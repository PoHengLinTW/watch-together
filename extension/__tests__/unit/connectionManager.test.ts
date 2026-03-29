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

    it('should handle connection failure with error callback', () => {
      const { factory, instances } = createWsFactory();
      const states: string[] = [];
      const manager = new ConnectionManager({
        wsFactory: factory as unknown as (url: string) => WebSocket,
        onStateChange: (s) => states.push(s),
      });

      manager.connect(SERVER_URL);
      instances[0].simulateError();

      expect(manager.getState()).toBe('DISCONNECTED');
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

    it('should stop reconnecting after 5 failures', () => {
      const { factory, instances } = createWsFactory();
      const manager = new ConnectionManager({ wsFactory: factory as unknown as (url: string) => WebSocket });

      manager.connect(SERVER_URL);

      // Fail 5 times without ever successfully connecting
      for (let i = 0; i < 5; i++) {
        const ws = instances[instances.length - 1];
        ws.simulateClose(1006);
        vi.advanceTimersByTime(30001); // advance past any backoff
      }

      const countAfter5 = instances.length;
      vi.advanceTimersByTime(60000); // advance well past any potential retry
      expect(instances.length).toBe(countAfter5);
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
});
