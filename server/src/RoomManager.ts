import type { WebSocket } from 'ws';
import type { VideoState, ErrorCode } from '@watchtogether/shared';
import type { Room } from './types.js';
import { generateRoomCode } from './utils.js';

const MAX_PEERS = 2;
const EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const MAX_CODE_RETRIES = 10;

export type JoinResult =
  | { videoState: VideoState | null }
  | { error: ErrorCode; message: string };

export interface LeaveResult {
  leavingPeerId: string;
  remainingPeers: Map<string, WebSocket>;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private peerToRoom = new Map<string, string>();

  /** Create a new empty room. Returns the room code. */
  createRoom(): string {
    let code: string;
    let attempts = 0;
    do {
      if (attempts >= MAX_CODE_RETRIES) {
        throw new Error('Failed to generate unique room code after max retries');
      }
      code = generateRoomCode();
      attempts++;
    } while (this.rooms.has(code));

    const now = Date.now();
    const room: Room = {
      code,
      peers: new Map(),
      createdAt: now,
      lastActivity: now,
      videoState: null,
    };
    this.rooms.set(code, room);
    return code;
  }

  /** Add a peer to an existing room. Returns the current video state on success. */
  joinRoom(code: string, peerId: string, ws: WebSocket): JoinResult {
    const normalizedCode = code.toUpperCase();

    if (this.peerToRoom.has(peerId)) {
      return { error: 'ALREADY_IN_ROOM', message: 'Peer is already in a room' };
    }

    const room = this.rooms.get(normalizedCode);
    if (!room) {
      return { error: 'ROOM_NOT_FOUND', message: `Room ${normalizedCode} not found` };
    }

    if (room.peers.size >= MAX_PEERS) {
      return { error: 'ROOM_FULL', message: 'Room is full' };
    }

    room.peers.set(peerId, ws);
    this.peerToRoom.set(peerId, normalizedCode);
    room.lastActivity = Date.now();

    return { videoState: room.videoState };
  }

  /**
   * Remove a peer from their room.
   * Returns remaining peers and metadata so the caller can send notifications,
   * or null if the peer was not in any room.
   */
  leaveRoom(peerId: string): LeaveResult | null {
    const code = this.peerToRoom.get(peerId);
    if (!code) return null;

    const room = this.rooms.get(code);
    if (!room) {
      this.peerToRoom.delete(peerId);
      return null;
    }

    room.peers.delete(peerId);
    this.peerToRoom.delete(peerId);

    // Keep empty rooms alive so reconnecting peers can rejoin within the
    // sweep expiry window. sweepExpiredRooms() handles eventual cleanup.
    room.lastActivity = Date.now();

    return {
      leavingPeerId: peerId,
      remainingPeers: new Map(room.peers),
    };
  }

  /** Look up a room by code (case-insensitive). */
  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Look up the room a peer currently belongs to. */
  getRoomForPeer(peerId: string): Room | undefined {
    const code = this.peerToRoom.get(peerId);
    if (!code) return undefined;
    return this.rooms.get(code);
  }

  /** Record recent activity for a room to prevent expiry. */
  updateActivity(code: string): void {
    const room = this.rooms.get(code.toUpperCase());
    if (room) {
      room.lastActivity = Date.now();
    }
  }

  /** Remove rooms that have had no activity for over 1 hour. */
  sweepExpiredRooms(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > EXPIRY_MS) {
        for (const peerId of room.peers.keys()) {
          this.peerToRoom.delete(peerId);
        }
        this.rooms.delete(code);
      }
    }
  }
}
