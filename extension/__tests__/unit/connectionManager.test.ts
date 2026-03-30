import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MockBrowserWebSocket, createWsFactory } from '../../../test/mocks/mockWebSocket.browser.js';
import { installMockChrome } from '../../../test/mocks/mockChrome.js';
import { ConnectionManager } from '../../src/background/ConnectionManager.js';
import type { ServerMessage } from '@watchtogether/shared';

const SERVER_URL = 'ws://localhost:8080';

describe('ConnectionManager', () => {
  beforeEach(() => {
    installMockChrome();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('connect', () => {
    it('should establish WebSocket to given server URL', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);

      expect(instances).toHaveLength(1);
      expect(instances[0].url).toBe(SERVER_URL);
    });

    it('should transition state to CONNECTING then CONNECTED', () => {
      const { factory, instances } = createWsFactory();
      const states: string[] = [];
      const manager = new ConnectionManager({
        wsFactory: factory as unknown as (url: string) => WebSocket,
        onStateChange: (s) => states.push(s),
      });

      manager.connect(SERVER_URL);
      expect(manager.getState()).toBe('CONNECTING');

      instances[0].simulateOpen();
      expect(manager.getState()).toBe('CONNECTED');
    });

    it('should reject if already connected', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();

      expect(() => manager.connect(SERVER_URL)).toThrow();
    });

    it('should handle connection failure by entering RECONNECTING state', () => {
      const { factory, instances } = createWsFactory();
      const states: string[] = [];
      const manager = new ConnectionManager({
        wsFactory: factory as unknown as (url: string) => WebSocket,
        onStateChange: (s) => states.push(s),
      });

      manager.connect(SERVER_URL);
      instances[0].simulateError();

      // First failure with retries remaining → RECONNECTING, not DISCONNECTED
      expect(manager.getState()).toBe('RECONNECTING');
    });
  });

  describe('reconnect', () => {
    it('should attempt reconnect with exponential backoff', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateClose(1006); // abnormal closure

      // After 1st failure: reconnect after 1000ms
      expect(instances).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(instances).toHaveLength(2);

      instances[1].simulateClose(1006);
      vi.advanceTimersByTime(2000);
      expect(instances).toHaveLength(3);
    });

    it('should cap backoff at 30 seconds', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();

      // Simulate 5 failures with increasing backoff
      for (let i = 0; i < 5; i++) {
        const ws = instances[instances.length - 1];
        ws.simulateClose(1006);
        const backoff = Math.min(1000 * Math.pow(2, i), 30000);
        vi.advanceTimersByTime(backoff);
        if (i < 4) {
          instances[instances.length - 1].simulateClose(1006);
        }
      }

      // At max backoff, wait 30s — should try again (not more than 30s wait)
      const countBefore = instances.length;
      vi.advanceTimersByTime(30000);
      expect(instances.length).toBeGreaterThanOrEqual(countBefore);
    });

    it('should switch to slow retry (60s) after exhausting 15 fast retries', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);

      // Exhaust all 15 fast retries:
      // Each iteration: close current socket → retryCount++ → advance past backoff → new socket opens
      // On the 16th close (retryCount === 15), slow-retry fires (no immediate new socket)
      for (let i = 0; i < 15; i++) {
        instances[instances.length - 1].simulateClose(1006);
        vi.advanceTimersByTime(30001); // past any fast backoff, opens next socket
      }
      // Close the 16th socket — retryCount is now 15 = MAX_RETRIES → slow retry
      instances[instances.length - 1].simulateClose(1006);

      // Should still be RECONNECTING, not DISCONNECTED
      expect(manager.getState()).toBe('RECONNECTING');

      // No new socket yet (slow retry fires after 60s)
      const countBefore = instances.length;
      vi.advanceTimersByTime(30001); // not enough for slow retry
      expect(instances.length).toBe(countBefore);

      // After 60s total past last close, slow retry fires
      vi.advanceTimersByTime(30001); // total: ~60s past the last close
      expect(instances.length).toBeGreaterThan(countBefore);
    });

    it('should keep slow-retrying indefinitely (not stop after one slow attempt)', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);

      // Exhaust fast retries
      for (let i = 0; i < 15; i++) {
        instances[instances.length - 1].simulateClose(1006);
        vi.advanceTimersByTime(30001);
      }
      instances[instances.length - 1].simulateClose(1006); // triggers slow retry

      // First slow retry fires at 60s
      vi.advanceTimersByTime(60001);
      instances[instances.length - 1].simulateClose(1006); // slow-retry socket fails too

      // Should schedule another 60s retry
      const countBefore = instances.length;
      vi.advanceTimersByTime(60001);
      expect(instances.length).toBeGreaterThan(countBefore);
      // After the retry fires, the new socket is CONNECTING (not DISCONNECTED)
      expect(manager.getState()).not.toBe('DISCONNECTED');
    });

    it('should rejoin room on successful reconnect', () => {
      const { factory, instances } = createWsFactory();
      const receivedMessages: unknown[] = [];
      const manager = new ConnectionManager({
        wsFactory: factory as unknown as (url: string) => WebSocket,
        onMessage: (m) => receivedMessages.push(m),
      });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();

      // Join a room
      manager.send({ type: 'join-room', code: 'ABC123' });
      instances[0].simulateMessage({ type: 'room-joined', code: 'ABC123', peerId: 'p1', state: null });
      manager.setState('IN_ROOM');

      // Simulate connection drop and reconnect
      instances[0].simulateClose(1006);
      vi.advanceTimersByTime(1000);
      instances[1].simulateOpen();

      // Should automatically send join-room after reconnect
      const sentMessages = instances[1].send.mock.calls.map(([d]: [string]) => JSON.parse(d));
      const joinMsg = sentMessages.find((m: { type: string }) => m.type === 'join-room');
      expect(joinMsg).toBeDefined();
    });
  });

  describe('send', () => {
    it('should serialize and send message over WebSocket', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();

      manager.send({ type: 'create-room' });

      expect(instances[0].send).toHaveBeenCalledWith(JSON.stringify({ type: 'create-room' }));
    });

    it('should queue messages if connecting (not yet open)', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);
      // Still CONNECTING — not yet open
      manager.send({ type: 'create-room' });

      // Message not sent yet
      expect(instances[0].send).not.toHaveBeenCalled();

      // After open, queued messages should be flushed
      instances[0].simulateOpen();
      expect(instances[0].send).toHaveBeenCalledWith(JSON.stringify({ type: 'create-room' }));
    });

    it('should throw if disconnected', () => {
      const { factory } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      expect(() => manager.send({ type: 'create-room' })).toThrow();
    });
  });

  describe('heartbeat', () => {
    it('should respond to server ping with pong', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();

      instances[0].simulateMessage({ type: 'ping' });

      const sent = instances[0].send.mock.calls.map(([d]: [string]) => JSON.parse(d));
      expect(sent).toContainEqual({ type: 'pong' });
    });

    it('should detect missed pings and trigger reconnect', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();

      // No ping received — advance past heartbeat timeout (45s)
      vi.advanceTimersByTime(46000);

      // Connection should have been closed and a reconnect attempted after backoff
      vi.advanceTimersByTime(1000);
      expect(instances.length).toBeGreaterThan(1);
    });
  });

  describe('room state tracking', () => {
    it('getRoomCode() returns null initially', () => {
      const { factory } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });
      expect(manager.getRoomCode()).toBeNull();
    });

    it('getRoomCode() returns code after room-created message', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });
      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateMessage({ type: 'room-created', code: 'ABC123', peerId: 'p1' });
      expect(manager.getRoomCode()).toBe('ABC123');
    });

    it('getRoomCode() returns code after room-joined message', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });
      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateMessage({ type: 'room-joined', code: 'XYZ789', peerId: 'p1', state: null });
      expect(manager.getRoomCode()).toBe('XYZ789');
    });

    it('getState() transitions to IN_ROOM on room-created', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });
      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateMessage({ type: 'room-created', code: 'ABC123', peerId: 'p1' });
      expect(manager.getState()).toBe('IN_ROOM');
    });

    it('getState() transitions to IN_ROOM on room-joined', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });
      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateMessage({ type: 'room-joined', code: 'XYZ789', peerId: 'p1', state: null });
      expect(manager.getState()).toBe('IN_ROOM');
    });

    it('getPeerCount() returns 0 initially', () => {
      const { factory } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });
      expect(manager.getPeerCount()).toBe(0);
    });

    it('getPeerCount() is 1 after room-created', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });
      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateMessage({ type: 'room-created', code: 'ABC123', peerId: 'p1' });
      expect(manager.getPeerCount()).toBe(1);
    });

    it('getPeerCount() is 2 after room-joined', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });
      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateMessage({ type: 'room-joined', code: 'XYZ789', peerId: 'p1', state: null });
      expect(manager.getPeerCount()).toBe(2);
    });

    it('getPeerCount() increments on peer-joined', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });
      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateMessage({ type: 'room-created', code: 'ABC123', peerId: 'p1' });
      expect(manager.getPeerCount()).toBe(1);
      instances[0].simulateMessage({ type: 'peer-joined', peerId: 'p2' });
      expect(manager.getPeerCount()).toBe(2);
    });

    it('getPeerCount() decrements on peer-left', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });
      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateMessage({ type: 'room-created', code: 'ABC123', peerId: 'p1' });
      instances[0].simulateMessage({ type: 'peer-joined', peerId: 'p2' });
      expect(manager.getPeerCount()).toBe(2);
      instances[0].simulateMessage({ type: 'peer-left', peerId: 'p2' });
      expect(manager.getPeerCount()).toBe(1);
    });

    it('clearRoom() resets roomCode, peerCount, and state to CONNECTED', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });
      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateMessage({ type: 'room-created', code: 'ABC123', peerId: 'p1' });
      expect(manager.getState()).toBe('IN_ROOM');
      manager.clearRoom();
      expect(manager.getRoomCode()).toBeNull();
      expect(manager.getPeerCount()).toBe(0);
      expect(manager.getState()).toBe('CONNECTED');
    });
  });

  describe('reconnecting state', () => {
    it('should enter RECONNECTING state (not DISCONNECTED) on abnormal close when retries remain', () => {
      const { factory, instances } = createWsFactory();
      const states: string[] = [];
      const manager = new ConnectionManager({
        wsFactory: factory as unknown as (url: string) => WebSocket,
        onStateChange: (s) => states.push(s),
      });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateClose(1006); // abnormal closure

      expect(manager.getState()).toBe('RECONNECTING');
      expect(states).toContain('RECONNECTING');
      expect(states).not.toContain('DISCONNECTED');
    });

    it('should remain RECONNECTING (slow retry) after exhausting all fast retries', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);

      // Each close+advance fires the retry and opens a new socket.
      // After 15 retries (retryCount reaches MAX_RETRIES=15), the next close triggers slow retry.
      for (let i = 0; i < 15; i++) {
        instances[instances.length - 1].simulateClose(1006);
        vi.advanceTimersByTime(30001); // advance past backoff, opens next socket
      }
      // Close the 16th socket — retryCount=15 = MAX_RETRIES → slow retry, stays RECONNECTING
      instances[instances.length - 1].simulateClose(1006);

      expect(manager.getState()).toBe('RECONNECTING');
    });

    it('should enter RECONNECTING on heartbeat timeout when retries remain', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();

      // Advance just past heartbeat timeout (45s) but before first retry fires (1s later)
      vi.advanceTimersByTime(45001);

      expect(manager.getState()).toBe('RECONNECTING');
    });

    it('should queue messages while RECONNECTING and flush on reconnect', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      instances[0].simulateClose(1006); // triggers RECONNECTING

      expect(manager.getState()).toBe('RECONNECTING');

      // Should not throw — messages should be queued
      expect(() => manager.send({ type: 'create-room' })).not.toThrow();

      // Advance timer so reconnect fires
      vi.advanceTimersByTime(1000);
      instances[1].simulateOpen();

      // Queued message should have been flushed
      const sent = instances[1].send.mock.calls.map(([d]: [string]) => JSON.parse(d));
      expect(sent).toContainEqual({ type: 'create-room' });
    });

    it('should only enter RECONNECTING once when both onerror and onclose fire', () => {
      const { factory, instances } = createWsFactory();
      const states: string[] = [];
      const manager = new ConnectionManager({
        wsFactory: factory as unknown as (url: string) => WebSocket,
        onStateChange: (s) => states.push(s),
      });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();

      // Real WebSocket fires both onerror AND onclose on a network drop
      instances[0].simulateError();
      instances[0].simulateClose(1006);

      // RECONNECTING should appear exactly once — guard prevents double-count
      expect(states.filter((s) => s === 'RECONNECTING')).toHaveLength(1);
      expect(manager.getState()).toBe('RECONNECTING');

      // Advance past first retry (1s) — exactly one new socket should be created
      vi.advanceTimersByTime(1000);
      expect(instances).toHaveLength(2);
    });

    it('should clear room code on clearRoom() to prevent auto-rejoin', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);
      instances[0].simulateOpen();
      manager.send({ type: 'join-room', code: 'ABC123' });
      instances[0].simulateMessage({ type: 'room-joined', code: 'ABC123', peerId: 'p1', state: null });
      manager.setState('IN_ROOM');

      // Clear the room before disconnect
      manager.clearRoom();

      // Reconnect
      instances[0].simulateClose(1006);
      vi.advanceTimersByTime(1000);
      instances[1].simulateOpen();

      // Should NOT send join-room on reconnect
      const sent = instances[1].send.mock.calls.map(([d]: [string]) => JSON.parse(d));
      const joinMsg = sent.find((m: { type: string }) => m.type === 'join-room');
      expect(joinMsg).toBeUndefined();
    });
  });
});
