export class MockVideoElement {
  currentTime = 0;
  paused = true;
  playbackRate = 1;
  clientWidth = 640;
  clientHeight = 480;
  readyState = 4; // HAVE_ENOUGH_DATA by default
  dataset: Record<string, string>;
  playRejectError: Error | null = null;
  /** Set this to control what video.closest() returns in tests */
  _closestResult: { querySelector: (s: string) => unknown } | null = null;
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

  /** Mimics Element.closest — returns _closestResult regardless of selector */
  closest(_selector: string): { querySelector: (s: string) => unknown } | null {
    return this._closestResult;
  }

  addEventListener(event: string, fn: Function, options?: { once?: boolean }): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    if (options?.once) {
      const wrapper = (...args: unknown[]) => {
        this.listeners.get(event)?.delete(wrapper);
        fn(...args);
      };
      this.listeners.get(event)!.add(wrapper);
    } else {
      this.listeners.get(event)!.add(fn);
    }
  }

  removeEventListener(event: string, fn: Function): void {
    this.listeners.get(event)?.delete(fn);
  }

  /** Simulate a DOM event (e.g. 'seeked', 'ratechange', 'canplay') without changing state */
  dispatchEvent(event: string): void {
    this.emit(event);
  }

  private emit(event: string): void {
    this.listeners.get(event)?.forEach((fn) => fn({ type: event }));
  }
}
