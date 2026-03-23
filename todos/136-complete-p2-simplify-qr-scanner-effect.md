---
status: complete
priority: p2
issue_id: '136'
tags: [code-review, quality, simplicity]
---

# Simplify QR scanner useEffect by delegating to processRecipientInput

## Problem Statement

The QR scanner `useEffect` (lines 131-157) manually classifies the input, checks for embedded amounts, and routes to either `processRecipientInput` or direct step set. This duplicates routing logic that `processRecipientInput` already handles. Additionally, the effect captures a stale closure of `processRecipientInput` on mount, which can silently fail if `onchain.status` is still `'loading'`.

## Findings

- Flagged by Simplicity reviewer (highest impact simplification), Security reviewer (LOW-2), Architecture reviewer (Issue 4)
- The `hasAmount` check in the effect duplicates the same check inside `processRecipientInput`
- Stale closure risk: `onchain.status` may be `'loading'` when effect fires, causing `processRecipientInput` to silently return

## Proposed Solutions

**Option A: Store scanned input in state, process when ready (Recommended)**

```typescript
const [pendingQrInput, setPendingQrInput] = useState<string | null>(null)

// Consume location.state on mount
useEffect(() => {
  const state = location.state as Record<string, unknown> | null
  const raw = typeof state?.scannedInput === 'string' ? state.scannedInput : null
  if (!raw || raw.length > 2000) return
  void navigate('/send', { replace: true, state: null })
  setPendingQrInput(raw)
}, [])

// Process when wallet is ready
useEffect(() => {
  if (!pendingQrInput || onchain.status !== 'ready') return
  const raw = pendingQrInput
  setPendingQrInput(null)
  setInputValue(raw)
  void processRecipientInput(raw, 'recipient')
}, [pendingQrInput, onchain.status, processRecipientInput])
```

- Pros: Eliminates duplicated routing, fixes stale closure, adds length guard
- Cons: Two effects instead of one
- Effort: Small
- Risk: Low

**Option B: Simple delegation with eslint-disable**

Just call `processRecipientInput(raw, 'recipient')` and accept the stale closure. Works for signet where loading is fast.

- Pros: Minimal change
- Cons: Stale closure remains, routing duplication remains
- Effort: Trivial
- Risk: Low (on signet)

## Acceptance Criteria

- [ ] QR scanner effect delegates to `processRecipientInput` (no duplicated routing)
- [ ] QR input processed only after wallet is ready
- [ ] Length guard on scanned input (max 2000 chars)
- [ ] Invalid scanned input shows error to user (not silently swallowed)
- [ ] All tests pass
