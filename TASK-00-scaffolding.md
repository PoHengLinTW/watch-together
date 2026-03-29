# TASK-00: Project Scaffolding

## Objective

Set up the monorepo structure, build tooling, and shared types. No implementation code — just the skeleton.

## Files to Create

### Root

- `package.json` — npm workspaces pointing to `server/`, `extension/`, `shared/`
- `tsconfig.base.json` — shared TS config (`strict: true`, ESM)

### Shared

- `shared/protocol.ts` — all shared types: `ClientMessage`, `ServerMessage`, `SyncEvent`, `VideoState`, `ErrorCode` (copy from CLAUDE.md "Protocol Types" section)

### Server

- `server/package.json` — dependencies: `ws`, devDeps: `vitest`, `typescript`, `@types/ws`
- `server/tsconfig.json` — extends base, `outDir: dist`
- `server/vitest.config.ts`
- `server/src/types.ts` — server-specific types (Room interface, etc.)
- `server/src/` directory structure
- `server/__tests__/unit/` and `server/__tests__/integration/` directories

### Extension

- `extension/package.json` — devDeps: `esbuild`, `vitest`, `typescript`
- `extension/tsconfig.json` — extends base
- `extension/vitest.config.ts`
- `extension/manifest.json` — Manifest V3 (copy from DESIGN.md section 7)
- `extension/src/content/`, `extension/src/background/`, `extension/src/popup/`, `extension/src/shared/` directories
- `extension/__tests__/unit/` and `extension/__tests__/integration/` directories

### Test Utilities

- `test/mocks/mockVideo.ts` — `MockVideoElement` class (from DESIGN.md section 5.6)
- `test/mocks/mockChrome.ts` — fake `chrome.*` APIs (from CLAUDE.md)
- `test/helpers/serverHelper.ts` — `startTestServer()` helper

### E2E

- `__tests__/e2e/fixtures/test-video.html` — local HTML mimicking anime1.me structure (`div.vjscontainer > video.video-js[data-vid]`)

## Key Decisions

- Use `npm workspaces` (no Lerna/Turborepo)
- `strict: true` in all tsconfigs
- esbuild for extension bundling: `iife` for content script, `esm` for background service worker
- Vitest for both server and extension tests

## Definition of Done

- [ ] `npm install` succeeds from root
- [ ] `tsc --noEmit` passes in both server/ and extension/
- [ ] `npx vitest run` executes (0 tests, no errors) in both workspaces
- [ ] `shared/protocol.ts` exports all protocol types
- [ ] Directory structure matches DESIGN.md section 6
