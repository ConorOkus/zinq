---
status: pending
priority: p1
issue_id: 111
tags: [code-review, lightning, activity]
---

# Inbound Lightning payments not visible until restart

## Problem Statement

`Event_PaymentClaimed` in the event handler persists inbound payments to IDB via `void persistPayment(...)`, but never triggers `refreshPaymentHistory()` in the LDK context. The `onPaymentEvent` callback only fires for `PaymentSent` and `PaymentFailed` — not for inbound claims. Result: received Lightning payments are persisted but do not appear on the Activity screen until the app restarts and `loadAllPayments()` runs during init.

## Findings

- `src/ldk/traits/event-handler.ts:174` — persists inbound payment but returns without notifying context
- `src/ldk/context.tsx:399` — `refreshPaymentHistory()` only called inside `setPaymentCallback`, which only fires for sent/failed
- All 4 review agents flagged this independently

## Proposed Solutions

### Option A: Extend PaymentEventCallback with 'claimed' type
Add `| { type: 'claimed'; paymentHash: string; amountMsat: bigint }` to the callback type. Fire it from `Event_PaymentClaimed`. Context calls `refreshPaymentHistory()` on claimed events.
- Pros: Minimal change, reuses existing callback plumbing
- Cons: Slightly expands callback type
- Effort: Small

### Option B: Add separate onPaymentClaimed callback
- Pros: Clean separation of concerns
- Cons: Another callback to thread through
- Effort: Small

## Acceptance Criteria

- [ ] Receiving a Lightning payment immediately appears on the Activity screen
- [ ] No app restart needed to see inbound payments
