---
title: "feat: Add onchain wallet with BDK-WASM and unified BIP39 mnemonic"
type: feat
status: completed
date: 2026-03-12
origin: docs/brainstorms/2026-03-12-onchain-wallet-bdk-wasm-brainstorm.md
---

# feat: Add onchain wallet with BDK-WASM and unified BIP39 mnemonic

## Overview

Add a full onchain Bitcoin wallet to the browser-based Lightning wallet using `@bitcoindevkit/bdk-wallet-web`. Replace the current random 32-byte seed with a BIP39 mnemonic that derives keys for both the onchain wallet (BIP84 P2WPKH) and the Lightning node (dedicated BIP32 path). This enables sending/receiving onchain Bitcoin, funding Lightning channels, and handling force-close sweeps — all backed by a single mnemonic recovery phrase.

## Problem Statement / Motivation

The wallet currently has no onchain Bitcoin capability. The LDK event handler stubs out `FundingGenerationReady` with a warning log (`src/ldk/traits/event-handler.ts:190-194`) — channels cannot be funded. The current seed is 32 random bytes with no mnemonic backup, meaning users have no recovery path. An onchain wallet is the prerequisite for channel funding, force-close sweeps, and any real Lightning usage.

## Proposed Solution

Integrate `@bitcoindevkit/bdk-wallet-web` (v0.2.0) — production-proven in MetaMask Bitcoin Snap. Use `@scure/bip39` + `@scure/bip32` for mnemonic generation and HD key derivation. Create a new `src/onchain/` module mirroring the existing `src/ldk/` patterns (see brainstorm: `docs/brainstorms/2026-03-12-onchain-wallet-bdk-wasm-brainstorm.md`).

## Technical Approach

### Architecture

```
src/
  wallet/                         # NEW — shared mnemonic/seed lifecycle
    mnemonic.ts                   # BIP39 generation, validation, storage
    mnemonic.test.ts
    keys.ts                       # Derive LDK seed + BDK descriptors from mnemonic
    keys.test.ts
  onchain/                        # NEW — BDK wallet module
    init.ts                       # BDK Wallet + EsploraClient initialization
    init.test.ts
    config.ts                     # Onchain-specific config (sync interval, gap limit)
    sync.ts                       # BDK Esplora sync loop
    sync.test.ts
    storage/
      changeset.ts                # ChangeSet persistence to IndexedDB
      changeset.test.ts
    onchain-context.ts            # Context types (discriminated union)
    context.tsx                   # OnchainProvider component
    use-onchain.ts                # useOnchain() hook
  ldk/
    storage/seed.ts               # MODIFIED — accept derived seed instead of generating random bytes
    storage/idb.ts                # MODIFIED — add new IDB stores, bump DB_VERSION
    init.ts                       # MODIFIED — receive seed from wallet/keys.ts
    traits/event-handler.ts       # MODIFIED — implement FundingGenerationReady + SpendableOutputs
  main.tsx                        # MODIFIED — add WalletProvider + OnchainProvider to tree
```

**Provider nesting order** in `main.tsx`:
```tsx
<WalletProvider>          {/* mnemonic lifecycle — must init first */}
  <LdkProvider>           {/* Lightning — depends on derived seed */}
    <OnchainProvider>     {/* BDK wallet — depends on derived descriptors */}
      <RouterProvider />
    </OnchainProvider>
  </LdkProvider>
</WalletProvider>
```

`WalletProvider` owns the mnemonic and exposes derived keys to children. `LdkProvider` and `OnchainProvider` are independent — if BDK fails, Lightning still works. If LDK fails, onchain still works.

### Implementation Phases

#### Phase 1: Unified Mnemonic and Key Derivation

Create `src/wallet/` module for shared seed management.

**`src/wallet/mnemonic.ts`:**
- `generateMnemonic()`: Generate 12-word BIP39 mnemonic via `@scure/bip39` (128-bit entropy)
- `validateMnemonic(words: string): boolean`: Validate user-provided mnemonic
- `getMnemonic(): Promise<string | undefined>`: Read from IDB store `wallet_mnemonic`
- `storeMnemonic(mnemonic: string): Promise<void>`: Write to IDB with overwrite guard (same pattern as existing `seed.ts:11-16`)
- Storage format: plaintext string in IDB (acceptable for Signet; encryption deferred to mainnet phase)

**`src/wallet/keys.ts`:**
- `deriveLdkSeed(mnemonic: string): Uint8Array`: Derive 32-byte LDK seed
  - `mnemonicToSeed(mnemonic)` → 64-byte BIP39 seed
  - `HDKey.fromMasterSeed(seed).derive("m/535'/0'")` → take `.privateKey` (32 bytes)
  - This is the child private key at path `m/535'/0'`, used as LDK's `KeysManager` seed
- `deriveBdkDescriptors(mnemonic: string, network: 'signet' | 'bitcoin'): { external: string, internal: string }`:
  - Derive BIP84 account key: `m/84'/1'/0'` (coin type 1 for Signet/testnet)
  - Build descriptor strings: `wpkh([fingerprint/84'/1'/0']xprv.../0/*)` and `.../1/*`
  - Fingerprint = first 4 bytes of HASH160 of the master public key

**IDB changes (`src/ldk/storage/idb.ts`):**
- Add `'wallet_mnemonic'` and `'bdk_changeset'` to `STORES` array
- Bump `DB_VERSION` from `2` to `3`
- Existing `onupgradeneeded` handler automatically creates missing stores

**Migration strategy:**
- On `DB_VERSION` upgrade from 2 to 3: detect existing `ldk_seed` data
- If existing seed found: log warning, clear all LDK state (seed, monitors, manager, graph, scorer, spendable outputs)
- This is a destructive migration — acceptable for Signet-only stage
- The `onupgradeneeded` handler in `idb.ts:23-30` runs before any app code reads state

**Modify `src/ldk/storage/seed.ts`:**
- Change `generateAndStoreSeed()` to `storeDerivedSeed(seed: Uint8Array)` — accepts externally derived seed
- `getSeed()` remains unchanged
- Remove `crypto.getRandomValues` generation

**Modify `src/ldk/init.ts`:**
- Remove direct seed generation (lines 119-122)
- Accept `seed: Uint8Array` as parameter to `doInitializeLdk(seed)`
- Caller (`WalletProvider`) derives seed from mnemonic before calling init

**Tests (`src/wallet/mnemonic.test.ts`, `src/wallet/keys.test.ts`):**
- Verify mnemonic generation produces valid 12-word phrases
- Verify LDK seed derivation is deterministic (same mnemonic → same 32 bytes)
- Verify BDK descriptor format matches BIP84 standard
- Verify overwrite guard on `storeMnemonic()`
- Cross-validate: generate address from descriptors and verify it matches a known BIP84 test vector

#### Phase 2: BDK Wallet Initialization and Sync

Create `src/onchain/` module.

**`src/onchain/config.ts`:**
```typescript
export const ONCHAIN_CONFIG = {
  esploraUrl: 'https://mutinynet.com/api',  // shared with LDK
  syncIntervalMs: 30_000,                    // same as LDK chain poll
  fullScanGapLimit: 20,                      // BDK default
  syncParallelRequests: 5,
} as const
```

**`src/onchain/init.ts`:**
- `initializeBdkWallet(descriptors, network)`: Create or restore BDK `Wallet`
  - Load existing ChangeSet from IDB → `Wallet.load(changeset, external, internal)` if found
  - Otherwise → `Wallet.create(network, external, internal)` for fresh wallet
  - Create `EsploraClient` pointing at Mutinynet
  - Run initial sync: `full_scan` for new wallets, `sync` for restored wallets
  - Persist ChangeSet after initial sync
  - Return `{ wallet, esploraClient }`
- WASM init: BDK-WASM ships its own `init()` from wasm-pack. Use module-level promise dedup (same pattern as `src/ldk/init.ts:67-77`)

**`src/onchain/storage/changeset.ts`:**
- `getChangeset(): Promise<string | undefined>`: Read JSON string from IDB `bdk_changeset` store
- `putChangeset(json: string): Promise<void>`: Write to IDB
- Note on `take_staged()` semantics: this is a destructive read — if the IDB write fails after `take_staged()`, those changes are lost. Log prominently on failure. This matches the pattern documented in `docs/solutions/integration-issues/ldk-wasm-foundation-layer-patterns.md` for LDK's `get_and_clear_needs_persistence()`.

**`src/onchain/sync.ts`:**
- `startOnchainSyncLoop(wallet, esploraClient)`: Returns `{ stop: () => void }`
  - Uses recursive `setTimeout` (not `setInterval`) — same pattern as `src/ldk/sync/chain-sync.ts:130`
  - Each tick: `wallet.start_sync_with_revealed_spks()` → `esploraClient.sync(request, parallelRequests)` → `wallet.apply_update(update)` → `wallet.take_staged()` → persist ChangeSet
  - Error handling: log and continue on sync failure, don't crash the loop

**`src/onchain/onchain-context.ts`:**
```typescript
export type OnchainContextValue =
  | { status: 'loading'; balance: null; error: null }
  | {
      status: 'ready'
      balance: { confirmed: bigint; trustedPending: bigint; untrustedPending: bigint }
      generateAddress: () => string
      error: null
    }
  | { status: 'error'; balance: null; error: Error }
```

**`src/onchain/context.tsx`:**
- `OnchainProvider` component — `useEffect` calls `initializeBdkWallet()`, starts sync loop
- Updates balance on each sync tick
- Cleanup on unmount: stop sync loop

**`src/onchain/use-onchain.ts`:**
- `useOnchain()` hook — thin `useContext` wrapper

**Tests:**
- ChangeSet persistence round-trip
- Sync loop starts/stops cleanly
- Fresh wallet vs restored wallet initialization paths

#### Phase 3: LDK Integration — Channel Funding and Sweeps

Wire BDK wallet into LDK event handlers.

**`FundingGenerationReady` handler (`src/ldk/traits/event-handler.ts:190-194`):**

Replace the stub with:
```typescript
if (event instanceof Event_FundingGenerationReady) {
  const { temporary_channel_id, counterparty_node_id, channel_value_satoshis, output_script } = event
  // BDK TxBuilder: build funding transaction
  const txBuilder = wallet.build_tx()
  txBuilder.add_recipient(new Recipient(ScriptBuf.from_bytes(output_script), Amount.from_sat(channel_value_satoshis)))
  const psbt = txBuilder.finish()   // sync WASM call — no async needed
  wallet.sign(psbt, new SignOptions())
  const tx = psbt.extract_tx()
  channelManager.funding_transaction_generated(temporary_channel_id, counterparty_node_id, tx.to_bytes())
  // Persist wallet state after funding
  const changeset = wallet.take_staged()
  if (changeset && !changeset.is_empty()) {
    void putChangeset(changeset.to_json()).catch(err =>
      console.error('[BDK] CRITICAL: failed to persist changeset after funding tx', err)
    )
  }
}
```

Key considerations:
- `TxBuilder.finish()` and `wallet.sign()` are **synchronous WASM calls** — they work inline in the sync event handler
- If insufficient balance: `txBuilder.finish()` will throw. Catch and log: `[LDK Event] FundingGenerationReady: insufficient onchain balance`
- The BDK `Wallet` instance must be accessible from the event handler. Pass it as a parameter to `createEventHandler()` or hold a module-level reference

**`SpendableOutputs` handler:**

The existing handler persists `SpendableOutputDescriptor` data to `ldk_spendable_outputs` IDB store. Extend it to sweep funds to a BDK address:
- Use LDK's `KeysManager.spend_spendable_outputs()` to build a PSBT spending the descriptors to a BDK-generated change address
- Sign with `KeysManager`
- Broadcast via Esplora
- The swept funds appear in the BDK wallet on next sync

This keeps sweep logic in LDK's domain (it owns the signing keys for these outputs) while routing funds to the BDK wallet for unified balance tracking.

**`BumpTransaction` handling (anchor channels):**

Check if `UserConfig.constructor_default()` enables anchor channels. If yes:
- Implement `BumpTransaction` handler using BDK UTXOs for CPFP
- If not feasible in this phase, explicitly disable anchors in `UserConfig` with a TODO comment

**Web Lock scope:**
- Rename lock from `ldk-wallet-lock` to `browser-wallet-lock` to cover both LDK and BDK
- Single lock prevents multi-tab corruption of shared IDB state

**Tests:**
- FundingGenerationReady handler builds valid funding transaction
- Insufficient balance produces graceful error (not crash)
- SpendableOutputs sweep builds valid PSBT to BDK address

#### Phase 4: WalletProvider and App Wiring

Create the top-level `WalletProvider` that manages the mnemonic lifecycle.

**`src/wallet/wallet-context.ts`:**
```typescript
export type WalletContextValue =
  | { status: 'new' }                              // no mnemonic — show create/import
  | { status: 'backup'; mnemonic: string }          // mnemonic generated, awaiting backup confirmation
  | { status: 'ready'; ldkSeed: Uint8Array; bdkDescriptors: { external: string; internal: string } }
  | { status: 'error'; error: Error }
```

**`src/wallet/context.tsx`:**
- On mount: check IDB for existing mnemonic
- If found: derive keys, set `status: 'ready'`
- If not found: set `status: 'new'` — UI shows create/import screen
- Expose `createWallet()` and `importWallet(mnemonic)` actions

**`src/wallet/use-wallet.ts`:**
- `useWallet()` hook

**`src/main.tsx` update:**
```tsx
<WalletProvider>
  <LdkProvider>
    <OnchainProvider>
      <RouterProvider router={router} />
    </OnchainProvider>
  </LdkProvider>
</WalletProvider>
```

`LdkProvider` reads `ldkSeed` from `WalletContext`. `OnchainProvider` reads `bdkDescriptors` from `WalletContext`. Both only initialize when `WalletContext.status === 'ready'`.

**First-launch flow:**
1. `WalletProvider` detects no mnemonic → `status: 'new'`
2. UI renders create/import screen
3. User creates wallet → `generateMnemonic()` → `status: 'backup'`
4. UI shows 12 words for backup
5. User confirms → `storeMnemonic()` → derive keys → `status: 'ready'`
6. `LdkProvider` and `OnchainProvider` initialize

**Import flow:**
1. User enters 12 words → `validateMnemonic()` → `storeMnemonic()`
2. `status: 'ready'` → both providers init
3. BDK runs `full_scan` (not just `sync`) to discover existing addresses/UTXOs

## System-Wide Impact

### Interaction Graph

Mnemonic generation → `WalletProvider.createWallet()` → `storeMnemonic()` (IDB write) → derive keys → `LdkProvider` receives `ldkSeed` via context → `KeysManager.constructor_new(seed)` → LDK init chain. Simultaneously, `OnchainProvider` receives descriptors → `Wallet.create(network, ext, int)` → `EsploraClient.full_scan()` → `wallet.apply_update()` → `wallet.take_staged()` → `putChangeset()` (IDB write).

Channel funding: User action → `channelManager.create_channel()` → LDK negotiates with peer → emits `FundingGenerationReady` event → event handler calls `wallet.build_tx()` → `wallet.sign()` → `channelManager.funding_transaction_generated()` → LDK broadcasts.

### Error Propagation

- BDK WASM load failure → `OnchainProvider` sets `status: 'error'` → UI shows onchain error, LDK still works
- LDK WASM load failure → `LdkProvider` sets `status: 'error'` → UI shows Lightning error, BDK still works
- Mnemonic IDB write failure → `WalletProvider` sets `status: 'error'` → neither subsystem starts
- ChangeSet persistence failure → logged at CRITICAL level, wallet continues with in-memory state (risk: lost on browser close, recoverable via full rescan)
- Esplora API failure → both sync loops log and retry on next tick (30s)

### State Lifecycle Risks

- **`take_staged()` is destructive**: If IDB write fails after `take_staged()`, those changes are lost. Mitigation: log CRITICAL, accept the risk (full rescan recovers), same approach as LDK's `get_and_clear_needs_persistence()`
- **Mnemonic overwrite**: Protected by existence check guard (same as existing `seed.ts` pattern)
- **IDB version upgrade from 2→3**: Clears existing LDK state for migration. Acceptable for Signet — must be revisited before mainnet
- **Multi-tab**: Single Web Lock (`browser-wallet-lock`) prevents concurrent access to IDB wallet state

## Acceptance Criteria

### Functional Requirements

- [x] 12-word BIP39 mnemonic generated on first launch, displayed for backup
- [x] Mnemonic persisted to IndexedDB, protected from overwrite
- [x] LDK seed derived deterministically from mnemonic at `m/535'/0'`
- [x] BDK wallet initialized with BIP84 P2WPKH descriptors from same mnemonic
- [x] Onchain balance displayed (confirmed + pending)
- [x] Receive address generated (P2WPKH, `tb1q...` on Signet)
- [x] BDK syncs with Mutinynet Esplora every 30s
- [x] ChangeSet persisted to IndexedDB after each sync
- [x] Returning user: wallet restored from mnemonic + ChangeSet without full rescan
- [x] Import flow: user enters 12 words, full scan discovers existing funds
- [x] `FundingGenerationReady` event builds and signs funding transaction via BDK
- [ ] `SpendableOutputs` event sweeps funds to BDK wallet address (persists descriptors; sweep not yet wired)
- [x] Web Lock renamed to `browser-wallet-lock` covering both subsystems
- [x] BDK failure does not prevent LDK from operating (and vice versa)

### Testing Requirements

- [x] Unit tests for mnemonic generation, validation, key derivation
- [x] Unit tests for BDK descriptor format (cross-validate with BIP84 test vectors)
- [x] Unit tests for ChangeSet persistence round-trip
- [x] Unit tests for FundingGenerationReady handler (mock BDK wallet)
- [ ] Integration test: full wallet lifecycle (create → sync → receive → send)
- [x] `fake-indexeddb` for all IDB tests, `Array.from()` for Uint8Array comparisons

## Dependencies & Risks

### New Dependencies

| Package | Purpose | Size concern |
|---------|---------|-------------|
| `@bitcoindevkit/bdk-wallet-web` | BDK wallet + Esplora client (WASM) | ~2-3MB WASM binary |
| `@scure/bip39` | BIP39 mnemonic generation/validation | ~50KB (includes wordlist) |
| `@scure/bip32` | BIP32 HD key derivation | ~20KB |

### Risks

1. **BDK-WASM v0.2.0 API stability**: Pre-1.0, API may change. Mitigated by keeping a thin wrapper layer
2. **Dual WASM memory**: LDK + BDK WASM modules share browser memory. Monitor total WASM heap usage
3. **Esplora rate limiting**: Two sync loops hitting Mutinynet Esplora. Mitigated by sharing the 30s timer
4. **Descriptor format correctness**: Wrong descriptor = wrong addresses = unrecoverable funds. Mitigated by test vector validation
5. **Main thread blocking**: BDK full scan (30-60s) blocks UI. Mitigated by showing loading state; Web Worker migration is a future optimization

## Alternative Approaches Considered

- **Custom Rust wasm-pack wrapper**: Full API control but requires Rust toolchain for all contributors. Rejected for iteration speed (see brainstorm).
- **@bitcoinerlab pure TypeScript**: No WASM complexity but less battle-tested crypto. Rejected for security confidence.
- **Separate seeds for LDK and BDK**: Simpler migration but two backup phrases. Rejected for UX simplicity (see brainstorm).

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-12-onchain-wallet-bdk-wasm-brainstorm.md](docs/brainstorms/2026-03-12-onchain-wallet-bdk-wasm-brainstorm.md) — Key decisions carried forward: unified BIP39 mnemonic, BDK-WASM npm package, BIP84 P2WPKH, @scure key derivation libs, main thread execution.

### Internal References

- LDK init flow: `src/ldk/init.ts:113-142`
- Current seed management: `src/ldk/storage/seed.ts`
- IndexedDB helpers: `src/ldk/storage/idb.ts`
- Event handler stubs: `src/ldk/traits/event-handler.ts:190-207`
- Chain sync pattern: `src/ldk/sync/chain-sync.ts`
- Context pattern: `src/ldk/ldk-context.ts`, `src/ldk/context.tsx`, `src/ldk/use-ldk.ts`
- Institutional learnings: `docs/solutions/integration-issues/ldk-wasm-foundation-layer-patterns.md`

### External References

- BDK WASM cookbook: bookofbdk.com/cookbook/bindings/wasm/
- `@bitcoindevkit/bdk-wallet-web` on npm
- `@scure/bip39` and `@scure/bip32` by @paulmillr
- LDK channel funding docs: lightningdevkit.org/building-a-node-with-ldk/opening-a-channel/
