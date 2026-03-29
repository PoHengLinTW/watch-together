import type { ClientMessage, ServerMessage } from '@watchtogether/shared';

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'IN_ROOM';

interface ConnectionManagerOptions {
  wsFactory?: (url: string) => WebSocket;
  onMessage?: (msg: ServerMessage) => void;
  onStateChange?: (state: ConnectionState) => void;
}

const MAX_RETRIES = 5;
const HEARTBEAT_TIMEOUT_MS = 45000;

function backoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

export class ConnectionManager {
  private wsFactory: (url: string) => WebSocket;
  private onMessage: ((msg: ServerMessage) => void) | undefined;
  private onStateChange: ((state: ConnectionState) => void) | undefined;

  private state: ConnectionState = 'DISCONNECTED';
  private ws: WebSocket | null = null;
  private url = '';
  private messageQueue: string[] = [];

  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  private roomCode: string | null = null;

  constructor(options: ConnectionManagerOptions = {}) {
    this.wsFactory = options.wsFactory ?? ((url) => new WebSocket(url));
    this.onMessage = options.onMessage;
    this.onStateChange = options.onStateChange;
  }

  getState(): ConnectionState {
    return this.state;
  }

  setState(state: ConnectionState): void {
    this.state = state;
    this.onStateChange?.(state);
  }

  connect(url: string): void {
    if (this.state !== 'DISCONNECTED') {
      throw new Error(`Cannot connect: already in state ${this.state}`);
    }
    this.url = url;
    this.openSocket();
  }

  disconnect(): void {
    this.clearHeartbeat();
    this.clearRetry();
    this.ws?.close();
    this.ws = null;
    this.setState('DISCONNECTED');
  }

  send(message: ClientMessage): void {
    if (this.state === 'DISCONNECTED') {
      throw new Error('Cannot send: not connected');
    }
    const serialized = JSON.stringify(message);
    if (this.state === 'CONNECTING') {
      this.messageQueue.push(serialized);
      return;
    }
    this.ws!.send(serialized);
  }

  private openSocket(): void {
    this.setState('CONNECTING');
    const ws = this.wsFactory(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retryCount = 0;
      this.setState('CONNECTED');
      this.flushQueue();
      this.resetHeartbeat();

      if (this.roomCode !== null) {
        this.ws!.send(JSON.stringify({ type: 'join-room', code: this.roomCode }));
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as ServerMessage;

      if (msg.type === 'ping') {
        this.ws?.send(JSON.stringify({ type: 'pong' }));
        this.resetHeartbeat();
        return;
      }

      if (msg.type === 'room-joined') {
        this.roomCode = msg.code;
      }

      this.onMessage?.(msg);
    };

    ws.onclose = (event: CloseEvent) => {
      if (event.code === 1000) {
        // Normal close — don't reconnect
        this.setState('DISCONNECTED');
        return;
      }
      this.handleDisconnect();
    };

    ws.onerror = () => {
      this.handleDisconnect();
    };
  }

  private handleDisconnect(): void {
    this.clearHeartbeat();
    this.ws = null;
    this.setState('DISCONNECTED');

    if (this.retryCount < MAX_RETRIES) {
      const delay = backoffMs(this.retryCount);
      this.retryCount++;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.openSocket();
      }, delay);
    }
  }

  private flushQueue(): void {
    for (const msg of this.messageQueue) {
      this.ws?.send(msg);
    }
    this.messageQueue = [];
  }

  private resetHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      // No ping received in time — force reconnect
      this.ws?.close(4000, 'heartbeat timeout');
      this.ws = null;
      this.setState('DISCONNECTED');
      if (this.retryCount < MAX_RETRIES) {
        const delay = backoffMs(this.retryCount);
        this.retryCount++;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.openSocket();
        }, delay);
      }
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
