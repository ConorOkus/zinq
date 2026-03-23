---
status: complete
priority: p2
issue_id: '135'
tags: [code-review, quality]
---

# Extract duplicated review back-navigation handler

## Problem Statement

The `onBack` handler for both `oc-review` and `ln-review` screens is identical 5-line logic inlined in two JSX blocks. If one is updated without the other, back navigation will silently diverge.

## Findings

- Flagged by TypeScript reviewer, Simplicity reviewer, Architecture reviewer
- `src/pages/Send.tsx` lines 619-625 (oc-review) and 668-674 (ln-review)
- Identical logic checking `fromStep` and `amountStepDataRef`

## Proposed Solutions

**Option A: Extract to `handleReviewBack` useCallback (Recommended)**

```typescript
const handleReviewBack = useCallback(() => {
  if (sendStep.step !== 'oc-review' && sendStep.step !== 'ln-review') return
  if (sendStep.fromStep === 'amount' && amountStepDataRef.current) {
    setSendStep({ step: 'amount', ...amountStepDataRef.current })
  } else {
    setSendStep({ step: 'recipient' })
  }
}, [sendStep])
```

- Pros: Single source of truth, no drift risk
- Cons: None
- Effort: Small
- Risk: Low

## Acceptance Criteria

- [ ] Single `handleReviewBack` callback used by both review screens
- [ ] Back navigation still works correctly for both fromStep variants
- [ ] All tests pass
