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

## Scripts & Maintenance

The root `package.json` contains several helper scripts.

### Testing

Tests are written using `vitest` and cover both unit and integration specs. Run them across all packages:

```bash
npm test
```

Or you can run `npm test` inside a specific workspace directory like `server` or `extension`.

### Typechecking

To verify TypeScript typings across the workspaces:

```bash
npm run typecheck
```
