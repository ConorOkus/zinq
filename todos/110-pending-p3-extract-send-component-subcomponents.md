---
status: pending
priority: p3
issue_id: 110
tags: [code-review, architecture, send-flow]
dependencies: []
---

# Extract Send.tsx sub-components and Lightning polling hook

## Problem Statement

Send.tsx is 700+ lines — 2x the next largest page component. It mixes state machine logic, business logic (fee estimation, capacity checks), Lightning payment polling, and 8 distinct screen renderings.

## Proposed Solutions

### Option A: Extract presentational screens + polling hook

1. Extract `<SendSuccess>`, `<SendError>`, `<SendBroadcasting>`, `<SendSending>` as sibling components
2. Extract `useLightningPaymentStatus(paymentId, ldk)` custom hook for the polling logic
3. Move `msatToSat` to `src/utils/`

- **Pros**: Reduces main component to ~350 lines, enables isolated testing of polling logic
- **Cons**: More files to navigate
- **Effort**: Medium

## Acceptance Criteria

- [ ] Send.tsx under 400 lines
- [ ] Lightning polling extracted into testable custom hook
- [ ] All existing tests still pass
