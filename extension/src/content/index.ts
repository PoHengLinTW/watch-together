import { VideoController } from './VideoController';
import { VideoDetector } from './VideoDetector';
import { showAutoplayOverlay } from './AutoplayOverlay';
import type { BackgroundMessage, ContentMessage } from '../shared/messages';
import { createConsoleDebugLogger } from '../shared/debug';

interface ContentScriptOptions {
  chrome: typeof globalThis.chrome;
  document: Document;
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
}

export function initContentScript(options: ContentScriptOptions): {
  controller: VideoController;
  detector: VideoDetector;
} {
  const { chrome, document, requestAnimationFrame: raf } = options;
  const logger = createConsoleDebugLogger('content');

  const controller = new VideoController({
    onSyncEvent: (event) => {
      logger.log('content:emit-sync-event', event);
      const msg: ContentMessage = { type: 'sync-event', event };
      chrome.runtime.sendMessage(msg);
    },
    document,
    requestAnimationFrame: raf,
    onAutoplayBlocked: showAutoplayOverlay,
    logger,
  });

  const detector = new VideoDetector({
    document,
    onVideosFound: (videos) => controller.attachVideos(videos),
  });

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as BackgroundMessage;
    if (msg.type === 'debug-log') {
      logger.log(`mirror:${msg.event}`, msg.payload);
    } else if (msg.type === 'sync-event') {
      logger.log('content:recv-sync-event', msg);
      controller.applyRemoteEvent(msg.event);
    }
  });

  logger.log('content:init');
  detector.scan();
  detector.observe();

  return { controller, detector };
}

// Auto-init when running as extension (guard against test environments)
if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome?.runtime != null) {
  initContentScript({ chrome: globalThis.chrome, document });
}
