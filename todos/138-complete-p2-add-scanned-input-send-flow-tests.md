---
status: pending
priority: p2
issue_id: 138
tags: [code-review, testing, send-flow]
dependencies: [134]
---

# Add Tests for scannedInput Location State Path

## Problem Statement

The `scannedInput` code path in Send.tsx (consuming QR data from location.state) has no test coverage. The existing tests render `<Send />` without location state. This is the programmatic entry point that any automated system would use.

## Findings

- **Agent-Native Reviewer**: No tests for the location.state path — validates the agent-equivalent entry point

## Proposed Solutions

Add test cases to `src/pages/Send.test.tsx` using `MemoryRouter` with `initialEntries`:

1. BIP 321 URI with amount → should advance to review step
2. Plain address without amount → should start at amount step with recipient pre-filled
3. BOLT 11 invoice with amount → should advance to Lightning review
4. Invalid string → should be silently ignored, show normal amount step

- **Effort**: Medium
- **Risk**: Low

## Acceptance Criteria

- [ ] Test: BIP 321 URI with amount navigates to oc-review
- [ ] Test: Plain address starts at amount step
- [ ] Test: Amount step Next skips recipient when scannedInput is set
- [ ] Test: Invalid scannedInput is ignored

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-18 | Created from PR #33 code review | — |

## Resources

- PR: #33
- File: `src/pages/Send.test.tsx`
