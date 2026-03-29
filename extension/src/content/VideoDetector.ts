const VIDEO_SELECTOR = 'div.vjscontainer video.video-js';

interface VideoDetectorOptions {
  document: Pick<Document, 'querySelectorAll' | 'body'>;
  onVideosFound?: (videos: HTMLVideoElement[]) => void;
}

export class VideoDetector {
  private doc: Pick<Document, 'querySelectorAll' | 'body'>;
  private onVideosFound: ((videos: HTMLVideoElement[]) => void) | undefined;
  private observer: MutationObserver | null = null;

  constructor(options: VideoDetectorOptions) {
    this.doc = options.document;
    this.onVideosFound = options.onVideosFound;
  }

  scan(): HTMLVideoElement[] {
    const nodes = this.doc.querySelectorAll(VIDEO_SELECTOR);
    const videos = Array.from(nodes) as HTMLVideoElement[];
    if (videos.length > 0) {
      this.onVideosFound?.(videos);
    }
    return videos;
  }

  observe(): void {
    this.observer = new MutationObserver(() => {
      const videos = this.scan();
      if (videos.length > 0) {
        this.onVideosFound?.(videos);
      }
    });
    this.observer.observe(this.doc.body as Node, { childList: true, subtree: true });
  }

  disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
