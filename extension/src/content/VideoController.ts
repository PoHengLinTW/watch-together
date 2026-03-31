import type { SyncEvent } from '@watchtogether/shared';
import type { DebugLogger } from '../shared/debug';

type RafFn = (cb: FrameRequestCallback) => number;

interface PendingRemoteEffect {
  eventId: string;
  sequence: number;
  action: SyncEvent['action'];
  expiresAt: number;
  expectedCurrentTime?: number;
  expectedRate?: number;
  suppressPlay: boolean;
  suppressPause: boolean;
  suppressSeeked: boolean;
  suppressRateChange: boolean;
}

interface VideoControllerOptions {
  onSyncEvent: (event: SyncEvent) => void;
  document?: Pick<Document, 'querySelector' | 'querySelectorAll'>;
  requestAnimationFrame?: RafFn;
  onAutoplayBlocked?: (video: HTMLVideoElement, event: SyncEvent, clickHandler?: () => void) => void;
  logger?: DebugLogger;
}

export class VideoController {
  private static readonly SEEK_TOLERANCE_SECONDS = 0.35;
  private static readonly RATE_TOLERANCE = 0.01;
  private static readonly REMOTE_EFFECT_TTL_MS = 1500;

  private onSyncEvent: (event: SyncEvent) => void;
  private doc: Pick<Document, 'querySelector' | 'querySelectorAll'>;
  private raf: RafFn;
  private onAutoplayBlocked: ((video: HTMLVideoElement, event: SyncEvent, clickHandler?: () => void) => void) | undefined;
  private logger: DebugLogger | undefined;
  private videos: HTMLVideoElement[] = [];
  private activeVideo: HTMLVideoElement | null = null;
  private seekDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRemoteEffects = new Map<string, PendingRemoteEffect>();
  private lastAppliedSequence = new Map<string, number>();

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

  applyRemoteEvent(event: SyncEvent, sequence: number): void {
    if (event.action === 'url-change') return;

    const lastSequence = this.lastAppliedSequence.get(event.videoId) ?? 0;
    if (sequence <= lastSequence) {
      this.logger?.log('content:ignore-stale-remote-event', {
        videoId: event.videoId,
        action: event.action,
        sequence,
        lastSequence,
      });
      return;
    }

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

    const effect: PendingRemoteEffect = {
      eventId: event.eventId,
      sequence,
      action: event.action,
      expiresAt: Date.now() + VideoController.REMOTE_EFFECT_TTL_MS,
      suppressPlay: false,
      suppressPause: false,
      suppressSeeked: false,
      suppressRateChange: false,
    };

    switch (event.action) {
      case 'play': {
        if (video.readyState === 0 /* HAVE_NOTHING */) {
          this.handleSourcelessPlay(video, event as Extract<SyncEvent, { action: 'play' }>, sequence);
          return;
        }
        const latency = (Date.now() - event.timestamp) / 1000;
        const targetTime = event.currentTime + latency;
        effect.expectedCurrentTime = targetTime;
        effect.suppressPlay = true;
        if (this.shouldAdjustCurrentTime(video.currentTime, targetTime)) {
          video.currentTime = targetTime;
          effect.suppressSeeked = true;
        }
        this.lastAppliedSequence.set(event.videoId, sequence);
        this.pendingRemoteEffects.set(event.videoId, effect);
        this.logger?.log('content:apply-play', { videoId: event.videoId, currentTime: targetTime, latency, sequence });
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
        effect.expectedCurrentTime = event.currentTime;
        effect.suppressPause = true;
        if (this.shouldAdjustCurrentTime(video.currentTime, event.currentTime)) {
          video.currentTime = event.currentTime;
          effect.suppressSeeked = true;
        }
        this.lastAppliedSequence.set(event.videoId, sequence);
        this.pendingRemoteEffects.set(event.videoId, effect);
        this.logger?.log('content:apply-pause', { videoId: event.videoId, currentTime: event.currentTime, sequence });
        video.pause();
        break;
      case 'seek':
        effect.expectedCurrentTime = event.currentTime;
        effect.suppressSeeked = true;
        this.lastAppliedSequence.set(event.videoId, sequence);
        this.pendingRemoteEffects.set(event.videoId, effect);
        this.logger?.log('content:apply-seek', { videoId: event.videoId, currentTime: event.currentTime, sequence });
        video.currentTime = event.currentTime;
        break;
      case 'playbackRate':
        effect.expectedRate = event.rate;
        effect.suppressRateChange = true;
        this.lastAppliedSequence.set(event.videoId, sequence);
        this.pendingRemoteEffects.set(event.videoId, effect);
        this.logger?.log('content:apply-playback-rate', { videoId: event.videoId, rate: event.rate, sequence });
        video.playbackRate = event.rate;
        break;
    }

    this.logger?.log('content:track-remote-effect', {
      videoId: event.videoId,
      action: event.action,
      sequence,
      suppressPlay: effect.suppressPlay,
      suppressPause: effect.suppressPause,
      suppressSeeked: effect.suppressSeeked,
      suppressRateChange: effect.suppressRateChange,
    });
  }

  /**
   * Called when a remote 'play' event arrives but the video has no source loaded yet
   * (readyState === HAVE_NOTHING — anime1.me's preload="none" case).
   *
   * Instead of calling video.play() directly (which fails — src is empty), we:
   * 1. Register a long-lived PendingRemoteEffect to suppress the upcoming play echo.
   * 2. Register a one-time `canplay` listener that corrects currentTime with fresh latency.
   * 3. Pass a clickHandler to onAutoplayBlocked that clicks .vjs-big-play-button,
   *    triggering Video.js's source-resolution API call.
   */
  private handleSourcelessPlay(
    video: HTMLVideoElement,
    event: Extract<SyncEvent, { action: 'play' }>,
    sequence: number,
  ): void {
    this.activeVideo = video;
    this.lastAppliedSequence.set(event.videoId, sequence);

    // Long-lived effect: suppress the VJS-triggered play echo (source load can take seconds)
    const effect: PendingRemoteEffect = {
      eventId: event.eventId,
      sequence,
      action: 'play',
      expiresAt: Date.now() + 30_000,
      suppressPlay: true,
      suppressPause: false,
      suppressSeeked: false,
      suppressRateChange: false,
    };
    this.pendingRemoteEffects.set(event.videoId, effect);

    // When VJS finishes loading the source, recalculate position with fresh latency
    video.addEventListener(
      'canplay',
      () => {
        const freshLatency = (Date.now() - event.timestamp) / 1000;
        const targetTime = event.currentTime + freshLatency;
        // Tighten the effect TTL now that we're about to seek
        effect.expiresAt = Date.now() + VideoController.REMOTE_EFFECT_TTL_MS;
        if (this.shouldAdjustCurrentTime(video.currentTime, targetTime)) {
          effect.suppressSeeked = true;
          effect.expectedCurrentTime = targetTime;
          video.currentTime = targetTime;
        }
        this.logger?.log('content:sourceless-play-canplay', {
          videoId: event.videoId,
          targetTime,
          freshLatency,
        });
      },
      { once: true } as AddEventListenerOptions,
    );

    // The overlay's click handler: trigger VJS source loading instead of video.play()
    const clickHandler = () => {
      const container = video.closest('.vjscontainer');
      const vjsButton = container?.querySelector('.vjs-big-play-button') as HTMLElement | null;
      if (vjsButton) {
        this.logger?.log('content:sourceless-play-vjs-click', { videoId: event.videoId });
        vjsButton.click();
      } else {
        // Fallback: best-effort direct play (may succeed if autoplay policy allows)
        video.play().catch(() => {});
      }
    };

    this.logger?.log('content:sourceless-play-overlay', { videoId: event.videoId });
    this.onAutoplayBlocked?.(video, event, clickHandler);
  }

  private handlePlay(video: HTMLVideoElement): void {
    this.activeVideo = video;
    if (this.consumeRemoteEffect(video, 'play')) {
      return;
    }
    const vid = this.getVideoId(video);
    const event: SyncEvent = {
      action: 'play',
      videoId: vid,
      currentTime: video.currentTime,
      timestamp: Date.now(),
      eventId: this.createEventId(),
    };
    this.logger?.log('content:local-play', event);
    this.onSyncEvent(event);
  }

  private handlePause(video: HTMLVideoElement): void {
    if (video !== this.activeVideo) {
      this.logger?.log('content:ignore-pause-inactive-video', { videoId: this.getVideoId(video) });
      return;
    }
    if (this.consumeRemoteEffect(video, 'pause')) {
      return;
    }
    const vid = this.getVideoId(video);
    const event: SyncEvent = {
      action: 'pause',
      videoId: vid,
      currentTime: video.currentTime,
      timestamp: Date.now(),
      eventId: this.createEventId(),
    };
    this.logger?.log('content:local-pause', event);
    this.onSyncEvent(event);
  }

  private handleSeeked(video: HTMLVideoElement): void {
    if (video !== this.activeVideo) {
      this.logger?.log('content:ignore-seek-inactive-video', { videoId: this.getVideoId(video) });
      return;
    }
    if (this.consumeRemoteEffect(video, 'seeked')) {
      return;
    }
    if (this.seekDebounceTimer !== null) {
      clearTimeout(this.seekDebounceTimer);
    }
    const vid = this.getVideoId(video);
    const currentTime = video.currentTime;
    this.logger?.log('content:debounce-seek', { videoId: vid, currentTime });
    this.seekDebounceTimer = setTimeout(() => {
      this.seekDebounceTimer = null;
      const event: SyncEvent = {
        action: 'seek',
        videoId: vid,
        currentTime,
        timestamp: Date.now(),
        eventId: this.createEventId(),
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
    if (this.consumeRemoteEffect(video, 'ratechange')) {
      return;
    }
    const vid = this.getVideoId(video);
    const event: SyncEvent = {
      action: 'playbackRate',
      videoId: vid,
      rate: video.playbackRate,
      timestamp: Date.now(),
      eventId: this.createEventId(),
    };
    this.logger?.log('content:local-playback-rate', event);
    this.onSyncEvent(event);
  }

  private consumeRemoteEffect(video: HTMLVideoElement, domEvent: 'play' | 'pause' | 'seeked' | 'ratechange'): boolean {
    const videoId = this.getVideoId(video);
    if (!videoId) return false;

    const effect = this.pendingRemoteEffects.get(videoId);
    if (!effect) return false;

    if (effect.expiresAt < Date.now()) {
      this.pendingRemoteEffects.delete(videoId);
      this.logger?.log('content:expire-remote-effect', { videoId, action: effect.action, sequence: effect.sequence });
      return false;
    }

    const matches =
      (domEvent === 'play' && effect.suppressPlay) ||
      (domEvent === 'pause' && effect.suppressPause) ||
      (domEvent === 'seeked' && effect.suppressSeeked && effect.expectedCurrentTime !== undefined
        && this.isWithinTolerance(video.currentTime, effect.expectedCurrentTime, VideoController.SEEK_TOLERANCE_SECONDS)) ||
      (domEvent === 'ratechange' && effect.suppressRateChange && effect.expectedRate !== undefined
        && this.isWithinTolerance(video.playbackRate, effect.expectedRate, VideoController.RATE_TOLERANCE));

    if (!matches) {
      return false;
    }

    if (domEvent === 'play') effect.suppressPlay = false;
    if (domEvent === 'pause') effect.suppressPause = false;
    if (domEvent === 'seeked') effect.suppressSeeked = false;
    if (domEvent === 'ratechange') effect.suppressRateChange = false;

    if (!effect.suppressPlay && !effect.suppressPause && !effect.suppressSeeked && !effect.suppressRateChange) {
      this.pendingRemoteEffects.delete(videoId);
    } else {
      this.pendingRemoteEffects.set(videoId, effect);
    }

    this.logger?.log('content:suppress-local-event', {
      videoId,
      domEvent,
      action: effect.action,
      sequence: effect.sequence,
      eventId: effect.eventId,
    });
    return true;
  }

  private shouldAdjustCurrentTime(currentTime: number, targetTime: number): boolean {
    return !this.isWithinTolerance(currentTime, targetTime, VideoController.SEEK_TOLERANCE_SECONDS);
  }

  private isWithinTolerance(value: number, expected: number, tolerance: number): boolean {
    return Math.abs(value - expected) <= tolerance;
  }

  private getVideoId(video: HTMLVideoElement): string {
    return (video as unknown as { dataset: Record<string, string> }).dataset.vid;
  }

  private createEventId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
