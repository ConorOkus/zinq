---
title: 'feat: VSS Integration Tests & Nodana Endpoint'
type: feat
status: active
date: 2026-03-18
origin: docs/brainstorms/2026-03-18-vss-integration-brainstorm.md
---

# feat: VSS Integration Tests & Nodana Endpoint

## Overview

Add integration tests that validate the VssClient against a real VSS server, and switch the default VSS endpoint from `vss.mutinynet.com` to the user's Nodana-hosted instance at `https://vss-2um9.nodana.app:9003`. All existing unit tests use mocks — this is the first validation against a real server.

## Problem Statement / Motivation

Phase 1 VSS integration is complete with ~40 unit tests, but every test mocks `fetch`. The VssClient has never been validated against a real server — protobuf encoding, encryption round-trips, version semantics, and error codes are all assumptions. A real endpoint is now available for validation. (see brainstorm: `docs/brainstorms/2026-03-18-vss-integration-brainstorm.md`)

## Proposed Solution

### 1. Config Change — `src/ldk/config.ts`

Update the default `vssUrl` from `https://vss.mutinynet.com/vss` to the Nodana endpoint.

**⚠️ Pre-flight check required:** Before changing the default, verify the correct base URL path. The VssClient appends `/<endpoint>` to the base URL (e.g., `${baseUrl}/putObjects`). Determine whether the Nodana server expects:

- `https://vss-2um9.nodana.app:9003/putObjects` (no path prefix)
- `https://vss-2um9.nodana.app:9003/vss/putObjects` (with `/vss` prefix, like the old endpoint)

Run a quick connectivity test:

```bash
# Test without path prefix
curl -v -X POST https://vss-2um9.nodana.app:9003/getObject \
  -H 'Content-Type: application/octet-stream' \
  --data-binary '' 2>&1 | head -20

# Test with /vss prefix
curl -v -X POST https://vss-2um9.nodana.app:9003/vss/getObject \
  -H 'Content-Type: application/octet-stream' \
  --data-binary '' 2>&1 | head -20
```

Set the config to whichever path returns a protobuf response (even an error response) rather than a 404.

**File:** `src/ldk/config.ts:13-15`

```typescript
vssUrl:
  (import.meta.env.VITE_VSS_URL as string | undefined) ??
  'https://vss-2um9.nodana.app:9003',  // or with /vss suffix if needed
```

### 2. Update `.env.example`

Document the `VITE_VSS_URL` env var alongside the existing `VITE_WS_PROXY_URL`.

**File:** `.env.example`

```bash
# VSS (Versioned Storage Service) URL for remote channel state backup.
# Optional — defaults to https://vss-2um9.nodana.app:9003 if unset.
VITE_VSS_URL=https://vss-2um9.nodana.app:9003
```

### 3. Integration Test Suite — `src/ldk/storage/vss-client.integration.test.ts`

A new test file that hits the real VSS server. Key design decisions:

**Skip-if-offline:** `beforeAll` attempts a lightweight `getObject` for a nonexistent key. If it returns `null` (server reachable) or throws `VssError` with an HTTP status (server reachable but errored), tests proceed. If it throws a network error, `describe.skip` the entire suite.

**Test isolation:** Each test run generates a unique `storeId` via `crypto.randomUUID()` to avoid cross-run data collisions. The Nodana endpoint is treated as a shared server.

**Cleanup:** `afterAll` deletes all keys written during the test run to avoid unbounded data accumulation.

**Test URL:** Use a hardcoded constant for the integration test URL (the Nodana endpoint). Do not couple to `SIGNET_CONFIG.vssUrl` — the integration tests should work regardless of what the app config says.

#### Test Cases

```typescript
// src/ldk/storage/vss-client.integration.test.ts

describe('VssClient integration (real server)', () => {
  // Skip entire suite if server unreachable

  // Setup: random encryption key, random storeId, empty auth headers
  // Track all written keys for cleanup

  describe('basic CRUD', () => {
    it('putObject + getObject round-trip with encryption')
    // Put a value at version 0, get it back, verify decrypted content matches

    it('getObject returns null for nonexistent key')
    // Fresh key that was never written

    it('deleteObject removes the key')
    // Put, then delete with correct version, then get returns null

    it('putObjects writes multiple items transactionally')
    // Write 3 items in one call, verify each can be read back
  })

  describe('version tracking', () => {
    it('putObject returns incremented version')
    // Put at version 0, expect return 1. Put again at version 1, expect return 2.
    // Verify with getObject that server agrees on the version.

    it('putObject with stale version throws CONFLICT_EXCEPTION')
    // Put at version 0 (succeeds), put again at version 0 (conflicts)

    it('getObject returns correct version number')
    // After two puts, getObject should return version 2
  })

  describe('listKeyVersions', () => {
    it('lists stored keys (obfuscated)')
    // Put a known key, list all keys, verify the obfuscated form of that key
    // appears in results. Use obfuscateKey() to compute the expected key.

    it('reflects correct version numbers')
    // Put a key twice (version 0 then 1), listKeyVersions should show version 2
  })

  describe('encryption integrity', () => {
    it('data is encrypted at rest (raw server value differs from plaintext)')
    // This is implicitly validated by the round-trip test, but worth an explicit
    // assertion: the value stored on the server is not the plaintext.

    it("different encryption keys cannot read each other's data")
    // Write with key A, create a second client with key B and same storeId,
    // getObject with key B should throw a decryption error (not return wrong data)
  })
})
```

## Technical Considerations

### Authentication

The Nodana endpoint's auth requirements must be verified. The existing production code passes empty auth headers (`FixedHeaderProvider({})`). If auth is required:

- Integration tests need credentials (hardcode for now, or use env var)
- App code may need updating

**Assumption:** No auth required (matches current production usage).

### CORS

Integration tests run in Node.js (`vitest` + `jsdom`) where CORS is irrelevant. A browser CORS issue would not be caught by these tests. After switching the default URL, **manually test from the browser** (`localhost:5173`) to confirm the Nodana endpoint sends correct CORS headers.

### TLS Certificate

The Nodana endpoint uses HTTPS on port 9003. If the certificate is not publicly trusted, both Node.js `fetch` and browser `fetch` will reject connections. The curl pre-flight check in step 1 will reveal this.

### Existing User Data

Switching the default URL means data on `vss.mutinynet.com` becomes unreachable. This is acceptable — the project runs on signet/mutinynet with no real funds (see brainstorm). Any existing test wallets will start fresh on the new endpoint; version conflict resolution handles the version-0 restart gracefully.

### `deleteObject` Version Semantics

The VSS proto defines version `-1` as "skip version check" for deletes. However, `BigInt(-1)` encodes as a signed int64 which may behave unexpectedly. For integration tests, use the actual version from a preceding `putObject` call rather than `-1`. This sidesteps the issue and tests the more realistic code path.

## Acceptance Criteria

- [ ] Determine correct base URL path for Nodana endpoint (with or without `/vss` suffix)
- [ ] Update default `vssUrl` in `src/ldk/config.ts` to the Nodana endpoint
- [ ] Add `VITE_VSS_URL` to `.env.example`
- [ ] Create `src/ldk/storage/vss-client.integration.test.ts` with skip-if-offline behavior
- [ ] Integration tests use random `storeId` per run for isolation
- [ ] Integration tests clean up written keys in `afterAll`
- [ ] Test: put + get round-trip with encryption
- [ ] Test: get nonexistent key returns null
- [ ] Test: delete removes key
- [ ] Test: putObjects (multi-item transactional write)
- [ ] Test: version increments correctly across puts
- [ ] Test: stale version throws CONFLICT_EXCEPTION
- [ ] Test: listKeyVersions returns obfuscated keys with correct versions
- [ ] Test: different encryption keys cannot decrypt each other's data
- [ ] Manually verify CORS works from browser at `localhost:5173`
- [ ] All existing unit tests continue to pass

## Success Metrics

- Integration test suite passes against the Nodana endpoint
- Integration tests skip cleanly when the server is unreachable (no failures in CI)
- App successfully writes to and reads from the Nodana endpoint in the browser

## Dependencies & Risks

| Risk                                    | Likelihood | Impact | Mitigation                                                  |
| --------------------------------------- | ---------- | ------ | ----------------------------------------------------------- |
| Nodana endpoint requires auth           | Low        | High   | Pre-flight curl check reveals this immediately              |
| CORS not configured on Nodana           | Medium     | High   | Manual browser test; can request CORS headers from provider |
| TLS cert not trusted                    | Low        | High   | curl pre-flight check validates TLS                         |
| Protobuf wire incompatibility           | Low        | High   | Integration tests validate this empirically                 |
| Server downtime causes test flakiness   | Medium     | Low    | Skip-if-offline pattern handles this gracefully             |
| URL path mismatch (needs `/vss` prefix) | Medium     | Medium | curl pre-flight check with both paths                       |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-18-vss-integration-brainstorm.md](docs/brainstorms/2026-03-18-vss-integration-brainstorm.md) — Key decisions: TS client over WASM, dual-write architecture, block on failure, client-side encryption
- **Phase 1 plan:** [docs/plans/2026-03-18-001-feat-vss-remote-state-recovery-plan.md](docs/plans/2026-03-18-001-feat-vss-remote-state-recovery-plan.md)
- **Dual-write learnings:** [docs/solutions/design-patterns/vss-dual-write-persistence-with-version-conflict-resolution.md](docs/solutions/design-patterns/vss-dual-write-persistence-with-version-conflict-resolution.md)
- **Full integration learnings:** [docs/solutions/integration-issues/vss-remote-state-recovery-full-integration.md](docs/solutions/integration-issues/vss-remote-state-recovery-full-integration.md) — Key insight: "Test the full restart cycle — version cache emptiness after restart is a real operational scenario that unit tests with mocks won't catch"
- VssClient implementation: `src/ldk/storage/vss-client.ts`
- Existing mock tests: `src/ldk/storage/vss-client.test.ts`
- Config: `src/ldk/config.ts:13-15`
