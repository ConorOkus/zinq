---
status: complete
priority: p1
issue_id: '270'
tags: [code-review, agent-native, tooling, todos]
dependencies: []
---

# `cancelled` todo status is undefined in the `file-todos` skill lifecycle

## Problem Statement

PR #147 introduced a fourth todo status — `cancelled` — used in 31 renamed payjoin todos (filename `*-cancelled-*.md`, frontmatter `status: cancelled`). The canonical `file-todos` skill defines exactly three statuses: `pending → ready → complete`. Tooling that consumes the todo system (`/triage`, `/resolve_todo_parallel`) globs on `pending-` filenames and does not have a documented contract for what to do with `cancelled` — they will silently ignore them, but agents are likely to handle them ad-hoc and produce inconsistent behavior over time.

The intent ("Reopen if Payjoin is re-integrated", appended to each cancelled file) has no machine-readable reactivation hook.

## Findings

- `~/.claude/plugins/cache/compound-engineering-plugin/compound-engineering/2.39.0/skills/file-todos/SKILL.md` — defines lifecycle `pending → ready → complete`; template comment lists `# pending | ready | complete` for the status field.
- `todos/253-cancelled-p2-payjoin-dead-signal-parameter.md:2` (representative) — uses `status: cancelled`.
- `commands/triage.md` (compound-engineering) — only handles `pending → ready` transitions; uses `ls todos/*-pending-*.md`.
- `/resolve_todo_parallel` — phrased as "all unresolved todos" without a precise glob; could include or exclude `cancelled` ad-hoc.
- 31 cancelled todos are affected; flagged by `agent-native-reviewer`.

## Proposed Solutions

### Option 1: Treat `cancelled` as a terminal status synonym of `complete` (recommended)

**Approach:** Document `cancelled` as a Zinqq-local extension in `compound-engineering.local.md`. State that for filtering/listing purposes it should be treated as terminal (same as `complete`), and that re-opening a cancelled todo means renaming it back to `pending` and clearing the `## Cancelled` section.

**Pros:**

- Keeps the existing rename intact — no churn on the 31 files.
- Preserves the semantic distinction (cancelled ≠ completed work) for human reviewers.

**Cons:**

- Slightly diverges from upstream skill vocabulary; relies on local convention.

**Effort:** 15 min.

**Risk:** Low.

---

### Option 2: Revert the rename — use `complete` filename + frontmatter, add `cancelled_reason:` field

**Approach:** Rename `*-cancelled-*` → `*-complete-*`. Add a `cancelled_reason` field to frontmatter pointing at the removal commit. Filenames glob cleanly with existing tooling.

**Pros:**

- Zero divergence from skill vocabulary; existing tooling works unmodified.

**Cons:**

- Conflates "completed work" with "abandoned work" in lists — hides the distinction we wanted to preserve.
- Larger churn (31 file renames + content edits).

**Effort:** 30 min.

**Risk:** Low.

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:**

- `compound-engineering.local.md` (Option 1) — add convention note
- `todos/*-cancelled-*.md` × 31 (Option 2) — rename + add field

## Acceptance Criteria

- [ ] Either: `compound-engineering.local.md` documents `cancelled` as a terminal status synonym, OR all 31 `*-cancelled-*` files are renamed `*-complete-*` with `cancelled_reason` frontmatter.
- [ ] `/triage` and `/resolve_todo_parallel` semantics around cancelled work are unambiguous.

## Resources

- **PR:** #147
- **Reviewer:** `agent-native-reviewer`

## Work Log

### 2026-04-29 — Discovered during PR #147 review

**By:** agent-native-reviewer
**Actions:** Cross-referenced 31 newly-cancelled todos against the `file-todos` skill's lifecycle vocabulary; flagged as P1.
