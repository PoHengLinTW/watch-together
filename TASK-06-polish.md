# TASK-06: Polish & Deployment

## Objective

Final polish: popup UI styling, extension icons, error UX, and deployment configuration.

## Subtasks

### Popup UI (`extension/src/popup/`)

- `popup.html` — layout for 3 states (disconnected, connected, in-room)
- `popup.css` — clean styling, dark mode support
- `popup.ts` — wire PopupStateMachine to DOM, handle user interactions
- States:
  1. **Disconnected**: server URL input + Connect button
  2. **Connected**: "Create Room" button + "Join Room" input (6-char code)
  3. **In Room**: room code display (copyable), peer count, "Leave Room" button
- Error messages: user-friendly toasts/banners for connection failures, room full, etc.

### Extension Icons

- `extension/icons/icon16.png`
- `extension/icons/icon48.png`
- `extension/icons/icon128.png`
- Simple, recognizable icon (two play buttons / sync symbol)

### Extension Build

- `extension/esbuild.config.ts` or npm scripts:
  - `npm run build` — one-shot build to `dist/`
  - `npm run watch` — watch mode for development
  - Content script: `format: 'iife'`
  - Background SW: `format: 'esm'`
  - Copy `manifest.json`, `popup.html`, `popup.css`, icons to `dist/`

### Server Deployment

- `server/Dockerfile` (optional) — for Docker deployment on homelab
- Document Cloudflare Tunnel setup in README or deployment notes
- Configurable server URL in extension (stored in `chrome.storage.local`)

### Error Handling Polish

- Video autoplay rejection: show overlay asking user to click to start
- Connection lost: show reconnecting state in popup
- Room expired: clear room state, return to Connected state

## Definition of Done

- [ ] Popup UI looks clean and works in all 3 states
- [ ] Icons are present and display correctly
- [ ] Extension builds cleanly with esbuild
- [ ] Server can be started with `npm run dev` and `node dist/index.js`
- [ ] Autoplay rejection handled gracefully
- [ ] All tests still pass
- [ ] Manual test: create room, join from second browser, sync play/pause/seek works on anime1.me
