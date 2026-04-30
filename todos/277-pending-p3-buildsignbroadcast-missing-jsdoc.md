---
status: pending
priority: p3
issue_id: '277'
tags: [code-review, docs, onchain]
dependencies: []
---

# `buildSignBroadcast` lacks a docstring after Payjoin removal

## Problem Statement

The pre-PR #147 JSDoc on `buildSignBroadcast` was Payjoin-flavored ("transformPsbt", "Payjoin proposal exchange"), so removing it was the right call. But the helper still does meaningful non-obvious work — pause sync → fee floor check → MAX_FEE_SATS sanity → sign → broadcast → balance update → persist changeset → resume sync — and now has no docstring at all. A future reader gets nothing.

## Findings

- `src/onchain/context.tsx:170-174` (post-PR #147) — bare function, no JSDoc.
- Three callers (`sendToAddress`, both `sendMax` codepaths) rely on the lifecycle.
- Flagged by `kieran-typescript-reviewer` as P3.

## Proposed Solution

Add a one-paragraph JSDoc:

```ts
/**
 * Build a PSBT, fee-sanity-check it, sign, broadcast, then persist BDK
 * changeset and resume sync. Pauses the sync loop while in flight so a
 * concurrent sync doesn't race the just-built tx. Throws are mapped via
 * `mapSendError` for friendlier user-facing messages.
 */
```

**Effort:** 5 min.

**Risk:** None.

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:** `src/onchain/context.tsx`.

## Acceptance Criteria

- [ ] `buildSignBroadcast` has a JSDoc that describes the lifecycle without referencing Payjoin.

## Resources

- **PR:** #147
- **Reviewer:** `kieran-typescript-reviewer`

## Work Log

### 2026-04-29 — Surfaced during PR #147 review

**By:** kieran-typescript-reviewer
