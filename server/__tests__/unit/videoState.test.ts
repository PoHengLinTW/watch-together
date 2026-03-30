import { describe, it, expect } from 'vitest';
import { applyEvent, getAdjustedTime } from '../../src/VideoState.js';
import type { VideoState } from '@watchtogether/shared';

function syncEvent<T extends Record<string, unknown>>(event: T): T & { eventId: string } {
  return {
    ...event,
    eventId: 'evt-1',
  };
}

const BASE_STATE: VideoState = {
  url: 'https://example.com/video',
  videoId: 'vid1',
  currentTime: 0,
  playing: false,
  playbackRate: 1,
  updatedAt: 1000,
};

describe('VideoState', () => {
  describe('applyEvent', () => {
    it('should update currentTime and playing=true on play event', () => {
      const result = applyEvent(BASE_STATE, {
        action: 'play',
        currentTime: 15,
        timestamp: 2000,
        videoId: 'vid1',
        eventId: 'evt-1',
      });
      expect(result.currentTime).toBe(15);
      expect(result.playing).toBe(true);
    });

    it('should update currentTime and playing=false on pause event', () => {
      const playing = { ...BASE_STATE, playing: true };
      const result = applyEvent(playing, {
        action: 'pause',
        currentTime: 30,
        timestamp: 3000,
        videoId: 'vid1',
        eventId: 'evt-1',
      });
      expect(result.currentTime).toBe(30);
      expect(result.playing).toBe(false);
    });

    it('should update currentTime on seek event', () => {
      const result = applyEvent(BASE_STATE, {
        action: 'seek',
        currentTime: 99,
        timestamp: 4000,
        videoId: 'vid1',
        eventId: 'evt-1',
      });
      expect(result.currentTime).toBe(99);
      // playing state should be preserved
      expect(result.playing).toBe(BASE_STATE.playing);
    });

    it('should update playbackRate on rate event', () => {
      const result = applyEvent(BASE_STATE, {
        action: 'playbackRate',
        rate: 2,
        timestamp: 5000,
        videoId: 'vid1',
        eventId: 'evt-1',
      });
      expect(result.playbackRate).toBe(2);
    });

    it('should update url on url-change event', () => {
      const result = applyEvent(BASE_STATE, {
        action: 'url-change',
        url: 'https://new.example.com/video',
        timestamp: 6000,
        eventId: 'evt-1',
      });
      expect(result.url).toBe('https://new.example.com/video');
    });

    it('should update updatedAt timestamp on every event', () => {
      const events = [
        syncEvent({ action: 'play' as const, currentTime: 0, timestamp: 100, videoId: 'v' }),
        syncEvent({ action: 'pause' as const, currentTime: 0, timestamp: 200, videoId: 'v' }),
        syncEvent({ action: 'seek' as const, currentTime: 0, timestamp: 300, videoId: 'v' }),
        syncEvent({ action: 'playbackRate' as const, rate: 1, timestamp: 400, videoId: 'v' }),
        syncEvent({ action: 'url-change' as const, url: 'x', timestamp: 500 }),
      ];
      for (const event of events) {
        const result = applyEvent(BASE_STATE, event);
        expect(result.updatedAt).toBe(event.timestamp);
      }
    });
  });

  describe('getAdjustedTime', () => {
    it('should return currentTime if paused', () => {
      const state: VideoState = { ...BASE_STATE, playing: false, currentTime: 30, updatedAt: 0 };
      expect(getAdjustedTime(state, 99999)).toBe(30);
    });

    it('should add elapsed time since updatedAt if playing', () => {
      const state: VideoState = {
        ...BASE_STATE,
        playing: true,
        currentTime: 30,
        playbackRate: 1,
        updatedAt: 1000,
      };
      // 5 seconds later (in ms)
      expect(getAdjustedTime(state, 6000)).toBe(35);
    });

    it('should account for playbackRate in elapsed calculation', () => {
      const state: VideoState = {
        ...BASE_STATE,
        playing: true,
        currentTime: 30,
        playbackRate: 2,
        updatedAt: 1000,
      };
      // 5 seconds later at 2x speed = +10 seconds
      expect(getAdjustedTime(state, 6000)).toBe(40);
    });
  });
});
