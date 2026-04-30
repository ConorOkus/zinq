---
status: complete
priority: p2
issue_id: '274'
tags: [code-review, infra, deploy, supply-chain]
dependencies: []
---

# Pin `pnpm` version via `packageManager` field in `package.json`

## Problem Statement

PR #147 removed `installCommand: bash scripts/vercel-install.sh` from `vercel.json` and deleted the install script. Vercel now auto-detects pnpm from `pnpm-lock.yaml` (lockfileVersion 9 → pnpm 9+). CI explicitly pins `pnpm/action-setup@v4 version: 10`.

There is **no `packageManager` field** in `package.json` and no `.nvmrc` / `.node-version`. Vercel's default pnpm is currently v9 (or whatever Vercel picks at build time); CI uses 10. This wasn't introduced by the PR — it's a pre-existing gap that the install hook also didn't address — but the PR is the moment when CI and Vercel resolve pnpm via different mechanisms.

## Findings

- `package.json` — no `packageManager` field.
- `.github/workflows/ci.yml:24-26` — `pnpm/action-setup@v4 with: version: 10`.
- `vercel.json` — no `installCommand` after PR #147; relies on Vercel default.
- Flagged by `security-sentinel` (P3) and `architecture-strategist` (P2).

## Proposed Solutions

### Option 1: Add `packageManager` to `package.json` (recommended)

```json
"packageManager": "pnpm@10.x.y"
```

(Pin to whatever exact pnpm version CI is currently building with; keep the patch version specific to make drift detectable.)

CI may also need an update to read `packageManager` instead of hardcoding `version: 10` — corepack-aware setups do this automatically.

**Pros:** Single source of truth for pnpm version across CI + Vercel + local dev.

**Cons:** Requires periodic version bumps.

**Effort:** 15 min + Dependabot config.

**Risk:** Low.

### Option 2: Document the divergence, accept it

State explicitly in `compound-engineering.local.md` that Vercel uses lockfile-detected pnpm and CI uses pinned v10.

**Pros:** Zero infra change.

**Cons:** Drift remains; future incident likely.

**Effort:** 5 min.

**Risk:** Medium.

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:** `package.json`, possibly `.github/workflows/ci.yml`, possibly `.dependabot.yml`.

## Acceptance Criteria

- [ ] Pnpm version pinned to a single source of truth across CI and Vercel.
- [ ] CI build still passes after the change.
- [ ] Vercel preview deploy still passes after the change.

## Resources

- **PR:** #147
- **Reviewers:** `security-sentinel`, `architecture-strategist`

## Work Log

### 2026-04-29 — Surfaced during PR #147 review

**By:** security-sentinel, architecture-strategist
