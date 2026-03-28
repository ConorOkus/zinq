# Brainstorm: CI Quality Gate for PRs

**Date:** 2026-03-23
**Status:** Ready for planning

## What We're Building

A GitHub Actions CI pipeline that runs quality checks on every PR to main (and direct pushes to main). This is a **quality gate** — it blocks merging broken code, not an automated deployment pipeline.

### Checks to run (in order):

1. **TypeScript type-check** — `pnpm typecheck` (tsc --noEmit)
2. **ESLint** — `pnpm lint`
3. **Unit/integration tests** — `pnpm test` (vitest run, 312 tests across 31 files)
4. **Production build** — `pnpm build` (tsc -b && vite build, includes WASM copy)
5. **Proxy type-check** — type-check the Cloudflare Workers proxy in `proxy/`

### Not included (yet):

- Playwright E2E tests (can add later as a separate workflow)
- Automated deployment to Vercel (Vercel handles this natively via Git integration)
- Cloudflare Workers deployment

## Why This Approach

### Single sequential job (not parallel)

The project is small enough (~300 tests, fast build) that a single job running checks sequentially is simpler and fast enough. Splitting into parallel jobs adds complexity (shared caching, multiple status checks) without meaningful time savings at this scale.

### Include the proxy

The `proxy/` directory contains a Cloudflare Worker that handles WebSocket-to-TCP proxying for Lightning peer connections. It's small (single file) but critical — a broken proxy means no peer connectivity. Cost of checking it is seconds; cost of missing a regression is high.

### Triggers: PRs + pushes to main

- **pull_request → main**: Catches issues before merge (the primary use case)
- **push → main**: Catches hotfixes, direct commits, or force-merges that bypass PRs

## Key Decisions

| Decision           | Choice                        | Rationale                                                   |
| ------------------ | ----------------------------- | ----------------------------------------------------------- |
| Workflow structure | Single job, sequential steps  | Simple, fast enough for project size                        |
| Runner             | ubuntu-latest (GitHub-hosted) | Free for public repos, no maintenance                       |
| Package manager    | pnpm with store caching       | Already used by the project                                 |
| Proxy checks       | Included                      | Small cost, high value — broken proxy = no peer connections |
| E2E tests          | Excluded for now              | Adds complexity (dev server in CI), can be a follow-up      |
| Deployment         | Not in scope                  | Vercel handles deployment via Git integration               |

## Technical Notes

- **WASM dependency**: `pnpm build` runs `pnpm copy:wasm` as a prebuild step, copying `liblightningjs.wasm` to `public/`. This should work in CI without special handling.
- **pnpm caching**: Use `pnpm/action-setup` + GitHub's built-in Node caching (`cache: 'pnpm'`) for fast installs.
- **Node version**: Should match what Vercel uses for builds (check `engines` field or use latest LTS).
- **Proxy directory**: Has its own `package.json` and `tsconfig.json` — needs separate install and type-check step.

## Open Questions

None — ready for planning.
