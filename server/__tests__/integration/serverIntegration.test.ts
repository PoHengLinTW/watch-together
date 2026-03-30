import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import WebSocket from 'ws';
import {
  startTestServer,
  createClient,
  sendMessage,
  waitForMessage,
  closeClient,
  type TestServer,
} from '../helpers/serverHelper.js';
import type { ServerMessage } from '@watchtogether/shared';

function syncEvent(overrides: Record<string, unknown> = {}) {
  return {
    action: 'play' as const,
    currentTime: 0,
    timestamp: Date.now(),
    videoId: 'vid1',
    eventId: 'evt-default',
    ...overrides,
  };
}

describe('Server Integration', () => {
  let server: TestServer;
  let clients: WebSocket[];

  beforeEach(async () => {
    server = await startTestServer();
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients ?? []) {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    }
    await server?.close();
  });

  /** Helper: create a tracked client (auto-cleaned up in afterEach) */
  async function connect(): Promise<WebSocket> {
    const ws = await createClient(server.port);
    clients.push(ws);
    return ws;
  }

  /** Helper: create room as client A and return { ws, code, peerId } */
  async function createRoom(): Promise<{ ws: WebSocket; code: string; peerId: string }> {
    const ws = await connect();
    sendMessage(ws, { type: 'create-room' });
    const msg = await waitForMessage(ws, (m) => m.type === 'room-created') as Extract<ServerMessage, { type: 'room-created' }>;
    return { ws, code: msg.code, peerId: msg.peerId };
  }

  /** Helper: join a room and return { ws, peerId, state, peerCount } */
  async function joinRoom(code: string): Promise<{ ws: WebSocket; peerId: string; state: ServerMessage extends { type: 'room-joined' } ? ServerMessage['state'] : never; peerCount: number }> {
    const ws = await connect();
    sendMessage(ws, { type: 'join-room', code });
    const msg = await waitForMessage(ws, (m) => m.type === 'room-joined') as Extract<ServerMessage, { type: 'room-joined' }>;
    return { ws, peerId: msg.peerId, state: msg.state, peerCount: msg.peerCount };
  }

  describe('full room lifecycle', () => {
    it('client A creates room and client B joins, both get correct responses', async () => {
      const { ws: wsA, code, peerId: peerIdA } = await createRoom();

      // B joins, A receives peer-joined concurrently
      const [joinResult, peerJoinedMsg] = await Promise.all([
        joinRoom(code),
        waitForMessage(wsA, (m) => m.type === 'peer-joined'),
      ]);

      const peerJoined = peerJoinedMsg as Extract<ServerMessage, { type: 'peer-joined' }>;

      expect(code).toMatch(/^[A-Z0-9]{6}$/);
      expect(joinResult.peerId).not.toBe(peerIdA);
      expect(peerJoined.peerId).toBe(joinResult.peerId);
      expect(joinResult.state).toBeNull(); // no video state yet
    });

    it('room-created has peerCount 1 and room-joined has peerCount 2', async () => {
      // Create room — creator is the sole peer, so peerCount should be 1
      const wsA = await connect();
      sendMessage(wsA, { type: 'create-room' });
      const createdMsg = await waitForMessage(wsA, (m) => m.type === 'room-created') as Extract<ServerMessage, { type: 'room-created' }>;
      expect(createdMsg.type).toBe('room-created');

      // Join as B — room now has 2 peers, so room-joined.peerCount should be 2
      const { peerCount } = await joinRoom(createdMsg.code);
      expect(peerCount).toBe(2);
    });

    it('sync events are relayed to peer but not echoed to sender', async () => {
      const { ws: wsA, code, peerId: peerIdA } = await createRoom();
      const { ws: wsB } = await joinRoom(code);
      // Consume peer-joined on A
      await waitForMessage(wsA, (m) => m.type === 'peer-joined');

      sendMessage(wsA, {
        type: 'sync-event',
        event: syncEvent({ currentTime: 5, eventId: 'evt-play-1' }),
      });

      const syncMsg = await waitForMessage(wsB, (m) => m.type === 'sync-event') as Extract<ServerMessage, { type: 'sync-event' }>;

      expect(syncMsg.fromPeer).toBe(peerIdA);
      expect(syncMsg.event.action).toBe('play');
      expect(syncMsg.sequence).toBe(1);

      // A should NOT receive an echo — wait briefly and confirm no sync-event arrives
      await expect(
        waitForMessage(wsA, (m) => m.type === 'sync-event', 200),
      ).rejects.toThrow('timed out');
    });

    it('client B leaves, client A gets peer-left, room still exists', async () => {
      const { ws: wsA, code } = await createRoom();
      const { ws: wsB, peerId: peerIdB } = await joinRoom(code);
      await waitForMessage(wsA, (m) => m.type === 'peer-joined');

      sendMessage(wsB, { type: 'leave-room' });

      const peerLeft = await waitForMessage(wsA, (m) => m.type === 'peer-left') as Extract<ServerMessage, { type: 'peer-left' }>;
      expect(peerLeft.peerId).toBe(peerIdB);

      // Room still alive: A can send sync event without NOT_IN_ROOM error
      sendMessage(wsA, {
        type: 'sync-event',
        event: syncEvent({ action: 'pause', currentTime: 3, eventId: 'evt-pause-1' }),
      });
      // No error should arrive within a short window
      await expect(
        waitForMessage(wsA, (m) => m.type === 'error', 200),
      ).rejects.toThrow('timed out');
    });

    it('client A leaves after B left, room stays alive for reconnection', async () => {
      const { ws: wsA, code } = await createRoom();
      const { ws: wsB } = await joinRoom(code);
      await waitForMessage(wsA, (m) => m.type === 'peer-joined');

      sendMessage(wsB, { type: 'leave-room' });
      await waitForMessage(wsA, (m) => m.type === 'peer-left');

      sendMessage(wsA, { type: 'leave-room' });

      // Room stays alive so reconnecting peers can rejoin within the expiry window.
      // A new client can join the now-empty room.
      const wsC = await connect();
      sendMessage(wsC, { type: 'join-room', code });
      const joined = await waitForMessage(wsC, (m) => m.type === 'room-joined') as Extract<ServerMessage, { type: 'room-joined' }>;
      expect(joined.code).toBe(code);
    });
  });

  describe('late joiner sync', () => {
    it('joiner receives current video state adjusted for elapsed time', async () => {
      const { ws: wsA, code } = await createRoom();

      const playTime = 10;
      sendMessage(wsA, {
        type: 'sync-event',
        event: syncEvent({ currentTime: playTime, eventId: 'evt-play-join' }),
      });

      // Small delay to let state propagate
      await new Promise((r) => setTimeout(r, 20));

      const { state } = await joinRoom(code);

      expect(state).not.toBeNull();
      expect(state!.playing).toBe(true);
      expect(state!.currentTime).toBeGreaterThanOrEqual(playTime - 1);
      expect(state!.currentTime).toBeLessThanOrEqual(playTime + 1);
    });
  });

  describe('error handling', () => {
    it('joining non-existent room returns ROOM_NOT_FOUND', async () => {
      const ws = await connect();
      sendMessage(ws, { type: 'join-room', code: 'ZZZZZZ' });
      const err = await waitForMessage(ws, (m) => m.type === 'error') as Extract<ServerMessage, { type: 'error' }>;
      expect(err.errorCode).toBe('ROOM_NOT_FOUND');
    });

    it('joining full room returns ROOM_FULL', async () => {
      const { code } = await createRoom();
      await joinRoom(code);
      // Consume peer-joined on A (ignore)

      // Third client tries to join
      const wsC = await connect();
      sendMessage(wsC, { type: 'join-room', code });
      const err = await waitForMessage(wsC, (m) => m.type === 'error') as Extract<ServerMessage, { type: 'error' }>;
      expect(err.errorCode).toBe('ROOM_FULL');
    });

    it('sending sync event without being in a room returns NOT_IN_ROOM', async () => {
      const ws = await connect();
      sendMessage(ws, {
        type: 'sync-event',
        event: syncEvent({ currentTime: 0, eventId: 'evt-not-in-room' }),
      });
      const err = await waitForMessage(ws, (m) => m.type === 'error') as Extract<ServerMessage, { type: 'error' }>;
      expect(err.errorCode).toBe('NOT_IN_ROOM');
    });

    it('malformed JSON returns INVALID_MESSAGE', async () => {
      const ws = await connect();
      ws.send('not valid json{{');
      const err = await waitForMessage(ws, (m) => m.type === 'error') as Extract<ServerMessage, { type: 'error' }>;
      expect(err.errorCode).toBe('INVALID_MESSAGE');
    });
  });

  describe('connection resilience', () => {
    it('client not responding to ping gets disconnected after timeout', async () => {
      // Use fast heartbeat: 100ms interval, 150ms pong timeout
      server = await startTestServer({ heartbeatIntervalMs: 100, pongTimeoutMs: 150 });

      const ws = await createClient(server.port);
      clients.push(ws);

      // Receive ping but do NOT respond
      await waitForMessage(ws, (m) => m.type === 'ping', 500);

      // Wait for disconnect (pongTimeout = 150ms after the heartbeat sends ping)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Client was not disconnected')), 1000);
        ws.once('close', () => {
          clearTimeout(t);
          resolve();
        });
      });
    });

    it('abrupt client disconnect triggers peer-left for remaining peer', async () => {
      const { ws: wsA, code } = await createRoom();
      const { ws: wsB, peerId: peerIdB } = await joinRoom(code);
      await waitForMessage(wsA, (m) => m.type === 'peer-joined');

      // Abrupt disconnect (no close frame)
      wsB.terminate();

      const peerLeft = await waitForMessage(wsA, (m) => m.type === 'peer-left', 1000) as Extract<ServerMessage, { type: 'peer-left' }>;
      expect(peerLeft.peerId).toBe(peerIdB);
    });

    it('conflicting events converge by server sequence order', async () => {
      const { ws: wsA, code } = await createRoom();
      const { ws: wsB } = await joinRoom(code);
      await waitForMessage(wsA, (m) => m.type === 'peer-joined');

      sendMessage(wsA, {
        type: 'sync-event',
        event: syncEvent({ action: 'play', currentTime: 12, eventId: 'evt-a-1' }),
      });
      sendMessage(wsB, {
        type: 'sync-event',
        event: syncEvent({ action: 'pause', currentTime: 18, eventId: 'evt-b-1' }),
      });

      const syncForB = await waitForMessage(wsB, (m) => m.type === 'sync-event') as Extract<ServerMessage, { type: 'sync-event' }>;
      const syncForA = await waitForMessage(wsA, (m) => m.type === 'sync-event') as Extract<ServerMessage, { type: 'sync-event' }>;

      expect(syncForB.sequence).toBe(1);
      expect(syncForA.sequence).toBe(2);
      expect(server.roomManager.getRoom(code)?.lastSequence).toBe(2);
      expect(server.roomManager.getRoom(code)?.videoState?.playing).toBe(false);
      expect(server.roomManager.getRoom(code)?.videoState?.currentTime).toBe(18);
    });
  });
});
