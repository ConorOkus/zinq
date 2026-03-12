# Brainstorm: Onchain Wallet with BDK-WASM

**Date:** 2026-03-12
**Status:** Complete

## What We're Building

A full onchain Bitcoin wallet integrated into the browser-based Lightning wallet, using `@bitcoindevkit/bdk-wallet-web` (BDK compiled to WASM). The wallet will:

- Send and receive onchain Bitcoin (balance, transaction history, address generation)
- Fund Lightning channels (handle LDK's `FundingGenerationReady` event via BDK's `TxBuilder`)
- Handle force-close sweeps, anchor outputs, and other LDK-generated onchain transactions
- Share a single BIP39 mnemonic with the Lightning node for unified backup

## Why This Approach

**BDK-WASM via npm (`@bitcoindevkit/bdk-wallet-web` v0.2.0)** was chosen over:

- **Custom Rust wrapper**: Adds Rust toolchain requirement for all contributors, slower iteration. The pre-built npm package already exposes `TxBuilder`, `Wallet`, `EsploraClient`, and `PSBT` — sufficient for LDK integration.
- **@bitcoinerlab (pure TS)**: Less battle-tested crypto primitives, smaller community. BDK's Rust core is more audited.
- **bitcoinjs-lib + manual wallet**: Too much glue code for UTXO management, coin selection, and chain sync that BDK provides out of the box.

BDK-WASM is production-proven (MetaMask Bitcoin Snap, ~$30M AUM), Esplora-native (matches our Mutinynet setup), and requires no Rust toolchain — just `pnpm add`.

## Key Decisions

### 1. Unified BIP39 Mnemonic

Replace the current 32-byte random seed with a BIP39 mnemonic (via `@scure/bip39` + `@scure/bip32`). Both the onchain wallet and Lightning node derive keys from the same mnemonic:

- **Onchain wallet**: BIP84 derivation path `m/84'/1'/0'` (Signet/Testnet) for P2WPKH (native SegWit, `bc1q...` / `tb1q...` addresses)
- **LDK seed**: Dedicated BIP32 path (e.g., `m/535'/0'`) derived to 32 bytes for `KeysManager`
- **User backup**: Single 12 or 24-word mnemonic phrase backs up everything

This is a breaking change for any existing seeds, acceptable given the project's early stage.

### 2. Address Type: P2WPKH / Native SegWit / BIP84

Native SegWit chosen for broad compatibility. Descriptor format:
```
wpkh([fingerprint/84'/1'/0']xprv.../0/*)  # external (receive)
wpkh([fingerprint/84'/1'/0']xprv.../1/*)  # internal (change)
```

### 3. Key Derivation in JavaScript

Since BDK-WASM doesn't export `seed_to_descriptor` to JS, key derivation happens in TypeScript:

- `@scure/bip39`: Mnemonic generation and seed derivation
- `@scure/bip32`: HD key derivation (BIP32 master key -> BIP84 account xprv -> descriptor strings)
- Descriptor strings are passed to `Wallet.create(network, external_descriptor, internal_descriptor)`

### 4. Persistence via ChangeSet + IndexedDB

BDK-WASM uses `create_wallet_no_persist()` — no built-in storage. The persistence model:

1. After sync/tx operations, call `wallet.take_staged()` to get a `ChangeSet`
2. Serialize to JSON via `changeset.to_json()`
3. Store in IndexedDB (new object store in the existing `browser-wallet-ldk` database)
4. Restore via `ChangeSet.from_json(str)` -> `Wallet.load(changeset, ...)`

### 5. Same Thread as LDK

BDK Esplora sync runs on the main thread alongside LDK chain sync. Simpler architecture for now — can move to a Web Worker later if performance becomes an issue.

### 6. LDK Integration Points

- **`FundingGenerationReady`**: Use BDK's `TxBuilder` to create a funding transaction with `add_recipient(output_script, channel_value)`, sign the PSBT, extract raw tx, pass to `channelManager.funding_transaction_generated()`
- **Force-close sweeps**: Monitor BDK wallet for incoming sweep transactions from LDK's justice/penalty handling
- **Shared Esplora backend**: Both BDK and LDK use the same Mutinynet Esplora API (`mutinynet.com/api`)

### 7. New Dependencies

- `@bitcoindevkit/bdk-wallet-web` — BDK WASM wallet for browsers
- `@scure/bip39` — BIP39 mnemonic generation/validation
- `@scure/bip32` — BIP32 HD key derivation

## Architecture Sketch

```
src/
  onchain/                    # New module (mirrors src/ldk/ pattern)
    init.ts                   # BDK wallet initialization
    config.ts                 # Onchain-specific config
    sync.ts                   # Esplora sync loop
    storage/
      mnemonic.ts             # BIP39 mnemonic generation + IndexedDB storage
      changeset.ts            # ChangeSet persistence to IndexedDB
    context.tsx               # React OnchainProvider (discriminated union state)
    onchain-context.ts        # Context types
    use-onchain.ts            # useOnchain() hook
  ldk/
    storage/seed.ts           # Modified: derive LDK seed from mnemonic instead of random bytes
    init.ts                   # Modified: accept derived seed from mnemonic
```

## Resolved Questions

- **Seed strategy**: Unified BIP39 mnemonic (not separate seeds)
- **BDK integration method**: npm package, not custom Rust wrapper
- **Address type**: P2WPKH / BIP84 (not Taproot)
- **Key derivation libs**: @scure/bip39 + @scure/bip32
- **Threading model**: Main thread (same as LDK)
