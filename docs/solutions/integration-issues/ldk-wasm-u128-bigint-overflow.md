---
title: 'LDK WASM rejects 128-bit BigInt for u128 parameters'
category: integration-issues
severity: moderate
date: 2026-03-15
tags:
  - ldk
  - wasm
  - bigint
  - u128
  - channel-creation
module: src/ldk/context
symptoms:
  - 'Error: U128s cannot exceed 128 bits'
  - 'create_channel() fails immediately after being called'
  - 'Channel open fails on confirm'
---

# LDK WASM Rejects Full 128-bit BigInt for u128 Parameters

## Problem

Generating a `userChannelId` from 16 random bytes (`crypto.getRandomValues(new Uint8Array(16))`) and converting to BigInt via bit-shifting produced values that LDK's WASM binding rejected with "U128s cannot exceed 128 bits."

## Root Cause

The LDK WASM binding's BigInt-to-u128 conversion has a boundary check that rejects values at exactly the 128-bit boundary. When 16 random bytes are reduced via `(acc << 8n) | BigInt(byte)`, the resulting BigInt can equal `2^128 - 1`, which the binding considers "exceeding 128 bits" — likely due to how JavaScript BigInt bit-length is computed versus the Rust u128 maximum.

## Solution

Use fewer random bytes (8 instead of 16) to stay safely within the u128 range. 64 bits of randomness provides more than sufficient collision resistance for channel IDs:

```typescript
const bytes = new Uint8Array(8) // 64 bits — safely within u128
crypto.getRandomValues(bytes)
const userChannelId = bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n)
```

## Prevention Strategies

When passing BigInt values to WASM bindings that expect fixed-width integers (u64, u128), use fewer bytes than the maximum to avoid boundary issues. For a u128 parameter, 8 bytes (64 bits) is pragmatically sufficient and avoids any conversion edge cases.

## Related Documentation

- PR: [#16](https://github.com/ConorOkus/browser-wallet/pull/16)
