# Brainstorm: BDK-LDK Transaction Bridge Workaround

**Date:** 2026-03-12
**Status:** Complete
**Upstream issue:** [bitcoindevkit/bdk-wasm#38](https://github.com/bitcoindevkit/bdk-wasm/issues/38)

## What We're Building

A temporary bridge module (`src/onchain/tx-bridge.ts`) that extracts raw transaction bytes from BDK's PSBT output using `@scure/btc-signer`, enabling two blocked Lightning flows:

1. **Channel funding** — Extract finalized tx bytes from BDK's signed PSBT and pass them to LDK's `funding_transaction_generated()`
2. **SpendableOutputs sweeps** — Get a receive address from BDK, build a sweep tx with `@scure/btc-signer` targeting that address
3. **Broadcasting** — POST raw tx hex to Esplora's `/tx` endpoint directly (since BDK's `EsploraClient.broadcast()` also requires the `Transaction` type)

This is explicitly temporary. Once bdk-wasm merges `Transaction.to_bytes()` / `Transaction.from_bytes()` (issue #38), this module gets deleted and replaced with native calls.

## Why This Approach

- **No viable alternative without new code** — BDK's `Transaction` type exposes no serialization. The PSBT base64 is the only data we can extract from BDK after signing.
- **@scure/btc-signer is a natural fit** — Already using `@scure/bip32` and `@scure/bip39` from the same ecosystem. Audited, lightweight (~15KB), handles PSBT parsing correctly including segwit witness data.
- **Single-file isolation** — All workaround code lives in one module, making it trivial to rip out later.
- **Manual BIP174 parsing rejected** — Error-prone for a temporary workaround; not worth reimplementing what scure already provides.

## Key Decisions

1. **Use `@scure/btc-signer` for PSBT → raw tx extraction** — Parse BDK's `psbt.toString()` base64, extract finalized transaction as `Uint8Array`.

2. **Bridge module handles broadcasting** — POST raw tx hex to Esplora `POST /tx` endpoint via `fetch()`. BDK's `EsploraClient.broadcast()` has the same `Transaction` type limitation, so we bypass it.

3. **Two-phase funding flow aligned with LDK events:**
   - `FundingGenerationReady` → build PSBT with BDK → extract raw bytes via bridge → `funding_transaction_generated()`
   - `FundingTxBroadcastSafe` → broadcast via bridge's direct Esplora POST

4. **Sweeps use BDK address + scure tx** — Generate a receive address from BDK wallet, build the sweep transaction with `@scure/btc-signer` using LDK's output descriptors, broadcast via bridge.

5. **BumpTransaction (anchor CPFP) deferred** — Out of scope for this workaround; revisit after bdk-wasm update.

6. **Designed for removal** — All bridge functions have a `// TEMPORARY: Remove when bdk-wasm exposes Transaction.to_bytes()` comment. No other module should import scure tx types directly.

## Module API Sketch

```typescript
// src/onchain/tx-bridge.ts
// TEMPORARY: Remove when bdk-wasm exposes Transaction.to_bytes() (bdk-wasm#38)

/** Extract raw transaction bytes from a finalized BDK PSBT base64 string */
export function extractTxBytes(psbtBase64: string): Uint8Array

/** Convert raw transaction bytes to hex string for broadcasting */
export function txBytesToHex(txBytes: Uint8Array): string

/** Broadcast a raw transaction hex to Esplora */
export async function broadcastTransaction(txHex: string, esploraUrl: string): Promise<string>
```

## Affected Files

- `src/onchain/tx-bridge.ts` — New bridge module (temporary)
- `src/ldk/traits/event-handler.ts` — Wire up FundingGenerationReady + FundingTxBroadcastSafe + SpendableOutputs
- `package.json` — Add `@scure/btc-signer` dependency

## Open Questions

*None — all resolved during brainstorming.*

## Resolved Questions

- **Scope:** Channel funding + sweeps (not BumpTransaction)
- **Dependency stance:** `@scure/btc-signer` acceptable as same ecosystem
- **Longevity:** Temporary bridge, isolated for easy removal
- **Broadcasting:** Bridge handles it via direct Esplora POST
- **Sweep approach:** BDK provides address, scure builds tx
