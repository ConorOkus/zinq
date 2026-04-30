---
status: pending
priority: p3
issue_id: '280'
tags: [code-review, parser, bip321, verification]
dependencies: []
---

# Audit `src/onchain/bip321.ts` for `URLSearchParams` after Payjoin removal

## Problem Statement

The `learnings-researcher` flagged that `docs/solutions/integration-issues/bip321-pj-urlsearchparams-plus-corruption.md` mentions a second BIP 21 parsing site at `src/onchain/bip321.ts:60` (separate from `src/ldk/payment-input.ts`'s `parseBip321`). PR #147 only audited the latter. If `bip321.ts` still uses `URLSearchParams`, it has the same RFC 3986 vs form-urlencoded `+`-corruption bug that the solution doc describes — and Payjoin's removal does not actually eliminate the risk because future BIP 21 parameters (BOLT 12 offer encodings, BIP extensions) could legally contain `+`.

## Findings

- `src/onchain/bip321.ts` — needs inspection. Possibly older parsing helper from before `parseBip321` was inlined into `payment-input.ts`.
- `docs/solutions/integration-issues/bip321-pj-urlsearchparams-plus-corruption.md` — source of the flag.
- Flagged by `learnings-researcher`.

## Proposed Solution

1. Open `src/onchain/bip321.ts` and check whether `URLSearchParams` is still used, and whether the file is still consumed by any active code path (search for imports).
2. If still in use: replace with the same hand-rolled split-and-decode loop pattern used in `parseBip321`.
3. If not in use: delete the file.
4. Either way, link the chosen path back to the solution doc.

**Effort:** 30 min.

**Risk:** Low.

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:** `src/onchain/bip321.ts` (read), possibly `src/onchain/bip321.test.ts`.

## Acceptance Criteria

- [ ] `bip321.ts` is either fixed (no `URLSearchParams`), deleted, or documented as not vulnerable to the `+`-corruption pattern.

## Resources

- **PR:** #147
- **Reviewer:** `learnings-researcher`
- **Doc:** `docs/solutions/integration-issues/bip321-pj-urlsearchparams-plus-corruption.md`

## Work Log

### 2026-04-29 — Surfaced during PR #147 review

**By:** learnings-researcher
