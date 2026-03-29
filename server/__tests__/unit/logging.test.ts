import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../../src/index.js';
import type { Logger } from '../../src/Logger.js';
import { sendMessage, waitForMessage } from '../helpers/serverHelper.js';

function createMockLogger(): Logger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

async function startLoggedServer(logger: Logger) {
  const { server, close } = createServer({ port: 0, logger });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as { port: number };
  return { port: addr.port, close };
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function closeClient(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    ws.once('close', () => resolve());
    ws.close();
  });
}

describe('Server Logging', () => {
  let logger: ReturnType<typeof createMockLogger>;
  let port: number;
  let close: () => Promise<void>;
  let clients: WebSocket[];

  beforeEach(async () => {
    logger = createMockLogger();
    ({ port, close } = await startLoggedServer(logger));
    clients = [];
  });

  afterEach(async () => {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    await close();
  });

  it('logs client connected with peerId', async () => {
    const ws = await connectClient(port);
    clients.push(ws);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('connected'),
      expect.objectContaining({ peerId: expect.any(String) }),
    );
  });

  it('logs client disconnected with peerId', async () => {
    const ws = await connectClient(port);
    clients.push(ws);
    await closeClient(ws);

    // Small wait for the server close handler to fire
    await new Promise((r) => setTimeout(r, 50));

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('disconnected'),
      expect.objectContaining({ peerId: expect.any(String) }),
    );
  });

  it('logs room creation with code and peerId', async () => {
    const ws = await connectClient(port);
    clients.push(ws);

    sendMessage(ws, { type: 'create-room' });
    await waitForMessage(ws, (m) => m.type === 'room-created');

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('created'),
      expect.objectContaining({ code: expect.any(String), peerId: expect.any(String) }),
    );
  });

  it('logs peer joining a room with code and peerId', async () => {
    const wsA = await connectClient(port);
    const wsB = await connectClient(port);
    clients.push(wsA, wsB);

    sendMessage(wsA, { type: 'create-room' });
    const created = await waitForMessage(wsA, (m) => m.type === 'room-created') as { type: 'room-created'; code: string };

    logger.info.mockClear();

    sendMessage(wsB, { type: 'join-room', code: created.code });
    await waitForMessage(wsB, (m) => m.type === 'room-joined');

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('joined'),
      expect.objectContaining({ code: expect.any(String), peerId: expect.any(String) }),
    );
  });

  it('logs peer leaving a room', async () => {
    const ws = await connectClient(port);
    clients.push(ws);

    sendMessage(ws, { type: 'create-room' });
    await waitForMessage(ws, (m) => m.type === 'room-created');

    logger.info.mockClear();
    sendMessage(ws, { type: 'leave-room' });
    await new Promise((r) => setTimeout(r, 50));

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('left'),
      expect.objectContaining({ peerId: expect.any(String) }),
    );
  });

  it('logs error sent to client', async () => {
    const ws = await connectClient(port);
    clients.push(ws);

    // join-room with a non-existent code triggers ROOM_NOT_FOUND error
    sendMessage(ws, { type: 'join-room', code: 'NOEXST' });
    await waitForMessage(ws, (m) => m.type === 'error');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Error'),
      expect.objectContaining({ errorCode: expect.any(String) }),
    );
  });
});
