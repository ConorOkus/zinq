---
title: 'LDK WASM get_node_id() returns Uint8Array directly — .write() is not needed'
category: integration-issues
severity: moderate
date: 2026-03-15
tags:
  - ldk
  - wasm
  - type-safety
  - channel-details
  - peer-management
module: src/pages/Peers, src/ldk/context
symptoms:
  - 'TypeError: ch.get_counterparty().get_node_id().write is not a function'
  - 'Peers page crashes when channels exist'
  - 'forgetPeer safety guard silently fails — peers with channels can be forgotten'
  - 'Pubkey hex comparison never matches (framing bytes prepended by .write())'
---

# LDK WASM: get_node_id() Returns Uint8Array Directly

## Problem

Two related bugs manifested when channels were first opened:

1. **Peers.tsx crash**: `ch.get_counterparty().get_node_id().write()` throws `TypeError: write is not a function` because `get_node_id()` returns a plain `Uint8Array`, not an LDK wrapper type with a `.write()` method.

2. **forgetPeer silent failure**: The same `.write()` call in `context.tsx` didn't crash (due to `as Uint8Array` cast) but produced incorrect hex (with serialization framing bytes), meaning the pubkey comparison `counterparty === pubkey` always returned `false`. This silently disabled the safety guard that prevents forgetting peers with open channels.

Both bugs were latent — they only surfaced when `list_channels()` returned non-empty results for the first time.

## Root Cause

LDK WASM bindings have two patterns for returning byte data:

1. **Wrapper types** (e.g., `ChannelId`, `PaymentHash`): Return LDK wrapper objects that have a `.write()` method for serialization to `Uint8Array`. The `.write()` call may prepend framing/length bytes.

2. **Direct `Uint8Array`**: Simple byte fields like public keys (`get_node_id()`, `get_counterparty_node_id()`) return `Uint8Array` directly. No `.write()` needed.

The original code assumed all byte-returning methods needed `.write()`, likely by analogy with `ChannelId`. The TypeScript types (`*.d.mts`) clearly show:

```typescript
// ChannelCounterparty — returns Uint8Array directly
get_node_id(): Uint8Array;

// PeerDetails — returns Uint8Array directly
get_counterparty_node_id(): Uint8Array;

// ChannelId — returns a wrapper, needs .write() for bytes
get_channel_id(): ChannelId;  // ChannelId.write() → Uint8Array
```

## Solution

Remove `.write()` when the return type is already `Uint8Array`:

```typescript
// Before (broken)
bytesToHex(ch.get_counterparty().get_node_id().write() as Uint8Array)

// After (correct)
bytesToHex(ch.get_counterparty().get_node_id())
```

## Prevention Strategies

### Check the .d.mts type definitions

Before calling `.write()` on any LDK return value, check the TypeScript declaration in `node_modules/lightningdevkit/structs/*.d.mts`. If the return type is already `Uint8Array`, `.write()` is unnecessary and likely wrong.

### Remove eslint-disable comments as a code smell

The original code had `// eslint-disable-next-line @typescript-eslint/no-unsafe-call` to suppress the type error from calling `.write()` on a `Uint8Array`. The eslint warning was correctly identifying the bug — suppressing it hid the problem.

### Test with non-empty channel lists

Channel-related code paths should be tested with at least one channel present. Many LDK integration bugs are latent until `list_channels()` returns non-empty results.

## Related Documentation

- [LDK WASM Foundation Layer Patterns](./ldk-wasm-foundation-layer-patterns.md) — Documents LDK Result types and instanceof narrowing
- PR: [#16](https://github.com/ConorOkus/browser-wallet/pull/16)
