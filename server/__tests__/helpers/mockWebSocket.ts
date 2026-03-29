import { vi } from 'vitest';
import type { WebSocket } from 'ws';

export interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
}

/** Create a minimal WebSocket mock suitable for passing to RoomManager and MessageHandler. */
export function createMockWebSocket(): MockWebSocket & WebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1, // WebSocket.OPEN
  } as unknown as MockWebSocket & WebSocket;
}

/** Parse all calls to mock.send() as JSON and return the array of objects. */
export function getSentMessages(mock: MockWebSocket): unknown[] {
  return mock.send.mock.calls.map(([data]: [string]) => JSON.parse(data));
}
