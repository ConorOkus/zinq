---
title: VSS wallet restore — stop background persistence race
category: logic-errors
date: 2026-03-25
severity: critical
tags: [vss-recovery, race-condition, ldk-persistence, idb-state-management, wallet-restore]
affected_files:
  [src/pages/Restore.tsx, src/ldk/context.tsx, src/ldk/init.ts, src/ldk/ldk-context.ts]
error_message: 'Key that was generated does not match the existing key'
---

# VSS Wallet Restore — Stop Background Persistence Race

## Problem

VSS wallet restore failed with "Key that was generated does not match the existing key" error. After restoring a wallet from mnemonic, the LDK node crashed on startup because the ChannelManager in IDB didn't match the new seed.

## Root Cause

Race condition during the restore flow. The original sequence was:

1. User enters mnemonic on Restore page
2. Restore fetches ChannelManager + monitors from VSS
3. `clearAllStores()` wipes IDB
4. Restore writes new ChannelManager + monitors to IDB
5. `setTimeout(500ms)` before page reload

Between steps 3 and 5, the **running LDK node's background persist loop** (every 30s) and `visibilitychange` handler continued writing the OLD wallet's ChannelManager to IDB. This overwrote the freshly restored data. On reload, the new seed couldn't deserialize the old ChannelManager, causing the crash.

## Solution

### 1. Added `shutdown()` to LdkContext

Exposed a teardown function that stops all background persistence before clearing IDB:

```typescript
// src/ldk/context.tsx
const teardownRef = useRef<(() => void) | null>(null)

const shutdown = useCallback(() => {
  console.log('[LDK Context] Shutting down LDK node for restore')
  teardownRef.current?.()
}, [])
```

The teardown function stops the sync loop, clears timers, removes the `visibilitychange` listener, disconnects peers, and nulls `nodeRef`.

### 2. Call shutdown() before clearing IDB in Restore.tsx

```typescript
// src/pages/Restore.tsx
if (ldk.status === 'ready') {
  ldk.shutdown()
}
// Flush microtasks so in-flight async IDB writes settle
await new Promise((r) => setTimeout(r, 0))
await clearAllStores()
```

### 3. Defense-in-depth: discard stale ChannelManager on deserialization failure

If CM deserialization fails but no monitors exist, discard the stale CM and create fresh rather than crashing:

```typescript
// src/ldk/init.ts
if (result instanceof Result_C2Tuple_ThirtyTwoBytesChannelManagerZDecodeErrorZ_OK) {
  channelManager = result.res.get_b()
} else if (restoredMonitors.length === 0) {
  console.warn('[LDK Init] CM deserialization failed with no monitors — discarding stale CM')
  await idbDelete('ldk_channel_manager', 'primary')
} else {
  throw new Error('[LDK Init] Failed to deserialize ChannelManager')
}
```

### 4. Removed unnecessary 500ms setTimeout

No longer needed since background tasks are stopped before clearing.

### 5. Replaced ~40-line TODO block with manifest-based monitor recovery

Restore.tsx now fetches monitors via the `_monitor_keys` manifest and recovers `_known_peers` from VSS, matching the init.ts recovery path.

## Prevention & Best Practices

### Always stop background writers before clearing shared state

Any code that clears or replaces shared persistent state must first stop all background tasks that write to it. Checklist:

- Event listeners removed (especially `visibilitychange`)
- Async loops stopped (`syncHandle.stop()`)
- Timers cleared
- Guard flags set (e.g., `nodeRef.current = null`)
- External connections closed

### Microtask flush between shutdown and clear

`setTimeout(r, 0)` defers to the next macrotask, ensuring all in-flight Promise chains (e.g., pending `idbPut` calls) have started their transactions before `clearAllStores()` runs. `queueMicrotask` is insufficient here because it runs in the current microtask batch.

### Defense-in-depth for deserialization

When deserializing critical state, validate against current context. If a ChannelManager exists but no monitors are present, it's safe to discard — it's definitionally stale. If both exist but deserialization fails, that's genuine corruption and should throw.

### Version cache seeding after recovery

After recovering state from VSS, seed the internal version cache so subsequent writes don't trigger optimistic concurrency conflicts.

## Test Coverage

- **7 integration tests** (`src/ldk/init-recovery.test.ts`): full recovery, partial failure rollback, missing CM, missing manifest, corrupt CM, migration upload, migration skip
- **Playwright e2e tests** (`e2e/vss-recovery.spec.ts`): full create-wallet then restore flow

## Related Documentation

- [VSS Remote State Recovery Full Integration](../integration-issues/vss-remote-state-recovery-full-integration.md) — Phase 1 VSS architecture including the recovery flow design
- [VSS Dual-Write Persistence with Version Conflict Resolution](../design-patterns/vss-dual-write-persistence-with-version-conflict-resolution.md) — The dual-write pattern whose background persist loop caused this race
- [VSS Recovery Key Mismatch Brainstorm](../../brainstorms/2026-03-25-vss-recovery-keymismatch-brainstorm.md) — Root cause investigation exploring multiple theories
- [VSS Restore Stale CM Race Plan](../../plans/2026-03-25-001-fix-vss-restore-stale-cm-race-plan.md) — Implementation plan for this fix
