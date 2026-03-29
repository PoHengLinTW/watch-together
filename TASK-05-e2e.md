# TASK-05: E2E Tests

## Objective

Write end-to-end tests using Puppeteer that load the real extension in two browser instances and verify video sync works.

## Test File

`__tests__/e2e/watchtogether.e2e.test.ts`

### Tests to Write

```
describe('E2E: WatchTogether')
  // Setup: build extension, start server, launch 2 browser instances
  // with extension loaded via --load-extension flag
  // Use local test page with <video> mimicking anime1.me structure

  - User A creates room -> popup shows room code
  - User B enters room code and joins -> both popups show "2 peers"
  - User A navigates to test page with video -> plays video -> User B video plays
  - User B pauses -> User A video pauses
  - User A seeks to 1:30 -> User B video is at ~1:30 (+/-1s tolerance)
  - User B closes tab -> User A popup shows "1 peer"
```

## Test Fixture

`__tests__/e2e/fixtures/test-video.html` — local HTML page mimicking anime1.me:

```html
<div class="vjscontainer">
  <video class="video-js" data-vid="test1" controls preload="auto">
    <source src="test.mp4" type="video/mp4">
  </video>
</div>
```

Need a small test video file (or use a data URI / canvas-generated video).

## Setup Requirements

- Build extension to `extension/dist/` before tests
- Start sync server on random port
- Launch 2 Puppeteer browser instances with `--load-extension=extension/dist/`
- Puppeteer needs `headless: 'new'` (Chrome extensions require non-headless or new headless)

## Key Considerations

- Extensions don't work in old headless mode — use `headless: 'new'` or `headless: false`
- Need to find extension popup URL via `chrome-extension://<id>/popup/popup.html`
- Use `page.waitForSelector` and `page.evaluate` for assertions
- Allow generous timeouts for WebSocket connection + video loading
- Seek tolerance: +/-1 second

## Definition of Done

- [ ] Test fixture HTML created
- [ ] E2E test file written
- [ ] Extension builds successfully (`cd extension && npm run build`)
- [ ] Server starts and E2E tests can connect
- [ ] All E2E tests pass
- [ ] All unit + integration tests still pass
- [ ] `npm run test:e2e` — exit 0
