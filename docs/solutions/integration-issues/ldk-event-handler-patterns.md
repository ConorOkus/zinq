---
title: "LDK EventHandler — Sync/Async Bridging and Fund-Safety Patterns"
category: integration-issues
date: 2026-03-12
tags: [ldk, event-handler, lightning, typescript, fund-safety, indexeddb, wasm]
modules: [src/ldk/traits/event-handler, src/ldk/context, src/ldk/init]
---

# LDK EventHandler — Sync/Async Bridging and Fund-Safety Patterns

## Problem

LDK's `EventHandler.handle_event()` is synchronous (returns `Result_NoneReplayEventZ`), but many event responses require async operations (IDB writes, network calls). Returning `ok()` tells LDK the event is consumed forever — if the async work fails or the browser crashes, that event is lost. For fund-safety events like `SpendableOutputs` and `PaymentClaimable`, this means potential fund loss.

## Root Cause

The WASM-to-JS bridge enforces synchronous trait methods. IndexedDB and network APIs are inherently async. There is no way to "await" inside `handle_event`.

## Solution

Categorize events by their async requirements and handle each appropriately:

### Sync-safe events (call LDK methods inline)
```typescript
// PaymentClaimable — claim_funds() is a sync WASM call
if (event instanceof Event_PaymentClaimable) {
  const preimage = event.purpose.preimage()
  if (preimage instanceof Option_ThirtyTwoBytesZ_Some) {
    channelManager.claim_funds(preimage.some)
  }
  return Result_NoneReplayEventZ.constructor_ok()
}

// PendingHTLCsForwardable — schedule with delay, track timer for cleanup
if (event instanceof Event_PendingHTLCsForwardable) {
  const delayMs = Math.min(Number(event.time_forwardable) * 1000, 10_000)
  if (forwardTimerId !== null) clearTimeout(forwardTimerId) // deduplicate
  forwardTimerId = setTimeout(() => {
    channelManager.process_pending_htlc_forwards()
  }, delayMs)
  return Result_NoneReplayEventZ.constructor_ok()
}
```

### Async events (fire-and-forget with IDB persistence)
```typescript
// SpendableOutputs — persist descriptors to IDB for future sweep
// Note: IDB write is async but handle_event is sync. If the browser
// crashes before the write commits, descriptors may be lost. Risk
// window is small (IDB writes ~<10ms) but not zero.
if (event instanceof Event_SpendableOutputs) {
  const key = crypto.randomUUID()
  const serialized = event.outputs.map((o) => o.write())
  void idbPut('ldk_spendable_outputs', key, serialized).catch(...)
  return Result_NoneReplayEventZ.constructor_ok()
}
```

### Deferred events (no implementation yet, log and acknowledge)
```typescript
// FundingGenerationReady, BumpTransaction — need wallet/UTXO layer
if (event instanceof Event_FundingGenerationReady) {
  console.warn('[LDK Event] FundingGenerationReady: no wallet layer')
  return Result_NoneReplayEventZ.constructor_ok()
}
```

### Background loop integration
```typescript
// Process events on the 10s peer timer tick
peerTimerId = setInterval(() => {
  node.peerManager.timer_tick_occurred()
  node.peerManager.process_events()
  // Drain events: ChannelManager first, then ChainMonitor
  node.channelManager.as_EventsProvider()
    .process_pending_events(node.eventHandler)
  node.chainMonitor.as_EventsProvider()
    .process_pending_events(node.eventHandler)
  // Flush CM state immediately after events (fund safety)
  if (node.channelManager.get_and_clear_needs_persistence()) {
    void idbPut('ldk_channel_manager', 'primary', node.channelManager.write())
  }
}, 10_000)
```

## Key Gotchas

1. **Always wrap `handleEvent` in try/catch** — an uncaught error in one event handler aborts the entire `process_pending_events` batch, losing remaining events.

2. **`get_and_clear_needs_persistence()` clears the flag regardless of IDB write success** — if the write fails, the dirty state is never retried. Accept this risk or maintain a local dirty flag.

3. **`PendingHTLCsForwardable` timers must be tracked and deduped** — multiple events in one drain cycle create orphaned timers. Clear previous timer before scheduling new one. Expose `cleanup()` for React unmount.

4. **Don't plumb dependencies you can't use yet** — `ConnectionNeeded` provides `SocketAddress` objects but the WASM bindings don't easily expose subclass types for parsing. Log and defer rather than passing empty host/port that always fails (YAGNI).

5. **`OpenChannelRequest` without explicit accept/reject will timeout** — LDK does not auto-reject. If you log "auto-rejecting" make sure you actually call the reject API, or be honest that it times out.

6. **Use `crypto.randomUUID()` for IDB keys** — `Math.random()` is not cryptographically secure and can collide under batch processing. `crypto.randomUUID()` is available in all modern browsers.

7. **Flush ChannelManager to IDB immediately after event processing** — don't wait for the 30s sync tick. A `claim_funds()` call modifies CM state; if the browser closes before persistence, the claim is lost on restart.

## Prevention

- Test every event handler branch (including error/no-preimage paths)
- Use `afterEach(() => cleanup())` in tests to clear pending timers
- Document sync/async bridge limitations in code comments for fund-safety paths
- When deferring event handling (no wallet layer), use `console.warn` not `console.log` to distinguish from handled events

## Related

- `docs/solutions/integration-issues/ldk-wasm-foundation-layer-patterns.md` — Persist trait InProgress pattern
- `docs/solutions/infrastructure/websocket-tcp-proxy-cloudflare-workers.md` — WritableStream writer pattern
- `docs/plans/2026-03-12-003-feat-ldk-event-handling-background-tasks-plan.md`
- [LDK Event handling docs](https://lightningdevkit.org/introduction/handling-events/)
