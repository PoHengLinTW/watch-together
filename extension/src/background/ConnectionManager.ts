import type { ClientMessage, ServerMessage } from '@watchtogether/shared';
import type { DebugLogger } from '../shared/debug';

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'IN_ROOM' | 'RECONNECTING';

interface ConnectionManagerOptions {
  wsFactory?: (url: string) => WebSocket;
  onMessage?: (msg: ServerMessage) => void;
  onStateChange?: (state: ConnectionState) => void;
  logger?: DebugLogger;
}

const MAX_RETRIES = 15;
const HEARTBEAT_TIMEOUT_MS = 45000;
const SLOW_RETRY_MS = 60000;

function backoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

export class ConnectionManager {
  private wsFactory: (url: string) => WebSocket;
  private onMessage: ((msg: ServerMessage) => void) | undefined;
  private onStateChange: ((state: ConnectionState) => void) | undefined;
  private logger: DebugLogger | undefined;

  private state: ConnectionState = 'DISCONNECTED';
  private ws: WebSocket | null = null;
  private url = '';
  private messageQueue: string[] = [];

  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  private disconnecting = false;

  private roomCode: string | null = null;
  private peerCount = 0;

  constructor(options: ConnectionManagerOptions = {}) {
    this.wsFactory = options.wsFactory ?? ((url) => new WebSocket(url));
    this.onMessage = options.onMessage;
    this.onStateChange = options.onStateChange;
    this.logger = options.logger;
  }

  getState(): ConnectionState {
    return this.state;
  }

  getRoomCode(): string | null {
    return this.roomCode;
  }

  getPeerCount(): number {
    return this.peerCount;
  }

  setState(state: ConnectionState): void {
    this.state = state;
    this.logger?.log('connection:state', {
      state,
      roomCode: this.roomCode,
      peerCount: this.peerCount,
      retryCount: this.retryCount,
    });
    this.onStateChange?.(state);
  }

  connect(url: string): void {
    if (this.state !== 'DISCONNECTED' && this.state !== 'RECONNECTING') {
      throw new Error(`Cannot connect: already in state ${this.state}`);
    }
    this.url = url;
    this.logger?.log('ws:connect', { url, state: this.state });
    this.openSocket();
  }

  disconnect(): void {
    this.disconnecting = false;
    this.retryCount = 0;
    this.clearHeartbeat();
    this.clearRetry();
    this.logger?.log('ws:disconnect', { roomCode: this.roomCode, peerCount: this.peerCount });
    this.ws?.close();
    this.ws = null;
    this.roomCode = null;
    this.peerCount = 0;
    this.setState('DISCONNECTED');
  }

  send(message: ClientMessage): void {
    if (this.state === 'DISCONNECTED') {
      throw new Error('Cannot send: not connected');
    }
    const serialized = JSON.stringify(message);
    if (this.state === 'CONNECTING' || this.state === 'RECONNECTING') {
      this.messageQueue.push(serialized);
      this.logger?.log('ws:queue-send', {
        message,
        state: this.state,
        queueLength: this.messageQueue.length,
      });
      return;
    }
    this.logger?.log('ws:send', { message, state: this.state });
    this.ws!.send(serialized);
  }

  clearRoom(): void {
    this.roomCode = null;
    this.peerCount = 0;
    if (this.state === 'IN_ROOM') {
      this.setState('CONNECTED');
    }
  }

  private openSocket(): void {
    // Reset before creating the socket so that any onerror/onclose fired
    // synchronously during construction doesn't get swallowed by the guard.
    this.disconnecting = false;
    this.setState('CONNECTING');
    this.logger?.log('ws:open-socket', { url: this.url });
    const ws = this.wsFactory(this.url);
    this.ws = ws;

    ws.onopen = () => {
      // Reset again on open: a race between onerror and onopen could leave
      // disconnecting=true, which would block the next handleDisconnect call.
      this.disconnecting = false;
      this.retryCount = 0;
      this.logger?.log('ws:open', { url: this.url, queuedMessages: this.messageQueue.length });
      this.setState('CONNECTED');
      this.flushQueue();
      this.resetHeartbeat();

      if (this.roomCode !== null) {
        const joinMessage: ClientMessage = { type: 'join-room', code: this.roomCode };
        this.logger?.log('ws:rejoin-room', joinMessage);
        this.ws!.send(JSON.stringify(joinMessage));
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      this.logger?.log('ws:recv', msg);

      if (msg.type === 'ping') {
        this.logger?.log('ws:ping', { roomCode: this.roomCode });
        this.ws?.send(JSON.stringify({ type: 'pong' }));
        this.logger?.log('ws:send', { message: { type: 'pong' }, state: this.state });
        this.resetHeartbeat();
        return;
      }

      if (msg.type === 'room-created') {
        this.roomCode = msg.code;
        this.peerCount = 1;
        this.setState('IN_ROOM');
      } else if (msg.type === 'room-joined') {
        this.roomCode = msg.code;
        this.peerCount = msg.peerCount;
        this.setState('IN_ROOM');
      } else if (msg.type === 'peer-joined') {
        this.peerCount++;
      } else if (msg.type === 'peer-left') {
        this.peerCount = Math.max(0, this.peerCount - 1);
      }

      this.onMessage?.(msg);
    };

    ws.onclose = (event: CloseEvent) => {
      this.logger?.log('ws:close', { code: event.code, reason: event.reason, disconnecting: this.disconnecting });
      if (event.code === 1000) {
        // Normal close — don't reconnect
        this.setState('DISCONNECTED');
        return;
      }
      this.handleDisconnect();
    };

    ws.onerror = () => {
      this.logger?.log('ws:error', { state: this.state, roomCode: this.roomCode });
      this.handleDisconnect();
    };
  }

  private handleDisconnect(): void {
    if (this.disconnecting) return;
    this.disconnecting = true;
    this.clearHeartbeat();
    this.ws = null;

    this.setState('RECONNECTING');
    if (this.retryCount < MAX_RETRIES) {
      const delay = backoffMs(this.retryCount);
      this.retryCount++;
      this.logger?.log('ws:reconnect-scheduled', {
        delay,
        retryCount: this.retryCount,
        mode: 'fast',
      });
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.openSocket();
      }, delay);
    } else {
      // Fast retries exhausted — slow retry every 60s indefinitely
      this.logger?.log('ws:reconnect-scheduled', {
        delay: SLOW_RETRY_MS,
        retryCount: this.retryCount,
        mode: 'slow',
      });
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.openSocket();
      }, SLOW_RETRY_MS);
    }
  }

  private flushQueue(): void {
    this.logger?.log('ws:flush-queue', { queueLength: this.messageQueue.length });
    for (const msg of this.messageQueue) {
      this.logger?.log('ws:send', { message: JSON.parse(msg) as ClientMessage, state: this.state, queued: true });
      this.ws?.send(msg);
    }
    this.messageQueue = [];
  }

  private resetHeartbeat(): void {
    this.clearHeartbeat();
    this.logger?.log('ws:heartbeat-reset', { timeoutMs: HEARTBEAT_TIMEOUT_MS });
    this.heartbeatTimer = setTimeout(() => {
      // No ping received in time — force reconnect
      this.logger?.log('ws:heartbeat-timeout', { timeoutMs: HEARTBEAT_TIMEOUT_MS });
      this.ws?.close(4000, 'heartbeat timeout');
      this.ws = null;
      this.handleDisconnect();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
