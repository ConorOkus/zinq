# Brainstorm: VSS Recovery Key Mismatch Root Cause

**Date:** 2026-03-25
**Status:** In Progress

## What We're Investigating

Cross-browser VSS restore fails with `"Key that was generated does not match the existing key"` during `ChannelManager` deserialization — even with fresh wallets, no channels, identical node IDs, and verified code fixes active.

## Research Findings (from ldk-node reference implementation)

### 1. KeysManager timestamp does NOT need persistence

ldk-node uses `SystemTime::now()` on every startup. The timestamp only seeds
`generate_channel_keys_id` for _new_ channels. Existing channels carry their
`channel_keys_id` in serialized data and re-derive keys from
`seed + channel_keys_id`. **Our timestamp persistence fix was unnecessary.**

### 2. `get_destination_script` is NOT compared during deserialization

ldk-node overrides `get_destination_script` to use BDK wallet addresses — same
as our original code. This is safe because LDK does NOT compare the destination
script during `ChannelManager::read`. **Our revert to KeysManager-only
destination script was unnecessary.**

### 3. The error IS a node_id comparison

The error `"Key that was generated does not match the existing key"` is triggered
when the `node_id` derived from the provided `NodeSigner` / `KeysManager` does
not match the `node_id` stored in the serialized `ChannelManager` data.

If the seed is the same, `node_id` will be the same. **If this error fires,
the seed used to create the KeysManager does NOT match the seed that created
the ChannelManager being deserialized.**

## Current Hypothesis

The `ChannelManager` in IDB at deserialization time was created by a **different
seed** than the one used by the restoring `KeysManager`. Possible causes:

### Theory A: Stale CM from Browser B's auto-created wallet

1. Browser B loads → `WalletProvider` auto-generates mnemonic B
2. LDK init → creates CM with `node_id_B` → persists to IDB
3. User navigates to Restore → enters mnemonic A
4. `Restore.tsx` calls `clearAllStores()` → clears all IDB (including CM B)
5. `Restore.tsx` downloads CM from VSS (if available) → writes to IDB
6. Page reloads → `init.ts` creates KeysManager with seed A
7. Reads CM from IDB and deserializes

**If VSS has a CM:** it should be CM A (matching seed A). ✅ Should work.
**If VSS has no CM:** IDB is empty (cleared). init.ts creates fresh CM. ✅ Should work.

**But what if clearAllStores() doesn't fully clear?** IndexedDB clear operations
might not be synchronous with subsequent writes if the page reloads too quickly.

### Theory B: Race between clearAllStores and page reload

`Restore.tsx` line 138: `setTimeout(() => window.location.href = '/', 500)`.

If the `idbPut` writes are not fully flushed before the reload, or if a
ServiceWorker or the LDK init (running in React StrictMode double-invoke)
re-creates the CM with mnemonic B's seed before the wallet context updates...

### Theory C: React StrictMode double-mount

In dev mode, React StrictMode mounts components twice. If `LdkProvider`'s
`useEffect` runs twice, the first invocation might create a CM with the old
mnemonic (before WalletProvider has updated), then the second invocation runs
with the new mnemonic. The first CM would be persisted to IDB with the wrong
node_id.

### Theory D: WalletProvider reads stale mnemonic

After restore, the page reloads. `WalletProvider` reads the mnemonic from IDB.
If it reads mnemonic B (from a cache or stale state) instead of mnemonic A,
it would derive the wrong seed. But this is unlikely since `clearAllStores()`
clears everything and the new mnemonic is written fresh.

## Key Decisions So Far

1. **KM timestamp persistence** — unnecessary, can revert
2. **`get_destination_script` KeysManager-only override** — unnecessary, can revert
3. **Root cause** — the ChannelManager in IDB was created by a different seed
   than the one restoring it

## Open Questions

1. Is `clearAllStores()` actually clearing `ldk_channel_manager` before the
   new data is written? Could there be an IDB race?
2. Does the `ChannelManager` get re-persisted by LDK's background persist
   between `clearAllStores()` and the page reload?
3. Is React StrictMode causing a double-init with stale wallet context?
4. Should we add a `console.log` showing which CM is in IDB at deserialization
   time (e.g., logging the first few bytes as a fingerprint)?

## Next Steps

1. Add debug logging to verify what's actually in IDB when deserialization runs
2. Log the node_id embedded in the serialized CM bytes and compare with current
3. Consider reverting the unnecessary timestamp and destination script fixes
4. Focus on the IDB state at deserialization time as the root cause
