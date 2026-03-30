# WatchTogether — Design Document

## 1. Vision & Scope

**WatchTogether** is a Chrome extension that lets two people watch the same video in sync. Either person can play, pause, or seek — the other person's player mirrors instantly.

### MVP Scope (v0.1)

- **2 users max** per room
- **Video sources**: anime1.me (Video.js player)
- **Sync actions**: play, pause, seek, playback rate
- **Room system**: create room → get 6-char code → share code → friend joins
- **No accounts** — ephemeral rooms, no persistence

### Explicit Non-Goals (MVP)

- YouTube support (deferred — use alternative app)
- Chat / text messaging
- Webcam / voice
- More than 2 users
- Mobile support
- Video file hosting
- DRM circumvention

---

## 2. Architecture Overview

```
┌──────────────────┐          WebSocket          ┌──────────────────┐
│  Browser A        │◄──────────────────────────►│  Sync Server      │
│  ┌──────────────┐ │                             │  (Node.js + ws)   │
│  │ Content Script│ │          WebSocket          │                   │
│  │ (video hook)  │ │◄──────────────────────────►│  • Room mgmt      │
│  ├──────────────┤ │                             │  • Event relay     │
│  │ Background SW │ │                             │  • Heartbeat       │
│  ├──────────────┤ │                             └──────────────────┘
│  │ Popup UI      │ │
│  └──────────────┘ │
└──────────────────┘

        ┌──────────────────┐
        │  Browser B        │  ◄── same structure
        └──────────────────┘
```

### Why This Architecture

| Decision | Rationale |
|---|---|
| **Chrome Extension** (not website) | Need to inject into anime1.me's Video.js player; can't iframe third-party sites |
| **WebSocket relay** (not WebRTC) | Syncing tiny JSON commands (~100 bytes); WebRTC's complexity (STUN/TURN, NAT traversal) is unjustified |
| **Stateless server** | Server holds room membership in memory only; no DB needed for MVP |
| **Content Script hooks** | Intercepts HTMLVideoElement events on the Video.js player's underlying `<video>` element |
| **Homelab + Cloudflare Tunnel** | Self-hosted, no recurring cost, WS support via Cloudflare natively |

---

## 3. Component Design

### 3.1 Sync Server (`server/`)

**Tech**: Node.js + `ws` library (no Express needed for MVP)

**Responsibilities**:
- Room lifecycle: create, join, leave, destroy
- Message relay: broadcast sync events to all *other* peers in room
- Heartbeat: detect dead connections (30s ping/pong)
- Room code generation: 6-char alphanumeric, collision-checked

**Data Model (in-memory)**:
```typescript
interface Room {
  code: string;
  peers: Map<string, WebSocket>;  // peerId → ws connection
  createdAt: number;
  videoState: VideoState;         // last-known state for late joiners
}

interface VideoState {
  url: string;
  videoId: string;           // data-vid attribute from anime1.me's <video>
  currentTime: number;
  playing: boolean;
  playbackRate: number;
  updatedAt: number;
}
```

**Room Rules**:
- Max 2 peers per room
- Room auto-destroys when last peer leaves
- Room expires after 1 hour of inactivity (no messages)
- Room codes are case-insensitive (stored uppercase)

**Message Protocol**:
```typescript
// Client → Server
type ClientMessage =
  | { type: 'create-room' }
  | { type: 'join-room'; code: string }
  | { type: 'leave-room' }
  | { type: 'sync-event'; event: SyncEvent }
  | { type: 'pong' }

// Server → Client
type ServerMessage =
  | { type: 'room-created'; code: string; peerId: string }
  | { type: 'room-joined'; code: string; peerId: string; state: VideoState | null; peerCount: number }
  | { type: 'peer-joined'; peerId: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'sync-event'; event: SyncEvent; fromPeer: string }
  | { type: 'error'; message: string; errorCode: string }
  | { type: 'ping' }

// Sync events (videoId = data-vid attribute from anime1.me's <video> element)
type SyncEvent =
  | { action: 'play'; currentTime: number; timestamp: number; videoId: string }
  | { action: 'pause'; currentTime: number; timestamp: number; videoId: string }
  | { action: 'seek'; currentTime: number; timestamp: number; videoId: string }
  | { action: 'playbackRate'; rate: number; timestamp: number; videoId: string }
  | { action: 'url-change'; url: string; timestamp: number }
```

### 3.2 Chrome Extension

#### 3.2.1 Content Script (`extension/src/content/`)

Injected into pages matching `*://anime1.me/*`.

**Responsibilities**:
- Detect ALL `<video>` elements on page (listing pages have up to 10+)
- Track the "active" video: whichever the user last interacted with
- Hook video events: `play`, `pause`, `seeked`, `ratechange` on ALL videos
- Apply incoming sync commands to the correct video (matched by `data-vid`)
- Anti-echo: ignore events that *we* triggered programmatically
- Include `videoId` (from `data-vid` attribute) in every outgoing sync event

**Multi-Video Strategy** (critical for listing pages):
```
anime1.me listing pages (e.g. /category/...) embed one <video> per episode.
A page listing 10 episodes has 10 <video> elements, all inside div.vjscontainer.

Strategy: "Attach to all, sync the active one"
1. querySelectorAll('div.vjscontainer video.video-js') → get ALL videos
2. Attach play/pause/seeked/ratechange listeners to EVERY video
3. When any video fires 'play' → it becomes the activeVideo
4. Only activeVideo's events get forwarded to background SW
5. Each outgoing SyncEvent includes videoId = video.dataset.vid
6. Incoming remote events use videoId to find the correct <video>:
   document.querySelector(`video.video-js[data-vid="${videoId}"]`)
7. If target video not found (peer is on a different page), ignore the event
8. MutationObserver watches for new <video> elements (deferred Video.js init)
```

**Video Detection Strategy** (anime1.me — Video.js):
```
anime1.me uses WordPress + Video.js (loaded from sta.anicdn.com/videojs.bundle.js).
The <video> elements are inside div.vjscontainer with class "video-js".

Page types:
- Episode page (anime1.me/<number>): 1 video
- Listing page  (anime1.me/category/...): 10+ videos (one per episode)

Strategy:
1. Wait for DOMContentLoaded
2. querySelectorAll('div.vjscontainer video.video-js') → get ALL videos
3. If none found, observe DOM with MutationObserver (videojs.bundle.js is deferred)
4. Attach play/pause/seeked/ratechange listeners to EVERY video
5. Track activeVideo: whichever video last received a 'play' from the user
6. Include data-vid attribute as videoId in all outgoing sync events
7. Use videoId to target the correct <video> for incoming remote events
8. No SPA handling needed — episode navigation is full page reload
```

**Anti-Echo Mechanism**:
When we receive a remote sync event and call `video.play()`, that triggers a local `play` event.
We must NOT re-broadcast that event back to the server.

```typescript
class VideoController {
  private suppressEvents = false;

  applyRemoteEvent(event: SyncEvent) {
    this.suppressEvents = true;
    // apply event to video...
    // Wait for the event to fire, then re-enable
    requestAnimationFrame(() => {
      this.suppressEvents = false;
    });
  }

  onLocalEvent(event: SyncEvent) {
    if (this.suppressEvents) return; // anti-echo
    this.sendToBackground(event);
  }
}
```

#### 3.2.2 Background Service Worker (`extension/src/background/`)

**Responsibilities**:
- Manage WebSocket connection to sync server
- Bridge messages between content script and server
- Handle connection lifecycle (reconnect on disconnect)
- Store room state (code, peerId) in `chrome.storage.session`

**Connection State Machine**:
```
DISCONNECTED → CONNECTING → CONNECTED → IN_ROOM
      ↑              │            │          │
      └──────────────┴────────────┴──────────┘
                   (on error/close)
```

#### 3.2.3 Popup UI (`extension/src/popup/`)

Simple HTML/CSS/JS popup (no framework for MVP).

**States**:
1. **Disconnected**: Show server URL input + Connect button
2. **Connected**: Show "Create Room" button + "Join Room" input
3. **In Room**: Show room code, peer status, "Leave Room" button

---

## 4. Sync Protocol Details

### 4.1 Event Flow

```
User A presses play
  → Content Script A detects 'play' event
  → Content Script A sends to Background SW A via chrome.runtime.sendMessage
  → Background SW A sends { type: 'sync-event', event: { action: 'play', ... } } over WS
  → Server relays to all other peers in room
  → Background SW B receives sync-event
  → Background SW B sends to Content Script B via chrome.tabs.sendMessage
  → Content Script B calls video.play() with anti-echo suppression
```

### 4.2 Late Joiner Sync

When peer B joins an existing room:
1. Server sends `room-joined` with the last-known `VideoState`
2. Content Script B seeks to `currentTime` and matches `playing` state
3. Time adjustment: `adjustedTime = state.currentTime + (Date.now() - state.updatedAt) / 1000` if playing

### 4.3 Conflict Resolution

**Strategy: Last-write-wins with source timestamp**

- Each sync event carries a `timestamp` (client's `Date.now()`)
- If two events arrive within 200ms of each other, the later timestamp wins
- In practice with 2 users, conflicts are rare — this is just a safety net

### 4.4 Seek Debouncing

Scrubbing a progress bar fires many `seeked` events rapidly. Debounce outgoing seek events by 300ms so only the final position is broadcast.

---

## 5. Test Strategy (TDD)

Tests are written BEFORE implementation. The project follows strict Red-Green-Refactor.

### 5.1 Test Pyramid

```
        ╱╲
       ╱ E2E ╲          2-3 tests  (Puppeteer + real extension)
      ╱────────╲
     ╱Integration╲      8-12 tests (real WebSocket, mocked browser)
    ╱──────────────╲
   ╱   Unit Tests    ╲   30-40 tests (pure functions, no I/O)
  ╱════════════════════╲
```

### 5.2 Unit Tests — Server (`server/__tests__/unit/`)

Framework: **Vitest** (fast, ESM-native, compatible with Node)

#### 5.2.1 Room Manager Tests (`roomManager.test.ts`)

```
describe('RoomManager', () => {

  describe('createRoom', () => {
    it('should generate a 6-character uppercase alphanumeric code')
    it('should not generate duplicate codes for concurrent creates')
    it('should store the room with an empty peers map')
    it('should set createdAt to current timestamp')
    it('should initialize videoState as null')
  })

  describe('joinRoom', () => {
    it('should add peer to existing room')
    it('should return current videoState for late joiner')
    it('should reject join if room is full (2 peers)')
    it('should reject join if room code does not exist')
    it('should reject join if peer is already in a room')
  })

  describe('leaveRoom', () => {
    it('should remove peer from room')
    it('should destroy room when last peer leaves')
    it('should notify remaining peer when other peer leaves')
    it('should be idempotent (leaving when not in room is no-op)')
  })

  describe('room expiry', () => {
    it('should mark room as expired after 1 hour of no messages')
    it('should clean up expired rooms on sweep interval')
    it('should not expire rooms with recent activity')
  })

  describe('room code generation', () => {
    it('should generate codes matching /^[A-Z0-9]{6}$/')
    it('should be case-insensitive on lookup (abc123 → ABC123)')
    it('should retry if generated code collides with existing room')
  })
})
```

#### 5.2.2 Message Handler Tests (`messageHandler.test.ts`)

```
describe('MessageHandler', () => {

  describe('parseMessage', () => {
    it('should parse valid JSON messages')
    it('should reject non-JSON messages with error')
    it('should reject messages missing "type" field')
    it('should reject unknown message types')
    it('should reject messages exceeding 10KB')
  })

  describe('handleSyncEvent', () => {
    it('should relay sync event to all other peers in room')
    it('should NOT echo sync event back to sender')
    it('should update room videoState on play/pause/seek')
    it('should reject sync event if sender is not in a room')
    it('should attach fromPeer to relayed event')
  })

  describe('handleCreateRoom', () => {
    it('should create room and send room-created response')
    it('should auto-join creator to the new room')
    it('should reject if peer is already in a room')
  })

  describe('handleJoinRoom', () => {
    it('should join room and send room-joined with state')
    it('should notify existing peer of new peer')
    it('should send error for invalid room code')
    it('should send error for full room')
  })
})
```

#### 5.2.3 Video State Tests (`videoState.test.ts`)

```
describe('VideoState', () => {

  describe('applyEvent', () => {
    it('should update currentTime and playing=true on play event')
    it('should update currentTime and playing=false on pause event')
    it('should update currentTime on seek event')
    it('should update playbackRate on rate event')
    it('should update url on url-change event')
    it('should update updatedAt timestamp on every event')
  })

  describe('getAdjustedTime', () => {
    it('should return currentTime if paused')
    it('should add elapsed time since updatedAt if playing')
    it('should account for playbackRate in elapsed calculation')
  })
})
```

### 5.3 Unit Tests — Extension (`extension/__tests__/unit/`)

#### 5.3.1 Video Controller Tests (`videoController.test.ts`)

Uses **jsdom** or a mock `HTMLVideoElement`.

```
describe('VideoController', () => {

  describe('detectVideo', () => {
    it('should find ALL <video> elements inside div.vjscontainer')
    it('should observe DOM for deferred Video.js initialization via MutationObserver')
    it('should attach event listeners to every detected video')
    it('should emit "videos-found" event with count when detected')
    it('should handle new videos added after initial scan (MutationObserver)')
  })

  describe('active video tracking', () => {
    it('should set activeVideo when a video fires play event')
    it('should switch activeVideo if user plays a different video')
    it('should only forward events from the activeVideo to background')
    it('should ignore events from non-active videos')
    it('should include video.dataset.vid as videoId in outgoing events')
  })

  describe('local event capture', () => {
    it('should emit sync event with videoId on active video play')
    it('should emit sync event with videoId on active video pause')
    it('should emit sync event with videoId on active video seeked')
    it('should emit sync event with videoId on active video ratechange')
    it('should include currentTime in every event')
    it('should include timestamp in every event')
    it('should debounce seek events (300ms)')
  })

  describe('anti-echo', () => {
    it('should suppress local events while applying remote event')
    it('should re-enable local events after remote apply completes')
    it('should not suppress events from genuine user interaction after remote apply')
    it('should only suppress events on the specific video being remotely controlled')
  })

  describe('applyRemoteEvent', () => {
    it('should find target video by data-vid matching event.videoId')
    it('should call video.play() on play event for matched video')
    it('should call video.pause() on pause event for matched video')
    it('should set video.currentTime on seek event for matched video')
    it('should set video.playbackRate on rate event for matched video')
    it('should seek to adjusted time for play event (compensate latency)')
    it('should ignore event if no video matches the videoId')
    it('should set matched video as activeVideo when applying remote play')
  })
})
```

#### 5.3.2 Connection Manager Tests (`connectionManager.test.ts`)

```
describe('ConnectionManager', () => {

  describe('connect', () => {
    it('should establish WebSocket to given server URL')
    it('should transition state to CONNECTING then CONNECTED')
    it('should reject if already connected')
    it('should handle connection failure with error callback')
  })

  describe('reconnect', () => {
    it('should attempt reconnect with exponential backoff')
    it('should cap backoff at 30 seconds')
    it('should stop reconnecting after 5 failures')
    it('should rejoin room on successful reconnect')
  })

  describe('send', () => {
    it('should serialize and send message over WebSocket')
    it('should queue messages if connecting (not yet open)')
    it('should throw if disconnected')
  })

  describe('heartbeat', () => {
    it('should respond to server ping with pong')
    it('should detect missed pings and trigger reconnect')
  })
})
```

#### 5.3.3 Popup State Machine Tests (`popupState.test.ts`)

```
describe('PopupStateMachine', () => {

  it('should start in DISCONNECTED state')
  it('should transition to CONNECTED after successful connect')
  it('should transition to IN_ROOM after create or join')
  it('should transition back to CONNECTED on leave')
  it('should transition to DISCONNECTED on connection loss')
  it('should show room code in IN_ROOM state')
  it('should show peer count in IN_ROOM state')
  it('should disable join button while connecting')
  it('should validate room code format before sending join')
})
```

### 5.4 Integration Tests (`__tests__/integration/`)

#### 5.4.1 Server Integration (`serverIntegration.test.ts`)

Spins up real server on a random port; uses `ws` client library.

```
describe('Server Integration', () => {

  describe('full room lifecycle', () => {
    it('client A creates room → gets code → client B joins with code → both receive peer-joined')
    it('client A sends play → client B receives play event (not A)')
    it('client B leaves → client A gets peer-left → room still exists')
    it('client A leaves → room is destroyed')
  })

  describe('late joiner sync', () => {
    it('A creates room, sends play at t=10s → B joins → B receives state with currentTime=10')
  })

  describe('error handling', () => {
    it('joining non-existent room returns error with code ROOM_NOT_FOUND')
    it('joining full room returns error with code ROOM_FULL')
    it('sending sync event without room returns error with code NOT_IN_ROOM')
    it('malformed JSON returns error with code INVALID_MESSAGE')
  })

  describe('connection resilience', () => {
    it('server sends ping every 30s; client must pong within 10s or gets disconnected')
    it('abrupt client disconnect triggers peer-left for remaining peer')
  })
})
```

#### 5.4.2 Extension Integration (`extensionIntegration.test.ts`)

Uses a mock WebSocket server + jsdom for video elements.

```
describe('Extension Integration', () => {

  describe('content script ↔ background', () => {
    it('content script video play → background sends sync event with videoId to server')
    it('background receives sync event from server → content script applies to correct video by videoId')
  })

  describe('full sync flow (mocked server)', () => {
    it('two tabs: tab A plays video → tab B video starts playing (same videoId)')
    it('two tabs: tab A seeks to 30s → tab B video jumps to 30s (same videoId)')
    it('two tabs: tab A pauses → tab B video pauses (same videoId)')
  })

  describe('multi-video page sync', () => {
    it('page has 3 videos: user plays video #2 → only video #2 events are sent')
    it('remote play event with videoId targets the correct video among multiple')
    it('remote event with unknown videoId is silently ignored')
    it('user switches from video #1 to video #3 → activeVideo updates, sync follows')
  })
})
```

### 5.5 E2E Tests (`__tests__/e2e/`)

Framework: **Puppeteer** with Chrome extension loading.

```
describe('E2E: WatchTogether', () => {

  // Setup: build extension, start server, launch 2 browser instances
  // with extension loaded via --load-extension flag
  // Use a local test page with <video> mimicking anime1.me structure
  // (div.vjscontainer > video.video-js) for reliable offline testing

  it('User A creates room → popup shows room code')
  it('User B enters room code and joins → both popups show "2 peers"')
  it('User A navigates to test page with video → plays video → User B video plays')
  it('User B pauses → User A video pauses')
  it('User A seeks to 1:30 → User B video is at ~1:30 (±1s tolerance)')
  it('User B closes tab → User A popup shows "1 peer"')
})
```

### 5.6 Test Utilities & Mocks

```typescript
// test/mocks/mockVideo.ts — Fake HTMLVideoElement
class MockVideoElement {
  currentTime = 0;
  paused = true;
  playbackRate = 1;
  dataset: Record<string, string>;
  private listeners: Map<string, Function[]> = new Map();

  constructor(videoId: string = 'testVid1') {
    this.dataset = { vid: videoId };
  }

  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
  addEventListener(event, fn) { ... }
  removeEventListener(event, fn) { ... }
  private emit(event) { ... }
}

// test/mocks/mockChrome.ts — Fake chrome.* APIs
const mockChrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  tabs: {
    sendMessage: vi.fn(),
    query: vi.fn(),
  },
  storage: {
    session: { get: vi.fn(), set: vi.fn() },
  },
};

// test/helpers/serverHelper.ts — Spin up/down test server
async function startTestServer(port?: number): Promise<{ port: number; close: () => void }>;
```

### 5.7 TDD Workflow

The implementation order follows strict Red → Green → Refactor:

```
Phase 1: Server Unit Tests
  1. Write roomManager.test.ts        → RED
  2. Implement RoomManager             → GREEN
  3. Refactor                          → REFACTOR
  4. Write messageHandler.test.ts      → RED
  5. Implement MessageHandler          → GREEN
  6. Refactor                          → REFACTOR
  7. Write videoState.test.ts          → RED
  8. Implement VideoState              → GREEN

Phase 2: Server Integration Tests
  9. Write serverIntegration.test.ts   → RED
  10. Wire up server entry point       → GREEN

Phase 3: Extension Unit Tests
  11. Write videoController.test.ts    → RED
  12. Implement VideoController        → GREEN
  13. Write connectionManager.test.ts  → RED
  14. Implement ConnectionManager      → GREEN
  15. Write popupState.test.ts         → RED
  16. Implement PopupStateMachine      → GREEN

Phase 4: Extension Integration + E2E
  17. Write extensionIntegration.test.ts → RED
  18. Wire up extension messaging        → GREEN
  19. Write e2e tests                    → RED
  20. Fix remaining issues               → GREEN
```

---

## 6. Project Structure

```
watchtogether/
├── CLAUDE.md                          # Claude Code instructions
├── DESIGN.md                          # This document
├── package.json                       # Monorepo root (workspaces)
│
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts                   # Entry: start WS server
│   │   ├── RoomManager.ts
│   │   ├── MessageHandler.ts
│   │   ├── VideoState.ts
│   │   ├── types.ts                   # Shared protocol types
│   │   └── utils.ts                   # Code generation, etc.
│   └── __tests__/
│       ├── unit/
│       │   ├── roomManager.test.ts
│       │   ├── messageHandler.test.ts
│       │   └── videoState.test.ts
│       └── integration/
│           └── serverIntegration.test.ts
│
├── extension/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── manifest.json                  # Chrome Extension Manifest V3
│   ├── src/
│   │   ├── content/
│   │   │   ├── index.ts               # Content script entry
│   │   │   ├── VideoController.ts
│   │   │   └── VideoDetector.ts
│   │   ├── background/
│   │   │   ├── index.ts               # Service worker entry
│   │   │   └── ConnectionManager.ts
│   │   ├── popup/
│   │   │   ├── popup.html
│   │   │   ├── popup.css
│   │   │   ├── popup.ts
│   │   │   └── PopupStateMachine.ts
│   │   └── shared/
│   │       ├── types.ts               # Re-exports from protocol
│   │       └── messages.ts            # Chrome message helpers
│   └── __tests__/
│       ├── unit/
│       │   ├── videoController.test.ts
│       │   ├── connectionManager.test.ts
│       │   └── popupState.test.ts
│       └── integration/
│           └── extensionIntegration.test.ts
│
├── shared/
│   └── protocol.ts                    # Shared types (symlinked or published)
│
└── __tests__/
    └── e2e/
        ├── watchtogether.e2e.test.ts
        └── fixtures/
            └── test-video.html        # Local HTML mimicking anime1.me structure:
                                       # div.vjscontainer > video.video-js with a test mp4
```

---

## 7. Chrome Extension Manifest (V3)

```json
{
  "manifest_version": 3,
  "name": "WatchTogether",
  "version": "0.1.0",
  "description": "Watch videos in sync with a friend",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": [
    "*://anime1.me/*"
  ],
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["*://anime1.me/*"],
      "js": ["content/index.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## 8. anime1.me Specifics (Verified from Real HTML)

### Video Player Analysis

anime1.me is a **WordPress site** using **Video.js** as its video player. Here's the exact HTML structure observed on episode pages:

```html
<div class="vjscontainer">
  <video id="vjs-3GGg7"
         data-apireq="%7B%22c%22%3A%221833%22%2C%22e%22%3A%2238b%22%2C%22t%22%3A...%7D"
         data-vid="3GGg7"
         data-tserver="pt2"
         class="video-js vjs-big-play-centered"
         poster="https://sta.anicdn.com/playerImg/8.jpg"
         controls
         preload="none">
  </video>
</div>
```

**Key observations:**

- **Video.js player**: Loaded via `//sta.anicdn.com/videojs.bundle.js` (deferred). This creates a full Video.js instance around the `<video>` element.
- **Lazy video loading**: `preload="none"` — video data isn't fetched until user clicks play. The actual video URL is resolved at play-time via the `data-apireq` attribute (encoded JSON with category, episode, timestamp, and a signature hash), fetched from `v.anime1.me`.
- **One video per episode page**: Each episode page (e.g., `anime1.me/28433`) has exactly ONE `<video>` element inside `div.vjscontainer`.
- **MULTIPLE videos on listing pages**: Category/listing pages (e.g., `anime1.me/category/...`) embed one `<video>` per episode — **10 videos on a single page** for a show with 10 listed episodes. Each has a unique `data-vid` attribute.
- **Full page reload navigation**: Clicking between episodes triggers a full page load (not SPA), so no `popstate` handling needed.
- **jQuery 3.6.1** is loaded.
- **Google Cast framework** is loaded (`cast_sender.js`).
- **Dark mode support** via CSS injection.

### Video.js Player Hookup Strategy

Since anime1.me uses Video.js, we have **two options** for hooking into the player:

**Option A: Video.js API (preferred)**
```typescript
// Wait for Video.js to initialize the player
function waitForVideoJs(): Promise<any> {
  return new Promise((resolve) => {
    const check = () => {
      const video = document.querySelector('video.video-js');
      if (video && (window as any).videojs) {
        const player = (window as any).videojs(video.id);
        if (player && player.ready) {
          player.ready(() => resolve(player));
          return;
        }
      }
      setTimeout(check, 200);
    };
    check();
  });
}

// Using Video.js API:
// player.play(), player.pause(), player.currentTime(seconds)
// player.on('play', handler), player.on('pause', handler), etc.
```

**Option B: Raw HTMLVideoElement (fallback)**
```typescript
// If Video.js API isn't accessible from content script's isolated world,
// fall back to the underlying <video> element directly:
const video = document.querySelector('div.vjscontainer video') as HTMLVideoElement;
```

**Important**: Content scripts run in an isolated world, so `window.videojs` may not be directly accessible. The recommended approach is:

1. **Try the raw `<video>` element first** — Video.js wraps the native element, so `video.play()`, `video.pause()`, `video.currentTime` all work on the underlying `<video>`.
2. The `<video>` element fires standard events (`play`, `pause`, `seeked`, `ratechange`) regardless of whether Video.js is wrapping it.
3. Select via `document.querySelector('div.vjscontainer video')` for specificity.

### Detection Heuristic (Updated)

```typescript
function findAllAnime1Videos(): HTMLVideoElement[] {
  // Find all Video.js players in vjscontainers
  const videos = Array.from(
    document.querySelectorAll('div.vjscontainer video.video-js')
  ) as HTMLVideoElement[];

  if (videos.length > 0) return videos;

  // Fallback: any video element with video-js class
  return Array.from(
    document.querySelectorAll('video.video-js')
  ) as HTMLVideoElement[];
}

function findVideoByVid(videoId: string): HTMLVideoElement | null {
  return document.querySelector(
    `video.video-js[data-vid="${videoId}"]`
  ) as HTMLVideoElement | null;
}
```

### Reference: Existing anime1.me Extensions

- **[enhanced-anime1](https://github.com/iyume/enhanced-anime1)**: Chrome/Firefox extension adding watch progress tracking. Confirms the Video.js player structure.
- **[anime1.me-dl](https://github.com/SodaWithoutSparkles/anime1.me-dl)**: Python downloader that parses the `data-apireq` attribute to extract video URLs.

---

## 9. Deployment & Dev Setup

### Local Development

```bash
# Terminal 1: Start sync server
cd server && npm run dev          # nodemon + ts-node, port 8080

# Terminal 2: Build extension (watch mode)
cd extension && npm run watch     # esbuild watch → dist/

# Browser: Load unpacked extension from extension/dist/
```

### Server Deployment (MVP)

Deploy the sync server on Henry's homelab behind a **Cloudflare Tunnel**:

```bash
# On homelab: run the sync server in Docker or directly
cd server && node dist/index.js    # listens on port 8080

# Cloudflare Tunnel config (cloudflared):
# Map a subdomain like wss://watchtogether.yourdomain.com → localhost:8080
# Ensure WebSocket support is enabled (Cloudflare Tunnels support WS natively)
```

**Cloudflare Tunnel notes:**
- WebSocket connections are supported natively through Cloudflare Tunnels
- The extension connects to `wss://watchtogether.yourdomain.com` (TLS via Cloudflare)
- No port forwarding or firewall rules needed on the homelab
- Cloudflare's free tier is sufficient for this use case
- Set the tunnel's `originRequest.noTLSVerify: true` if the local server runs plain `ws://`

### Build & Bundle

- **Server**: `tsc` → plain Node.js
- **Extension**: `esbuild` for fast bundling of content script, background SW, and popup
- **Shared types**: Symlinked or copy-on-build (avoid npm package overhead for MVP)

---

## 10. Security Considerations

- **Room codes**: 6-char alphanumeric = 2.1B combinations; sufficient for ephemeral rooms
- **No auth for MVP**: rooms are security-by-obscurity (acceptable for 2-person friend sessions)
- **Rate limiting**: Max 10 messages/second per connection; max 5 room creates per minute per IP
- **Message size**: Reject messages > 10KB
- **Origin validation**: Server can optionally check `Origin` header but not required for MVP
- **No content proxying**: Extension works with existing page content; server never sees video data

---

## 11. Future Considerations (Post-MVP)

- **YouTube support**: YouTube's heavily customized player needs special handling (no standard `<video>` access); investigate YouTube IFrame API
- **More users**: Upgrade room capacity, add "host" role for who controls
- **Chat**: Simple text chat over same WebSocket
- **More sites**: Generic video detection for any site with `<video>`
- **Persistent rooms**: Named rooms with optional passwords
- **Mobile**: Companion website that proxies video (complex, DRM issues)
- **Latency compensation**: NTP-like sync for sub-100ms accuracy
- **Docker Compose**: Package the server as a container for easier homelab deployment
