# TASK-04: Extension Integration Tests

## Objective

Write integration tests that verify the content script, background service worker, and sync server work together end-to-end through Chrome messaging.

## Test File

`extension/__tests__/integration/extensionIntegration.test.ts`

Uses a mock WebSocket server + jsdom for video elements.

### Tests to Write

```
describe('Extension Integration')
  describe('content script <-> background')
    - content script video play -> background sends sync event with videoId to server
    - background receives sync event from server -> content script applies to correct video by videoId

  describe('full sync flow (mocked server)')
    - two tabs: tab A plays video -> tab B video starts playing (same videoId)
    - two tabs: tab A seeks to 30s -> tab B video jumps to 30s (same videoId)
    - two tabs: tab A pauses -> tab B video pauses (same videoId)

  describe('multi-video page sync')
    - page has 3 videos: user plays video #2 -> only video #2 events are sent
    - remote play event with videoId targets the correct video among multiple
    - remote event with unknown videoId is silently ignored
    - user switches from video #1 to video #3 -> activeVideo updates, sync follows
```

## Implementation

### Wiring to build

- `extension/src/content/index.ts` — content script entry: instantiate VideoController, listen for chrome.runtime messages, forward sync events
- `extension/src/background/index.ts` — service worker entry: instantiate ConnectionManager, bridge messages between content script and WebSocket
- `extension/src/shared/messages.ts` — Chrome message type helpers for content <-> background communication

### Message Flow

```
Content Script                    Background SW                    Server
     |                                |                              |
     |-- chrome.runtime.sendMessage ->|                              |
     |   { type: 'sync-event', ... }  |-- ws.send(JSON) ----------->|
     |                                |                              |
     |                                |<-- ws.onmessage(JSON) ------|
     |<- chrome.tabs.sendMessage -----|                              |
     |   { type: 'sync-event', ... }  |                              |
```

## Key Considerations

- Mock `chrome.runtime` and `chrome.tabs` APIs
- Use real or mock WebSocket server depending on test
- Test multi-video scenarios with multiple `MockVideoElement` instances
- Verify anti-echo: remote event applied locally doesn't bounce back

## Definition of Done

- [ ] Integration test file written and failing (RED)
- [ ] Content script entry point (`content/index.ts`) wired up
- [ ] Background service worker entry point (`background/index.ts`) wired up
- [ ] Message helpers (`shared/messages.ts`) implemented
- [ ] All integration tests pass
- [ ] All unit tests still pass
- [ ] `cd extension && npx vitest run` — all pass, exit 0
- [ ] `tsc --noEmit` — no errors
