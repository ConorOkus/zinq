---
status: complete
priority: p2
issue_id: '273'
tags: [code-review, lint, cleanup]
dependencies: []
---

# `eslint.config.js` ignores `api/**` even though the directory was deleted

## Problem Statement

PR #147 deleted `api/payjoin-proxy.ts` and `api/payjoin-proxy.test.ts`. The remaining `api/` directory still has `esplora-proxy.ts`, `lnurl-proxy.ts`, `vss-proxy.ts` — but those are Vercel serverless functions that we _do_ want lint coverage on.

The pre-existing `'api/**'` entry in `eslint.config.js`'s ignores excludes the entire directory from linting. Whether intentional historically or not, the existence of an unlinted directory in a TypeScript codebase is a smell, and the question is now visible because of this PR.

## Findings

- `eslint.config.js:11` — `ignores: ['dist/**', 'node_modules/**', 'proxy/**', 'design/**', 'api/**']`.
- `api/esplora-proxy.ts`, `api/lnurl-proxy.ts`, `api/vss-proxy.ts` — production serverless functions, currently unlinted.
- Flagged by `code-simplicity-reviewer`.

## Proposed Solutions

### Option 1: Drop `api/**` and fix any lint errors that appear (recommended)

**Pros:** Restores lint coverage on serverless functions; surfaces real issues.

**Cons:** May produce a wave of lint findings to triage; could need a tsconfig.json under `api/` for `parserOptions.projectService`.

**Effort:** 1–3 hours depending on existing violations.

**Risk:** Low.

### Option 2: Leave as-is, document why

Keep the ignore but add a comment explaining the intent.

**Pros:** Zero churn.

**Cons:** Hides real coverage gap.

**Effort:** 5 min.

**Risk:** N/A.

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:** `eslint.config.js`. May require a `tsconfig.json` in `api/` if not already present.

## Acceptance Criteria

- [ ] Either `api/**` is dropped from `eslint.config.js` ignores and `pnpm lint` passes, OR a comment documents why it's excluded.

## Resources

- **PR:** #147
- **Reviewer:** `code-simplicity-reviewer`

## Work Log

### 2026-04-29 — Surfaced during PR #147 review

**By:** code-simplicity-reviewer
