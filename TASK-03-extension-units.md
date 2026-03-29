# TASK-03: Extension Unit Tests + Implementation

## Objective

Write all extension unit tests first (RED), then implement each module until all tests pass (GREEN).

## TDD Order

### 1. VideoController

**Test file**: `extension/__tests__/unit/videoController.test.ts`
**Implementation**: `extension/src/content/VideoController.ts` + `extension/src/content/VideoDetector.ts`

Uses `MockVideoElement` from `test/mocks/mockVideo.ts`.

Tests to write:

```
describe('VideoController')
  describe('detectVideo')
    - should find ALL <video> elements inside div.vjscontainer
    - should observe DOM for deferred Video.js initialization via MutationObserver
    - should attach event listeners to every detected video
    - should emit "videos-found" event with count when detected
    - should handle new videos added after initial scan (MutationObserver)

  describe('active video tracking')
    - should set activeVideo when a video fires play event
    - should switch activeVideo if user plays a different video
    - should only forward events from the activeVideo to background
    - should ignore events from non-active videos
    - should include video.dataset.vid as videoId in outgoing events

  describe('local event capture')
    - should emit sync event with videoId on active video play
    - should emit sync event with videoId on active video pause
    - should emit sync event with videoId on active video seeked
    - should emit sync event with videoId on active video ratechange
    - should include currentTime in every event
    - should include timestamp in every event
    - should debounce seek events (300ms)

  describe('anti-echo')
    - should suppress local events while applying remote event
    - should re-enable local events after remote apply completes
    - should not suppress events from genuine user interaction after remote apply
    - should only suppress events on the specific video being remotely controlled

  describe('applyRemoteEvent')
    - should find target video by data-vid matching event.videoId
    - should call video.play() on play event for matched video
    - should call video.pause() on pause event for matched video
    - should set video.currentTime on seek event for matched video
    - should set video.playbackRate on rate event for matched video
    - should seek to adjusted time for play event (compensate latency)
    - should ignore event if no video matches the videoId
    - should set matched video as activeVideo when applying remote play
```

Implementation notes:
- Content script runs in isolated world — use raw `<video>` element API
- Video selector: `div.vjscontainer video.video-js`
- Anti-echo: boolean `suppressEvents` flag + `requestAnimationFrame` to re-enable
- Seek debounce: 300ms, only final position sent
- MutationObserver for deferred Video.js init
- Multi-video: attach listeners to ALL, track active, include `data-vid` as videoId

### 2. ConnectionManager

**Test file**: `extension/__tests__/unit/connectionManager.test.ts`
**Implementation**: `extension/src/background/ConnectionManager.ts`

Uses `MockWebSocket` from `test/mocks/`.

Tests to write:

```
describe('ConnectionManager')
  describe('connect')
    - should establish WebSocket to given server URL
    - should transition state to CONNECTING then CONNECTED
    - should reject if already connected
    - should handle connection failure with error callback

  describe('reconnect')
    - should attempt reconnect with exponential backoff
    - should cap backoff at 30 seconds
    - should stop reconnecting after 5 failures
    - should rejoin room on successful reconnect

  describe('send')
    - should serialize and send message over WebSocket
    - should queue messages if connecting (not yet open)
    - should throw if disconnected

  describe('heartbeat')
    - should respond to server ping with pong
    - should detect missed pings and trigger reconnect
```

Implementation notes:
- State machine: `DISCONNECTED -> CONNECTING -> CONNECTED -> IN_ROOM`
- Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (cap), stop after 5 failures
- Store room state in `chrome.storage.session`
- Message queue for messages sent during CONNECTING state

### 3. PopupStateMachine

**Test file**: `extension/__tests__/unit/popupState.test.ts`
**Implementation**: `extension/src/popup/PopupStateMachine.ts`

Tests to write:

```
describe('PopupStateMachine')
  - should start in DISCONNECTED state
  - should transition to CONNECTED after successful connect
  - should transition to IN_ROOM after create or join
  - should transition back to CONNECTED on leave
  - should transition to DISCONNECTED on connection loss
  - should show room code in IN_ROOM state
  - should show peer count in IN_ROOM state
  - should disable join button while connecting
  - should validate room code format before sending join
```

Implementation notes:
- Pure state machine, no DOM (DOM rendering is separate in popup.ts)
- States: DISCONNECTED, CONNECTED, IN_ROOM
- Room code validation: 6-char alphanumeric, case-insensitive

## Definition of Done

- [ ] All 3 test files written and failing (RED confirmed)
- [ ] VideoController + VideoDetector implemented — tests pass
- [ ] ConnectionManager implemented — tests pass
- [ ] PopupStateMachine implemented — tests pass
- [ ] `cd extension && npx vitest run` — all pass, exit 0
- [ ] `tsc --noEmit` — no errors
- [ ] No `any` types
