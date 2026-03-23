---
status: pending
priority: p3
issue_id: 121
tags: [code-review, quality, wallet]
dependencies: []
---

# Remove unused validateMnemonic export

## Problem Statement

After removing the import wallet flow, `validateMnemonic` in `src/wallet/mnemonic.ts` has no production consumers. It is only called from its own test file. If wallet import is re-added in a follow-up plan, the function is trivial to restore.

## Findings

- **TypeScript reviewer**: "validateMnemonic is exported but no longer called from context.tsx... dead code."
- **Simplicity reviewer**: "YAGNI violation — exists 'just in case' someone re-adds import."

## Proposed Solutions

### Option A: Remove export and tests

- **Effort**: Small (3 lines + test cases)
- **Risk**: Low — trivially re-added when import flow is implemented

### Option B: Keep for planned import feature

- If wallet import in Settings is actively planned (it is), keeping it avoids churn.

## Technical Details

- **Affected files**: `src/wallet/mnemonic.ts:11-13`, `src/wallet/mnemonic.test.ts`

## Acceptance Criteria

- [ ] `validateMnemonic` export removed (or decision documented to keep for import feature)

## Work Log

| Date       | Action                     | Learnings                      |
| ---------- | -------------------------- | ------------------------------ |
| 2026-03-16 | Created from PR #29 review | Dead code after import removal |

## Resources

- PR: #29
