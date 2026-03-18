---
status: pending
priority: p2
issue_id: 135
tags: [code-review, react, send-flow]
dependencies: [134]
---

# Clear scannedInput State After Use

## Problem Statement

In `src/pages/Send.tsx`, the `scannedInput` state is set when a QR code without an amount is scanned, but it is never cleared after `processRecipientInput` consumes it in `handleAmountNext`. If `processRecipientInput` fails (e.g., sets `inputError`), the stale `scannedInput` persists and will be re-used on every subsequent "Next" press.

## Findings

- **TypeScript Reviewer**: Flagged as medium severity — `scannedInput` persists for component lifetime

## Proposed Solutions

Clear `scannedInput` before calling `processRecipientInput` in `handleAmountNext`:

```typescript
if (scannedInput) {
  const input = scannedInput
  setScannedInput(null)
  void processRecipientInput(input)
  return
}
```

- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] `scannedInput` is cleared after `handleAmountNext` consumes it
- [ ] If `processRecipientInput` fails, user can manually enter a recipient

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-18 | Created from PR #33 code review | — |

## Resources

- PR: #33
- File: `src/pages/Send.tsx` — `handleAmountNext` callback
