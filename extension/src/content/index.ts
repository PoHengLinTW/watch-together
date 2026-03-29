import { VideoController } from './VideoController';
import { VideoDetector } from './VideoDetector';
import type { BackgroundMessage, ContentMessage } from '../shared/messages';

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

  const controller = new VideoController({
    onSyncEvent: (event) => {
      const msg: ContentMessage = { type: 'sync-event', event };
      chrome.runtime.sendMessage(msg);
    },
    document,
    requestAnimationFrame: raf,
  });

  const detector = new VideoDetector({
    document,
    onVideosFound: (videos) => controller.attachVideos(videos),
  });

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as BackgroundMessage;
    if (msg.type === 'sync-event') {
      controller.applyRemoteEvent(msg.event);
    }
  });

  detector.scan();
  detector.observe();

  return { controller, detector };
}
