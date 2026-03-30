import type { SyncEvent } from '@watchtogether/shared';

/** Sent from content script to background service worker via chrome.runtime.sendMessage */
export type ContentMessage = { type: 'sync-event'; event: SyncEvent };

/** Sent from background service worker to content script via chrome.tabs.sendMessage */
export interface DebugLogMessage {
  type: 'debug-log';
  scope: 'background' | 'content';
  event: string;
  payload?: unknown;
}

export type BackgroundMessage =
  | { type: 'sync-event'; event: SyncEvent; fromPeer: string; sequence: number }
  | DebugLogMessage;

/** Sent from popup to background service worker via chrome.runtime.sendMessage */
export type PopupMessage =
  | { type: 'get-state' }
  | { type: 'create-room' }
  | { type: 'join-room'; code: string }
  | { type: 'leave-room' };

/** Sent from background service worker to popup via chrome.runtime.sendMessage */
export type BackgroundToPopupMessage =
  | { type: 'state-update'; state: 'DISCONNECTED' | 'CONNECTED' | 'IN_ROOM' | 'RECONNECTING'; roomCode: string | null; peerCount: number }
  | { type: 'peer-joined' }
  | { type: 'peer-left' }
  | { type: 'error'; message: string; errorCode?: string };
