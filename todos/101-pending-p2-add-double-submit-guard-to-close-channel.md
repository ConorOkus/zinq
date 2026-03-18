---
status: pending
priority: p2
issue_id: '101'
tags: [code-review, security, quality]
dependencies: []
---

# No double-click guard on CloseChannel confirm button

## Problem Statement

`OpenChannel.tsx` correctly uses `openingRef` to prevent double-submission of the channel open call. `CloseChannel.tsx` has no equivalent guard. A rapid double-tap on the confirm button could call `ldk.closeChannel` or `ldk.forceCloseChannel` twice before the state update propagates.

## Findings

- **File**: `src/pages/CloseChannel.tsx:78-111` (handleConfirm has no ref guard)
- **Reference**: `src/pages/OpenChannel.tsx:37,114` (openingRef pattern)
- **Identified by**: security-sentinel

## Proposed Solution

Add a `closingRef` guard identical to the `openingRef` pattern in `OpenChannel.tsx`:

```typescript
const closingRef = useRef(false)

const handleConfirm = useCallback(() => {
  if (closingRef.current) return
  closingRef.current = true
  try { ... } finally { closingRef.current = false }
}, [ldk, currentStep])
```

- **Effort**: Small (5 lines)
- **Risk**: Low

## Acceptance Criteria

- [ ] `closingRef` guard prevents double-submission
- [ ] Pattern matches `openingRef` in `OpenChannel.tsx`
