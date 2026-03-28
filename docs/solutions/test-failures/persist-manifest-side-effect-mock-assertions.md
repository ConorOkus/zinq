---
title: Fix persist.test.ts failures from manifest write side effect and validate VSS recovery data
category: test-failures
date: 2026-03-23
tags:
  - test-fixes
  - vss-integration
  - manifest-persistence
  - data-validation
  - mock-patterns
affected_files:
  - src/ldk/traits/persist.test.ts
  - src/ldk/init.ts
symptoms:
  - 6 failing tests in persist.test.ts with incorrect putObject call counts
  - Assertions failing due to unexpected manifest write calls (_monitor_keys)
  - versionCache iteration picking up manifest key instead of monitor key
  - mockResolvedValueOnce chains consumed by manifest writes before monitor writes
  - VSS recovery writing corrupt monitor data to IDB without validation
---

# Fix persist.test.ts failures from manifest write side effect and validate VSS recovery data

## Problem

### Test Failures (6 pre-existing)

When `persist_new_channel()` was updated to call `writeManifest()`, it introduced an additional fire-and-forget `putObject` call for the `_monitor_keys` manifest key. The existing 6 tests were written before this feature and broke because:

1. **Call count assertions off by 1** — tests expected N `putObject` calls but got N+1
2. **Call order assertions wrong** — `['vss', 'idb']` became `['vss', 'vss', 'idb']`
3. **versionCache key iteration** — `versionCache.keys()[0]` returned the manifest key instead of the monitor key
4. **mockResolvedValueOnce consumed wrong** — manifest write (which fires first as a microtask from `Promise.resolve().then()`) consumed mock values intended for the monitor write

### Corrupt VSS Recovery Data

During VSS recovery (`init.ts:183-210`), monitor and ChannelManager blobs downloaded from VSS were written directly to IDB without integrity validation. If VSS returned corrupt data, recovery would persist garbage to IDB. The existing "orphaned monitors" safety guard would then block startup, and since IDB is populated, recovery won't trigger again — the user is stuck.

## Root Cause

### Test Failures

`persist_new_channel` calls `writeManifest()` before `handlePersist()`. Since `manifestWriteChain` starts as `Promise.resolve()`, the `.then()` callback fires as a microtask before the `handlePersist` async function reaches its first `await`. This means the manifest `putObject` executes before the monitor `putObject`, consuming `mockResolvedValueOnce` entries out of order.

### Recovery Validation

The recovery path trusted VSS data completely — `getObject` returns encrypted blobs that are decrypted by the client, but decryption success does not guarantee valid LDK serialization. No deserialization check was performed before writing to IDB.

## Solution

### Fix 1: Key-Aware Mock Filtering for Tests

Filter `putObject` mock calls by key to isolate monitor writes from manifest writes:

```typescript
// Filter to monitor-only putObject calls (exclude _monitor_keys manifest)
const monitorCalls = vi.mocked(vssClient.putObject).mock.calls.filter(([k]) => k === monitorKey)
expect(monitorCalls).toHaveLength(2)
expect(monitorCalls[1]![2]).toBe(5) // retried with corrected version
```

For call-order tests, skip manifest writes in the tracking:

```typescript
const putObjectFn = vi.fn().mockImplementation(async (key: string) => {
  if (key !== '_monitor_keys') callOrder.push('vss')
  return 1
})
```

For conflict tests where `mockResolvedValueOnce` ordering matters, use key-aware implementations:

```typescript
putObject: vi.fn().mockImplementation(async (key: string) => {
  if (key === '_monitor_keys') return 1 // manifest write succeeds
  monitorAttempt++
  if (monitorAttempt === 1) throw conflictError
  return 6 // retry succeeds
})
```

For versionCache assertions, look up the specific monitor key instead of relying on iteration order:

```typescript
const monitorKey = `${Array.from(outpoint.get_txid())
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('')}:0`
expect(versionCache.get(monitorKey)).toBe(6)
```

### Fix 2: Validate VSS Recovery Data Before IDB Write

Deserialize each monitor blob before persisting to IDB:

```typescript
const readResult = UtilMethods.constructor_C2Tuple_ThirtyTwoBytesChannelMonitorZ_read(
  obj.value,
  keysManager.as_EntropySource(),
  bdkSignerProvider
)
if (!(readResult instanceof Result_C2Tuple_ThirtyTwoBytesChannelMonitorZDecodeErrorZ_OK)) {
  throw new Error(`Monitor "${key}" from VSS failed deserialization — data is corrupt`)
}
await idbPut('ldk_channel_monitors', key, obj.value)
```

Add minimum size check for ChannelManager:

```typescript
if (cm.value.byteLength < 32) {
  throw new Error(
    `ChannelManager from VSS is too small (${cm.value.byteLength} bytes) — likely corrupt`
  )
}
```

Both throw into the existing catch block which rolls back all partial IDB writes and falls through to fresh state.

## Prevention Strategies

### When Adding Side Effects to Existing Functions

- **Filter mock assertions by key/parameter** — never assert on exact `toHaveBeenCalledTimes` when the function has fire-and-forget side effects. Filter calls to the specific operation under test.
- **Use key-aware mock implementations** instead of `mockResolvedValueOnce` chains when multiple callers share the same mock and ordering is unpredictable.
- **Look up specific keys** in Maps/caches instead of relying on iteration order (`keys()[0]`).

### When Writing Recovery/Restoration Code

- **Validate all external data before persistence** — deserialization at storage boundaries catches corrupt data before it poisons IDB.
- **Track partial writes for rollback** — maintain a list of written keys so the catch block can clean up atomically.
- **Test the rollback path explicitly** — simulate failures at each step of recovery and verify cleanup.

## Related Documentation

- [VSS Dual-Write Persistence](../design-patterns/vss-dual-write-persistence-with-version-conflict-resolution.md) — Core persistence pattern with version conflict resolution
- [VSS Remote State Recovery](../integration-issues/vss-remote-state-recovery-full-integration.md) — Full Phase 1 recovery integration overview
- [IDB Persistence Patterns](../design-patterns/bdk-ldk-transaction-history-indexeddb-persistence.md) — IndexedDB persistence and test mock patterns
