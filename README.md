# Watch Together

A browser extension and server to watch videos synchronously with friends.

This project is organized as an npm workspace monorepo containing a WebSocket server, a browser extension, and a shared module.

## Requirements

- **Node.js**: Recommended v18+ (or whatever you use for ES Modules / Vite / esbuild).
- **npm**: Generally ships with Node.

## Setup

First, install all dependencies for the entire workspace from the root directory:

```bash
npm install
```

This will link local workspaces (`extension`, `server`, `shared`) together.

## Running Locally

To run the application, you need to start the WebSocket server and build the browser extension.

### 1. Start the WebSocket Server

The server coordinates the video playback state among all connected clients.

```bash
# From the root directory
cd server
npm run dev
```

The server will start up locally.

### 2. Build the Extension

The extension must be built so it can be unpacked and loaded into Google Chrome. It has a `watch` script using `esbuild` that will re-compile automatically when you make changes.

```bash
# In a new terminal, from the root directory
cd extension
npm run watch
```

_(Leave this running to automatically rebuild the extension on changes)_

### 3. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable the **"Developer mode"** toggle in the top right corner.
3. Click the **"Load unpacked"** button in the top left.
4. Select the output directory (typically `extension/dist` or just the `extension` folder if it compiles in place) in this project.
5. The extension should now be loaded into your browser and ready to connect to the local server.

## Usage

Once the server is running and the extension is loaded into Chrome, you can start watching videos with friends:

1. **Host a Room**:
   - Navigate to a webpage with an HTML5 video player (e.g., a standard web video).
   - Click the "Watch Together" extension icon in your Chrome toolbar.
   - Click **Create Room** (or similar button) to generate a new room code.
   - Share the generated room code with your friends.

2. **Join a Room**:
   - Open a webpage with the _same_ video that the host is watching.
   - Click the "Watch Together" extension icon in the toolbar.
   - Enter the room code shared by the host and click **Join Room**.

3. **Watch Synchronously**:
   - As long as you remain in the room, whenever anyone plays, pauses, or seeks the video, it will automatically synchronize for all other viewers in the room!

## Project Structure

```
watchtogether/
├── server/
│   └── src/
│       ├── index.ts             # Entry point
│       ├── RoomManager.ts       # Room CRUD
│       ├── MessageHandler.ts    # WS message routing
│       ├── VideoState.ts        # Video state tracking
│       ├── Logger.ts            # Console logger
│       ├── types.ts             # Server-specific types
│       └── utils.ts             # Room code generation
├── extension/
│   ├── manifest.json
│   ├── build.mjs                # esbuild config
│   └── src/
│       ├── content/
│       │   ├── index.ts
│       │   ├── VideoController.ts
│       │   ├── VideoDetector.ts
│       │   └── AutoplayOverlay.ts
│       ├── background/
│       │   ├── index.ts
│       │   └── ConnectionManager.ts
│       ├── popup/
│       │   ├── popup.html
│       │   ├── popup.css
│       │   ├── popup.ts
│       │   └── PopupStateMachine.ts
│       └── shared/
│           ├── messages.ts
│           └── debug.ts
├── shared/
│   └── protocol.ts              # Shared message types
└── test/
    ├── mocks/                   # mockChrome, mockVideo, mockWebSocket
    └── helpers/                 # serverHelper (spin up test server)
```

## Implementation Status

| Phase | Description | Status |
|---|---|---|
| Phase 1 | Server unit tests + implementation | ✓ Complete |
| Phase 2 | Server integration tests | ✓ Complete |
| Phase 3 | Extension unit tests + implementation | ✓ Complete |
| Phase 4 | Extension integration tests | ✓ Complete |
| Phase 5 | E2E tests (Puppeteer) | Pending |
| Phase 6 | Polish (icons, styling, README) | Pending |

212+ tests pass across server and extension workspaces.

## Scripts & Maintenance

The root `package.json` contains several helper scripts.

### Testing

Tests are written using `vitest` and cover both unit and integration specs. Run them across all packages:

```bash
npm test
```

To run end-to-end (e2e) tests using Puppeteer and Vitest:

```bash
npm run test:e2e
```

Or you can run `npm test` inside a specific workspace directory like `server` or `extension`.

### Typechecking

To verify TypeScript typings across the workspaces:

```bash
npm run typecheck
```
