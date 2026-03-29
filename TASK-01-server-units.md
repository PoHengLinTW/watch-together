# TASK-01: Server Unit Tests + Implementation

## Objective

Write all server unit tests first (RED), then implement each module until all tests pass (GREEN), then refactor.

## TDD Order

### 1. RoomManager

**Test file**: `server/__tests__/unit/roomManager.test.ts`
**Implementation**: `server/src/RoomManager.ts` + `server/src/utils.ts`

Tests to write:

```
describe('RoomManager')
  describe('createRoom')
    - should generate a 6-character uppercase alphanumeric code
    - should not generate duplicate codes for concurrent creates
    - should store the room with an empty peers map
    - should set createdAt to current timestamp
    - should initialize videoState as null

  describe('joinRoom')
    - should add peer to existing room
    - should return current videoState for late joiner
    - should reject join if room is full (2 peers)
    - should reject join if room code does not exist
    - should reject join if peer is already in a room

  describe('leaveRoom')
    - should remove peer from room
    - should destroy room when last peer leaves
    - should notify remaining peer when other peer leaves
    - should be idempotent (leaving when not in room is no-op)

  describe('room expiry')
    - should mark room as expired after 1 hour of no messages
    - should clean up expired rooms on sweep interval
    - should not expire rooms with recent activity

  describe('room code generation')
    - should generate codes matching /^[A-Z0-9]{6}$/
    - should be case-insensitive on lookup (abc123 -> ABC123)
    - should retry if generated code collides with existing room
```

Implementation notes:
- `utils.ts`: `generateRoomCode()` — 6-char uppercase alphanumeric, collision-checked
- Room data model: `{ code, peers: Map<string, WebSocket>, createdAt, videoState }`
- Max 2 peers per room
- Room auto-destroys when last peer leaves
- Expiry: 1 hour inactivity, checked via sweep interval

### 2. VideoState

**Test file**: `server/__tests__/unit/videoState.test.ts`
**Implementation**: `server/src/VideoState.ts`

Tests to write:

```
describe('VideoState')
  describe('applyEvent')
    - should update currentTime and playing=true on play event
    - should update currentTime and playing=false on pause event
    - should update currentTime on seek event
    - should update playbackRate on rate event
    - should update url on url-change event
    - should update updatedAt timestamp on every event

  describe('getAdjustedTime')
    - should return currentTime if paused
    - should add elapsed time since updatedAt if playing
    - should account for playbackRate in elapsed calculation
```

Implementation notes:
- Pure functions / simple class, no I/O
- `getAdjustedTime`: `currentTime + (now - updatedAt) / 1000 * playbackRate` if playing

### 3. MessageHandler

**Test file**: `server/__tests__/unit/messageHandler.test.ts`
**Implementation**: `server/src/MessageHandler.ts`

Tests to write:

```
describe('MessageHandler')
  describe('parseMessage')
    - should parse valid JSON messages
    - should reject non-JSON messages with error
    - should reject messages missing "type" field
    - should reject unknown message types
    - should reject messages exceeding 10KB

  describe('handleSyncEvent')
    - should relay sync event to all other peers in room
    - should NOT echo sync event back to sender
    - should update room videoState on play/pause/seek
    - should reject sync event if sender is not in a room
    - should attach fromPeer to relayed event

  describe('handleCreateRoom')
    - should create room and send room-created response
    - should auto-join creator to the new room
    - should reject if peer is already in a room

  describe('handleJoinRoom')
    - should join room and send room-joined with state
    - should notify existing peer of new peer
    - should send error for invalid room code
    - should send error for full room
```

Implementation notes:
- Takes RoomManager as dependency (constructor injection)
- `parseMessage` validates JSON, type field, size
- Sync events: relay to other peers, update videoState
- Error responses use `ErrorCode` from protocol types

## Definition of Done

- [ ] All 3 test files written and failing (RED confirmed)
- [ ] RoomManager implemented — its tests pass
- [ ] VideoState implemented — its tests pass
- [ ] MessageHandler implemented — its tests pass
- [ ] `cd server && npx vitest run` — all pass, exit 0
- [ ] `tsc --noEmit` — no errors
- [ ] No `any` types
