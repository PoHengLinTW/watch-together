# CLAUDE.md — WatchTogether

## Project Overview

WatchTogether is a Chrome extension + WebSocket server that syncs video playback between two people. One person creates a room, shares a 6-char code, the other joins, and both can control the video (play/pause/seek) — it mirrors instantly to the other person.

Read `DESIGN.md` for full architecture, protocol, and test specifications.

---

## Critical Rules

### TDD Is Non-Negotiable

This project uses strict Test-Driven Development. **Never write implementation code without a failing test first.**

Workflow for every feature:
1. **RED**: Write the test. Run it. Confirm it fails.
2. **GREEN**: Write the minimum implementation to make the test pass.
3. **REFACTOR**: Clean up, extract, improve — tests must stay green.

If you're about to write implementation code, stop and ask: "Is there a failing test for this?" If not, write the test first.

### Implementation Order

Follow this exact sequence. Do not skip ahead.

```
Phase 1: Server Unit Tests + Implementation                          ✓ COMPLETE
  → server/__tests__/unit/roomManager.test.ts     → server/src/RoomManager.ts
  → server/__tests__/unit/videoState.test.ts       → server/src/VideoState.ts
  → server/__tests__/unit/messageHandler.test.ts   → server/src/MessageHandler.ts

Phase 2: Server Integration                                          ✓ COMPLETE
  → server/__tests__/integration/serverIntegration.test.ts → server/src/index.ts

Phase 3: Extension Unit Tests + Implementation                       ✓ COMPLETE
  → extension/__tests__/unit/videoController.test.ts    → extension/src/content/VideoController.ts
  → extension/__tests__/unit/connectionManager.test.ts  → extension/src/background/ConnectionManager.ts
  → extension/__tests__/unit/popupState.test.ts         → extension/src/popup/PopupStateMachine.ts

Phase 4: Extension Integration                                       ✓ COMPLETE
  → extension/__tests__/integration/extensionIntegration.test.ts → wire up messaging

Phase 5: E2E Tests                                                   ⬜ PENDING
  → __tests__/e2e/watchtogether.e2e.test.ts → fix remaining issues

Phase 6: Polish                                                      ⬜ PENDING
  → popup UI styling, icons, error messages, README
```

### One Phase at a Time

When I say "implement Phase 1", work through the entire phase:
- Write ALL unit tests for that phase first (they should all fail)
- Then implement each module until all tests pass
- Run the full test suite before moving on

When I say "implement the next phase", advance to the next numbered phase.

---

## Tech Stack

| Component | Technology | Why |
|---|---|---|
| Server runtime | Node.js 20+ | WebSocket native support, JS everywhere |
| Server WS lib | `ws` | Lightweight, no framework overhead |
| Extension bundler | `esbuild` | Fast builds, good for watch mode |
| Language | TypeScript (strict) | Shared types across server + extension |
| Test framework | Vitest | Fast, ESM-native, good mocking |
| E2E | Puppeteer | Can load Chrome extensions |
| Package manager | npm workspaces | Monorepo without extra tooling |

---

## Project Structure

```
watchtogether/
├── CLAUDE.md                    # THIS FILE
├── DESIGN.md                    # Architecture & protocol spec
├── package.json                 # Root: workspaces config
├── server/                      # WebSocket sync server
│   ├── src/
│   │   ├── index.ts             # Entry point
│   │   ├── RoomManager.ts       # Room CRUD
│   │   ├── MessageHandler.ts    # WS message routing
│   │   ├── VideoState.ts        # Video state tracking
│   │   ├── Logger.ts            # Console logger interface
│   │   ├── types.ts             # Server-specific types
│   │   └── utils.ts             # Room code generation
│   └── __tests__/
│       ├── unit/
│       └── integration/
├── extension/                   # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── build.mjs                # esbuild bundler config
│   ├── src/
│   │   ├── content/             # Injected into anime1.me pages
│   │   │   ├── index.ts
│   │   │   ├── VideoController.ts
│   │   │   ├── VideoDetector.ts
│   │   │   └── AutoplayOverlay.ts  # Click-to-play overlay for blocked autoplay
│   │   ├── background/          # Service worker
│   │   │   ├── index.ts
│   │   │   └── ConnectionManager.ts
│   │   ├── popup/               # Extension popup UI
│   │   │   ├── popup.html
│   │   │   ├── popup.css
│   │   │   ├── popup.ts
│   │   │   └── PopupStateMachine.ts
│   │   └── shared/
│   │       ├── messages.ts
│   │       └── debug.ts         # Debug logging utility
│   └── __tests__/
│       ├── unit/
│       └── integration/
├── shared/
│   └── protocol.ts              # Shared message types
├── test/                        # Shared test mocks and helpers
│   ├── mocks/
│   │   ├── mockChrome.ts
│   │   ├── mockVideo.ts
│   │   └── mockWebSocket.browser.ts
│   └── helpers/
│       └── serverHelper.ts      # Spin up/down test server
└── __tests__/
    └── e2e/
```

---

## Commands

```bash
# Install everything (from repo root)
npm install

# Run server tests
cd server && npx vitest run

# Run server tests (watch mode)
cd server && npx vitest

# Run extension tests
cd extension && npx vitest run

# Run ALL tests
npm test                          # runs vitest in both workspaces

# Run E2E tests
npm run test:e2e                  # requires built extension + running server

# Start server (dev)
cd server && npm run dev

# Build extension (one-shot)
cd extension && npm run build

# Build extension (watch)
cd extension && npm run watch

# Type-check everything
npm run typecheck                 # tsc --noEmit across workspaces
```

---

## Coding Standards

### TypeScript
- `strict: true` in all tsconfig files
- No `any` — use `unknown` and narrow
- Prefer interfaces over type aliases for object shapes
- Export types separately: `export type { Foo }` (helps bundling)

### Naming
- Files: PascalCase for classes (`RoomManager.ts`), camelCase for utils (`utils.ts`)
- Tests: `[module].test.ts` mirroring source structure
- Variables/functions: camelCase
- Types/interfaces: PascalCase
- Constants: UPPER_SNAKE for true constants, camelCase for config

### Error Handling
- Server: never crash on bad client input; always send error message and continue
- Extension: log errors to console; show user-friendly messages in popup
- All WebSocket errors: attempt reconnect with exponential backoff

### Code Style
- No classes for pure functions — use plain functions/modules
- Classes for stateful things (RoomManager, VideoController, ConnectionManager)
- Dependency injection for testability: pass dependencies into constructors, don't import singletons
- Keep functions small: if it's over 30 lines, extract a helper

---

## Protocol Types (Source of Truth)

These types are defined in `shared/protocol.ts` and used by both server and extension. Copy them exactly.

```typescript
// === Client → Server ===
type ClientMessage =
  | { type: 'create-room' }
  | { type: 'join-room'; code: string }
  | { type: 'leave-room' }
  | { type: 'sync-event'; event: SyncEvent }
  | { type: 'pong' }

// === Server → Client ===
type ServerMessage =
  | { type: 'room-created'; code: string; peerId: string }
  | { type: 'room-joined'; code: string; peerId: string; state: VideoState | null; peerCount: number }
  | { type: 'peer-joined'; peerId: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'sync-event'; event: SyncEvent; fromPeer: string; sequence: number }  // sequence assigned by server
  | { type: 'error'; message: string; errorCode: ErrorCode }
  | { type: 'ping' }

type SyncEvent =
  | { action: 'play'; currentTime: number; timestamp: number; videoId: string }
  | { action: 'pause'; currentTime: number; timestamp: number; videoId: string }
  | { action: 'seek'; currentTime: number; timestamp: number; videoId: string }
  | { action: 'playbackRate'; rate: number; timestamp: number; videoId: string }
  | { action: 'url-change'; url: string; timestamp: number }

type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NOT_IN_ROOM'
  | 'ALREADY_IN_ROOM'
  | 'INVALID_MESSAGE'
  | 'RATE_LIMITED'

interface VideoState {
  url: string;
  videoId: string;           // data-vid attribute from anime1.me's <video>
  currentTime: number;
  playing: boolean;
  playbackRate: number;
  updatedAt: number;
}
```

---

## Key Design Decisions

Refer to these when making implementation choices:

1. **Anti-echo mechanism**: When applying a remote sync event to the local video, suppress the resulting local event so it doesn't bounce back. Use a boolean flag + requestAnimationFrame to re-enable.

2. **Seek debouncing**: Outgoing seek events are debounced by 300ms. The user scrubbing rapidly should only send the final position.

3. **Late joiner sync**: When joining an existing room, the server sends the last-known VideoState. If `playing` is true, the joiner adjusts `currentTime` by elapsed time since `updatedAt`.

4. **Video detection on anime1.me (VERIFIED)**: anime1.me uses **Video.js** loaded from `sta.anicdn.com/videojs.bundle.js` (deferred). The video element is at `div.vjscontainer video.video-js` with attributes `data-apireq`, `data-vid`, `data-tserver`. Use `document.querySelector('div.vjscontainer video.video-js')` as the primary selector. Since `videojs.bundle.js` is deferred, use MutationObserver if the element isn't found immediately. **Content scripts run in an isolated world** — you cannot access `window.videojs` directly, so use the raw `<video>` element's native API (`play()`, `pause()`, `currentTime`, event listeners). Video.js wraps the native element, so native events (`play`, `pause`, `seeked`, `ratechange`) all fire normally.

5. **Multiple videos on listing pages (CRITICAL)**: Category/listing pages (e.g., `anime1.me/category/...`) embed one `<video>` per episode — up to 10+ on a single page. The content script must: (a) attach listeners to ALL videos, (b) track which one is "active" (last one the user played), (c) include `videoId` (from `data-vid` attribute) in every outgoing sync event, (d) use `videoId` to find the correct `<video>` when applying incoming remote events via `document.querySelector('video.video-js[data-vid="${videoId}"]')`. Single episode pages (`anime1.me/<number>`) have exactly one video.

6. **Room codes**: 6-char uppercase alphanumeric. Case-insensitive lookup. Collision-checked on generation.

7. **No persistence**: All state is in-memory. Server restart = all rooms gone. This is fine for MVP.

8. **Server deployment**: Self-hosted on homelab behind Cloudflare Tunnel. Extension connects to `wss://watchtogether.<domain>`. Cloudflare handles TLS. No YouTube support in MVP — anime1.me only.

9. **Sequence-based stale event filtering**: The server assigns a monotonically increasing `sequence` number to every relayed `sync-event` (per room). Clients track the last applied sequence and ignore any incoming event whose sequence is ≤ the last applied value. This prevents out-of-order or duplicate events from causing stale state.

10. **Service worker keepalive**: Chrome can terminate the background service worker after ~30s of inactivity. The background script registers a `chrome.alarms` alarm that fires every 25 minutes. The alarm handler is a no-op that simply keeps the worker alive while the extension is in a room.

---

## Testing Guidance

### Mock Patterns

**Mock WebSocket (for extension tests)**:
```typescript
class MockWebSocket {
  readyState = WebSocket.OPEN;
  send = vi.fn();
  close = vi.fn();
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: Event) => void) | null = null;
  onopen: (() => void) | null = null;

  // Test helper: simulate server message
  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}
```

**Mock HTMLVideoElement (for content script tests)**:
```typescript
class MockVideoElement {
  currentTime = 0;
  paused = true;
  playbackRate = 1;
  clientWidth = 640;
  clientHeight = 480;
  dataset: Record<string, string>;  // dataset.vid maps to data-vid attribute
  private listeners = new Map<string, Set<Function>>();

  constructor(videoId: string = 'testVid1') {
    this.dataset = { vid: videoId };
  }

  play() {
    this.paused = false;
    this.emit('play');
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
  addEventListener(event: string, fn: Function) { ... }
  removeEventListener(event: string, fn: Function) { ... }
  private emit(event: string) { ... }
}
```

**Mock chrome.runtime (for messaging tests)**:
```typescript
const mockChrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    sendMessage: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
  },
  storage: {
    session: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
};
globalThis.chrome = mockChrome as any;
```

### Test Assertions

- **Timing tests**: Use `vi.useFakeTimers()` for debouncing, heartbeat, expiry tests
- **WebSocket tests**: For integration tests, use real `ws` library connecting to real server on localhost
- **Tolerance**: Seek sync tests should allow ±1 second tolerance
- **Async**: All WebSocket tests need proper `await` / callback handling; use `waitFor` helper:
  ```typescript
  function waitFor(fn: () => boolean, timeout = 2000): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (fn()) return resolve();
        if (Date.now() - start > timeout) return reject(new Error('Timed out'));
        setTimeout(check, 10);
      };
      check();
    });
  }
  ```

---

## Common Pitfalls

1. **Service Worker lifecycle**: Chrome can kill the background service worker after 30s of inactivity. Use `chrome.alarms` or periodic `chrome.runtime.sendMessage` from content script to keep it alive while in a room.

2. **Content Script isolation**: Content scripts run in an isolated world. `window.videojs` is NOT accessible. Use the raw `<video>` element's native API instead — Video.js wraps the native element, so standard events and methods work fine. Use `chrome.runtime.sendMessage` to communicate with background, NOT direct function calls.

3. **Video.js deferred loading**: The `videojs.bundle.js` script has `defer` attribute, so the `<video>` element might not be fully initialized when the content script runs at `document_idle`. Use a MutationObserver or a polling loop (`setInterval` checking for `div.vjscontainer video.video-js`) with a reasonable timeout.

4. **Video autoplay policy**: Browsers block `video.play()` without user gesture. When receiving a remote "play" event, if `play()` rejects, show a toast/overlay asking the user to click to start playback.

5. **esbuild + Chrome Extension**: Use `format: 'esm'` for background (service worker supports ESM). Use `format: 'iife'` for content script (injected into page context).

6. **Cloudflare Tunnel + WebSocket**: Cloudflare Tunnels support WebSocket natively but may add latency (~20-50ms). This is acceptable for video sync. If the tunnel connection drops, the extension's reconnect logic handles it.

7. **anime1.me Cloudflare protection**: anime1.me itself uses Cloudflare (cf_clearance cookies). This doesn't affect our extension since the content script runs in the already-authenticated page context. The sync server is on a separate domain behind its own tunnel.

---

## How to Ask Me to Work

Use these patterns:

- **"Set up the project scaffolding"** → Create package.json files, tsconfig, vitest config, directory structure, manifest.json. No implementation code.

- **"Implement Phase 1"** → Write all server unit tests (they fail), then implement RoomManager, VideoState, MessageHandler until all tests pass.

- **"Implement Phase N"** → Work through the Nth phase from the implementation order above.

- **"Run the tests"** → Execute `npx vitest run` in the appropriate workspace and report results.

- **"Fix the failing tests"** → Look at test output, fix implementation (never fix the test unless the test is wrong).

- **"Add a feature: [description]"** → Write test first, then implement. Always.

- **"Investigate anime1.me"** → Use the browser to analyze the site's video player structure and update VideoDetector accordingly.

---

## Definition of Done (per Phase)

A phase is complete when:
- [ ] All tests in the phase are written and pass
- [ ] `npx vitest run` exits with 0
- [ ] `tsc --noEmit` has no errors
- [ ] No `any` types in new code
- [ ] Code follows naming/style conventions above
- [ ] New public functions have JSDoc comments
