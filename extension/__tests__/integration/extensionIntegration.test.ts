import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockVideoElement } from '../../../test/mocks/mockVideo';
import { createWsFactory } from '../../../test/mocks/mockWebSocket.browser';
import { initBackground } from '../../src/background/index';
import { initContentScript } from '../../src/content/index';

// ---------------------------------------------------------------------------
// Functional Chrome messaging mock
// Routes messages synchronously between background and per-tab listeners.
// ---------------------------------------------------------------------------

type MessageListener = (msg: unknown, sender: unknown, sendResponse: () => void) => void;

function createIntegrationChrome() {
  const bgListeners: MessageListener[] = [];
  const tabListeners = new Map<number, MessageListener[]>();

  const bgChrome = {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: {
        addListener: (fn: MessageListener) => bgListeners.push(fn),
        removeListener: (fn: MessageListener) => {
          const idx = bgListeners.indexOf(fn);
          if (idx !== -1) bgListeners.splice(idx, 1);
        },
      },
    },
    tabs: {
      query: vi.fn().mockImplementation((_q: unknown, cb?: (tabs: { id: number }[]) => void) => {
        const tabs = [...tabListeners.keys()].map((id) => ({ id }));
        if (cb) {
          cb(tabs);
          return;
        }
        return Promise.resolve(tabs);
      }),
      sendMessage: vi.fn().mockImplementation((tabId: number, msg: unknown) => {
        const listeners = tabListeners.get(tabId) ?? [];
        for (const fn of listeners) fn(msg, {}, () => {});
      }),
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(),
      onAlarm: {
        addListener: vi.fn(),
      },
    },
  };

  function createTabChrome(tabId: number) {
    return {
      runtime: {
        sendMessage: vi.fn().mockImplementation((msg: unknown) => {
          for (const fn of bgListeners) {
            fn(msg, { tab: { id: tabId } }, () => {});
          }
        }),
        onMessage: {
          addListener: (fn: MessageListener) => {
            if (!tabListeners.has(tabId)) tabListeners.set(tabId, []);
            tabListeners.get(tabId)!.push(fn);
          },
          removeListener: vi.fn(),
        },
      },
    };
  }

  return { bgChrome, createTabChrome };
}

// ---------------------------------------------------------------------------
// Mock document factory
// ---------------------------------------------------------------------------

function createMockDocument(videos: MockVideoElement[]) {
  return {
    querySelectorAll: (selector: string) => {
      if (selector === 'video[data-vid]' || selector === 'video.video-js' || selector === 'video.vjs-tech') {
        return videos as unknown as NodeListOf<Element>;
      }
      return [] as unknown as NodeListOf<Element>;
    },
    querySelector: (selector: string) => {
      // Match: video[data-vid="X"]
      const match = selector.match(/video\[data-vid="([^"]+)"\]/);
      if (match) {
        return (videos.find((v) => v.dataset.vid === match[1]) ?? null) as unknown as Element | null;
      }
      return null;
    },
    body: {} as HTMLElement,
  };
}

// ---------------------------------------------------------------------------
// MutationObserver stub (not available in Node test environment)
// ---------------------------------------------------------------------------

class MockMutationObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

// ---------------------------------------------------------------------------
// RAF mock helpers
// ---------------------------------------------------------------------------

function createRafMock() {
  const callbacks: FrameRequestCallback[] = [];
  const raf = (cb: FrameRequestCallback) => {
    callbacks.push(cb);
    return callbacks.length;
  };
  const flush = () => {
    const toRun = callbacks.splice(0);
    for (const cb of toRun) cb(0);
  };
  return { raf, flush };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Extension Integration', () => {
  let wsFactory: ReturnType<typeof createWsFactory>;
  let bgChrome: ReturnType<typeof createIntegrationChrome>['bgChrome'];
  let createTabChrome: ReturnType<typeof createIntegrationChrome>['createTabChrome'];

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.MutationObserver = MockMutationObserver as unknown as typeof MutationObserver;
    wsFactory = createWsFactory();
    const integration = createIntegrationChrome();
    bgChrome = integration.bgChrome;
    createTabChrome = integration.createTabChrome;

    initBackground({
      chrome: bgChrome as unknown as typeof chrome,
      wsFactory: wsFactory.factory as unknown as (url: string) => WebSocket,
      serverUrl: 'ws://localhost:8080',
    });

    wsFactory.instances[0].simulateOpen();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  describe('background get-state', () => {
    it('returns IN_ROOM with roomCode and peerCount after room creation', () => {
      // Simulate server responding with room-created
      wsFactory.instances[0].simulateMessage({ type: 'room-created', code: 'TEST01', peerId: 'p1' });

      bgChrome.runtime.sendMessage.mockClear();

      // Popup sends get-state (routed via tab chrome to background listeners)
      const tabChrome = createTabChrome(99);
      tabChrome.runtime.sendMessage({ type: 'get-state' });

      expect(bgChrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'state-update',
          state: 'IN_ROOM',
          roomCode: 'TEST01',
          peerCount: 1,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('content script <-> background', () => {
    it('content script video play sends sync event with videoId to server', () => {
      const video = new MockVideoElement('vid1');
      const doc = createMockDocument([video]);
      const { raf } = createRafMock();
      const tabChrome = createTabChrome(1);

      initContentScript({
        chrome: tabChrome as unknown as typeof chrome,
        document: doc as unknown as Document,
        requestAnimationFrame: raf,
      });

      video.play();

      const calls = wsFactory.instances[0].send.mock.calls;
      expect(calls.length).toBe(1);
      const sent = JSON.parse(calls[0][0] as string);
      expect(sent.type).toBe('sync-event');
      expect(sent.event.action).toBe('play');
      expect(sent.event.videoId).toBe('vid1');
    });

    it('background receives sync event from server and content script applies it to correct video', () => {
      const video = new MockVideoElement('vid1');
      const doc = createMockDocument([video]);
      const { raf, flush } = createRafMock();
      const tabChrome = createTabChrome(1);

      initContentScript({
        chrome: tabChrome as unknown as typeof chrome,
        document: doc as unknown as Document,
        requestAnimationFrame: raf,
      });

      wsFactory.instances[0].simulateMessage({
        type: 'sync-event',
        event: { action: 'play', videoId: 'vid1', currentTime: 5, timestamp: Date.now() },
        fromPeer: 'peer2',
      });

      flush();

      expect(video.paused).toBe(false);
      expect(video.currentTime).toBeCloseTo(5, 0);
    });

    it('mirrors background debug logs to the content script console', () => {
      const video = new MockVideoElement('vid1');
      const doc = createMockDocument([video]);
      const { raf } = createRafMock();
      const tabChrome = createTabChrome(1);
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      initContentScript({
        chrome: tabChrome as unknown as typeof chrome,
        document: doc as unknown as Document,
        requestAnimationFrame: raf,
      });

      wsFactory.instances[0].simulateMessage({
        type: 'sync-event',
        event: { action: 'play', videoId: 'vid1', currentTime: 5, timestamp: Date.now() },
        fromPeer: 'peer2',
      });

      expect(debugSpy).toHaveBeenCalledWith(
        '[WatchTogether]',
        'content',
        'mirror:bg:server-message',
        expect.objectContaining({ type: 'sync-event' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('full sync flow (mocked server)', () => {
    function setupTwoTabs() {
      const videoA = new MockVideoElement('vid1');
      const videoB = new MockVideoElement('vid1');
      const docA = createMockDocument([videoA]);
      const docB = createMockDocument([videoB]);
      const rafA = createRafMock();
      const rafB = createRafMock();
      const tabChromeA = createTabChrome(1);
      const tabChromeB = createTabChrome(2);

      initContentScript({
        chrome: tabChromeA as unknown as typeof chrome,
        document: docA as unknown as Document,
        requestAnimationFrame: rafA.raf,
      });
      initContentScript({
        chrome: tabChromeB as unknown as typeof chrome,
        document: docB as unknown as Document,
        requestAnimationFrame: rafB.raf,
      });

      // Mock server: echo sync-events back to all peers
      wsFactory.instances[0].send.mockImplementation((data: string) => {
        const msg = JSON.parse(data);
        if (msg.type === 'sync-event') {
          wsFactory.instances[0].simulateMessage({
            type: 'sync-event',
            event: msg.event,
            fromPeer: 'peer-other',
          });
        }
      });

      const flushAll = () => {
        rafA.flush();
        rafB.flush();
      };

      return { videoA, videoB, rafA, rafB, flushAll };
    }

    it('tab A plays video -> tab B video starts playing (same videoId)', () => {
      const { videoA, videoB, flushAll } = setupTwoTabs();

      videoA.play();
      flushAll();

      expect(videoB.paused).toBe(false);
    });

    it('tab A seeks to 30s -> tab B video jumps to 30s (same videoId)', () => {
      const { videoA, videoB, flushAll } = setupTwoTabs();

      // First play videoA to make it active
      videoA.play();
      flushAll();

      videoA.currentTime = 30;
      videoA.dispatchEvent('seeked');
      vi.advanceTimersByTime(300); // flush seek debounce
      flushAll();

      expect(videoB.currentTime).toBeCloseTo(30, 0);
    });

    it('tab A pauses -> tab B video pauses (same videoId)', () => {
      const { videoA, videoB, flushAll } = setupTwoTabs();

      // Play first to make active
      videoA.play();
      flushAll();

      videoA.pause();
      flushAll();

      expect(videoB.paused).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('multi-video page sync', () => {
    it('page has 3 videos: user plays video #2 -> only video #2 events are sent', () => {
      const vid1 = new MockVideoElement('vid1');
      const vid2 = new MockVideoElement('vid2');
      const vid3 = new MockVideoElement('vid3');
      const doc = createMockDocument([vid1, vid2, vid3]);
      const { raf } = createRafMock();
      const tabChrome = createTabChrome(1);

      initContentScript({
        chrome: tabChrome as unknown as typeof chrome,
        document: doc as unknown as Document,
        requestAnimationFrame: raf,
      });

      vid2.play();

      const calls = wsFactory.instances[0].send.mock.calls;
      expect(calls.length).toBe(1);
      const sent = JSON.parse(calls[0][0] as string);
      expect(sent.event.videoId).toBe('vid2');
    });

    it('remote play event with videoId targets the correct video among multiple', () => {
      const vid1 = new MockVideoElement('vid1');
      const vid2 = new MockVideoElement('vid2');
      const vid3 = new MockVideoElement('vid3');
      const doc = createMockDocument([vid1, vid2, vid3]);
      const { raf, flush } = createRafMock();
      const tabChrome = createTabChrome(1);

      initContentScript({
        chrome: tabChrome as unknown as typeof chrome,
        document: doc as unknown as Document,
        requestAnimationFrame: raf,
      });

      wsFactory.instances[0].simulateMessage({
        type: 'sync-event',
        event: { action: 'play', videoId: 'vid2', currentTime: 0, timestamp: Date.now() },
        fromPeer: 'peer-other',
      });
      flush();

      expect(vid1.paused).toBe(true);
      expect(vid2.paused).toBe(false);
      expect(vid3.paused).toBe(true);
    });

    it('remote event with unknown videoId is silently ignored', () => {
      const vid1 = new MockVideoElement('vid1');
      const doc = createMockDocument([vid1]);
      const { raf } = createRafMock();
      const tabChrome = createTabChrome(1);

      initContentScript({
        chrome: tabChrome as unknown as typeof chrome,
        document: doc as unknown as Document,
        requestAnimationFrame: raf,
      });

      expect(() => {
        wsFactory.instances[0].simulateMessage({
          type: 'sync-event',
          event: { action: 'play', videoId: 'unknown-id', currentTime: 0, timestamp: Date.now() },
          fromPeer: 'peer-other',
        });
      }).not.toThrow();

      expect(vid1.paused).toBe(true);
    });

    it('user switches from video #1 to video #3 -> activeVideo updates, sync follows', () => {
      const vid1 = new MockVideoElement('vid1');
      const vid2 = new MockVideoElement('vid2');
      const vid3 = new MockVideoElement('vid3');
      const doc = createMockDocument([vid1, vid2, vid3]);
      const { raf, flush } = createRafMock();
      const tabChrome = createTabChrome(1);

      initContentScript({
        chrome: tabChrome as unknown as typeof chrome,
        document: doc as unknown as Document,
        requestAnimationFrame: raf,
      });

      // Play vid1 first
      vid1.play();
      flush();

      const calls1 = wsFactory.instances[0].send.mock.calls;
      expect(JSON.parse(calls1[0][0] as string).event.videoId).toBe('vid1');

      // Switch to vid3
      vid3.play();
      flush();

      const calls2 = wsFactory.instances[0].send.mock.calls;
      expect(JSON.parse(calls2[1][0] as string).event.videoId).toBe('vid3');

      // Pause vid3 should also use vid3
      vid3.pause();
      flush();

      const calls3 = wsFactory.instances[0].send.mock.calls;
      expect(JSON.parse(calls3[2][0] as string).event.videoId).toBe('vid3');
    });
  });
});
