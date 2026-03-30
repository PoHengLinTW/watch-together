import type { SyncEvent } from '@watchtogether/shared';
import type { DebugLogger } from '../shared/debug';

type RafFn = (cb: FrameRequestCallback) => number;

interface VideoControllerOptions {
  onSyncEvent: (event: SyncEvent) => void;
  document?: Pick<Document, 'querySelector' | 'querySelectorAll'>;
  requestAnimationFrame?: RafFn;
  onAutoplayBlocked?: (video: HTMLVideoElement, event: SyncEvent) => void;
  logger?: DebugLogger;
}

export class VideoController {
  private onSyncEvent: (event: SyncEvent) => void;
  private doc: Pick<Document, 'querySelector' | 'querySelectorAll'>;
  private raf: RafFn;
  private onAutoplayBlocked: ((video: HTMLVideoElement, event: SyncEvent) => void) | undefined;
  private logger: DebugLogger | undefined;
  private videos: HTMLVideoElement[] = [];
  private activeVideo: HTMLVideoElement | null = null;
  private suppressEvents = false;
  private seekDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: VideoControllerOptions) {
    this.onSyncEvent = options.onSyncEvent;
    this.doc = options.document ?? document;
    this.raf = options.requestAnimationFrame ?? requestAnimationFrame.bind(globalThis);
    this.onAutoplayBlocked = options.onAutoplayBlocked;
    this.logger = options.logger;
  }

  attachVideos(videos: HTMLVideoElement[]): void {
    this.videos = videos;
    this.logger?.log('content:attach-videos', {
      count: videos.length,
      videoIds: videos.map((video) => (video as unknown as { dataset: Record<string, string> }).dataset.vid ?? null),
    });
    for (const video of videos) {
      video.addEventListener('play', () => this.handlePlay(video));
      video.addEventListener('pause', () => this.handlePause(video));
      video.addEventListener('seeked', () => this.handleSeeked(video));
      video.addEventListener('ratechange', () => this.handleRateChange(video));
    }
  }

  getActiveVideoId(): string | null {
    return (this.activeVideo as unknown as { dataset: Record<string, string> } | null)?.dataset.vid ?? null;
  }

  applyRemoteEvent(event: SyncEvent): void {
    if (event.action === 'url-change') return;

    this.logger?.log('content:apply-remote-event', event);
    const video = this.doc.querySelector(
      `video[data-vid="${event.videoId}"]`
    ) as HTMLVideoElement | null;

    if (!video) {
      this.logger?.log('content:apply-remote-event-missing-video', {
        videoId: event.videoId,
        action: event.action,
      });
      return;
    }

    this.suppressEvents = true;
    this.logger?.log('content:suppress-events', { action: event.action, videoId: event.videoId });

    switch (event.action) {
      case 'play': {
        const latency = (Date.now() - event.timestamp) / 1000;
        this.logger?.log('content:apply-play', { videoId: event.videoId, currentTime: event.currentTime, latency });
        video.currentTime = event.currentTime + latency;
        video.play().catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'NotAllowedError') {
            this.logger?.log('content:autoplay-blocked', { videoId: event.videoId, action: event.action });
            this.onAutoplayBlocked?.(video, event);
          }
          // Other errors (AbortError etc.) are ignored — browser aborts play() when
          // a new load or pause() interrupts; this is expected and not an error.
        });
        this.activeVideo = video;
        break;
      }
      case 'pause':
        this.logger?.log('content:apply-pause', { videoId: event.videoId, currentTime: event.currentTime });
        video.currentTime = event.currentTime;
        video.pause();
        break;
      case 'seek':
        this.logger?.log('content:apply-seek', { videoId: event.videoId, currentTime: event.currentTime });
        video.currentTime = event.currentTime;
        break;
      case 'playbackRate':
        this.logger?.log('content:apply-playback-rate', { videoId: event.videoId, rate: event.rate });
        video.playbackRate = event.rate;
        break;
    }

    this.raf(() => {
      this.suppressEvents = false;
      this.logger?.log('content:resume-events', { action: event.action, videoId: event.videoId });
    });
  }

  private handlePlay(video: HTMLVideoElement): void {
    this.activeVideo = video;
    if (this.suppressEvents) {
      this.logger?.log('content:suppress-local-play', { videoId: this.getVideoId(video) });
      return;
    }
    const vid = (video as unknown as { dataset: Record<string, string> }).dataset.vid;
    const event: SyncEvent = {
      action: 'play',
      videoId: vid,
      currentTime: video.currentTime,
      timestamp: Date.now(),
    };
    this.logger?.log('content:local-play', event);
    this.onSyncEvent(event);
  }

  private handlePause(video: HTMLVideoElement): void {
    if (video !== this.activeVideo) {
      this.logger?.log('content:ignore-pause-inactive-video', { videoId: this.getVideoId(video) });
      return;
    }
    if (this.suppressEvents) {
      this.logger?.log('content:suppress-local-pause', { videoId: this.getVideoId(video) });
      return;
    }
    const vid = (video as unknown as { dataset: Record<string, string> }).dataset.vid;
    const event: SyncEvent = {
      action: 'pause',
      videoId: vid,
      currentTime: video.currentTime,
      timestamp: Date.now(),
    };
    this.logger?.log('content:local-pause', event);
    this.onSyncEvent(event);
  }

  private handleSeeked(video: HTMLVideoElement): void {
    if (video !== this.activeVideo) {
      this.logger?.log('content:ignore-seek-inactive-video', { videoId: this.getVideoId(video) });
      return;
    }
    if (this.suppressEvents) {
      this.logger?.log('content:suppress-local-seek', { videoId: this.getVideoId(video) });
      return;
    }
    if (this.seekDebounceTimer !== null) {
      clearTimeout(this.seekDebounceTimer);
    }
    const vid = (video as unknown as { dataset: Record<string, string> }).dataset.vid;
    const currentTime = video.currentTime;
    this.logger?.log('content:debounce-seek', { videoId: vid, currentTime });
    this.seekDebounceTimer = setTimeout(() => {
      this.seekDebounceTimer = null;
      const event: SyncEvent = {
        action: 'seek',
        videoId: vid,
        currentTime,
        timestamp: Date.now(),
      };
      this.logger?.log('content:local-seek', event);
      this.onSyncEvent(event);
    }, 300);
  }

  private handleRateChange(video: HTMLVideoElement): void {
    if (video !== this.activeVideo) {
      this.logger?.log('content:ignore-ratechange-inactive-video', { videoId: this.getVideoId(video) });
      return;
    }
    if (this.suppressEvents) {
      this.logger?.log('content:suppress-local-ratechange', { videoId: this.getVideoId(video) });
      return;
    }
    const vid = (video as unknown as { dataset: Record<string, string> }).dataset.vid;
    const event: SyncEvent = {
      action: 'playbackRate',
      videoId: vid,
      rate: video.playbackRate,
      timestamp: Date.now(),
    };
    this.logger?.log('content:local-playback-rate', event);
    this.onSyncEvent(event);
  }

  private getVideoId(video: HTMLVideoElement): string | null {
    return (video as unknown as { dataset: Record<string, string> }).dataset.vid ?? null;
  }
}
