---
title: 'fix: VSS restore fails due to stale ChannelManager race condition'
type: fix
status: active
date: 2026-03-25
origin: docs/brainstorms/2026-03-25-vss-recovery-keymismatch-brainstorm.md
---

# fix: VSS restore fails due to stale ChannelManager race condition

## Overview

Cross-browser VSS restore fails with `"Key that was generated does not match
the existing key"` during ChannelManager deserialization. The root cause is a
race condition: the running LDK node's background persist loop overwrites the
restored ChannelManager in IDB after `clearAllStores()` but before the page
reload completes.

## Problem Statement

When a user restores a wallet via the Restore page:

1. Browser B already has LDK running with seed B (auto-created wallet)
2. `Restore.tsx` calls `clearAllStores()`, then writes seed A's data to IDB
3. The old LDK node's persist loop (still running with seed B) writes CM_B
   back to IDB — **overwriting the correct CM_A**
4. The `visibilitychange` handler fires on page navigation, calling
   `persistChannelManagerIdbOnly()` which writes CM_B to IDB
5. Page reloads → KeysManager uses seed A → tries to deserialize CM_B → 💥

The 500ms `setTimeout` before `window.location.href = '/'` creates a large
race window, but even without it, the `visibilitychange` handler fires at
the moment of navigation.

(see brainstorm: docs/brainstorms/2026-03-25-vss-recovery-keymismatch-brainstorm.md)

## Proposed Solution

### Part 1: Stop LDK persistence before clearing IDB

Add a `shutdown()` method to LdkContext that stops all background activity:

- Stops the chain sync loop
- Clears the peer/event timer interval
- Removes the `visibilitychange` listener
- Sets a flag that prevents any further `idbPut` calls to LDK stores

Restore.tsx calls `shutdown()` before `clearAllStores()`.

### Part 2: Eliminate the 500ms delay

Replace `setTimeout(() => window.location.href = '/', 500)` with an immediate
reload after IDB writes are confirmed complete.

### Part 3: Revert unnecessary fixes

The brainstorm research (from ldk-node reference implementation) confirmed:

- **KM timestamp persistence** was unnecessary — revert
- **`get_destination_script` KeysManager-only override** was unnecessary — revert
- **`nativeSignerProvider` debug swap** — revert back to `bdkSignerProvider`

### Part 4: Defense-in-depth node_id validation

In `init.ts`, before deserializing the CM from IDB, extract the node_id from
the serialized bytes and compare it to the current KeysManager's node_id. If
they don't match, discard the stale CM and create a fresh one (or re-fetch
from VSS).

## Technical Considerations

### Architecture

The Restore page runs **inside** the WalletGate → LdkProvider component tree.
This means LDK is fully initialized and running background tasks while the
user is on the Restore page. The restore flow needs to safely tear down the
running LDK node before replacing its data.

### The `visibilitychange` handler

At `src/ldk/context.tsx:670-678`, when the page navigates via
`window.location.href`, the browser fires `visibilitychange` with state
`"hidden"`. This triggers `persistChannelManagerIdbOnly(channelManager)`,
writing the OLD ChannelManager to IDB. This is the most likely immediate
cause of the overwrite.

### React StrictMode double-mount

In dev mode, StrictMode mounts LdkProvider twice. The dedup guards
(`initPromise`, `walletInitPromise`) protect against this, but care must be
taken that the shutdown method is idempotent and doesn't race with the
second mount's initialization.

### Web Lock

The `zinqq-lock` Web Lock prevents two tabs from running LDK simultaneously.
After shutdown, the lock should be released so the reloaded page can acquire
it. The lock is held via a never-resolving promise — a full page reload
naturally releases it.

## Acceptance Criteria

- [ ] Restoring a wallet in a different browser context produces no
      "Key that was generated does not match" errors
- [ ] The Playwright e2e test `vss-recovery.spec.ts` passes (both with
      and without channels)
- [ ] The `visibilitychange` handler does not fire after shutdown
- [ ] Background persist loops are stopped before IDB is cleared
- [ ] All 320 unit tests continue to pass
- [ ] KM timestamp persistence code is reverted
- [ ] `get_destination_script` returns BDK wallet addresses again
- [ ] `nativeSignerProvider` debug code is removed

## Implementation Steps

### Step 1: Add `shutdown` to LdkContext

**File:** `src/ldk/context.tsx`

- Add a `shutdown: () => void` method to the `LdkContextValue` type (ready state)
- In the LdkProvider effect, capture references to the sync handle, interval
  timer, and visibilitychange listener
- Implement `shutdown()` that:
  1. Calls `syncHandle.stop()`
  2. Clears the interval timer
  3. Removes the `visibilitychange` listener
  4. Sets `nodeRef.current = null` to prevent further persist calls
  5. Calls `closeDb()` to close the IDB connection (prevents further writes)

### Step 2: Update Restore.tsx to call shutdown before clearing IDB

**File:** `src/pages/Restore.tsx`

- Import `useLdk` hook
- Before `clearAllStores()`, call `ldk.shutdown()` (if ldk.status === 'ready')
- Remove the 500ms `setTimeout` — reload immediately after IDB writes complete
- Add error handling if shutdown fails

### Step 3: Revert unnecessary fixes

**Files:** `src/ldk/init.ts`, `src/ldk/storage/seed.ts`, `src/ldk/traits/bdk-signer-provider.ts`

- Remove `getKeysManagerTimestamp()` / `storeKeysManagerTimestamp()` from seed.ts
- Remove KM timestamp VSS recovery logic from init.ts (step 1.5)
- Remove KM timestamp VSS upload from init.ts
- Remove `KM_TIMESTAMP_VSS_KEY` constant
- Revert `get_destination_script` to use BDK wallet (original behavior)
- Remove `nativeSignerProvider` debug code, restore `bdkSignerProvider` usage
- Remove debug node ID log (or keep as non-debug log)
- Remove BdkSignerProvider `(v2)` startup log
- Update init-recovery.test.ts to remove timestamp-related mocks/assertions

### Step 4: Add node_id validation defense-in-depth

**File:** `src/ldk/init.ts`

- Before CM deserialization, extract the stored node_id from the serialized
  bytes (it's at a known offset in the LDK serialization format)
- Compare with the current KeysManager's node_id
- If mismatch: log a warning, discard the stale CM, fall through to fresh
  creation
- This protects against any future race conditions we haven't anticipated

### Step 5: Update e2e test

**File:** `e2e/vss-recovery.spec.ts`

- Add a test that creates a wallet with channels, restores in another context,
  and verifies no key mismatch errors (requires longer test with VSS write
  settling time)
- Verify the key error assertion catches real failures

## Dependencies & Risks

- **Risk:** The `shutdown()` method must be thorough — any missed background
  task could still overwrite IDB. Enumerate all persist paths.
- **Risk:** Closing the IDB connection via `closeDb()` might cause errors in
  other components that try to read/write IDB during the shutdown window.
  These errors should be caught and ignored.
- **Risk:** Reverting the KM timestamp and destination script fixes changes
  behavior for any users who tested during this branch. Since this is
  signet-only and pre-release, this is acceptable.

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-25-vss-recovery-keymismatch-brainstorm.md](docs/brainstorms/2026-03-25-vss-recovery-keymismatch-brainstorm.md)
  — Key decisions: KM timestamp unnecessary, destination script override unnecessary, error is node_id check

### Internal References

- Race condition analysis: `src/ldk/context.tsx:670-678` (visibilitychange handler)
- Persist loop: `src/ldk/sync/chain-sync.ts:216-224`
- Event timer persist: `src/ldk/context.tsx:498`
- Restore flow: `src/pages/Restore.tsx:43-145`
- IDB clear: `src/storage/idb.ts:134-145`
- VSS recovery docs: `docs/solutions/integration-issues/vss-remote-state-recovery-full-integration.md`
- Persist test patterns: `docs/solutions/test-failures/persist-manifest-side-effect-mock-assertions.md`

### External References

- ldk-node VSS integration: https://github.com/lightningdevkit/ldk-node (WalletKeysManager pattern)
- LDK key management: https://lightningdevkit.org/key_management/
