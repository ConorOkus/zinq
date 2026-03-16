---
title: LDK WASM encodeUint128/decodeUint128 asymmetry causes channel open failure
category: integration-issues
date: 2026-03-16
severity: high
tags: [ldk, wasm, uint128, bigint, signer-provider, channel-open]
modules: [src/ldk/traits/bdk-signer-provider.ts]
---

# LDK WASM encodeUint128/decodeUint128 Asymmetry

## Problem

Channel open failed with "U128s cannot exceed 128 bits" followed by a WASM panic "already borrowed: BorrowMutError". The error appeared intermittent — it depended on the random bits in `user_channel_id`.

## Root Cause

The LDK WASM JavaScript bindings have an **encode/decode asymmetry** for u128 values:

- **`decodeUint128`**: Reads all 16 bytes big-endian → can produce values up to 2^128-1
- **`encodeUint128`**: Rejects values >= `0x10000000000000000000000000000000n` (which is **2^124**, not 2^128 — the hex literal has 31 zero digits after the leading 1)

When a custom `SignerProvider` delegates `generate_channel_keys_id` to the default provider, the flow is:

1. WASM calls JS callback with `user_channel_id` as encoded u128 bytes
2. `decodeUint128` reads it → BigInt value (potentially > 2^124)
3. Custom impl calls `defaultProvider.generate_channel_keys_id()`
4. Default provider calls `bindings.encodeUint128(user_channel_id)` → **throws** if value >= 2^124

The "already borrowed: BorrowMutError" panic is a cascading failure — the u128 error corrupts WASM's internal RefCell state.

## Solution

Don't delegate `generate_channel_keys_id` through the default provider's JS wrapper. Generate the channel keys ID directly:

```typescript
generate_channel_keys_id(_inbound, _channel_value_satoshis, _user_channel_id) {
  // Generate random 32 bytes directly to avoid re-encoding user_channel_id
  // through the broken encodeUint128 path
  const channelKeysId = new Uint8Array(32)
  crypto.getRandomValues(channelKeysId)
  return channelKeysId
}
```

This is safe because:
- LDK doesn't require `generate_channel_keys_id` to be deterministic
- The `channel_keys_id` is persisted in the ChannelMonitor and used via `derive_channel_signer` on restore
- 32 random bytes provide sufficient uniqueness (collision probability ~2^-128)

## Prevention

- **Never re-encode a decoded u128 through the LDK WASM bindings** — the decode produces values the encode rejects
- When implementing custom `SignerProvider` or other LDK trait wrappers, avoid delegating methods that pass u128 parameters through the JS wrapper layer
- If you must delegate, cap the value: `value & ((1n << 124n) - 1n)` before passing to the default provider
