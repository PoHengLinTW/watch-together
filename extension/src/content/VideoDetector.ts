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
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;

export class VideoDetector {
  private doc: Pick<Document, 'querySelectorAll' | 'body'>;
  private onVideosFound: ((videos: HTMLVideoElement[]) => void) | undefined;
  private logger: DebugLogger | undefined;
  private observer: MutationObserver | null = null;
  private pollIntervalMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private knownVideos = new Set<HTMLVideoElement>();

  constructor(options: VideoDetectorOptions) {
    this.doc = options.document;
    this.onVideosFound = options.onVideosFound;
    this.logger = options.logger;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
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

    const newVideos = videos.filter((video) => !this.knownVideos.has(video));
    for (const video of newVideos) {
      this.knownVideos.add(video);
    }

    this.logger?.log('detector:scan-new-result', {
      count: newVideos.length,
      videoIds: newVideos.map((video) => (video as unknown as { dataset: Record<string, string> }).dataset.vid ?? null),
    });

    if (newVideos.length > 0) {
      this.logger?.log('detector:videos-found', { count: newVideos.length });
      this.onVideosFound?.(newVideos);
    }
    return newVideos;
  }

  observe(): void {
    this.observer = new MutationObserver(() => {
      this.logger?.log('detector:mutation');
      const newVideos = this.scan();
      if (newVideos.length > 0) {
        this.logger?.log('detector:mutation-videos-found', { count: newVideos.length });
      }
    });
    this.logger?.log('detector:observe-start');
    this.observer.observe(this.doc.body as Node, { childList: true, subtree: true });
    this.startPolling();
  }

  disconnect(): void {
    this.logger?.log('detector:disconnect');
    this.observer?.disconnect();
    this.observer = null;
    this.stopPolling();
  }

  private startPolling(): void {
    this.stopPolling();
    this.logger?.log('detector:poll-start', { intervalMs: this.pollIntervalMs });
    this.pollTimer = setInterval(() => {
      this.logger?.log('detector:poll-tick');
      const newVideos = this.scan();
      if (newVideos.length > 0) {
        this.logger?.log('detector:poll-videos-found', { count: newVideos.length });
      }
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.logger?.log('detector:poll-stop');
    }
  }
}
