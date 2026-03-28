---
title: 'refactor: Harden sync loop timeouts and relax intervals'
type: refactor
status: completed
date: 2026-03-17
origin: docs/brainstorms/2026-03-17-sync-architecture-validation-brainstorm.md
---

# refactor: Harden sync loop timeouts and relax intervals

## Overview

After comparing Zinqq's sync architecture against LDK Node's reference implementation (see brainstorm), we validated that our architecture is fundamentally correct. This plan addresses the three hardening improvements identified: adding overall sync timeouts, adding a timeout to the RGS fetch, and relaxing unnecessarily aggressive intervals.

## Problem Statement / Motivation

1. **No overall sync timeout**: Individual Esplora fetches have 10s timeouts, but `syncOnce()` makes many sequential+parallel calls. A wallet watching 15+ txids/outputs could have `syncOnce` run for minutes. LDK Node wraps lightning sync in 30s and onchain in 90s.
2. **RGS fetch has no timeout**: `rapid-gossip-sync.ts` line 69 uses bare `fetch()`. A hung RGS server blocks indefinitely.
3. **BDK `esploraClient.sync()` has no timeout**: The WASM sync call has no upper bound.
4. **Onchain syncs too frequently**: 30s vs LDK Node's 80s. Onchain balance is not time-sensitive — unnecessary Esplora load.
5. **RGS syncs too frequently**: ~10min vs LDK Node's 60min. Signet graph doesn't change fast enough.

## Proposed Solution

Five discrete, independently testable changes:

### 1. Add overall timeout to `syncOnce()` — `src/ldk/sync/chain-sync.ts`

Add `SYNC_TIMEOUT_MS = 60_000` constant. In `startSyncLoop`'s `tick()`, wrap the `syncOnce()` call in `Promise.race` with `AbortSignal.timeout(SYNC_TIMEOUT_MS)`:

```typescript
const SYNC_TIMEOUT_MS = 60_000

// In tick():
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS)
try {
  await syncOnce({ ...config, signal: controller.signal })
} finally {
  clearTimeout(timeout)
}
```

Thread the `AbortSignal` through `syncOnce` → individual Esplora calls so in-flight fetches are cancelled on timeout. This prevents background mutations after timeout and avoids resource leaks.

**Partial sync state**: A timeout between steps is safe — LDK handles partial `Confirm` state. The next tick retries. `lastTipHash` should be reset on timeout to force a full retry rather than skipping a changed-tip check.

**Timeout counts as an error** for backoff/stale detection (existing `consecutiveErrors` logic applies).

Add `signal?: AbortSignal` to `SyncLoopConfig` interface and pass it through to `EsploraClient` methods.

### 2. Add timeout to RGS fetch — `src/ldk/sync/rapid-gossip-sync.ts`

Add `AbortSignal.timeout(30_000)` to the `fetch()` call on line 69. 30 seconds allows large initial snapshots on moderate connections while preventing indefinite hangs.

```typescript
const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
```

The 50 MB size guard remains unchanged. RGS errors are already caught and logged without affecting chain sync backoff.

### 3. Add timeout to BDK sync — `src/onchain/sync.ts`

BDK's WASM `esploraClient.sync()` does not accept an AbortSignal. Use `Promise.race` with a 90-second timeout (matching LDK Node's onchain timeout):

```typescript
const BDK_SYNC_TIMEOUT_MS = 90_000

const syncWithTimeout = Promise.race([
  esploraClient.sync(syncRequest, parallelRequests),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('BDK sync timeout')), BDK_SYNC_TIMEOUT_MS)
  ),
])
```

The `isSyncing` guard already prevents overlapping ticks, so if the WASM sync continues after timeout, the next tick won't start a concurrent sync. The stale WASM sync will complete harmlessly — `apply_update` is only called on the awaited result, which on timeout is the rejected promise, so the update is never applied.

### 4. Relax onchain sync interval — `src/onchain/config.ts`

Change `syncIntervalMs` from `30_000` to `80_000`.

`syncNow()` (triggered by channel close) is unaffected — it fires immediately with 3 retries at 3s. The 80s fallback after all retries fail is acceptable since force-close funds require many block confirmations anyway.

### 5. Relax RGS interval — `src/ldk/config.ts`

Change `rgsSyncIntervalTicks` from `20` to `60`. At 30s chain poll interval, this is ~30 minutes. Update the inline comment.

## Technical Considerations

- **AbortController propagation (item 1)**: `syncOnce` must accept and forward the signal to all Esplora calls. The existing `EsploraClient` already uses `AbortSignal.timeout(10_000)` per-request — the overall signal should be composed: abort if _either_ the per-request timeout OR the overall timeout fires. Use `AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])` in `EsploraClient` methods.
- **BDK WASM cancellation (item 3)**: Not supported. `Promise.race` is the only option. Safe because `isSyncing` prevents overlap and `apply_update` is only called on the resolved path.
- **`timer_tick_occurred` coupling**: Currently called only on successful sync. A pre-existing limitation that timeouts make more visible. Out of scope — document as known issue for a future decoupling task.

## System-Wide Impact

- **Interaction graph**: Timeout in `syncOnce` → error path → `consecutiveErrors++` → possible `'stale'` status → UI status indicator. No new callbacks introduced.
- **Error propagation**: Timeout errors flow through the existing `try/catch` in `tick()`. Backoff and stale detection apply identically.
- **State lifecycle risks**: Partial sync after timeout is safe — LDK's `Confirm` protocol is idempotent. BDK's `apply_update` is never called on timeout. No orphaned state.
- **API surface parity**: Only internal sync loops affected. No user-facing API changes.

## Acceptance Criteria

- [x] `syncOnce()` aborts all in-flight requests and resolves within 60s even when Esplora is slow
- [x] RGS `fetch()` has 30s `AbortSignal.timeout`
- [x] BDK `esploraClient.sync()` is wrapped in 90s `Promise.race` timeout
- [x] `ONCHAIN_CONFIG.syncIntervalMs` is `80_000`
- [x] `SIGNET_CONFIG.rgsSyncIntervalTicks` is `60`
- [x] All timeout constants are named exports in their respective config files
- [x] Existing `syncOnce` tests pass (no regressions)
- [x] New test: `syncOnce` with slow mock aborts within timeout
- [x] New test: RGS fetch with slow mock aborts within timeout

## Implementation Order

1. **Config changes first** (items 4 & 5) — pure constant changes, zero risk
2. **RGS timeout** (item 2) — one-line change, isolated
3. **BDK sync timeout** (item 3) — small `Promise.race` wrapper
4. **`syncOnce` timeout with AbortController threading** (item 1) — largest change, touches `SyncLoopConfig`, `syncOnce`, and `EsploraClient`

## Deferred Items

- **BDK sync backoff**: No exponential backoff on BDK sync failure (existing gap). Separate task.
- **BDK sync status reporting**: No `onStatusChange` equivalent for onchain. Separate task.
- **`timer_tick_occurred` decoupling**: Should fire on a fixed cadence, not gated by sync success. Separate task.
- **`syncNow()` concurrency with long timeouts**: The `isSyncing` guard can suppress `syncNow()` during a long BDK sync. Tracked in `todos/122`.
- **OutputSweeper adoption**: Revisit for mainnet (see brainstorm: `docs/brainstorms/2026-03-17-sync-architecture-validation-brainstorm.md`).

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-17-sync-architecture-validation-brainstorm.md](docs/brainstorms/2026-03-17-sync-architecture-validation-brainstorm.md) — Key decisions: architecture validated as correct, three hardening improvements prioritized, OutputSweeper deferred
- **LDK Node reference:** `lightningdevkit/ldk-node` — timeouts: 90s onchain, 30s lightning, 5s RGS; intervals: 80s onchain, 30s lightning, 60min RGS
- **Institutional learnings:** `docs/solutions/integration-issues/ldk-trait-defensive-hardening-patterns.md` — counter placement after operations, persistence atomic flag handling
- Key files:
  - `src/ldk/sync/chain-sync.ts` — LDK sync loop + `syncOnce`
  - `src/ldk/sync/esplora-client.ts:4` — `FETCH_TIMEOUT_MS = 10_000`
  - `src/ldk/sync/rapid-gossip-sync.ts:69` — bare `fetch()` without timeout
  - `src/ldk/config.ts:6-12` — `SIGNET_CONFIG` intervals
  - `src/onchain/sync.ts:18-116` — BDK sync loop
  - `src/onchain/config.ts:5` — `syncIntervalMs: 30_000`
