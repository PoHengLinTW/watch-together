import { createServer } from '../../src/index.js';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '@watchtogether/shared';

export interface TestServerOptions {
  heartbeatIntervalMs?: number;
  pongTimeoutMs?: number;
}

export interface TestServer {
  port: number;
  close: () => Promise<void>;
}

/** Start a test server on a random port. Returns port and cleanup function. */
export async function startTestServer(opts: TestServerOptions = {}): Promise<TestServer> {
  const { server, close } = createServer({
    port: 0,
    heartbeatIntervalMs: opts.heartbeatIntervalMs,
    pongTimeoutMs: opts.pongTimeoutMs,
  });

  await new Promise<void>((resolve) => server.once('listening', resolve));

  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

  return { port, close };
}

/** Connect a WebSocket client to the test server. */
export function createClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Serialize and send a ClientMessage. */
export function sendMessage(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

/**
 * Wait for the next ServerMessage matching the optional predicate.
 * Rejects after `timeout` ms (default 2000).
 */
export function waitForMessage(
  ws: WebSocket,
  predicate?: (msg: ServerMessage) => boolean,
  timeout = 2000,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMessage);
      reject(new Error(`waitForMessage timed out after ${timeout}ms`));
    }, timeout);

    function onMessage(data: WebSocket.RawData) {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(data.toString()) as ServerMessage;
      } catch {
        return; // ignore non-JSON
      }
      if (!predicate || predicate(parsed)) {
        clearTimeout(timer);
        ws.removeListener('message', onMessage);
        resolve(parsed);
      }
    }

    ws.on('message', onMessage);
  });
}

/** Close a WebSocket client and wait for the close event. */
export function closeClient(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.once('close', () => resolve());
    ws.close();
  });
}
