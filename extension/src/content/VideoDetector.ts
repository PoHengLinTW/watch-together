import type { DebugLogger } from '../shared/debug';

const VIDEO_SELECTORS = [
  'video[data-vid]',
  'video.video-js',
  'video.vjs-tech',
] as const;

interface VideoDetectorOptions {
  document: Pick<Document, 'querySelectorAll' | 'body'>;
  onVideosFound?: (videos: HTMLVideoElement[]) => void;
  logger?: DebugLogger;
}

export class VideoDetector {
  private doc: Pick<Document, 'querySelectorAll' | 'body'>;
  private onVideosFound: ((videos: HTMLVideoElement[]) => void) | undefined;
  private logger: DebugLogger | undefined;
  private observer: MutationObserver | null = null;

  constructor(options: VideoDetectorOptions) {
    this.doc = options.document;
    this.onVideosFound = options.onVideosFound;
    this.logger = options.logger;
  }

  scan(): HTMLVideoElement[] {
    this.logger?.log('detector:scan-start', { selectors: VIDEO_SELECTORS });
    const seen = new Set<HTMLVideoElement>();
    const videos: HTMLVideoElement[] = [];

    for (const selector of VIDEO_SELECTORS) {
      const nodes = this.doc.querySelectorAll(selector);
      const matched = Array.from(nodes) as HTMLVideoElement[];
      this.logger?.log('detector:scan-selector-result', { selector, count: matched.length });
      for (const video of matched) {
        if (seen.has(video)) continue;
        seen.add(video);
        videos.push(video);
      }
    }

    this.logger?.log('detector:scan-result', {
      count: videos.length,
      videoIds: videos.map((video) => (video as unknown as { dataset: Record<string, string> }).dataset.vid ?? null),
    });
    if (videos.length > 0) {
      this.logger?.log('detector:videos-found', { count: videos.length });
      this.onVideosFound?.(videos);
    }
    return videos;
  }

  observe(): void {
    this.observer = new MutationObserver(() => {
      this.logger?.log('detector:mutation');
      const videos = this.scan();
      if (videos.length > 0) {
        this.logger?.log('detector:mutation-videos-found', { count: videos.length });
        this.onVideosFound?.(videos);
      }
    });
    this.logger?.log('detector:observe-start');
    this.observer.observe(this.doc.body as Node, { childList: true, subtree: true });
  }

  disconnect(): void {
    this.logger?.log('detector:disconnect');
    this.observer?.disconnect();
    this.observer = null;
  }
}
