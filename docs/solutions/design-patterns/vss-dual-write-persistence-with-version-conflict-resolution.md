---
title: 'VSS Dual-Write Persistence with Version Conflict Resolution'
category: design-patterns
date: 2026-03-18
severity: HIGH
tags: [vss, persistence, channel-monitor, dual-write, exponential-backoff, version-conflict, ldk]
modules: [src/ldk/traits/persist.ts, src/ldk/ldk-context.ts]
---

## Problem

Lightning channel monitor state was only persisted to IndexedDB (local). If a user clears browser data or loses their device, all channel state is permanently lost. The BIP39 mnemonic only recovers on-chain funds — open channels, in-flight payments, and channel balances are irrecoverable.

## Root Cause

Single-write architecture: the `Persist` trait implementation wrote only to IndexedDB, a browser-local storage mechanism with no remote durability. No backup mechanism existed for fund-critical LDK state.

## Solution

Dual-write architecture: VSS (Versioned Storage Service) first, then IndexedDB. The key design decisions:

### 1. VSS-First Write Ordering

Write to the durable remote store before the fast local store. If the browser crashes between the two writes, VSS has the data and LDK will re-persist from memory on restart (because `channel_monitor_updated` was never called).

### 2. Indefinite Exponential Backoff (Not Fixed Retries)

Replaced the previous 3-attempt linear backoff with indefinite exponential backoff capped at 60s. A 30-second network blip should not permanently halt a channel. The `channel_monitor_updated` callback is withheld until both writes succeed, so LDK naturally halts channel operations during the retry.

```typescript
// Key pattern: indefinite retry with degradation signaling
let backoff = 500
while (true) {
  try {
    if (vssClient) {
      const version = versionCache.get(key) ?? 0
      const newVersion = await vssClient.putObject(key, data, version)
      versionCache.set(key, newVersion)
    }
    await idbPut(store, key, data)
    return
  } catch (err) {
    // ... conflict resolution or exponential backoff
  }
}
```

### 3. Version Conflict Resolution with Capped Retries

VSS uses optimistic concurrency (version numbers). Conflicts are resolved by re-fetching the server's version and comparing data. **Critical learning: cap conflict retries** (5 attempts) to prevent tight infinite loops if the server is in a perpetual conflict state (e.g., racing writer or server bug). After the cap, fall through to exponential backoff.

Also handle `getObject` returning `null` during conflict resolution (key deleted between conflict and re-fetch) by resetting version to 0.

### 4. Degradation Signaling via Callbacks

The persist layer signals `onVssUnavailable` after 10s of cumulative failure and `onVssRecovered` when writes resume. The React context maps this to a `VssStatus` type (`'ok' | 'degraded'`) for UI banner display.

### 5. Archive is Fire-and-Forget

`archive_persisted_channel` deletes from VSS then IDB but does not retry on failure. Orphaned VSS keys waste storage but do not affect fund safety since the channel is already closed. This is a deliberate tradeoff — retry complexity is not justified for non-safety-critical cleanup.

## Key Patterns

- **Return `InProgress` from `Persist` trait, never `Completed`** — LDK assumes data is durable when `Completed` is returned. Always return `InProgress` for async writes and resolve via `channel_monitor_updated`.
- **Version cache re-read per retry iteration** — Read `versionCache.get(key)` inside the retry loop, not once at the start. This handles concurrent persist calls for the same channel correctly.
- **Closure over persister context** — `persistWithRetry` is nested inside `createPersister` and closes over `vssClient`, `versionCache`, and callbacks. This reduces the function from 7 parameters to 3.

## Prevention

- **Always cap retry loops that skip backoff.** Any `continue` without delay in a retry loop is a potential tight spin. Even "fast path" retries (like conflict resolution) need a cap.
- **Handle all branches in conflict resolution.** When re-fetching server state, the key may have been deleted — always handle the `null` case explicitly.
- **Test conflict resolution with fake timers.** The interaction between `vi.useFakeTimers()`, `advanceTimersByTimeAsync()`, and async conflict resolution requires careful test design — flush microtasks between backoff advances.

## Related

- `docs/solutions/integration-issues/ldk-wasm-foundation-layer-patterns.md` — `InProgress` return pattern
- `docs/solutions/design-patterns/bdk-ldk-transaction-history-indexeddb-persistence.md` — IDB write pairing
- `docs/solutions/integration-issues/ldk-trait-defensive-hardening-patterns.md` — Retry patterns for LDK trait callbacks
