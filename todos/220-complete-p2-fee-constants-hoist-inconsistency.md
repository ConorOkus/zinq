---
status: complete
priority: p2
issue_id: '220'
tags: [code-review, architecture, payjoin]
dependencies: []
---

# `MIN_FEE_RATE_SAT_VB` / `MAX_FEE_SATS` hoist inconsistent with `ONCHAIN_CONFIG`

## Problem Statement

`src/onchain/config.ts:1-5` adds two top-level exports:

```ts
export const MIN_FEE_RATE_SAT_VB = 2n
export const MAX_FEE_SATS = 50_000n
```

The rest of the file exports a single `ONCHAIN_CONFIG` object that holds all other configuration. Having these constants as top-level exports while the rest lives inside `ONCHAIN_CONFIG` is inconsistent. Also: the current PR doesn't actually IMPORT these from `config.ts` anywhere outside `context.tsx` — the hoist is a Phase 3 preparation that shipped early.

Architecture reviewer flagged this; Kieran flagged it as "wrong shape"; Simplicity reviewer suggested deferring the hoist to Phase 3 entirely.

## Findings

- `src/onchain/config.ts:1-5` — top-level exports.
- `src/onchain/config.ts:27-33` — `ONCHAIN_CONFIG` object.
- `src/onchain/context.tsx:21` — imports both shapes from one module: `{ ONCHAIN_CONFIG, MIN_FEE_RATE_SAT_VB, MAX_FEE_SATS }`.
- No other consumer in Phase 1.
- Reviewers: architecture-strategist #3, kieran Q8, simplicity-reviewer.

## Proposed Solutions

### Option 1: Move into `ONCHAIN_CONFIG`, rename to camelCase (Recommended)

**Approach:**

```ts
export const ONCHAIN_CONFIG = {
  ...DEFAULTS,
  minFeeRateSatVb: 2n,
  maxFeeSats: 50_000n,
  esploraUrl: /* ... */,
  explorerUrl: /* ... */,
}
```

**Pros:** One consistent shape in the file.
**Cons:** Mixes runtime-configurable (env-overridable URLs) with compile-time constants (bigint safety limits); the current separation is actually _meaningful_.
**Effort:** Small (15 min + rename all usage sites).
**Risk:** Low.

### Option 2: Keep separate but add comment explaining why

**Approach:** Keep current shape; add a comment:

```ts
// Compile-time safety limits (bigint, not env-overridable).
// Kept outside ONCHAIN_CONFIG which holds runtime/env-overridable values.
export const MIN_FEE_RATE_SAT_VB = 2n
export const MAX_FEE_SATS = 50_000n
```

**Pros:** Documents the meaningful separation; minimal change.
**Cons:** Still looks inconsistent at a glance.
**Effort:** Trivial.
**Risk:** None.

### Option 3: Introduce `FEE_LIMITS` object

**Approach:**

```ts
export const FEE_LIMITS = {
  minFeeRateSatVb: 2n,
  maxFeeSats: 50_000n,
} as const
```

**Pros:** Related constants grouped; clear semantic boundary.
**Cons:** Additional import for consumers; slightly more ceremony.
**Effort:** Small.
**Risk:** Low.

### Option 4: Revert the hoist; defer to Phase 3

**Approach:** Put the constants back in `src/onchain/context.tsx` as module-private. Add when Phase 3's Payjoin code needs them.

**Pros:** YAGNI-correct; no speculative code.
**Cons:** Re-do the hoist in Phase 3.
**Effort:** Small.
**Risk:** Low.

## Recommended Action

_To be filled during triage._ Option 2 or Option 4. Option 2 if keeping the hoist; Option 4 if simplicity wins.

## Technical Details

**Affected files:**

- `src/onchain/config.ts:1-5`
- `src/onchain/context.tsx:21, 30-32`

## Resources

- **PR:** #139
- **Reviewers:** architecture-strategist #3, kieran Q8, simplicity-reviewer

## Acceptance Criteria

- [ ] Decision made on one of the four options.
- [ ] If Option 2: comment added explaining separation.
- [ ] If Option 4: hoist reverted; constants back in `context.tsx`.
- [ ] No existing tests break.

## Work Log

### 2026-04-23 — Discovered in code review

**By:** Claude Code (ce:review)
