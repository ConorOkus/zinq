---
status: pending
priority: p3
issue_id: '279'
tags: [code-review, todos, hygiene]
dependencies: []
---

# Stale `payjoin` tag and reference on todo 236 (GHA SHA pinning)

## Problem Statement

`todos/236-pending-p2-pin-gha-actions-by-sha.md` is the one Payjoin-tagged todo PR #147 _intentionally kept_ — it's a generic GHA security hygiene improvement that still applies repo-wide. But its current content references a `payjoin-build` job that no longer exists ("`permissions: {}` on `payjoin-build` caps the blast radius"), and its frontmatter still carries the `payjoin` tag.

A future agent triaging GHA pinning will look for a job that's been deleted and may either dismiss the todo as stale or get confused.

## Findings

- `todos/236-pending-p2-pin-gha-actions-by-sha.md:5` — `tags: [code-review, payjoin, security, ci, supply-chain]`.
- `todos/236-pending-p2-pin-gha-actions-by-sha.md:22` — references `payjoin-build` job permissions setup.
- Flagged by `agent-native-reviewer` as P2 (re-classified P3 here — generic CI hygiene; not blocking).

## Proposed Solution

1. Drop `payjoin` from the `tags` array.
2. Rewrite the body so it cites the remaining `check` job (which has `contents: read`) instead of the deleted `payjoin-build` job.

**Effort:** 10 min.

**Risk:** None.

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:** `todos/236-pending-p2-pin-gha-actions-by-sha.md`.

## Acceptance Criteria

- [ ] `payjoin` tag removed.
- [ ] Body references current CI jobs only.

## Resources

- **PR:** #147
- **Reviewer:** `agent-native-reviewer`

## Work Log

### 2026-04-29 — Surfaced during PR #147 review

**By:** agent-native-reviewer
