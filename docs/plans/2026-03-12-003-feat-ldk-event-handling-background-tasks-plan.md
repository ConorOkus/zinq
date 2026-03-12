---
title: 'feat: LDK event handling and background task management'
type: feat
status: active
date: 2026-03-12
---

# feat: LDK Event Handling and Background Task Management

## Overview

Implement the LDK `EventHandler` trait to process events from both `ChannelManager` and `ChainMonitor`, and integrate event processing into the existing background task loop. This is the critical missing piece — without it, payments cannot be received, channels cannot complete opening, and spendable outputs from closed channels are never swept.

## Problem Statement

The wallet initializes all core LDK components (ChannelManager, ChainMonitor, PeerManager) but **never drains events** from the `EventsProvider` interface. Neither `channelManager.as_EventsProvider().process_pending_events(handler)` nor `chainMonitor.as_EventsProvider().process_pending_events(handler)` is called anywhere. This means:

- Incoming payments are never claimed (`PaymentClaimable` ignored)
- HTLC forwarding never happens (`PendingHTLCsForwardable` ignored)
- Channel opens never complete (`FundingGenerationReady` ignored)
- Closed channel funds are never swept (`SpendableOutputs` ignored)

## Proposed Solution

1. Create an `EventHandler` trait implementation in `src/ldk/traits/event-handler.ts` following the established factory pattern
2. Handle all core LDK events — synchronous operations inline, async work via fire-and-forget with IDB persistence for fund-safety-critical data
3. Process events on the existing 10s peer timer tick, with an immediate ChannelManager persistence flush after each cycle
4. Persist `SpendableOutputDescriptor` data to IDB to survive browser restarts

### Scope Decisions

**In scope (this PR):**
- EventHandler trait implementation with handlers for all event variants
- Payment events: `PaymentClaimable` → `claim_funds()`, `PaymentClaimed`, `PaymentSent`, `PaymentFailed`
- HTLC forwarding: `PendingHTLCsForwardable` → `process_pending_htlc_forwards()` with `time_forwardable` delay
- Channel lifecycle: `ChannelPending`, `ChannelReady`, `ChannelClosed` (log + state tracking)
- Peer reconnection: `ConnectionNeeded` → `connectToPeer()` via WebSocket proxy
- SpendableOutputs persistence to IDB (descriptors saved, sweep deferred)
- Event processing integrated into background loop with concurrency guard
- Immediate ChannelManager persistence flush after event processing

**Out of scope (deferred — no wallet/UTXO layer exists):**
- `FundingGenerationReady` → log warning, return `ok()` (needs coin selection + tx construction)
- `FundingTxBroadcastSafe` → log, return `ok()`
- `SpendableOutputs` sweep execution (descriptors persisted but not swept until wallet layer exists)
- `BumpTransaction` → log warning, return `ok()` (needs CPFP/RBF tx construction)
- `OpenChannelRequest` → auto-reject all inbound channels (safest default)
- BOLT12: `InvoiceReceived` → log, return `ok()`

## Technical Approach

### Architecture

```
┌──────────────────── 10s peer timer tick ────────────────────┐
│                                                              │
│  1. peerManager.timer_tick_occurred()                        │
│  2. peerManager.process_events()                             │
│  3. if (!isProcessingEvents) {                               │
│       isProcessingEvents = true                              │
│       channelManager.as_EventsProvider()                     │
│         .process_pending_events(eventHandler)                │
│       chainMonitor.as_EventsProvider()                       │
│         .process_pending_events(eventHandler)                │
│       flush ChannelManager to IDB if needs_persistence       │
│       isProcessingEvents = false                             │
│     }                                                        │
└──────────────────────────────────────────────────────────────┘
```

### Sync/Async Bridging Strategy

`handle_event` is synchronous. The approach per event type:

| Event | Operations | Strategy |
|---|---|---|
| `PaymentClaimable` | `claim_funds()` (sync WASM call) | Inline sync — call and return `ok()` |
| `PendingHTLCsForwardable` | `process_pending_htlc_forwards()` (sync) | Schedule via `setTimeout(fn, time_forwardable)`, return `ok()` |
| `PaymentClaimed/Sent/Failed` | State update + log | Inline sync — update in-memory state, return `ok()` |
| `ChannelPending/Ready/Closed` | State update + log | Inline sync, return `ok()` |
| `ConnectionNeeded` | `connectToPeer()` (async WebSocket) | Fire-and-forget `void connectToPeer(...)`, return `ok()` |
| `SpendableOutputs` | Persist descriptors to IDB (async) | Fire-and-forget IDB write, return `ok()`. Descriptors saved for future sweep. |
| `FundingGenerationReady` | Needs wallet layer | Log warning, return `ok()` |
| `BumpTransaction` | Needs wallet layer | Log warning, return `ok()` |
| `OpenChannelRequest` | Policy decision | Auto-reject, return `ok()` |
| All others | Log | Log at appropriate level, return `ok()` |

**Fund safety for SpendableOutputs:** Descriptors are persisted to a new `ldk_spendable_outputs` IDB store. Even if the browser closes before sweep, descriptors survive for retry on next startup. This is the same pattern as the Persist trait's `InProgress` approach (see `docs/solutions/integration-issues/ldk-wasm-foundation-layer-patterns.md`).

**Persistence flush after events:** After each `process_pending_events` cycle, check `channelManager.get_and_clear_needs_persistence()` and flush to IDB immediately. This prevents a 30s window where a `claim_funds()` call could be lost if the browser closes.

### Implementation Phases

#### Phase 1: EventHandler Trait + Core Payment Events

**Files to create:**
- `src/ldk/traits/event-handler.ts` — EventHandler factory

**Files to modify:**
- `src/ldk/init.ts` — Create EventHandler, add to `LdkNode` interface
- `src/ldk/storage/idb.ts` — Add `ldk_spendable_outputs` store

**`src/ldk/traits/event-handler.ts` — core structure:**

```typescript
// src/ldk/traits/event-handler.ts
import {
  EventHandler,
  Event_PaymentClaimable,
  Event_PaymentClaimed,
  Event_PaymentSent,
  Event_PaymentFailed,
  Event_PendingHTLCsForwardable,
  Event_SpendableOutputs,
  Event_ChannelPending,
  Event_ChannelReady,
  Event_ChannelClosed,
  Event_FundingGenerationReady,
  Event_OpenChannelRequest,
  Event_ConnectionNeeded,
  Event_BumpTransaction,
  Result_NoneReplayEventZ,
  type ChannelManager,
} from 'lightningdevkit'

interface EventHandlerDeps {
  channelManager: ChannelManager
  connectToPeer: (pubkey: string, host: string, port: number) => Promise<void>
  persistSpendableOutputs: (descriptors: Uint8Array[]) => Promise<void>
}

export function createEventHandler(deps: EventHandlerDeps) {
  const handler = EventHandler.new_impl({
    handle_event(event): Result_NoneReplayEventZ {
      if (event instanceof Event_PaymentClaimable) {
        // claim_funds is a sync WASM call
        deps.channelManager.claim_funds(event.payment_preimage)
        console.log('[LDK Event] PaymentClaimable: claiming', event.payment_hash)
        return Result_NoneReplayEventZ.constructor_ok()
      }

      if (event instanceof Event_PendingHTLCsForwardable) {
        const delayMs = Math.min(Number(event.time_forwardable) * 1000, 10_000)
        setTimeout(() => {
          deps.channelManager.process_pending_htlc_forwards()
        }, delayMs)
        return Result_NoneReplayEventZ.constructor_ok()
      }

      if (event instanceof Event_SpendableOutputs) {
        // Persist descriptors to IDB for future sweep
        void deps.persistSpendableOutputs(/* serialized descriptors */)
        console.log('[LDK Event] SpendableOutputs: persisted for future sweep')
        return Result_NoneReplayEventZ.constructor_ok()
      }

      if (event instanceof Event_ConnectionNeeded) {
        // Reconnect via WebSocket proxy
        // Extract address from event and call connectToPeer
        return Result_NoneReplayEventZ.constructor_ok()
      }

      if (event instanceof Event_FundingGenerationReady) {
        console.warn('[LDK Event] FundingGenerationReady: no wallet layer — cannot fund channel')
        return Result_NoneReplayEventZ.constructor_ok()
      }

      if (event instanceof Event_OpenChannelRequest) {
        // Auto-reject inbound channels (no acceptance policy yet)
        return Result_NoneReplayEventZ.constructor_ok()
      }

      // PaymentClaimed, PaymentSent, PaymentFailed, ChannelPending,
      // ChannelReady, ChannelClosed, BumpTransaction, and all others:
      // log and acknowledge
      console.log('[LDK Event]', event.constructor.name)
      return Result_NoneReplayEventZ.constructor_ok()
    },
  })

  return { handler }
}
```

#### Phase 2: Background Task Integration

**Files to modify:**
- `src/ldk/context.tsx` — Add event processing to peer timer, add concurrency guard, flush persistence after events
- `src/ldk/config.ts` — Add `eventProcessIntervalMs` if needed

**Integration into peer timer in `context.tsx`:**

```typescript
let isProcessingEvents = false

const peerTimer = setInterval(() => {
  node.peerManager.timer_tick_occurred()
  node.peerManager.process_events()

  // Drain LDK events
  if (!isProcessingEvents) {
    isProcessingEvents = true
    try {
      node.channelManager.as_EventsProvider()
        .process_pending_events(node.eventHandler)
      node.chainMonitor.as_EventsProvider()
        .process_pending_events(node.eventHandler)

      // Flush ChannelManager state immediately after processing events
      if (node.channelManager.get_and_clear_needs_persistence()) {
        void persistChannelManager(node.channelManager)
      }
    } finally {
      isProcessingEvents = false
    }
  }
}, SIGNET_CONFIG.peerTimerIntervalMs)
```

#### Phase 3: Tests

**Files to create:**
- `src/ldk/traits/event-handler.test.ts` — Unit tests for event handler

**Test cases:**

```
EventHandler:
  PaymentClaimable → calls claim_funds with correct preimage
  PendingHTLCsForwardable → schedules process_pending_htlc_forwards with delay
  SpendableOutputs → persists descriptors to IDB
  ConnectionNeeded → calls connectToPeer with correct address
  FundingGenerationReady → logs warning, returns ok
  OpenChannelRequest → returns ok (auto-reject)
  PaymentClaimed → logs, returns ok
  PaymentSent → logs, returns ok
  PaymentFailed → logs, returns ok
  ChannelPending → logs, returns ok
  ChannelReady → logs, returns ok
  ChannelClosed → logs with reason, returns ok
  Unknown event → logs, returns ok (never silently swallows)
```

## System-Wide Impact

### Interaction Graph

```
10s timer tick
  → peerManager.timer_tick_occurred() + process_events()
  → channelManager.as_EventsProvider().process_pending_events(handler)
    → handle_event(PaymentClaimable) → channelManager.claim_funds()
    → handle_event(PendingHTLCsForwardable) → setTimeout → process_pending_htlc_forwards()
    → handle_event(SpendableOutputs) → IDB write (fire-and-forget)
    → handle_event(ConnectionNeeded) → connectToPeer() (fire-and-forget)
  → chainMonitor.as_EventsProvider().process_pending_events(handler)
    → handle_event(SpendableOutputs) → IDB write
  → channelManager.get_and_clear_needs_persistence() → IDB flush
```

### Error Propagation

| Error | Impact | Handling |
|---|---|---|
| `claim_funds()` throws | Payment not claimed; LDK replays on restart if CM not persisted | Log error, return `ok()` — CM flush will persist the claim attempt |
| IDB write for SpendableOutputs fails | Descriptors lost if browser closes | Log error; descriptors may be re-emitted if CM state is not persisted |
| `connectToPeer()` fails | Peer not reconnected | Fire-and-forget; LDK will re-emit `ConnectionNeeded` |
| Event handler throws | Current event lost, remaining events in batch skipped | Wrap handler in try/catch; log and return `ok()` to prevent batch abort |

### State Lifecycle Risks

- **PaymentClaimable → browser closes before CM flush**: `claim_funds()` modifies CM state in memory. If browser closes before IDB flush, LDK replays `PaymentClaimable` on restart (CM state was not persisted after claim). This is safe — `claim_funds()` is idempotent.
- **SpendableOutputs → browser closes before IDB write**: Descriptors lost. Mitigation: the IDB write is the first thing the handler does, before returning `ok()`. The write is async but starts immediately.
- **Concurrent event processing**: The `isProcessingEvents` boolean guard prevents overlapping cycles from multiple timers.

## Acceptance Criteria

### Functional Requirements

- [ ] `EventHandler` trait implemented following factory pattern in `src/ldk/traits/event-handler.ts`
- [ ] `PaymentClaimable` calls `claim_funds()` with correct preimage
- [ ] `PendingHTLCsForwardable` schedules `process_pending_htlc_forwards()` with `time_forwardable` delay (clamped to 10s max)
- [ ] `SpendableOutputs` persists descriptors to `ldk_spendable_outputs` IDB store
- [ ] `ConnectionNeeded` calls `connectToPeer()` via WebSocket proxy
- [ ] `FundingGenerationReady` and `BumpTransaction` log warnings (deferred — no wallet layer)
- [ ] `OpenChannelRequest` auto-rejected
- [ ] All other events logged and acknowledged with `Result_NoneReplayEventZ.constructor_ok()`
- [ ] Events processed every 10s (peer timer tick)
- [ ] ChannelManager drained before ChainMonitor
- [ ] ChannelManager persisted to IDB immediately after event processing if `needs_persistence`
- [ ] Concurrency guard prevents overlapping `process_pending_events` calls
- [ ] `ldk_spendable_outputs` IDB store added

### Non-Functional Requirements

- [ ] No fund-safety regressions — `claim_funds()` and SpendableOutputs persistence are correct
- [ ] Event handler never throws — all branches wrapped in try/catch
- [ ] Cleanup on unmount — no dangling timers or references

### Quality Gates

- [ ] Unit tests for all event handler branches
- [ ] Existing wallet tests still pass (44 tests)
- [ ] Lint and typecheck clean
- [ ] Manual test: connect to peer, verify event processing logs appear every 10s

## Dependencies & Risks

### Dependencies

- Peer connectivity merged (PR #4) — needed for `ConnectionNeeded` handling
- `lightningdevkit@0.1.8-0` Event types available in the NPM package

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `claim_funds()` + browser close before persistence | Low | High (payment loss) | Immediate CM flush after event processing |
| SpendableOutputs IDB write fails silently | Low | High (fund loss) | Log error prominently; retry on next startup |
| `PendingHTLCsForwardable` timer fires after component unmount | Medium | Low (no-op) | Check if cancelled before calling `process_pending_htlc_forwards` |
| LDK adds new event variants in future versions | Certain | Low | Default branch logs unknown events rather than silently swallowing |

## Sources & References

### Internal References

- Event types: `node_modules/lightningdevkit/structs/Event.d.mts`
- EventHandler trait: `node_modules/lightningdevkit/structs/EventHandler.d.mts`
- Trait factory pattern: `src/ldk/traits/persist.ts` (InProgress + callback pattern)
- Background loops: `src/ldk/context.tsx:50-53` (peer timer), `src/ldk/sync/chain-sync.ts` (sync loop)
- IDB stores: `src/ldk/storage/idb.ts`
- Learnings: `docs/solutions/integration-issues/ldk-wasm-foundation-layer-patterns.md` — sync/async bridging, Result type narrowing

### External References

- [LDK Event handling docs](https://lightningdevkit.org/introduction/handling-events/)
- [LDK sample node event handling](https://github.com/lightningdevkit/ldk-sample/blob/main/src/main.rs)
