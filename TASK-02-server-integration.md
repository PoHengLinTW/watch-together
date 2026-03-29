# TASK-02: Server Integration Tests + Entry Point

## Objective

Write server integration tests that spin up a real WebSocket server, then wire up `server/src/index.ts` as the entry point until all tests pass.

## Test File

`server/__tests__/integration/serverIntegration.test.ts`

Uses real `ws` library clients connecting to a real server on a random port.

### Tests to Write

```
describe('Server Integration')
  describe('full room lifecycle')
    - client A creates room -> gets code -> client B joins with code -> both receive peer-joined
    - client A sends play -> client B receives play event (not A)
    - client B leaves -> client A gets peer-left -> room still exists
    - client A leaves -> room is destroyed

  describe('late joiner sync')
    - A creates room, sends play at t=10s -> B joins -> B receives state with currentTime=10

  describe('error handling')
    - joining non-existent room returns error with code ROOM_NOT_FOUND
    - joining full room returns error with code ROOM_FULL
    - sending sync event without room returns error with code NOT_IN_ROOM
    - malformed JSON returns error with code INVALID_MESSAGE

  describe('connection resilience')
    - server sends ping every 30s; client must pong within 10s or gets disconnected
    - abrupt client disconnect triggers peer-left for remaining peer
```

## Implementation

### `server/src/index.ts`

Wire up:
1. Create `ws.WebSocketServer` on configurable port (default 8080, env `PORT`)
2. On `connection`: create peerId, instantiate MessageHandler
3. On `message`: route through MessageHandler
4. On `close`: call RoomManager.leaveRoom, clean up
5. Heartbeat: 30s ping interval, 10s pong timeout

### `test/helpers/serverHelper.ts`

```typescript
async function startTestServer(port?: number): Promise<{ port: number; close: () => void }>
```

- Starts server on random available port (port 0)
- Returns port number and cleanup function
- Used by integration tests

## Key Considerations

- Use `vi.useFakeTimers()` for heartbeat/ping tests
- Client connections in tests: use `ws` library, not browser WebSocket
- Each test should start/stop its own server instance for isolation
- Allow ±1s tolerance for time-based assertions

## Definition of Done

- [ ] Integration test file written and failing (RED)
- [ ] `server/src/index.ts` wired up
- [ ] `startTestServer` helper works
- [ ] All integration tests pass
- [ ] All unit tests still pass
- [ ] `cd server && npx vitest run` — all pass, exit 0
- [ ] `tsc --noEmit` — no errors
