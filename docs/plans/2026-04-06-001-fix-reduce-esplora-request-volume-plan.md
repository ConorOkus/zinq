---
title: "fix: Reduce esplora API request volume"
type: fix
status: completed
date: 2026-04-06
origin: docs/brainstorms/2026-04-06-reduce-esplora-request-volume-brainstorm.md
---

# fix: Reduce Esplora API Request Volume

## Overview

The app was banned from mutinynet.com for generating ~40% of their traffic (~30-40 requests/minute per active user). Two overlapping sync loops (LDK chain sync at 30s, BDK onchain sync at 80s) hit the same esplora endpoint independently, and four separate fee estimate fetchers make redundant `/fee-estimates` calls with no shared caching. The fee estimator also has a concurrent fetch bug where multiple LDK trait callbacks can fire parallel HTTP requests when the cache is stale.

## Problem Statement

1. **Sync intervals are too aggressive** — 30s chain sync and 80s onchain sync generate continuous traffic disproportionate to a signet/mutinynet environment (and even mainnet's ~10-minute blocks).
2. **Fee estimator concurrent fetch bug** — `refreshCache()` in `fee-estimator.ts` is fire-and-forget with no in-flight guard. Multiple concurrent `get_est_sat_per_1000_weight` calls each trigger a new HTTP request.
3. **Four independent fee estimate fetchers** — LDK fee estimator, OpenChannel.tsx, sweep.ts, and onchain/context.tsx each fetch `/fee-estimates` independently with no shared cache.

## Proposed Solution

Increase sync intervals, fix the fee estimator dedup bug, and consolidate all fee estimate consumers behind a single shared cache module (see brainstorm: `docs/brainstorms/2026-04-06-reduce-esplora-request-volume-brainstorm.md`).

## Technical Approach

### Step 1: Increase Sync Intervals

**Files:**
- `src/ldk/config.ts:26,41` — `chainPollIntervalMs: 30_000` → `60_000` (both signet and mainnet)
- `src/onchain/config.ts:20,29` — `syncIntervalMs: 80_000` → `180_000` (both signet and mainnet)

**Rationale for both networks:** Even on mainnet with ~10-minute blocks, polling every 30s is aggressive. 60s chain sync still detects new blocks within one interval. 180s onchain sync is acceptable because `syncNow()` provides immediate sync after user-initiated sends.

**Side effects to address:**
- **RGS cadence doubles** from ~30min to ~60min because `rgsSyncIntervalTicks: 60` is measured in chain-sync ticks. Fix: reduce `rgsSyncIntervalTicks` from `60` to `30` to maintain ~30-minute RGS sync cadence on both networks.
  - `src/ldk/config.ts:30` (signet) and `src/ldk/config.ts:45` (mainnet)
- **NetworkGraph/Scorer persistence cadence doubles** from ~5min to ~10min (every 10 ticks). This is acceptable — routing scores rebuild quickly and 10-minute persistence is fine. Update the comment at `src/ldk/sync/chain-sync.ts:236` to reflect "~10 min at 60s interval".

### Step 2: Fix Fee Estimator In-Flight Dedup

**File:** `src/ldk/traits/fee-estimator.ts`

Add a `pendingFetch: Promise<void> | null` variable to the closure scope. When `refreshCache()` is called:
1. If `pendingFetch` is not null, return early (fetch already in-flight).
2. Otherwise, set `pendingFetch` to the fetch promise.
3. In the `.finally()` handler, clear `pendingFetch` back to null.

This prevents duplicate parallel fetches while preserving the fire-and-forget behavior for the synchronous LDK trait callback. The second caller gets the stale/default cached value until the in-flight fetch resolves — this is the correct behavior since `get_est_sat_per_1000_weight` is a synchronous LDK trait callback that cannot await.

### Step 3: Extract Shared Fee Cache Module

**New file:** `src/shared/fee-cache.ts`

This module lives outside both `ldk/` and `onchain/` to avoid cross-layer dependencies (identified in SpecFlow analysis). Prior learning from `docs/solutions/integration-issues/bdk-wasm-onchain-send-patterns.md` also recommends extracting fee estimation into a reusable helper.

**Design:**
- Module-scoped singleton cache: `{ rates: Record<string, number>, fetchedAt: number }` where rates map block-target strings to **sat/vB** (raw esplora format).
- `CACHE_TTL_MS = 60_000` (matches current fee estimator TTL).
- In-flight dedup via stored `Promise` reference (same pattern as Step 2).
- Two read paths:
  - **`getCachedFeeRate(target: number): number | null`** — Synchronous. Returns cached sat/vB for the given block target, or null if no cache. Triggers background refresh if stale. Used by the LDK fee estimator trait (which converts to sat/KW internally).
  - **`getFeeRate(target: number): Promise<number>`** — Async. If cache is fresh, returns immediately. If stale, awaits the in-flight fetch (or triggers one). Falls back to network-aware defaults. Used by OpenChannel, sweep, and onchain send.
- **`refreshFeeCache(esploraUrl: string): void`** — Fire-and-forget trigger, called on init.
- Returns the full esplora map so consumers can pick their own block target.
- Network-aware defaults: `{ 1: 25, 6: 10, 12: 5, 144: 1 }` for mainnet, `{ 1: 1, 6: 1, 12: 1, 144: 1 }` for signet.

### Step 4: Rewire Fee Consumers

**`src/ldk/traits/fee-estimator.ts`:**
- Remove the internal cache and `refreshCache()` function.
- Import `getCachedFeeRate` from `src/shared/fee-cache.ts`.
- `getCachedFeeRate()` returns sat/vB; the trait converts to sat/KW (multiply by 250) and applies the minimum of 253 sat/KW.
- Remove the `createFeeEstimator` closure pattern — the shared module handles caching.

**`src/pages/OpenChannel.tsx:68-80`:**
- Replace standalone `fetch()` with `import { getFeeRate } from '@/shared/fee-cache'`.
- Call `const satPerVb = await getFeeRate(6)` in the useEffect.
- Remove inline fetch and error handling — `getFeeRate` handles defaults.

**`src/ldk/sweep.ts:23-46`:**
- Replace `fetchFeeRate()` with `import { getFeeRate } from '@/shared/fee-cache'`.
- Call `const satPerVb = await getFeeRate(FEE_TARGET_BLOCKS)` at line 116 instead of `fetchFeeRate(esploraUrl)`.
- Remove the standalone `fetchFeeRate` function.

**`src/onchain/context.tsx:40-51`:**
- Replace `esploraClient.get_fee_estimates()` with `import { getFeeRate } from '@/shared/fee-cache'`.
- Call `const satPerVb = await getFeeRate(FEE_TARGET_BLOCKS)`.
- This eliminates BDK's separate HTTP request for fee estimates. Note: BDK's `get_fee_estimates()` has no side effects beyond the HTTP call — it's a pure read from esplora, safe to replace.

## System-Wide Impact

- **Interaction graph**: Sync loops → esplora client → mutinynet.com/api. Fee cache → esplora `/fee-estimates`. No new callbacks or observers introduced — this simplifies the existing interaction graph by consolidating 4 fetch paths into 1.
- **Error propagation**: Fee cache failures fall back to network-aware defaults, same as current behavior. Sync loop errors continue to use existing backoff (LDK: exponential to 5min, BDK: fixed interval).
- **State lifecycle risks**: None — the fee cache is ephemeral (module scope). Worst case on failure is stale/default fee rates, same as today.
- **API surface parity**: The shared `getFeeRate()` replaces 4 different fetch patterns with one consistent interface.

## Acceptance Criteria

- [x] LDK chain sync polls at 60s intervals (both networks)
- [x] BDK onchain sync polls at 180s intervals (both networks)
- [x] RGS syncs every ~30 minutes (30 ticks × 60s) — `rgsSyncIntervalTicks` updated to 30
- [x] Fee estimator concurrent fetch bug is fixed (only one in-flight fetch at a time)
- [x] All four fee estimate consumers use the shared cache
- [x] No direct `/fee-estimates` fetches remain outside `src/shared/fee-cache.ts`
- [x] Network-aware default fee rates used on cache miss
- [x] Existing tests pass (fee-estimator tests, esplora-client tests)
- [x] Stale comment at chain-sync.ts:236 updated

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-04-06-reduce-esplora-request-volume-brainstorm.md](docs/brainstorms/2026-04-06-reduce-esplora-request-volume-brainstorm.md) — Key decisions: tune intervals (not rate-limit), fix fee dedup bug, consolidate fee fetchers
- **Prior learning:** [docs/solutions/integration-issues/bdk-wasm-onchain-send-patterns.md](docs/solutions/integration-issues/bdk-wasm-onchain-send-patterns.md) — Recommends extracting fee estimation into reusable helper
- **Prior learning:** [docs/solutions/integration-issues/ldk-event-handler-patterns.md](docs/solutions/integration-issues/ldk-event-handler-patterns.md) — Deduplication pattern for timer-driven operations
- Config: `src/ldk/config.ts:26,41` (chainPollIntervalMs), `src/onchain/config.ts:20,29` (syncIntervalMs)
- Fee estimator: `src/ldk/traits/fee-estimator.ts` (concurrent fetch bug)
- Chain sync: `src/ldk/sync/chain-sync.ts:236` (stale comment)
