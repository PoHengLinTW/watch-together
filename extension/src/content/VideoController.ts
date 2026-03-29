import type { SyncEvent } from '@watchtogether/shared';

type RafFn = (cb: FrameRequestCallback) => number;

interface VideoControllerOptions {
  onSyncEvent: (event: SyncEvent) => void;
  document?: Pick<Document, 'querySelector' | 'querySelectorAll'>;
  requestAnimationFrame?: RafFn;
}

export class VideoController {
  private onSyncEvent: (event: SyncEvent) => void;
  private doc: Pick<Document, 'querySelector' | 'querySelectorAll'>;
  private raf: RafFn;
  private videos: HTMLVideoElement[] = [];
  private activeVideo: HTMLVideoElement | null = null;
  private suppressEvents = false;
  private seekDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: VideoControllerOptions) {
    this.onSyncEvent = options.onSyncEvent;
    this.doc = options.document ?? document;
    this.raf = options.requestAnimationFrame ?? requestAnimationFrame.bind(globalThis);
  }

  attachVideos(videos: HTMLVideoElement[]): void {
    this.videos = videos;
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

    const video = this.doc.querySelector(
      `video.video-js[data-vid="${event.videoId}"]`
    ) as HTMLVideoElement | null;

    if (!video) return;

    this.suppressEvents = true;

    switch (event.action) {
      case 'play': {
        const latency = (Date.now() - event.timestamp) / 1000;
        video.currentTime = event.currentTime + latency;
        video.play();
        this.activeVideo = video;
        break;
      }
      case 'pause':
        video.currentTime = event.currentTime;
        video.pause();
        break;
      case 'seek':
        video.currentTime = event.currentTime;
        break;
      case 'playbackRate':
        video.playbackRate = event.rate;
        break;
    }

    this.raf(() => {
      this.suppressEvents = false;
    });
  }

  private handlePlay(video: HTMLVideoElement): void {
    this.activeVideo = video;
    if (this.suppressEvents) return;
    const vid = (video as unknown as { dataset: Record<string, string> }).dataset.vid;
    this.onSyncEvent({
      action: 'play',
      videoId: vid,
      currentTime: video.currentTime,
      timestamp: Date.now(),
    });
  }

  private handlePause(video: HTMLVideoElement): void {
    if (video !== this.activeVideo) return;
    if (this.suppressEvents) return;
    const vid = (video as unknown as { dataset: Record<string, string> }).dataset.vid;
    this.onSyncEvent({
      action: 'pause',
      videoId: vid,
      currentTime: video.currentTime,
      timestamp: Date.now(),
    });
  }

  private handleSeeked(video: HTMLVideoElement): void {
    if (video !== this.activeVideo) return;
    if (this.suppressEvents) return;
    if (this.seekDebounceTimer !== null) {
      clearTimeout(this.seekDebounceTimer);
    }
    const vid = (video as unknown as { dataset: Record<string, string> }).dataset.vid;
    const currentTime = video.currentTime;
    this.seekDebounceTimer = setTimeout(() => {
      this.seekDebounceTimer = null;
      this.onSyncEvent({
        action: 'seek',
        videoId: vid,
        currentTime,
        timestamp: Date.now(),
      });
    }, 300);
  }

  private handleRateChange(video: HTMLVideoElement): void {
    if (video !== this.activeVideo) return;
    if (this.suppressEvents) return;
    const vid = (video as unknown as { dataset: Record<string, string> }).dataset.vid;
    this.onSyncEvent({
      action: 'playbackRate',
      videoId: vid,
      rate: video.playbackRate,
      timestamp: Date.now(),
    });
  }
}
