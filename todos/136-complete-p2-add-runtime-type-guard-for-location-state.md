---
status: pending
priority: p2
issue_id: 136
tags: [code-review, type-safety, security-hardening]
dependencies: [134]
---

# Add Runtime Type Guard for location.state

## Problem Statement

In `src/pages/Send.tsx` line 128, `location.state` is cast with `as { scannedInput?: string } | null` — a compile-time assertion with no runtime validation. In a payment application, every input boundary should be validated at runtime.

## Findings

- **TypeScript Reviewer**: Unsafe cast — add runtime type guard
- **Security Reviewer**: Input validation hardening recommendation (medium-low severity)

## Proposed Solutions

Replace the `as` cast with a runtime check:

```typescript
const state = location.state as Record<string, unknown> | null
const raw = typeof state?.scannedInput === 'string' ? state.scannedInput : null
if (!raw) return
```

- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] `location.state.scannedInput` is validated as `string` at runtime
- [ ] Non-string values are silently ignored

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-18 | Created from PR #33 code review | — |

## Resources

- PR: #33
- File: `src/pages/Send.tsx:128`
