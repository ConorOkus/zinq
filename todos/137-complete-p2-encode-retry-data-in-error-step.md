---
status: complete
priority: p2
issue_id: '137'
tags: [code-review, architecture]
---

# Encode retry data in error step instead of lastReviewStepRef

## Problem Statement

`lastReviewStepRef` stores the review step as mutable shadow state outside the state machine. This creates two sources of truth and an implicit coupling: correctness depends on the ref being set at exactly the right time. The same applies to `amountStepDataRef`. Both refs should be folded into the state machine proper.

## Findings

- Flagged by TypeScript reviewer, Simplicity reviewer, Architecture reviewer
- `src/pages/Send.tsx` line 116: `lastReviewStepRef`
- `src/pages/Send.tsx` line 114: `amountStepDataRef`
- The `fromStep` field on review steps is the right pattern — extend it

## Proposed Solutions

**Option A: Add `retryStep` to error variant, carry restoration data on review steps (Recommended)**

```typescript
| { step: 'error'; message: string; retryStep: ReviewStep | null }
| { step: 'oc-review'; ...; amountStepData?: { parsedInput; rawInput } }
```

Error retry restores `retryStep`. Back from review uses `amountStepData` if present.

- Pros: State machine is self-contained, no refs needed, type-safe
- Cons: Moderate refactor, review step types grow
- Effort: Medium
- Risk: Low

**Option B: Keep refs but narrow types**

At minimum, narrow `lastReviewStepRef` to `Extract<SendStep, { step: 'oc-review' } | { step: 'ln-review' }>`.

- Pros: Minimal change, type-safer
- Cons: Refs remain as shadow state
- Effort: Small
- Risk: Low

## Acceptance Criteria

- [ ] No mutable refs for state that should be in the state machine (or refs are properly typed)
- [ ] Error retry restores review screen correctly
- [ ] Back navigation from review works correctly
- [ ] All tests pass
