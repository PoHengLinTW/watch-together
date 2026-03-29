import type { VideoState, SyncEvent } from '@watchtogether/shared';

const DEFAULT_STATE: VideoState = {
  url: '',
  videoId: '',
  currentTime: 0,
  playing: false,
  playbackRate: 1,
  updatedAt: 0,
};

/**
 * Apply a sync event to the current video state, returning the updated state.
 * Accepts null for the initial state (first event in a room).
 */
export function applyEvent(state: VideoState | null, event: SyncEvent): VideoState {
  const base = state ?? DEFAULT_STATE;

  switch (event.action) {
    case 'play':
      return { ...base, currentTime: event.currentTime, playing: true, videoId: event.videoId, updatedAt: event.timestamp };
    case 'pause':
      return { ...base, currentTime: event.currentTime, playing: false, videoId: event.videoId, updatedAt: event.timestamp };
    case 'seek':
      return { ...base, currentTime: event.currentTime, videoId: event.videoId, updatedAt: event.timestamp };
    case 'playbackRate':
      return { ...base, playbackRate: event.rate, videoId: event.videoId, updatedAt: event.timestamp };
    case 'url-change':
      return { ...base, url: event.url, currentTime: 0, playing: false, updatedAt: event.timestamp };
  }
}

/**
 * Get the adjusted current time.
 * If paused, returns currentTime as-is.
 * If playing, adds elapsed wall-clock time (scaled by playbackRate).
 *
 * @param state - Current video state
 * @param now   - Current time in milliseconds (e.g. Date.now())
 */
export function getAdjustedTime(state: VideoState, now: number): number {
  if (!state.playing) return state.currentTime;
  const elapsedSeconds = (now - state.updatedAt) / 1000;
  return state.currentTime + elapsedSeconds * state.playbackRate;
}
