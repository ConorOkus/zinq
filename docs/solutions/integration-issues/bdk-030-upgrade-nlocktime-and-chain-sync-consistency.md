---
title: BDK 0.3.0 Upgrade — nlocktime Finality and Chain Sync Tip Consistency
category: integration-issues
date: 2026-03-17
severity: critical
tags: [bdk, ldk, channel-funding, chain-sync, esplora, nlocktime, wasm]
modules:
  [
    src/ldk/traits/event-handler.ts,
    src/ldk/sync/chain-sync.ts,
    src/ldk/sync/esplora-client.ts,
    src/ldk/init.ts,
  ]
---

# BDK 0.3.0 Upgrade: nlocktime Finality and Chain Sync Tip Consistency

## Problem

After upgrading `@bitcoindevkit/bdk-wallet-web` from 0.2.0 to 0.3.0 (to use native `Transaction.to_bytes()` / `from_bytes()`), two separate issues blocked Lightning channel opening:

1. **Funding tx rejected by LDK**: `APIMisuseError: "Funding transaction absolute timelock is non-final"`
2. **Channel stuck at ChannelPending forever**: `best_block_updated` reported tip height 190 blocks behind the funding tx confirmation height, so LDK could never see enough confirmations.

## Root Cause

### Issue 1: BDK 0.3.0 Default nLockTime

BDK 0.3.0 changed `TxBuilder.finish()` to set `nLockTime` to the current block height (anti-fee-sniping). BDK 0.2.0 defaulted to 0. LDK requires funding transactions to have a final absolute locktime — a locktime equal to the current tip means inputs with `nSequence != 0xFFFFFFFF` make it non-final from LDK's perspective.

### Issue 2: Separate getTipHash / getTipHeight API Calls

`syncOnce()` called `esplora.getTipHash()` and `esplora.getTipHeight()` as independent HTTP requests. On fast-block networks like mutinynet (~30s blocks), the tip could advance between calls, yielding a hash from block N but a height from block M (where M << N). LDK was told `best_block = height M` but the funding tx confirmed at height N, making it appear "in the future" — confirmations could never accumulate.

The same bug existed in `init.ts` where `BestBlock` was constructed for a fresh `ChannelManager`.

## Solution

### Fix 1: Explicit nlocktime(0) on Funding Transactions

```typescript
// src/ldk/traits/event-handler.ts — FundingGenerationReady handler
const psbt = bdkWallet
  .build_tx()
  .nlocktime(0) // ← LDK rejects non-final locktime
  .add_recipient(recipient)
  .finish()
```

Anti-fee-sniping is irrelevant for funding transactions: they are time-sensitive, the counterparty already knows the txid, and the protection primarily benefits regular spend transactions.

### Fix 2: Derive Tip Height from Block Hash

Added `EsploraClient.getBlockHeight(hash)` that derives the height from `/block/{hash}/status` instead of the independent `/blocks/tip/height` endpoint:

```typescript
// src/ldk/sync/esplora-client.ts
async getBlockHeight(hash: string): Promise<number> {
  const status = await this.getBlockStatus(hash)
  return status.height
}

// src/ldk/sync/chain-sync.ts — syncOnce()
const tipHeight = await esplora.getBlockHeight(tipHash)  // consistent with tipHash
const tipHeader = await esplora.getBlockHeader(tipHash)

// src/ldk/init.ts — fresh ChannelManager
const tipHeight = await esplora.getBlockHeight(tipHash)   // same fix
```

This guarantees the height corresponds to the exact block hash used for `best_block_updated`.

## Prevention

- **When upgrading BDK wasm**: Check for default behavior changes in `TxBuilder` (locktime, fee rate, dust threshold). Run a full channel open/close cycle on signet after any BDK version bump.
- **When fetching related blockchain data**: Never use separate API calls for data that must be consistent (hash + height, tx + status). Derive dependent values from a single authoritative response.
- **When building funding transactions**: Always set `nlocktime(0)` explicitly — don't rely on BDK defaults, which may change across versions.

## Related

- [BDK wasm PR #39](https://github.com/bitcoindevkit/bdk-wasm/pull/39) — Added `Transaction.to_bytes()` / `from_bytes()`
- [BDK wasm issue #38](https://github.com/bitcoindevkit/bdk-wasm/issues/38) — The upstream gap that prompted the tx-bridge workaround
- `docs/solutions/integration-issues/bdk-wasm-txbuilder-consumes-self.md` — Related TxBuilder gotcha
