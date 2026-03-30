// === Sync Events ===

export type SyncEvent =
  | { action: 'play'; currentTime: number; timestamp: number; videoId: string; eventId: string }
  | { action: 'pause'; currentTime: number; timestamp: number; videoId: string; eventId: string }
  | { action: 'seek'; currentTime: number; timestamp: number; videoId: string; eventId: string }
  | { action: 'playbackRate'; rate: number; timestamp: number; videoId: string; eventId: string }
  | { action: 'url-change'; url: string; timestamp: number; eventId: string };

// === Video State ===

export interface VideoState {
  url: string;
  videoId: string;
  currentTime: number;
  playing: boolean;
  playbackRate: number;
  updatedAt: number;
}

// === Error Codes ===

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NOT_IN_ROOM'
  | 'ALREADY_IN_ROOM'
  | 'INVALID_MESSAGE'
  | 'RATE_LIMITED';

// === Client → Server ===

export type ClientMessage =
  | { type: 'create-room' }
  | { type: 'join-room'; code: string }
  | { type: 'leave-room' }
  | { type: 'sync-event'; event: SyncEvent }
  | { type: 'pong' };

// === Server → Client ===

export type ServerMessage =
  | { type: 'room-created'; code: string; peerId: string }
  | { type: 'room-joined'; code: string; peerId: string; state: VideoState | null; peerCount: number }
  | { type: 'peer-joined'; peerId: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'sync-event'; event: SyncEvent; fromPeer: string; sequence: number }
  | { type: 'error'; message: string; errorCode: ErrorCode }
  | { type: 'ping' };
