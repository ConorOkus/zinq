---
status: complete
priority: p2
issue_id: '272'
tags: [code-review, simplicity, dead-code, onchain]
dependencies: []
---

# `mapSendError` `InsufficientFunds` branch is unreachable post-Payjoin

## Problem Statement

`src/onchain/context.tsx:57-74` defines `mapSendError`, which translates BDK errors into user-friendly messages. The `InsufficientFunds` branch existed because the Payjoin proposal exchange could discover funds shortfalls only after PSBT construction. With Payjoin removed:

- `sendToAddress` performs an explicit anchor-reserve + `estimateFee` pre-check at `context.tsx:281-292` and throws a friendlier message **before** `buildSignBroadcast` runs.
- `sendMax` similarly pre-computes via `estimateMaxSendable`.

The only theoretical remaining path is a user with zero channels racing a sync — exceedingly rare, and BDK's raw message is acceptable in that case.

## Findings

- `src/onchain/context.tsx:8` — `InsufficientFunds` import (only used by the dead branch).
- `src/onchain/context.tsx:60-64` — branch maps `InsufficientFunds` to a `formatBtc` message.
- `src/onchain/context.tsx:281-292` — pre-check that makes the BDK throw unreachable in practice.
- Flagged by `code-simplicity-reviewer`.

## Proposed Solutions

### Option 1: Drop the branch and the import (recommended)

```diff
- import { ..., InsufficientFunds } from '@bitcoindevkit/bdk-wallet-web'
- if (err instanceof InsufficientFunds) { return new Error(`Insufficient funds...`) }
```

`mapSendError`'s remaining branches (network/dust message rewriting) still earn their keep.

**Pros:** ~7 LOC saved, no dead code.

**Cons:** If a future caller stops pre-checking, the BDK error surfaces verbatim instead of formatted. Acceptable because the formatted message is no clearer than the BDK one in that edge case.

**Effort:** 5 min.

**Risk:** Low.

### Option 2: Keep as defensive coverage

Leave the branch in case future callers skip the pre-check.

**Pros:** Defense in depth.

**Cons:** Dead code today; misleading abstraction.

**Effort:** 0 min.

**Risk:** N/A.

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:** `src/onchain/context.tsx`.

## Acceptance Criteria

- [ ] `InsufficientFunds` no longer imported in `context.tsx`.
- [ ] `mapSendError` does not branch on it.
- [ ] All onchain tests still pass.

## Resources

- **PR:** #147
- **Reviewer:** `code-simplicity-reviewer`

## Work Log

### 2026-04-29 — Surfaced during PR #147 review

**By:** code-simplicity-reviewer
