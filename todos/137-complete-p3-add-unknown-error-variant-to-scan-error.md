---
status: pending
priority: p3
issue_id: 137
tags: [code-review, ux, error-handling]
dependencies: []
---

# Add Unknown Error Variant to ScanError

## Problem Statement

In `src/pages/Scan.tsx`, `classifyCameraError` defaults to `{ kind: 'permission-denied' }` for unrecognized errors. This shows "Camera access is required... enable it in your browser settings" which is misleading for genuinely unexpected errors.

## Proposed Solutions

Add a generic `unknown` variant:

```typescript
type ScanError =
  | { kind: 'permission-denied' }
  | { kind: 'not-found' }
  | { kind: 'in-use' }
  | { kind: 'unknown'; message: string }
  | { kind: 'invalid-qr'; message: string }
```

Fallback: `return { kind: 'unknown', message: 'Could not access camera' }`

- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] Unknown camera errors show a generic message, not "enable in browser settings"

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-18 | Created from PR #33 code review | — |

## Resources

- PR: #33
- File: `src/pages/Scan.tsx:28-33`
