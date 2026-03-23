---
title: Custom SignerProvider to route channel close funds to BDK wallet
category: integration-issues
date: 2026-03-16
severity: critical
tags: [ldk, bdk, signer-provider, channel-close, fund-safety, cooperative-close, force-close]
modules: [src/ldk/traits/bdk-signer-provider.ts, src/ldk/init.ts]
---

# Custom SignerProvider to Route Channel Close Funds to BDK Wallet

## Problem

LDK's `KeysManager` derives its own addresses from `m/535'/0'` for channel close destinations (`get_shutdown_scriptpubkey` for cooperative close, `get_destination_script` for force close). The BDK on-chain wallet uses BIP84 at `m/84'/1'/0'`. These are completely separate key hierarchies — BDK cannot see funds sent to LDK-derived addresses, so channel close funds appeared "lost" to the user even though they were technically recoverable from the LDK seed.

## Root Cause

LDK and BDK use different derivation paths from the same mnemonic. Without a custom `SignerProvider`, LDK directs close funds to its own addresses that BDK's `start_sync_with_revealed_spks()` never watches.

## Solution

Create a decorator `SignerProvider` that wraps `KeysManager` but overrides two methods to return BDK wallet addresses:

```typescript
// src/ldk/traits/bdk-signer-provider.ts
const impl: SignerProviderInterface = {
  // Delegate all signing to KeysManager
  derive_channel_signer(channel_value_satoshis, channel_keys_id) {
    return defaultProvider.derive_channel_signer(channel_value_satoshis, channel_keys_id)
  },

  // Override: route force-close funds to BDK
  get_destination_script(_channel_keys_id) {
    const script = getScriptFromBdkWallet()
    if (script) return Result_CVec_u8ZNoneZ.constructor_ok(script)
    return defaultProvider.get_destination_script(_channel_keys_id)
  },

  // Override: route cooperative-close funds to BDK
  get_shutdown_scriptpubkey() {
    const script = getScriptFromBdkWallet()
    if (script) {
      // CRITICAL: Validate P2WPKH format before constructing ShutdownScript
      if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) {
        return Result_ShutdownScriptNoneZ.constructor_ok(
          ShutdownScript.constructor_new_p2wpkh(script.slice(2))
        )
      }
      // Fall back to KeysManager if format unexpected (e.g., P2TR)
    }
    return defaultProvider.get_shutdown_scriptpubkey()
  },
}
```

Key implementation details:

- BDK wallet reference is set lazily via `setBdkWallet()` since BDK initializes after LDK
- Falls back to KeysManager defaults when BDK wallet isn't available yet
- Must persist BDK changeset after `next_unused_address()` so the address is tracked after restart
- Must pass custom provider to `deserializeMonitors()` too, not just ChannelManager

## Critical Pitfalls

### 1. P2WPKH format must be validated

`ShutdownScript.constructor_new_p2wpkh` expects exactly 20 bytes. If BDK returns a P2TR address (34 bytes), slicing without validation produces a malformed script → **permanent fund loss**.

### 2. `generate_channel_keys_id` cannot delegate through default provider

The LDK WASM bindings have an asymmetry: `decodeUint128` reads full 128-bit values but `encodeUint128` rejects values >= 2^124. When `create_channel` calls `generate_channel_keys_id`, the `user_channel_id` parameter gets decoded to a BigInt that may exceed the encode limit. Delegating to `defaultProvider.generate_channel_keys_id()` re-encodes it, causing "U128s cannot exceed 128 bits". Fix: generate random 32 bytes directly.

### 3. `deserializeMonitors` must use the custom provider

Channel monitors carry signer instances from deserialization. If deserialized with `keysManager.as_SignerProvider()` instead of the custom provider, force-close claim transactions use KeysManager addresses that BDK doesn't track.

## Prevention

- Always validate script format before constructing LDK script types
- When wrapping LDK trait implementations, avoid re-encoding parameters that passed through decode — the WASM bindings may have encode/decode asymmetries
- Test with cooperative close, force close, and channel monitor restoration paths
