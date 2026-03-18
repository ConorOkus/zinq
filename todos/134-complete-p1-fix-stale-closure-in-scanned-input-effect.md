---
status: pending
priority: p1
issue_id: 134
tags: [code-review, react, stale-closure, send-flow]
dependencies: []
---

# Fix Stale Closure in Scanned-Input Effect

## Problem Statement

In `src/pages/Send.tsx` lines 127-157, the scanned-input consumption effect uses `setTimeout(() => void processRecipientInput(raw), 0)` to defer processing after `setAmountDigits`. However, `processRecipientInput` is a `useCallback` that closes over `amountSats` (derived from `amountDigits`). The `setTimeout` fires in the same render cycle, so `processRecipientInput` sees the stale `amountSats = 0n`.

This works today **by accident** because the embedded-amount code paths in `processRecipientInput` use `parsed.amountSats` / `parsed.amountMsat` (from the parsed input) rather than the closure variable `amountSats`. If anyone modifies `processRecipientInput` to use `amountSats` earlier in the flow, it will silently break.

## Findings

- **TypeScript Reviewer**: Flagged as BLOCKING — `processRecipientInput` sees stale `amountSats = 0n` from initial render
- **Architecture Reviewer**: Confirmed it works by accident, not by design — fragile against future changes
- **Simplicity Reviewer**: The `setAmountDigits` calls for fixed-amount inputs are unnecessary since `processRecipientInput` derives amounts from the parsed input directly. Remove the setTimeout hack entirely.

## Proposed Solutions

### Option A: Simplify — Remove setTimeout and redundant setAmountDigits (Recommended)
For scanned inputs with embedded amounts, call `processRecipientInput(raw)` directly without pre-filling `amountDigits`. The function already extracts amounts from the parsed input.

```typescript
useEffect(() => {
  const state = location.state as Record<string, unknown> | null
  const raw = typeof state?.scannedInput === 'string' ? state.scannedInput : null
  if (!raw) return

  void navigate('/send', { replace: true, state: null })
  const parsed = classifyPaymentInput(raw)
  if (parsed.type === 'error') return

  const hasAmount =
    (parsed.type === 'onchain' && parsed.amountSats !== null) ||
    ((parsed.type === 'bolt11' || parsed.type === 'bolt12') && parsed.amountMsat !== null)

  if (hasAmount) {
    setInputValue(raw)
    void processRecipientInput(raw)
  } else {
    setScannedInput(raw)
  }
}, []) // eslint-disable-line react-hooks/exhaustive-deps
```

- **Pros**: Removes ~15 lines, eliminates stale closure risk entirely, no setTimeout hack
- **Cons**: None identified — processRecipientInput already handles embedded amounts correctly
- **Effort**: Small
- **Risk**: Low

### Option B: Two-effect pattern with state flag
Set a `pendingProcess` state flag, then a second effect watches it with proper deps.

- **Pros**: Guaranteed fresh closure values
- **Cons**: More complex, adds another effect and state variable
- **Effort**: Medium
- **Risk**: Low

## Technical Details

- **Affected files**: `src/pages/Send.tsx` lines 127-157
- **Components**: Send page scanned-input consumption effect

## Acceptance Criteria

- [ ] No `setTimeout` hack in the scanned-input effect
- [ ] Scanned BIP 321 URI with `?amount=` navigates to review step with correct amount
- [ ] Scanned BOLT 11 with embedded amount navigates to Lightning review with correct amount
- [ ] Scanned plain address starts at amount step
- [ ] Existing Send tests continue to pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-18 | Created from PR #33 code review | Multiple reviewers flagged the setTimeout as fragile |

## Resources

- PR: #33
- File: `src/pages/Send.tsx:127-157`
