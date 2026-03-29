import { ConnectionManager } from './ConnectionManager';
import type { BackgroundMessage, ContentMessage } from '../shared/messages';

interface BackgroundOptions {
  chrome: typeof globalThis.chrome;
  wsFactory?: (url: string) => WebSocket;
  serverUrl: string;
}

export function initBackground(options: BackgroundOptions): { connectionManager: ConnectionManager } {
  const { chrome, wsFactory, serverUrl } = options;

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
            if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, outgoing);
          }
        });
      }
    },
  });

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as ContentMessage;
    if (msg.type === 'sync-event') {
      connectionManager.send({ type: 'sync-event', event: msg.event });
    }
  });

  connectionManager.connect(serverUrl);

  return { connectionManager };
}
