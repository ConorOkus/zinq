---
title: Immediate UI update on channel state changes instead of 10s timer delay
category: ui-bugs
date: 2026-03-25
severity: moderate
tags: [ldk-events, websocket, react-state, channel-ready, ui-latency]
affected_files:
  [src/ldk/context.tsx, src/ldk/peers/peer-connection.ts, src/ldk/peers/peer-reconnect.ts]
---

# Immediate UI Update on Channel State Changes

## Problem

After a channel became ready (both sides exchanged `channel_ready`), the UI did not reflect the updated balance for up to 10 seconds. Users had to manually refresh to see the change.

## Root Cause

The WebSocket `onmessage` handler in `peer-connection.ts` already called `peerManager.read_event()` + `peerManager.process_events()` immediately when data arrived, causing LDK to internally process the `channel_ready` message and queue an `Event_ChannelReady`. However, the LDK event drain (`process_pending_events`) and balance/channel-state recomputation only ran in the 10s `setInterval` peer timer tick in `context.tsx`. So there was up to a 10s delay between the peer message arriving and the UI reflecting the state change.

## Solution

### 1. Extract `drainEventsAndRefresh()` from the 10s timer

Moved the event-drain + balance-check logic into a named function, called from both the timer and a new WebSocket callback.

### 2. Add `onMessageProcessed` callback to `connectToPeer()`

Optional callback invoked after `peerManager.process_events()` on each post-handshake WebSocket message:

```typescript
// peer-connection.ts
peerManager.process_events()
if (resolved) onMessageProcessed?.()
```

### 3. Wire via mutable ref with microtask throttling

A `drainEventsRef` bridges the WebSocket handler into the React context. Rapid messages are coalesced via `queueMicrotask` to prevent excessive recomputation from chatty peers:

```typescript
// context.tsx
let drainScheduled = false
drainEventsRef.current = () => {
  if (drainScheduled) return
  drainScheduled = true
  queueMicrotask(() => {
    drainScheduled = false
    drainEventsAndRefresh()
  })
}
```

### 4. Pass callback to all peer connection paths

The callback is passed to `connectToPeer` in three places: the user-facing wrapper, `reconnectDisconnectedPeers`, and the initial startup reconnection loop.

## Prevention

- **Polling timers are for fallback, not primary reactivity.** When you have a real-time data source (WebSocket), use callbacks to trigger immediate UI updates. Reserve timers for housekeeping (timer_tick_occurred, periodic persistence).
- **Throttle callbacks from external sources.** Any callback triggered by network messages should be coalesced to prevent CPU waste from chatty peers. `queueMicrotask` is ideal for same-tick coalescing.
- **Ref-based callback bridging** is the correct React pattern when a non-React handler (WebSocket) needs to trigger React state updates without stale closures or causing effect re-runs.

## Related Documentation

- [LDK Event Handler Patterns](../integration-issues/ldk-event-handler-patterns.md) — Established event processing loop and persistence timing
- [WebSocket Message Relay Blocked After Noise Handshake](../logic-errors/websocket-onmessage-blocked-after-noise-handshake.md) — Past WebSocket handler bug in peer-connection.ts
