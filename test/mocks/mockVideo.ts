export class MockVideoElement {
  currentTime = 0;
  paused = true;
  playbackRate = 1;
  clientWidth = 640;
  clientHeight = 480;
  dataset: Record<string, string>;
  playRejectError: Error | null = null;
  private listeners = new Map<string, Set<Function>>();

  constructor(videoId: string = 'testVid1') {
    this.dataset = { vid: videoId };
  }

  play(): Promise<void> {
    if (this.playRejectError !== null) {
      return Promise.reject(this.playRejectError);
    }
    this.paused = false;
    this.emit('play');
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    this.emit('pause');
  }

  addEventListener(event: string, fn: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
  }

  removeEventListener(event: string, fn: Function): void {
    this.listeners.get(event)?.delete(fn);
  }

  /** Simulate a DOM event (e.g. 'seeked', 'ratechange') without changing state */
  dispatchEvent(event: string): void {
    this.emit(event);
  }

  private emit(event: string): void {
    this.listeners.get(event)?.forEach((fn) => fn({ type: event }));
  }
}
