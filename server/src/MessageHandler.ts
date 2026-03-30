import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, ErrorCode } from '@watchtogether/shared';
import type { RoomManager } from './RoomManager.js';
import type { Logger } from './Logger.js';
import { applyEvent } from './VideoState.js';

const MAX_MESSAGE_BYTES = 10 * 1024; // 10KB

const VALID_CLIENT_TYPES: Set<ClientMessage['type']> = new Set([
  'create-room',
  'join-room',
  'leave-room',
  'sync-event',
  'pong',
]);

export type ParseResult = ClientMessage | { error: ErrorCode; message: string };

export class MessageHandler {
  constructor(
    private readonly roomManager: RoomManager,
    private readonly logger?: Logger,
  ) {}

  /**
   * Parse and validate a raw WebSocket message string.
   * Returns the parsed ClientMessage or an error descriptor.
   */
  parseMessage(data: string): ParseResult {
    if (data.length > MAX_MESSAGE_BYTES) {
      return { error: 'INVALID_MESSAGE', message: 'Message exceeds maximum size' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return { error: 'INVALID_MESSAGE', message: 'Message is not valid JSON' };
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return { error: 'INVALID_MESSAGE', message: 'Message must be a JSON object' };
    }

    const msg = parsed as Record<string, unknown>;

    if (typeof msg['type'] !== 'string') {
      return { error: 'INVALID_MESSAGE', message: 'Message missing required "type" field' };
    }

    if (!VALID_CLIENT_TYPES.has(msg['type'] as ClientMessage['type'])) {
      return { error: 'INVALID_MESSAGE', message: `Unknown message type: ${msg['type']}` };
    }

    return parsed as ClientMessage;
  }

  /**
   * Handle an incoming raw WebSocket message from a connected peer.
   * Routes to the appropriate handler based on message type.
   */
  handleMessage(peerId: string, ws: WebSocket, data: string): void {
    const result = this.parseMessage(data);

    if ('error' in result) {
      this.sendError(ws, result.error, result.message);
      return;
    }

    switch (result.type) {
      case 'create-room':
        this.handleCreateRoom(peerId, ws);
        break;
      case 'join-room':
        this.handleJoinRoom(peerId, ws, result.code);
        break;
      case 'leave-room':
        this.handleLeaveRoom(peerId);
        break;
      case 'sync-event':
        this.handleSyncEvent(peerId, ws, result);
        break;
      case 'pong':
        this.handlePong(peerId);
        break;
    }
  }

  private handleCreateRoom(peerId: string, ws: WebSocket): void {
    const code = this.roomManager.createRoom();
    const joinResult = this.roomManager.joinRoom(code, peerId, ws);

    if ('error' in joinResult) {
      this.sendError(ws, joinResult.error, joinResult.message);
      return;
    }

    this.logger?.info('Room created', { code, peerId });
    this.send(ws, { type: 'room-created', code, peerId });
  }

  private handleJoinRoom(peerId: string, ws: WebSocket, code: string): void {
    const joinResult = this.roomManager.joinRoom(code, peerId, ws);

    if ('error' in joinResult) {
      this.sendError(ws, joinResult.error, joinResult.message);
      return;
    }

    this.logger?.info('Peer joined room', { code: code.toUpperCase(), peerId });
    const room = this.roomManager.getRoom(code);
    const peerCount = room ? room.peers.size : 1;
    this.send(ws, { type: 'room-joined', code: code.toUpperCase(), peerId, state: joinResult.videoState, peerCount });

    // Notify existing peers
    if (room) {
      for (const [existingPeerId, existingWs] of room.peers) {
        if (existingPeerId !== peerId) {
          this.send(existingWs, { type: 'peer-joined', peerId });
        }
      }
    }
  }

  private handleLeaveRoom(peerId: string): void {
    const leaveResult = this.roomManager.leaveRoom(peerId);
    if (!leaveResult) return;

    this.logger?.info('Peer left room', { peerId: leaveResult.leavingPeerId });
    for (const [, remainingWs] of leaveResult.remainingPeers) {
      this.send(remainingWs, { type: 'peer-left', peerId: leaveResult.leavingPeerId });
    }
  }

  private handleSyncEvent(peerId: string, ws: WebSocket, message: Extract<ClientMessage, { type: 'sync-event' }>): void {
    const room = this.roomManager.getRoomForPeer(peerId);
    if (!room) {
      this.sendError(ws, 'NOT_IN_ROOM', 'Peer is not in a room');
      return;
    }

    // Update room's video state
    room.videoState = applyEvent(room.videoState, message.event);
    this.roomManager.updateActivity(room.code);

    // Relay to all other peers
    for (const [otherPeerId, otherWs] of room.peers) {
      if (otherPeerId !== peerId) {
        this.send(otherWs, { type: 'sync-event', event: message.event, fromPeer: peerId });
      }
    }
  }

  private handlePong(peerId: string): void {
    const room = this.roomManager.getRoomForPeer(peerId);
    if (room) {
      this.roomManager.updateActivity(room.code);
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    ws.send(JSON.stringify(message));
  }

  private sendError(ws: WebSocket, errorCode: ErrorCode, message: string): void {
    this.logger?.warn('Error sent to client', { errorCode, message });
    this.send(ws, { type: 'error', message, errorCode });
  }
}
