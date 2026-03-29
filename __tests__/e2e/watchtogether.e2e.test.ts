/**
 * E2E tests for WatchTogether.
 *
 * Setup:
 *   1. Start a real WatchTogether server on a random port.
 *   2. Build the extension with SERVER_URL pointed at that port + E2E_TEST=1
 *      so the manifest allows injection on http://localhost/*.
 *   3. Serve the test fixture via a minimal HTTP server.
 *   4. Launch two Puppeteer browser instances with the extension loaded.
 *
 * Tests exercise the full stack: popup UI → background service worker →
 * WebSocket server → background → content script → video element.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { execSync } from 'child_process';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from '../../server/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXTENSION_DIST = path.join(ROOT, 'extension/dist');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait until predicate returns true, polling every 100ms, up to timeout ms. */
async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeout = 10000,
  interval = 100,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/** Get extension ID by waiting for the service worker target to appear. */
async function getExtensionId(browser: Browser, timeout = 15000): Promise<string> {
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
    { timeout },
  );
  const match = swTarget.url().match(/chrome-extension:\/\/([^/]+)/);
  if (!match) throw new Error('Could not parse extension ID from ' + swTarget.url());
  return match[1];
}

/** Open the extension popup in a new page (navigates to the popup URL). */
async function openPopup(browser: Browser, extensionId: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
    waitUntil: 'networkidle0',
  });
  return page;
}

/** Serve the fixtures directory over HTTP. Returns { port, close }. */
function serveFixtures(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const filePath = path.join(FIXTURES_DIR, req.url === '/' ? '/test-video.html' : req.url!);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath);
        const mime: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
        };
        res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () => server.close(),
      });
    });
    server.on('error', reject);
  });
}

/** Read text content of an element, waiting for it to become non-empty. */
async function waitForText(page: Page, selector: string, timeout = 10000): Promise<string> {
  await waitFor(
    async () => {
      const text = await page.$eval(selector, (el) => el.textContent?.trim() ?? '');
      return text.length > 0;
    },
    timeout,
  );
  return page.$eval(selector, (el) => el.textContent?.trim() ?? '');
}

// ---------------------------------------------------------------------------
// Suite-level state
// ---------------------------------------------------------------------------

let syncServer: { close: () => Promise<void> };
let syncPort: number;
let fixtureServer: { port: number; close: () => void };
let browserA: Browser;
let browserB: Browser;
let extIdA: string;
let extIdB: string;

// Popup pages (opened per test, reused within test)
let popupA: Page;
let popupB: Page;

// Video pages
let videoPageA: Page;
let videoPageB: Page;

// Room code shared between tests
let roomCode: string;

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // 1. Start sync server on random port
  const { server, close } = createServer({ port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as { port: number };
  syncPort = addr.port;
  syncServer = { close };

  // 2. Build extension pointing at the test server
  execSync(`SERVER_URL=ws://localhost:${syncPort} E2E_TEST=1 npm run build`, {
    cwd: path.join(ROOT, 'extension'),
    stdio: 'inherit',
  });

  // 3. Start fixture file server
  fixtureServer = await serveFixtures();

  // 4. Launch two browser instances with extension loaded
  const launchOptions = {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  };

  // Launch browsers sequentially to avoid Chrome startup race conditions
  browserA = await puppeteer.launch(launchOptions);
  extIdA = await getExtensionId(browserA);

  browserB = await puppeteer.launch(launchOptions);
  extIdB = await getExtensionId(browserB);
}, 120000);

afterAll(async () => {
  // Close all pages (they may already be closed if the browser was closed in a test)
  await Promise.allSettled([
    popupA?.close().catch(() => {}),
    popupB?.close().catch(() => {}),
    videoPageA?.close().catch(() => {}),
    videoPageB?.close().catch(() => {}),
  ]);
  // Close browsers (browserB may have been closed in a test)
  await Promise.allSettled([
    browserA?.close().catch(() => {}),
    browserB?.close().catch(() => {}),
  ]);
  fixtureServer?.close();
  await syncServer?.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: WatchTogether', () => {
  it('User A creates a room → popup shows room code', async () => {
    popupA = await openPopup(browserA, extIdA);

    // Wait for connected state (create button enabled)
    await waitFor(async () => {
      const disabled = await popupA.$eval(
        '#create-room-btn',
        (el) => (el as HTMLButtonElement).disabled,
      );
      return !disabled;
    }, 15000);

    await popupA.click('#create-room-btn');

    // Wait for room code to appear (6 alphanumeric chars)
    roomCode = await waitForText(popupA, '#room-code-display', 15000);
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('User B enters room code and joins → both popups show 2 peers', async () => {
    expect(roomCode).toBeDefined();

    popupB = await openPopup(browserB, extIdB);

    // Wait for connected state
    await waitFor(async () => {
      const disabled = await popupB.$eval(
        '#join-room-btn',
        (el) => (el as HTMLButtonElement).disabled,
      );
      return !disabled;
    }, 15000);

    // Type room code and join
    await popupB.type('#room-code-input', roomCode);
    await popupB.click('#join-room-btn');

    // Both popups should show peer-count = 2
    await waitFor(async () => {
      const [cntA, cntB] = await Promise.all([
        popupA.$eval('#peer-count', (el) => el.textContent?.trim()),
        popupB.$eval('#peer-count', (el) => el.textContent?.trim()),
      ]);
      return cntA === '2' && cntB === '2';
    }, 15000);

    const cntA = await popupA.$eval('#peer-count', (el) => el.textContent?.trim());
    const cntB = await popupB.$eval('#peer-count', (el) => el.textContent?.trim());
    expect(cntA).toBe('2');
    expect(cntB).toBe('2');
  });

  it('User A navigates to test page → plays video → User B video plays', async () => {
    const fixtureUrl = `http://localhost:${fixtureServer.port}/test-video.html`;

    [videoPageA, videoPageB] = await Promise.all([
      browserA.newPage(),
      browserB.newPage(),
    ]);

    await Promise.all([
      videoPageA.goto(fixtureUrl, { waitUntil: 'networkidle0' }),
      videoPageB.goto(fixtureUrl, { waitUntil: 'networkidle0' }),
    ]);

    // Wait for test video to be generated (the fixture uses MediaRecorder which takes ~3s)
    await waitFor(async () => {
      const hasSrc = await videoPageA.$eval(
        'video.video-js',
        (el) => !!(el as HTMLVideoElement).src,
      );
      return hasSrc;
    }, 15000);

    await waitFor(async () => {
      const hasSrc = await videoPageB.$eval(
        'video.video-js',
        (el) => !!(el as HTMLVideoElement).src,
      );
      return hasSrc;
    }, 15000);

    // User A plays the video
    await videoPageA.evaluate(() => {
      const video = document.querySelector('video.video-js') as HTMLVideoElement;
      video.play().catch(() => {});
    });

    // Wait for User B's video to start playing
    await waitFor(async () => {
      const paused = await videoPageB.$eval(
        'video.video-js',
        (el) => (el as HTMLVideoElement).paused,
      );
      return !paused;
    }, 20000);

    const pausedB = await videoPageB.$eval(
      'video.video-js',
      (el) => (el as HTMLVideoElement).paused,
    );
    expect(pausedB).toBe(false);
  });

  it('User B pauses → User A video pauses', async () => {
    // User B pauses
    await videoPageB.evaluate(() => {
      const video = document.querySelector('video.video-js') as HTMLVideoElement;
      video.pause();
    });

    // Wait for User A's video to pause
    await waitFor(async () => {
      const paused = await videoPageA.$eval(
        'video.video-js',
        (el) => (el as HTMLVideoElement).paused,
      );
      return paused;
    }, 15000);

    const pausedA = await videoPageA.$eval(
      'video.video-js',
      (el) => (el as HTMLVideoElement).paused,
    );
    expect(pausedA).toBe(true);
  });

  it('User A seeks → User B video is at the same position (±1s tolerance)', async () => {
    // Get the video duration and seek to ~half of it
    const durationA = await videoPageA.$eval(
      'video.video-js',
      (el) => (el as HTMLVideoElement).duration,
    );
    // Seek to 1 second (safe for any duration, since the test video is ~3s)
    const targetTime = Math.min(1, durationA * 0.3);

    await videoPageA.evaluate((t: number) => {
      const video = document.querySelector('video.video-js') as HTMLVideoElement;
      video.currentTime = t;
    }, targetTime);

    // Wait for User B to receive seek event and update time
    await waitFor(async () => {
      const time = await videoPageB.$eval(
        'video.video-js',
        (el) => (el as HTMLVideoElement).currentTime,
      );
      return Math.abs(time - targetTime) <= 1;
    }, 15000);

    const timeB = await videoPageB.$eval(
      'video.video-js',
      (el) => (el as HTMLVideoElement).currentTime,
    );
    expect(Math.abs(timeB - targetTime)).toBeLessThanOrEqual(1);
  });

  it('User B closes browser → User A popup shows 1 peer', async () => {
    // Close entire browser B to force WebSocket disconnect
    await browserB.close();

    // Wait for User A's popup to update to 1 peer
    await waitFor(async () => {
      // Reload popup to get latest state
      const cnt = await popupA.$eval('#peer-count', (el) => el.textContent?.trim());
      return cnt === '1';
    }, 15000);

    const cnt = await popupA.$eval('#peer-count', (el) => el.textContent?.trim());
    expect(cnt).toBe('1');
  });
});
