import { ConnectionManager } from './ConnectionManager';
import type { BackgroundMessage, ContentMessage, PopupMessage, BackgroundToPopupMessage } from '../shared/messages';

declare const __SERVER_URL__: string;

interface BackgroundOptions {
  chrome: typeof globalThis.chrome;
  wsFactory?: (url: string) => WebSocket;
  serverUrl: string;
}

export function initBackground(options: BackgroundOptions): { connectionManager: ConnectionManager } {
  const { chrome, wsFactory, serverUrl } = options;

  /** Broadcast a message to all extension popups. */
  function sendToPopup(msg: BackgroundToPopupMessage): void {
    chrome.runtime.sendMessage(msg).catch(() => {
      // Popup may not be open — ignore
    });
  }

  const connectionManager = new ConnectionManager({
    wsFactory,
    onMessage: (msg) => {
      if (msg.type === 'sync-event') {
        const outgoing: BackgroundMessage = {
          type: 'sync-event',
          event: msg.event,
          fromPeer: msg.fromPeer,
        };
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs) {
            if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, outgoing)?.catch(() => {});
          }
        });
      } else if (msg.type === 'room-created') {
        sendToPopup({
          type: 'state-update',
          state: 'IN_ROOM',
          roomCode: msg.code,
          peerCount: 1,
        });
      } else if (msg.type === 'room-joined') {
        // We joined an existing room, so there's already at least one other peer
        sendToPopup({
          type: 'state-update',
          state: 'IN_ROOM',
          roomCode: msg.code,
          peerCount: 2,
        });
      } else if (msg.type === 'peer-joined') {
        sendToPopup({ type: 'peer-joined' });
      } else if (msg.type === 'peer-left') {
        sendToPopup({ type: 'peer-left' });
      } else if (msg.type === 'error') {
        if (msg.errorCode === 'ROOM_NOT_FOUND') {
          connectionManager.clearRoom();
          sendToPopup({ type: 'state-update', state: 'CONNECTED', roomCode: null, peerCount: 0 });
        }
        sendToPopup({ type: 'error', message: msg.message, errorCode: msg.errorCode });
      }
    },
    onStateChange: (state) => {
      if (state === 'CONNECTED') {
        sendToPopup({ type: 'state-update', state: 'CONNECTED', roomCode: null, peerCount: 0 });
      } else if (state === 'DISCONNECTED') {
        sendToPopup({ type: 'state-update', state: 'DISCONNECTED', roomCode: null, peerCount: 0 });
      } else if (state === 'RECONNECTING') {
        sendToPopup({ type: 'state-update', state: 'RECONNECTING', roomCode: null, peerCount: 0 });
      }
    },
  });

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as ContentMessage | PopupMessage;
    if (msg.type === 'sync-event') {
      connectionManager.send({ type: 'sync-event', event: (msg as ContentMessage).event });
    } else if (msg.type === 'create-room') {
      connectionManager.send({ type: 'create-room' });
    } else if (msg.type === 'join-room') {
      connectionManager.send({ type: 'join-room', code: (msg as Extract<PopupMessage, { type: 'join-room' }>).code });
    } else if (msg.type === 'leave-room') {
      connectionManager.send({ type: 'leave-room' });
      connectionManager.clearRoom();
      sendToPopup({ type: 'state-update', state: 'CONNECTED', roomCode: null, peerCount: 0 });
    } else if (msg.type === 'get-state') {
      const connState = connectionManager.getState();
      const popupState = connState === 'IN_ROOM' ? 'IN_ROOM'
        : connState === 'CONNECTED' ? 'CONNECTED'
        : connState === 'RECONNECTING' ? 'RECONNECTING'
        : 'DISCONNECTED';
      sendToPopup({
        type: 'state-update',
        state: popupState,
        roomCode: connectionManager.getRoomCode(),
        peerCount: connectionManager.getPeerCount(),
      });
    }
  });

  connectionManager.connect(serverUrl);

  // Keep the service worker alive so the WebSocket isn't dropped.
  // Chrome MV3 kills service workers after 30s of inactivity;
  // a periodic alarm wakes it before that threshold.
  const KEEPALIVE_ALARM = 'watchtogether-keepalive';
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 25 / 60 });
  chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) {
      // No-op — waking the service worker is the purpose
    }
  });

  return { connectionManager };
}

// Auto-init when running as extension (guard against test environments)
if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome?.runtime != null) {
  initBackground({ chrome: globalThis.chrome, serverUrl: __SERVER_URL__ });
}
