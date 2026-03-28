---
title: GitHub Actions CI quality gate setup with Prettier and ESLint fixes
category: build-errors
date: 2026-03-23
tags:
  - github-actions
  - continuous-integration
  - prettier
  - eslint
  - code-quality
  - monorepo
affected_files:
  - .github/workflows/ci.yml
  - eslint.config.js
  - src/ldk/traits/persist.test.ts
  - src/ldk/traits/event-handler.test.ts
  - src/ldk/sync/chain-sync.test.ts
  - src/ldk/storage/persist-cm.test.ts
  - src/ldk/storage/vss-client.test.ts
  - src/hooks/use-unified-balance.test.ts
  - src/pages/Home.test.tsx
symptoms:
  - No CI pipeline to enforce code quality before merges
  - 282 files with Prettier formatting inconsistencies
  - 152 ESLint errors across 15 files blocking lint from passing
  - Test files with heavy mocking triggering strict TypeScript-ESLint rules
---

# GitHub Actions CI quality gate setup with Prettier and ESLint fixes

## Problem

The project had zero CI — no GitHub Actions, no quality gates on PRs. This allowed code quality issues to accumulate silently: 282 files had Prettier formatting violations and 152 ESLint errors existed across 15 files (mostly `@typescript-eslint/no-unsafe-*` and `@typescript-eslint/unbound-method` in test files with heavy `vi.mock()` usage).

Additionally, two independent packages (root SPA + `proxy/` Cloudflare Worker) needed coordinated but separate quality checks.

## Root Cause

1. **No feedback loop** — without CI, developers had no automated signal that formatting or lint rules were being violated
2. **Strict TypeScript-ESLint rules applied to test mocks** — `vi.mock()` returns bare objects that violate `no-unsafe-assignment`, `no-unsafe-call`, `unbound-method`, etc. These rules are designed for production code safety, not test mock infrastructure
3. **Monorepo without unified quality checks** — root ESLint ignores `proxy/**`, and proxy has no ESLint config, so each package drifted independently

## Solution

### 1. GitHub Actions Workflow

Created `.github/workflows/ci.yml` with a single sequential job:

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm test
      - run: pnpm build
      # Proxy (separate package)
      - run: pnpm install --frozen-lockfile
        working-directory: proxy
      - run: pnpm typecheck
        working-directory: proxy
      - run: pnpm test
        working-directory: proxy
```

Key decisions: `--frozen-lockfile` prevents stale lockfiles, `concurrency` cancels superseded runs, `timeout-minutes: 15` catches hangs, `working-directory: proxy` isolates the Cloudflare Worker package.

### 2. Formatting Fixes (282 files)

Single `pnpm format` invocation fixed all Prettier violations atomically. No manual fixes needed.

### 3. ESLint Fixes (152 errors)

**Test files** — Added file-level `eslint-disable` comments for mock-related rules:

```typescript
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
```

This is preferable to per-line disables because it's explicit, discoverable, and reduces noise.

**Production code** — Fixed properly:

- Removed unnecessary `async` from non-awaiting functions
- Added `design/**` to ESLint ignores (static prototypes, not part of build)
- Removed stale `eslint-disable` comments

### 4. Monorepo Handling

Root and proxy packages have separate install, typecheck, and test steps using `working-directory`. Root lint/format checks don't apply to `proxy/` (it has different tooling context and no ESLint config).

## Prevention Strategies

- **Set up CI early** — even a minimal typecheck + test workflow prevents quality drift from accumulating
- **Use ESLint config overrides for test files** instead of inline disables — consider adding a `files: ['**/*.test.ts']` override block in `eslint.config.js` to disable mock-related rules project-wide
- **Run `pnpm format:check` locally before pushing** — or add `husky` + `lint-staged` pre-commit hooks to catch formatting automatically
- **Use `--frozen-lockfile` in CI always** — catches lockfile drift that `pnpm install` would silently fix

## Related Documentation

- [CI Quality Gate Brainstorm](../../brainstorms/2026-03-23-ci-quality-gate-brainstorm.md) — design decisions for the CI pipeline
- [CI Quality Gate Plan](../../plans/2026-03-23-001-feat-ci-quality-gate-github-actions-plan.md) — implementation plan
- [WebSocket-TCP Proxy on Cloudflare Workers](../infrastructure/websocket-tcp-proxy-cloudflare-workers.md) — proxy deployment patterns
- [Persist Test Mock Assertions](../test-failures/persist-manifest-side-effect-mock-assertions.md) — related test mock patterns
