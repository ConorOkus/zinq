---
title: 'LSPS2 JIT Receive: React useEffect Dependency Race Discards In-Flight Invoice'
category: integration-issues
date: 2026-03-31
severity: HIGH
module:
  - src/pages/Receive.tsx
  - src/ldk/context.tsx
  - src/ldk/ldk-context.ts
  - src/onchain/bip321.ts
tags:
  - react
  - lsps2
  - jit-channels
  - lightning
  - useEffect
  - state-management
  - bip321
  - async-cancellation
related_issues:
  - 'PR #72: feat: integrate LSPS2 JIT receive into default request flow'
  - 'PR #71: fix: complete LSPS2 JIT receive flow and improve balance updates'
---

# LSPS2 JIT Receive: React useEffect Dependency Race Discards In-Flight Invoice

## Problem

After integrating LSPS2 JIT receive into the main `/receive` page, the JIT invoice was intermittently lost. The BIP 321 URI displayed to the user contained only the on-chain address (`bitcoin:ADDRESS?amount=X`) with no `lightning=` parameter, despite the JIT negotiation completing successfully.

The user could copy the URI and share it, but the sender would have no Lightning invoice to pay.

## Root Cause

The invoice generation `useEffect` had memoized channel state values (`totalInboundMsat`, `hasUsableChannels`) in its dependency array. Requesting a JIT invoice causes the LSP to open a 0-conf channel, which changes the node's channel state. This triggered the following race:

1. User enters amount. Effect fires, determines JIT is needed, calls `requestJitInvoice()`.
2. LSP begins opening JIT channel. Channel state changes (`channelChangeCounter` increments).
3. `totalInboundMsat` recomputes, `hasUsableChannels` flips. These deps change.
4. React re-runs the effect. The **cleanup function** executes: `stale = true`.
5. JIT promise resolves. `.then()` checks `if (stale) return` — **valid invoice is silently discarded**.
6. `invoice` state remains `null`. BIP 321 URI has no lightning parameter.

This is a circular dependency: the async operation's side effect (channel opening) changes the deps that control the async operation's lifecycle.

## Solution

### 1. Compute inbound capacity inline (remove from deps)

Move channel state reads inside the effect body so they don't appear in the dependency array:

```typescript
useEffect(() => {
  // Compute inline — reads current state without subscribing to changes
  const channels = listChannels?.() ?? []
  let inboundMsat = 0n
  for (const ch of channels) {
    if (ch.get_is_usable()) {
      inboundMsat += ch.get_inbound_capacity_msat()
    }
  }
  const hasUsable = inboundMsat > 0n || channels.some((ch) => ch.get_is_usable())
  const needsJit = amountMsat !== undefined ? inboundMsat < amountMsat : !hasUsable
  // ...
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [createInvoice, requestJitInvoice, confirmedAmountSats, peersReconnected])
```

Channel state changes no longer trigger re-runs. The effect only re-runs when the user changes the amount or peers reconnect.

### 2. Replace stale flag with requestCounterRef

The `let stale = false; return () => { stale = true }` pattern is too aggressive — any dep change discards the result. A request counter only discards results when a _newer_ request exists:

```typescript
const requestCounterRef = useRef(0)

useEffect(() => {
  const thisRequest = ++requestCounterRef.current

  requestJitInvoice(amountMsat, 'zinqq wallet').then((result) => {
    if (requestCounterRef.current !== thisRequest) return // newer request superseded this one
    setInvoice(result.bolt11)
    setPaymentHash(result.paymentHash)
    setOpeningFeeSats((result.openingFeeMsat + 999n) / 1000n)
    setReceiveState({ step: 'ready', invoicePath: 'jit' })
  })

  // Unmount cleanup: increment counter so abandoned .then() is ignored
  return () => {
    requestCounterRef.current++
  }
}, [createInvoice, requestJitInvoice, confirmedAmountSats, peersReconnected])
```

### 3. Additional fixes discovered during implementation

**Fee display rounding**: Opening fee was displayed with floor division (`msat / 1000n`), showing a lower fee than the LSP actually deducts. Fixed with ceiling division: `(msat + 999n) / 1000n`.

**Memoize needsAmount**: `listChannels()` (WASM FFI) was called on every render to compute `needsAmount`. Fixed with `useMemo` keyed on `channelChangeCounter`.

**Run-once guard**: `hasInitAmount` used `useState` causing an extra render. Changed to `useRef` since it's a "run once" guard that doesn't need to trigger re-renders.

**Dead state variant**: `jit-failed` was defined in the `ReceiveState` union but never checked in the render path. Collapsed into `ready`/`none`.

## Prevention

### When async operations modify their own effect deps

If an async operation launched from a `useEffect` can change state that's in the effect's dependency array, you have a circular dependency. Solutions:

1. **Compute volatile values inline** in the effect body instead of using memoized/derived values in deps
2. **Use a request counter** instead of a stale flag for cancellation — it only invalidates when a newer request exists, not on any dep change
3. **Add an eslint-disable comment** explaining WHY the dep is excluded

### BigInt monetary display

Always use ceiling division for user-facing fee amounts: `(msat + 999n) / 1000n`. The user should never see a fee lower than what they'll actually pay.

### Expensive computations in render path

Never call WASM FFI (like `listChannels()`) directly in the render body. Use `useMemo` with an appropriate change counter, or compute inside effects.

### Run-once guards

Use `useRef(false)` not `useState(false)` for "run once" patterns that don't need to trigger re-renders.

## Related Documentation

- [LSPS2 JIT Channel Config](./lsps2-jit-receive-channel-config.md) — UserConfig settings required for JIT channels (PR #71)
- [BIP 321 URI + BOLT 11 Invoice Generation](./bip321-unified-uri-bolt11-invoice-generation.md) — Original createInvoice and URI construction patterns
- [Channel State UI Update Delay](../ui-bugs/channel-state-ui-update-10s-delay.md) — drainEventsAndRefresh callback pattern for immediate channel state updates
- [LDK Event Handler Patterns](./ldk-event-handler-patterns.md) — Sync/async event handling, PaymentClaimable flow
- [React Send Flow State Machine](../design-patterns/react-send-flow-amount-first-state-machine.md) — Discriminated union state machine pattern, useRef bridging
- [VSS Restore Background Persist Race](../logic-errors/vss-restore-background-persist-race.md) — Related async lifecycle race in context.tsx
