---
title: 'feat: Add GitHub Actions CI quality gate for PRs'
type: feat
status: active
date: 2026-03-23
origin: docs/brainstorms/2026-03-23-ci-quality-gate-brainstorm.md
---

# feat: Add GitHub Actions CI quality gate for PRs

## Overview

Add a GitHub Actions workflow that runs quality checks on every PR to main and every push to main. This is a quality gate — it blocks merging broken code. Deployment is handled separately by Vercel's Git integration.

## Proposed Solution

A single-job workflow (`.github/workflows/ci.yml`) that runs sequential checks: install → typecheck → lint → format check → test → build → proxy checks. Uses GitHub-hosted runners (`ubuntu-latest`) with pnpm store caching.

(see brainstorm: `docs/brainstorms/2026-03-23-ci-quality-gate-brainstorm.md`)

## Technical Considerations

### Workflow Structure

```yaml
# .github/workflows/ci.yml
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

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Format check
        run: pnpm format:check

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build

      - name: Install proxy dependencies
        run: pnpm install --frozen-lockfile
        working-directory: proxy

      - name: Typecheck proxy
        run: pnpm typecheck
        working-directory: proxy

      - name: Test proxy
        run: pnpm test
        working-directory: proxy
```

### Key Design Decisions

| Decision            | Choice             | Rationale                                                                             |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| Node version        | 22 LTS             | No `.nvmrc` or `engines` field exists; 22 is current LTS and widely supported         |
| pnpm version        | 10                 | Matches installed 10.32.1; lockfile is v9.0 format (compatible with pnpm 10)          |
| `--frozen-lockfile` | Yes, both installs | Prevents CI from silently passing with stale lockfiles                                |
| `timeout-minutes`   | 15                 | Pipeline should finish in ~3-5 min; 15 min catches hangs without being aggressive     |
| `concurrency`       | cancel-in-progress | Avoids wasting runner minutes on superseded PR pushes                                 |
| Proxy steps         | Split into 3       | Individual steps give clearer failure signals vs compound `&&` command                |
| Action versions     | Major tags (`@v4`) | Reasonable security/maintenance tradeoff; can tighten to SHA pins later               |
| Proxy lint/format   | Excluded           | Root ESLint config explicitly ignores `proxy/**`; proxy is a small single-file Worker |

### Caching Strategy

- `actions/setup-node` with `cache: pnpm` caches the global pnpm store (`~/.local/share/pnpm/store`)
- Cache key is derived from `**/pnpm-lock.yaml` glob, which picks up both root and `proxy/pnpm-lock.yaml`
- Both `pnpm install` commands benefit from the shared content-addressable store
- `node_modules` are re-linked each run (correct behavior with `--frozen-lockfile`)

### WASM Handling

- The `prebuild` hook in `package.json` runs `copy:wasm` (copies `liblightningjs.wasm` to `public/`)
- This runs automatically before `pnpm build` — no special CI handling needed
- Unit tests use jsdom and don't need the WASM file (it's fetched at runtime, not imported statically)

### Security

- Uses `pull_request` trigger (not `pull_request_target`) — safe default for fork PRs
- No secrets needed — all checks are local
- No elevated `permissions` block
- Fork PRs get read-only `GITHUB_TOKEN` automatically

### Intentional Omissions

- **Playwright E2E**: Excluded — adds complexity (browser install, dev server), can be a follow-up workflow
- **Automated deployment**: Vercel handles this via Git integration
- **Cloudflare Workers deployment**: Manual via `wrangler deploy`
- **Proxy lint/format**: Not configured in the proxy subproject; intentional given its small size

## Acceptance Criteria

- [ ] `.github/workflows/ci.yml` exists with the workflow above
- [ ] Workflow triggers on PRs to main and pushes to main
- [ ] TypeScript type-check passes (`pnpm typecheck`)
- [ ] ESLint passes (`pnpm lint`)
- [ ] Prettier format check passes (`pnpm format:check`)
- [ ] Unit tests pass (`pnpm test`)
- [ ] Production build succeeds (`pnpm build`)
- [ ] Proxy type-check passes (`cd proxy && pnpm typecheck`)
- [ ] Proxy tests pass (`cd proxy && pnpm test`)
- [ ] `--frozen-lockfile` is used for both install steps
- [ ] Concurrency group cancels superseded runs
- [ ] Job timeout is set to 15 minutes

## File Map

| File                       | Action | Description          |
| -------------------------- | ------ | -------------------- |
| `.github/workflows/ci.yml` | Create | The CI workflow file |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-23-ci-quality-gate-brainstorm.md](../brainstorms/2026-03-23-ci-quality-gate-brainstorm.md) — single job, sequential checks, include proxy, exclude E2E
- **Root scripts:** `package.json` — typecheck, lint, format:check, test, build
- **Proxy scripts:** `proxy/package.json` — typecheck, test
- **Playwright config:** `playwright.config.ts` — already CI-aware with `process.env.CI` checks (for future E2E workflow)
- **Proxy infrastructure:** `docs/solutions/infrastructure/websocket-tcp-proxy-cloudflare-workers.md`
