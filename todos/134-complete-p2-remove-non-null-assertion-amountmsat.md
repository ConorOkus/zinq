---
status: complete
priority: p2
issue_id: "134"
tags: [code-review, typescript, security]
---

# Remove non-null assertion on parsed.amountMsat

## Problem Statement

`Send.tsx:289` uses `parsed.amountMsat!` with a non-null assertion. The `hasEmbeddedAmount` boolean guard ensures it's non-null at runtime, but TypeScript's narrowing doesn't carry through the intermediate boolean. If the `ParsedPaymentInput` union is ever modified, this could produce a runtime TypeError that crashes the send screen.

## Findings

- Flagged by TypeScript reviewer (CRITICAL), Security reviewer (MEDIUM-1), Simplicity reviewer
- `src/pages/Send.tsx` line 289: `parsed.amountMsat!`
- The `!` assertion sidesteps TypeScript's type narrowing system

## Proposed Solutions

**Option A: Restructure with inline type narrowing (Recommended)**

Replace the boolean + assertion pattern with direct narrowing:

```typescript
if (parsed.type !== 'bip353' && parsed.amountMsat !== null) {
  if (parsed.amountMsat > lnCapacityMsat) { ... }
  setSendStep({ step: 'ln-review', parsed, amountMsat: parsed.amountMsat, fromStep })
  return
}
// No amount path follows...
```

- Pros: Eliminates the `!`, self-documenting branching
- Cons: Minor restructuring of the lightning section
- Effort: Small
- Risk: Low

## Acceptance Criteria

- [ ] No `!` non-null assertions in `processRecipientInput`
- [ ] TypeScript compiles without errors
- [ ] All existing tests pass
