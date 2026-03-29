import * as http from 'http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { RoomManager } from './RoomManager.js';
import { MessageHandler } from './MessageHandler.js';
import { consoleLogger } from './Logger.js';
import type { Logger } from './Logger.js';

export interface ServerConfig {
  port: number;
  /** How often to send ping frames. Default: 30000ms */
  heartbeatIntervalMs?: number;
  /** How long after a ping to wait for pong before disconnecting. Default: 10000ms */
  pongTimeoutMs?: number;
  /** Logger instance. Defaults to console logger. */
  logger?: Logger;
}

interface ClientInfo {
  peerId: string;
  isAlive: boolean;
  pongTimer: ReturnType<typeof setTimeout> | null;
}

export interface ServerHandle {
  server: http.Server;
  wss: WebSocketServer;
  close: () => Promise<void>;
}

/**
 * Create and start the WatchTogether WebSocket server.
 * Returns handles to the HTTP server, WebSocket server, and a cleanup function.
 */
export function createServer(config: ServerConfig): ServerHandle {
  const heartbeatIntervalMs = config.heartbeatIntervalMs ?? 30_000;
  const pongTimeoutMs = config.pongTimeoutMs ?? 10_000;
  const logger = config.logger ?? consoleLogger;

  const roomManager = new RoomManager();
  const handler = new MessageHandler(roomManager, logger);

  const server = http.createServer();
  const wss = new WebSocketServer({ server });

  const connections = new Map<WebSocket, ClientInfo>();

  wss.on('connection', (ws, req) => {
    const peerId = randomUUID();
    const info: ClientInfo = { peerId, isAlive: true, pongTimer: null };
    connections.set(ws, info);

    const ip = req.socket.remoteAddress ?? 'unknown';
    logger.info('Client connected', { peerId, ip });

    ws.on('message', (data) => {
      const clientInfo = connections.get(ws);
      if (clientInfo) clientInfo.isAlive = true;
      handler.handleMessage(peerId, ws, data.toString());
    });

    ws.on('close', () => {
      const clientInfo = connections.get(ws);
      if (clientInfo?.pongTimer) clearTimeout(clientInfo.pongTimer);
      connections.delete(ws);
      logger.info('Client disconnected', { peerId });
      // Reuse MessageHandler's handleLeaveRoom logic via synthetic message
      handler.handleMessage(peerId, ws, JSON.stringify({ type: 'leave-room' }));
    });

    ws.on('error', () => {
      // Errors are handled by the close event which fires after
    });
  });

  // Heartbeat: ping all clients on interval, disconnect those that don't respond
  const heartbeatInterval = setInterval(() => {
    for (const [ws, info] of connections) {
      if (!info.isAlive) {
        // Already missed a pong — terminate
        logger.warn('Heartbeat timeout, terminating client', { peerId: info.peerId });
        ws.terminate();
        continue;
      }

      info.isAlive = false;
      ws.send(JSON.stringify({ type: 'ping' }));

      // Set a pong timeout: if client doesn't respond within pongTimeoutMs, terminate
      info.pongTimer = setTimeout(() => {
        if (!info.isAlive) {
          logger.warn('Pong timeout, terminating client', { peerId: info.peerId });
          ws.terminate();
        }
      }, pongTimeoutMs);
    }
  }, heartbeatIntervalMs);

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      clearInterval(heartbeatInterval);

      for (const [ws, info] of connections) {
        if (info.pongTimer) clearTimeout(info.pongTimer);
        ws.terminate();
      }
      connections.clear();

      server.close(() => resolve());
    });

  server.listen(config.port);

  return { server, wss, close };
}

// Auto-start when run directly
const isMain =
  process.argv[1] != null &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMain) {
  const port = parseInt(process.env['PORT'] ?? '8080', 10);
  const { server } = createServer({ port });
  server.once('listening', () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port;
    console.log(`WatchTogether server listening on port ${actualPort}`);
  });
}
