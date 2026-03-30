import { describe, it, expect, beforeEach } from 'vitest';
import { MessageHandler } from '../../src/MessageHandler.js';
import { RoomManager } from '../../src/RoomManager.js';
import { createMockWebSocket, getSentMessages } from '../helpers/mockWebSocket.js';

function syncEvent(overrides: Record<string, unknown> = {}) {
  return {
    action: 'play' as const,
    currentTime: 10,
    timestamp: 1000,
    videoId: 'v1',
    eventId: 'evt-1',
    ...overrides,
  };
}

describe('MessageHandler', () => {
  let roomManager: RoomManager;
  let handler: MessageHandler;

  beforeEach(() => {
    roomManager = new RoomManager();
    handler = new MessageHandler(roomManager);
  });

  describe('parseMessage', () => {
    it('should parse valid JSON messages', () => {
      const result = handler.parseMessage('{"type":"create-room"}');
      expect(result).toEqual({ type: 'create-room' });
    });

    it('should reject non-JSON messages with error', () => {
      const result = handler.parseMessage('not json');
      expect(result).toMatchObject({ error: 'INVALID_MESSAGE' });
    });

    it('should reject messages missing "type" field', () => {
      const result = handler.parseMessage('{"foo":"bar"}');
      expect(result).toMatchObject({ error: 'INVALID_MESSAGE' });
    });

    it('should reject unknown message types', () => {
      const result = handler.parseMessage('{"type":"unknown-type"}');
      expect(result).toMatchObject({ error: 'INVALID_MESSAGE' });
    });

    it('should reject messages exceeding 10KB', () => {
      const big = JSON.stringify({ type: 'create-room', pad: 'x'.repeat(10241) });
      const result = handler.parseMessage(big);
      expect(result).toMatchObject({ error: 'INVALID_MESSAGE' });
    });
  });

  describe('handleSyncEvent', () => {
    let codeA: string;
    let wsA: ReturnType<typeof createMockWebSocket>;
    let wsB: ReturnType<typeof createMockWebSocket>;

    beforeEach(() => {
      wsA = createMockWebSocket();
      wsB = createMockWebSocket();
      codeA = roomManager.createRoom();
      roomManager.joinRoom(codeA, 'peerA', wsA);
      roomManager.joinRoom(codeA, 'peerB', wsB);
    });

    it('should relay sync event to all other peers in room', () => {
      handler.handleMessage('peerA', wsA, JSON.stringify({
        type: 'sync-event',
        event: syncEvent(),
      }));
      const messagesB = getSentMessages(wsB);
      expect(messagesB.some((m: unknown) => (m as Record<string, unknown>).type === 'sync-event')).toBe(true);
    });

    it('should NOT echo sync event back to sender', () => {
      handler.handleMessage('peerA', wsA, JSON.stringify({
        type: 'sync-event',
        event: syncEvent(),
      }));
      const messagesA = getSentMessages(wsA);
      expect(messagesA.some((m: unknown) => (m as Record<string, unknown>).type === 'sync-event')).toBe(false);
    });

    it('should update room videoState on play/pause/seek', () => {
      handler.handleMessage('peerA', wsA, JSON.stringify({
        type: 'sync-event',
        event: syncEvent({ currentTime: 42 }),
      }));
      const room = roomManager.getRoom(codeA);
      expect(room!.videoState).not.toBeNull();
      expect(room!.videoState!.playing).toBe(true);
      expect(room!.videoState!.currentTime).toBe(42);
    });

    it('should reject sync event if sender is not in a room', () => {
      const wsUnknown = createMockWebSocket();
      handler.handleMessage('unknownPeer', wsUnknown, JSON.stringify({
        type: 'sync-event',
        event: syncEvent({ currentTime: 0 }),
      }));
      const messages = getSentMessages(wsUnknown);
      expect(messages.some((m: unknown) => (m as Record<string, unknown>).type === 'error')).toBe(true);
    });

    it('should attach fromPeer to relayed event', () => {
      handler.handleMessage('peerA', wsA, JSON.stringify({
        type: 'sync-event',
        event: syncEvent({ action: 'pause', currentTime: 5 }),
      }));
      const messagesB = getSentMessages(wsB);
      const syncMsg = messagesB.find((m: unknown) => (m as Record<string, unknown>).type === 'sync-event') as Record<string, unknown> | undefined;
      expect(syncMsg).toBeDefined();
      expect(syncMsg!.fromPeer).toBe('peerA');
      expect(syncMsg!.sequence).toBe(1);
    });

    it('should increment room sequence for each sync event', () => {
      handler.handleMessage('peerA', wsA, JSON.stringify({
        type: 'sync-event',
        event: syncEvent({ eventId: 'evt-1' }),
      }));
      handler.handleMessage('peerA', wsA, JSON.stringify({
        type: 'sync-event',
        event: syncEvent({ action: 'pause', eventId: 'evt-2' }),
      }));

      const messagesB = getSentMessages(wsB).filter((m: unknown) => (m as Record<string, unknown>).type === 'sync-event') as Record<string, unknown>[];
      expect(messagesB[0]?.sequence).toBe(1);
      expect(messagesB[1]?.sequence).toBe(2);
      expect(roomManager.getRoom(codeA)?.lastSequence).toBe(2);
    });
  });

  describe('handleCreateRoom', () => {
    it('should create room and send room-created response', () => {
      const ws = createMockWebSocket();
      handler.handleMessage('peer1', ws, JSON.stringify({ type: 'create-room' }));
      const messages = getSentMessages(ws);
      const created = messages.find((m: unknown) => (m as Record<string, unknown>).type === 'room-created') as Record<string, unknown> | undefined;
      expect(created).toBeDefined();
      expect(typeof created!.code).toBe('string');
      expect(created!.peerId).toBe('peer1');
    });

    it('should auto-join creator to the new room', () => {
      const ws = createMockWebSocket();
      handler.handleMessage('peer1', ws, JSON.stringify({ type: 'create-room' }));
      const messages = getSentMessages(ws);
      const created = messages.find((m: unknown) => (m as Record<string, unknown>).type === 'room-created') as Record<string, unknown>;
      const room = roomManager.getRoom(created.code as string);
      expect(room).toBeDefined();
      expect(room!.peers.has('peer1')).toBe(true);
    });

    it('should reject if peer is already in a room', () => {
      const ws = createMockWebSocket();
      handler.handleMessage('peer1', ws, JSON.stringify({ type: 'create-room' }));
      ws.send.mockClear();
      handler.handleMessage('peer1', ws, JSON.stringify({ type: 'create-room' }));
      const messages = getSentMessages(ws);
      expect(messages.some((m: unknown) => (m as Record<string, unknown>).type === 'error')).toBe(true);
    });
  });

  describe('handleJoinRoom', () => {
    let existingCode: string;
    let wsA: ReturnType<typeof createMockWebSocket>;

    beforeEach(() => {
      wsA = createMockWebSocket();
      existingCode = roomManager.createRoom();
      roomManager.joinRoom(existingCode, 'peerA', wsA);
    });

    it('should join room and send room-joined with state', () => {
      const wsB = createMockWebSocket();
      handler.handleMessage('peerB', wsB, JSON.stringify({ type: 'join-room', code: existingCode }));
      const messages = getSentMessages(wsB);
      const joined = messages.find((m: unknown) => (m as Record<string, unknown>).type === 'room-joined') as Record<string, unknown> | undefined;
      expect(joined).toBeDefined();
      expect(joined!.code).toBe(existingCode);
      expect(joined!.peerId).toBe('peerB');
      expect('state' in joined!).toBe(true);
    });

    it('should notify existing peer of new peer', () => {
      const wsB = createMockWebSocket();
      handler.handleMessage('peerB', wsB, JSON.stringify({ type: 'join-room', code: existingCode }));
      const messagesA = getSentMessages(wsA);
      const peerJoined = messagesA.find((m: unknown) => (m as Record<string, unknown>).type === 'peer-joined') as Record<string, unknown> | undefined;
      expect(peerJoined).toBeDefined();
      expect(peerJoined!.peerId).toBe('peerB');
    });

    it('should send error for invalid room code', () => {
      const wsB = createMockWebSocket();
      handler.handleMessage('peerB', wsB, JSON.stringify({ type: 'join-room', code: 'ZZZZZZ' }));
      const messages = getSentMessages(wsB);
      const err = messages.find((m: unknown) => (m as Record<string, unknown>).type === 'error') as Record<string, unknown> | undefined;
      expect(err).toBeDefined();
      expect(err!.errorCode).toBe('ROOM_NOT_FOUND');
    });

    it('should send error for full room', () => {
      const wsB = createMockWebSocket();
      roomManager.joinRoom(existingCode, 'peerB', wsB);
      const wsC = createMockWebSocket();
      handler.handleMessage('peerC', wsC, JSON.stringify({ type: 'join-room', code: existingCode }));
      const messages = getSentMessages(wsC);
      const err = messages.find((m: unknown) => (m as Record<string, unknown>).type === 'error') as Record<string, unknown> | undefined;
      expect(err).toBeDefined();
      expect(err!.errorCode).toBe('ROOM_FULL');
    });
  });
});
