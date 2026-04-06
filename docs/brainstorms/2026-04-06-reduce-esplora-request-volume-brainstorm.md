# Brainstorm: Reduce Esplora Request Volume

**Date:** 2026-04-06
**Status:** Complete

## Context

The mutinynet admin banned the app's IP for being 40% of mutinynet.com traffic. The app makes ~30-40 requests/minute per active user to `mutinynet.com/api` through two overlapping sync loops plus multiple uncached fee estimate fetches.

## What We're Building

Reduce esplora request volume by tuning sync intervals and fixing the fee estimator, targeting a ~60-70% reduction in requests.

## Why This Approach

- Simplest changes with highest impact — interval tuning alone halves the request rate
- The fee estimator has a concrete bug (concurrent fetches on cache miss) that compounds the problem
- No need for complex rate-limiting infrastructure; the sync loops just poll too aggressively for a signet app
- Approach B (skip-if-tip-unchanged) was considered but unnecessary — the early-return on unchanged tip already exists in chain-sync.ts:29, and the interval increase alone provides sufficient reduction

## Key Decisions

1. **Increase LDK chain sync interval from 30s → 60s** — Mutinynet blocks are ~30s, but checking every other block is acceptable. No user-visible impact for Lightning operations.

2. **Increase BDK onchain sync interval from 80s → 180s** — On-chain balance is informational; near-real-time updates aren't needed. The `syncNow()` method still triggers immediate sync after sends.

3. **Fix fee estimator concurrent fetch bug** — Add an in-flight dedup guard so only one `/fee-estimates` fetch runs at a time. Multiple concurrent callers share the same pending promise.

4. **Consolidate ad-hoc fee fetches into shared cache** — OpenChannel.tsx, sweep.ts, and onchain/context.tsx each fetch `/fee-estimates` independently. Consolidate them to use one shared cached fetcher (the fixed fee estimator or a shared module extracted from it).

## Request Budget (estimated after changes)

| Source | Before | After |
|---|---|---|
| LDK chain sync (base) | ~10-12/min | ~5-6/min |
| LDK chain sync (watched items) | ~6-12/min | ~3-6/min |
| BDK onchain sync | ~4-8/min | ~2-3/min |
| Fee estimator | ~1-5/min | ~1/min |
| Ad-hoc fee fetches | ~1-3/min | 0 (consolidated) |
| **Total** | **~22-40/min** | **~11-16/min** |

## Files to Change

| File | Change |
|---|---|
| `src/ldk/config.ts:27` | `chainPollIntervalMs: 30_000` → `60_000` |
| `src/onchain/config.ts:20` | `syncIntervalMs: 80_000` → `180_000` |
| `src/ldk/traits/fee-estimator.ts` | Add in-flight dedup guard to `refreshCache()` |
| `src/ldk/traits/fee-estimator.ts` | Export shared `getFeeEstimates()` for external consumers |
| `src/pages/OpenChannel.tsx:69` | Use shared fee cache instead of direct fetch |
| `src/ldk/sweep.ts:23-25` | Use shared fee cache instead of direct fetch |
| `src/onchain/context.tsx:42` | Use shared fee cache instead of BDK's separate fetch |

## Out of Scope

- Request rate limiting / throttling layer
- Response caching in esplora client (block headers, tx data)
- Request coalescing / deduplication for identical concurrent fetches
- Shared esplora client between LDK and BDK subsystems
- Adaptive polling based on activity
- Skip-if-tip-unchanged optimization (already partially exists, can add later if needed)
