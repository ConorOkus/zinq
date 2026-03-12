---
title: "feat: BDK-LDK transaction bridge via @scure/btc-signer"
type: feat
status: completed
date: 2026-03-12
origin: docs/brainstorms/2026-03-12-bdk-ldk-tx-bridge-brainstorm.md
---

# feat: BDK-LDK Transaction Bridge via @scure/btc-signer

## Overview

Temporary bridge module that extracts raw transaction bytes from BDK's signed PSBT output using `@scure/btc-signer`, unblocking channel funding and spendable output sweeps while waiting for [bdk-wasm#38](https://github.com/bitcoindevkit/bdk-wasm/issues/38) to land upstream.

## Problem Statement

BDK-WASM's `Transaction` type has no `to_bytes()` method. This blocks two critical Lightning flows:

1. **Channel funding** — `channelManager.funding_transaction_generated()` requires raw tx bytes (`Uint8Array`), but `psbt.extract_tx()` returns a `Transaction` object with no serialization
2. **SpendableOutputs sweeps** — funds from closed channels cannot be swept back to the onchain wallet
3. **Broadcasting** — `EsploraClient.broadcast()` also takes `Transaction`, so even broadcasting is blocked

The only serializable data we can extract from BDK after signing is `psbt.toString()` (base64 PSBT string).

## Proposed Solution

A single `src/onchain/tx-bridge.ts` module that uses `@scure/btc-signer` to parse the base64 PSBT and extract the finalized raw transaction bytes. All temporary code is isolated in this one file for easy removal (see brainstorm: `docs/brainstorms/2026-03-12-bdk-ldk-tx-bridge-brainstorm.md`).

## Technical Considerations

### Verified API Surface

**BDK WASM (`@bitcoindevkit/bdk-wallet-web@^0.2.0`):**
- `Psbt.toString()` → base64 PSBT string (confirmed in `bitcoindevkit.d.ts`)
- `Psbt.extract_tx()` → `Transaction` (no `to_bytes()`)

**LDK WASM (`lightningdevkit@0.1.8-0`):**
- `channelManager.funding_transaction_generated(temporary_channel_id: ChannelId, counterparty_node_id: Uint8Array, funding_transaction: Uint8Array)` → `Result_NoneAPIErrorZ`
- `Event_FundingTxBroadcastSafe` has: `channel_id`, `user_channel_id`, `funding_txo: OutPoint`, `counterparty_node_id`, `former_temporary_channel_id: ChannelId`
- `Event_DiscardFunding` has: `channel_id`, `funding_info: FundingInfo` (where `FundingInfo_Tx.transaction: Uint8Array`)

### Cache Key Resolution

`FundingTxBroadcastSafe` provides `former_temporary_channel_id` — so we can cache by `temporary_channel_id.write()` hex at `FundingGenerationReady` and look up by `former_temporary_channel_id.write()` hex at `FundingTxBroadcastSafe`. No mapping needed.

### Event Handler Sync Constraint

`handle_event` is synchronous. All bridge operations (PSBT parsing, `funding_transaction_generated`) are synchronous. Only the Esplora broadcast at `FundingTxBroadcastSafe` is async — use fire-and-forget with `.catch()`, matching the existing pattern in `src/ldk/traits/broadcaster.ts`.

### Sweep Scope

Only `StaticOutput` (cooperative close P2WPKH) for initial implementation. `DelayedPaymentOutput` and anchor outputs logged as warnings. Rationale: signing delayed outputs requires LDK key extraction, which is a separate complexity (see brainstorm: resolved questions on sweep approach).

## Acceptance Criteria

### Phase 1: Bridge Module (`src/onchain/tx-bridge.ts`)

- [x] `extractTxBytes(psbtBase64: string): Uint8Array` — parses base64 PSBT via `@scure/btc-signer`, returns raw consensus-encoded tx bytes
- [x] `txBytesToHex(txBytes: Uint8Array): string` — hex encoding for Esplora broadcast
- [x] `broadcastTransaction(txHex: string, esploraUrl: string): Promise<string>` — POST to Esplora `/tx`, returns txid
- [x] All exports marked with `// TEMPORARY: Remove when bdk-wasm exposes Transaction.to_bytes() (bdk-wasm#38)`
- [x] Unit tests with a known PSBT test vector verifying round-trip correctness

### Phase 2: Channel Funding Flow (`src/ldk/traits/event-handler.ts`)

- [x] `FundingGenerationReady`: after signing PSBT, extract raw bytes via bridge → call `channelManager.funding_transaction_generated(temporary_channel_id, counterparty_node_id, rawTxBytes)` → cache `{ rawTxHex }` keyed by `temporary_channel_id.write()` hex
- [x] `FundingTxBroadcastSafe`: look up cached tx by `former_temporary_channel_id.write()` hex → broadcast via `broadcastTransaction()` → remove cache entry
- [x] `DiscardFunding`: logs channel ID (cache cleanup deferred — uses final channel_id, not temp)
- [x] Handle `funding_transaction_generated` error result (log, clean cache)
- [x] Persist BDK changeset after successful `funding_transaction_generated` (move existing logic)
- [x] Tests: happy path, BDK unavailable, broadcast safe, DiscardFunding

### Phase 3: SpendableOutputs Sweep (Deferred — separate PR)

- [ ] Read `StaticOutput` descriptors from `ldk_spendable_outputs` IDB store
- [ ] Get BDK receive address via `wallet.next_unused_address('external')`
- [ ] Build sweep tx with `@scure/btc-signer` (single input StaticOutput → single output to BDK address)
- [ ] Fee estimation via Esplora `/fee-estimates` endpoint
- [ ] Broadcast via bridge, delete descriptor from IDB after broadcast
- [ ] Log warning for non-StaticOutput descriptor types

## Implementation Plan

### Step 1: Add dependency

```bash
pnpm add @scure/btc-signer
```

Verify no version conflicts with existing `@scure/bip32` and `@scure/bip39`.

### Step 2: Create `src/onchain/tx-bridge.ts`

```typescript
// src/onchain/tx-bridge.ts
// TEMPORARY: Remove when bdk-wasm exposes Transaction.to_bytes() (bdk-wasm#38)

import { Transaction } from '@scure/btc-signer'

/** Extract raw transaction bytes from a finalized BDK PSBT base64 string */
export function extractTxBytes(psbtBase64: string): Uint8Array {
  const psbtBytes = base64ToBytes(psbtBase64)
  const tx = Transaction.fromPSBT(psbtBytes)
  tx.finalize()
  return tx.extract()
}

/** Convert raw transaction bytes to hex string for broadcasting */
export function txBytesToHex(txBytes: Uint8Array): string {
  return Array.from(txBytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Broadcast a raw transaction hex to Esplora POST /tx */
export async function broadcastTransaction(
  txHex: string,
  esploraUrl: string,
): Promise<string> {
  const response = await fetch(`${esploraUrl}/tx`, {
    method: 'POST',
    body: txHex,
  })
  if (!response.ok) {
    throw new Error(`Esplora broadcast failed: ${response.status} ${await response.text()}`)
  }
  return response.text() // returns txid
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
```

> **Note:** The exact `@scure/btc-signer` API (`Transaction.fromPSBT`, `.finalize()`, `.extract()`) must be verified against the installed version. The API may differ — check docs.

### Step 3: Create `src/onchain/tx-bridge.test.ts`

Test with a known signed PSBT base64 string. Verify:
- `extractTxBytes` produces expected raw tx bytes
- `txBytesToHex` produces correct hex
- `broadcastTransaction` calls fetch with correct URL and body (mock fetch)
- Throws on non-finalized PSBT

### Step 4: Wire up event handler — funding flow

In `src/ldk/traits/event-handler.ts`:

1. Add a `Map<string, string>` for the funding tx cache (keyed by temp channel ID hex → raw tx hex)
2. In `FundingGenerationReady`:
   - After `bdkWallet.sign(psbt, new SignOptions())`, call `extractTxBytes(psbt.toString())`
   - Call `channelManager.funding_transaction_generated(event.temporary_channel_id, event.counterparty_node_id, rawTxBytes)`
   - Check result — if error, log and return
   - Cache `txBytesToHex(rawTxBytes)` keyed by `bytesToHex(event.temporary_channel_id.write())`
   - Persist BDK changeset
3. In `FundingTxBroadcastSafe`:
   - Look up cached tx by `bytesToHex(event.former_temporary_channel_id.write())`
   - If found, fire-and-forget `broadcastTransaction(txHex, esploraUrl).catch(...)` and delete cache entry
   - If not found, log warning (may have been cleaned up by DiscardFunding or tab reload)
4. In `DiscardFunding`:
   - Clean up cache entry by `bytesToHex(event.channel_id.write())`

### Step 5: Update event handler tests

Add test cases in `src/ldk/traits/event-handler.test.ts`:
- FundingGenerationReady happy path: verify `funding_transaction_generated` called with extracted bytes
- FundingTxBroadcastSafe: verify broadcast called with cached tx
- DiscardFunding: verify cache cleanup
- FundingGenerationReady with no BDK wallet: verify warning, no crash

### Step 6 (Separate PR): SpendableOutputs sweep

Deferred to a follow-up PR to keep this change focused.

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| `@scure/btc-signer` PSBT API doesn't match expected usage | Verify API against docs before coding; the library is well-documented |
| In-memory cache lost on tab close between events | Acceptable on signet — channel times out, BDK recovers UTXOs on rescan |
| BDK wallet state inconsistent if funding tx never broadcasts | BDK's chain sync will detect unconfirmed "spent" UTXOs and return them |
| Version conflict with existing @scure packages | Unlikely — same ecosystem, shared noble dependencies |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-12-bdk-ldk-tx-bridge-brainstorm.md](docs/brainstorms/2026-03-12-bdk-ldk-tx-bridge-brainstorm.md) — key decisions: @scure/btc-signer as temporary bridge, single-file isolation, bridge handles broadcasting
- **Upstream issue:** [bitcoindevkit/bdk-wasm#38](https://github.com/bitcoindevkit/bdk-wasm/issues/38) — `Transaction.to_bytes()` / `from_bytes()` feature request
- **Existing broadcaster pattern:** `src/ldk/traits/broadcaster.ts` — Esplora POST /tx pattern
- **Event handler:** `src/ldk/traits/event-handler.ts:204-270` — current funding/discard stubs
- **Institutional learnings:** `docs/solutions/integration-issues/bdk-wasm-onchain-wallet-integration-patterns.md` — BDK Transaction serialization issue documented as unresolved
- **Institutional learnings:** `docs/solutions/integration-issues/ldk-event-handler-patterns.md` — sync/async bridging patterns, fund safety
