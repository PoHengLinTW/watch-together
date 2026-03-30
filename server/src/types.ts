import type { WebSocket } from 'ws';
import type { VideoState } from '@watchtogether/shared';

export interface Room {
  code: string;
  peers: Map<string, WebSocket>;
  createdAt: number;
  lastActivity: number;
  videoState: VideoState | null;
  lastSequence: number;
}
