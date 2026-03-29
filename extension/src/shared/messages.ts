import type { SyncEvent } from '@watchtogether/shared';

/** Sent from content script to background service worker via chrome.runtime.sendMessage */
export type ContentMessage = { type: 'sync-event'; event: SyncEvent };

/** Sent from background service worker to content script via chrome.tabs.sendMessage */
export type BackgroundMessage = { type: 'sync-event'; event: SyncEvent; fromPeer: string };
