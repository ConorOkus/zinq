---
status: pending
priority: p3
issue_id: '278'
tags: [code-review, docs, hygiene]
dependencies: []
---

# Annotate Payjoin brainstorms / plans / solution docs as archived

## Problem Statement

PR #147 intentionally kept `docs/brainstorms/`, `docs/plans/`, and `docs/solutions/` untouched as institutional record. Two Payjoin-specific files are now misleading:

- `docs/plans/2026-04-23-001-feat-payjoin-send-support-plan.md` — reads as a live plan; instructions reference deleted code paths.
- `docs/brainstorms/2026-04-23-payjoin-send-brainstrom.md` — reads as active design exploration.

Two solution docs that reference deleted file paths in their `module:` / `files:` frontmatter:

- `docs/solutions/integration-issues/bip321-pj-urlsearchparams-plus-corruption.md` — references `src/onchain/payjoin/payjoin.ts`.
- `docs/solutions/build-errors/rustup-target-wrong-toolchain-submodule.md` — references `vendor/rust-payjoin/...`, `scripts/build-payjoin-bindings.sh`.

A future agent grep-ing for a payment bug will read these and try to open files that don't exist.

## Findings

- Flagged by `architecture-strategist` (P3-1) and `agent-native-reviewer` (P3).

## Proposed Solutions

### Option 1: Add `archived:` frontmatter (recommended)

Add `archived: 2026-04-29 (PR #147 — Payjoin integration removed pending upstream)` to the frontmatter of:

- `docs/plans/2026-04-23-001-feat-payjoin-send-support-plan.md`
- `docs/brainstorms/2026-04-23-payjoin-send-brainstorm.md`
- `docs/solutions/integration-issues/bip321-pj-urlsearchparams-plus-corruption.md`
- `docs/solutions/build-errors/rustup-target-wrong-toolchain-submodule.md`

Agents and humans can filter on this field.

**Pros:** Minimal churn; preserves searchability; agent-readable.

**Cons:** Requires consumers to know about the field.

**Effort:** 15 min.

**Risk:** None.

### Option 2: Move to a `docs/archived/` subtree

Physically move the files; keeps "active" docs trees clean.

**Pros:** Stronger signal; impossible to confuse with live work.

**Cons:** Breaks any inbound links (e.g. solution docs referenced from todos or comments).

**Effort:** 30 min + audit inbound links.

**Risk:** Low.

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:**

- `docs/plans/2026-04-23-001-feat-payjoin-send-support-plan.md`
- `docs/brainstorms/2026-04-23-payjoin-send-brainstorm.md`
- `docs/solutions/integration-issues/bip321-pj-urlsearchparams-plus-corruption.md`
- `docs/solutions/build-errors/rustup-target-wrong-toolchain-submodule.md`

## Acceptance Criteria

- [ ] All four files have an `archived:` frontmatter field (or are moved to `docs/archived/`).
- [ ] No inbound links broken.

## Resources

- **PR:** #147
- **Reviewers:** `architecture-strategist`, `agent-native-reviewer`

## Work Log

### 2026-04-29 — Surfaced during PR #147 review

**By:** architecture-strategist, agent-native-reviewer
