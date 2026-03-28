---
title: 'feat: Complete Vercel staging deployment with VSS proxy and env config'
type: feat
status: completed
date: 2026-03-25
origin: docs/brainstorms/2026-03-25-staging-environment-brainstorm.md
---

# feat: Complete Vercel staging deployment with VSS proxy and env config

## Overview

Complete the Vercel staging environment so it mirrors local dev. The initial deployment (see `docs/plans/2026-03-16-001-feat-vercel-staging-deployment-plan.md`, status: completed) created `vercel.json` with SPA rewrites and security headers, but left the VSS CORS gap unresolved. This plan adds the Vercel rewrite for VSS, configures environment variables, and updates the WS proxy origins for preview deploys.

## Problem Statement

The staging deployment is non-functional for any wallet that uses VSS (Versioned Storage Service) because:

1. `vss.mutinynet.com` does not send CORS headers (see `docs/solutions/integration-issues/vss-cors-bypass-vite-proxy.md`)
2. Locally, Vite proxies `/__vss_proxy` to the VSS server — but this only works in `pnpm dev`, not in a production Vite build
3. The fallback in `src/ldk/config.ts:13` hits `https://vss.mutinynet.com/vss` directly in production mode, which fails due to CORS
4. Preview deploy URLs are blocked by the WS proxy's strict origin check (`proxy/src/validation.ts:20`)

## Proposed Solution

Add a Vercel rewrite rule to proxy `/__vss_proxy/*` to `https://vss.mutinynet.com/*`, mirroring the local Vite dev proxy. Set `VITE_VSS_URL` so the app uses the proxy path in all environments. Update the Cloudflare Worker to accept Vercel preview origins.

## Changes

### 1. Add VSS proxy rewrite to `vercel.json`

Add a rewrite rule **before** the existing SPA catch-all rewrite so `/__vss_proxy` requests are proxied to the VSS server instead of being routed to `index.html`.

**File:** `vercel.json`

```json
"rewrites": [
  {
    "source": "/__vss_proxy/:path*",
    "destination": "https://vss.mutinynet.com/:path*"
  },
  { "source": "/(.*)", "destination": "/index.html" }
]
```

### 2. Set Vercel environment variables

Configure in the Vercel dashboard (Settings > Environment Variables):

| Variable            | Value                                          | Environments        |
| ------------------- | ---------------------------------------------- | ------------------- |
| `VITE_VSS_URL`      | `/__vss_proxy/vss`                             | Production, Preview |
| `VITE_WS_PROXY_URL` | `wss://ln-ws-proxy-dev.conor-okus.workers.dev` | Production only     |

**Why `VITE_VSS_URL` for both Production and Preview:** Both need the VSS proxy rewrite to work. Without it, VSS requests fail due to CORS.

**Why `VITE_WS_PROXY_URL` for Production only:** Preview deploys fall back to the public proxy `wss://p.mutinynet.com` (see brainstorm: decision #5). This avoids needing to add every preview URL to the Worker's `ALLOWED_ORIGINS`.

### 3. Update WS proxy `ALLOWED_ORIGINS` for preview deploys

The current `validateOrigin` function in `proxy/src/validation.ts:18-21` does strict exact-match checking. Vercel preview URLs are dynamic (e.g., `https://zinqq-git-feature-x-conor-okus.vercel.app`).

**Approach:** Add suffix-match support to the origin validation so `*.vercel.app` origins are accepted by the dev Worker.

**File:** `proxy/src/validation.ts`

Update `validateOrigin` to support wildcard entries in the allowed origins list. A wildcard entry like `*.vercel.app` would match any origin ending in `.vercel.app`.

**File:** `proxy/wrangler.toml` (env.dev)

```toml
[env.dev.vars]
ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,https://zinqq.vercel.app,*.vercel.app"
```

**Alternative (simpler, if wildcard feels over-engineered):** Keep exact-match and just use the public proxy `wss://p.mutinynet.com` for all preview deploys. This is what the previous plan decided and it works — the public proxy has no origin restrictions. Only add wildcard support if you want preview deploys to use the self-hosted Worker too.

### 4. Update `.env.example`

Document `VITE_VSS_URL` for contributors.

**File:** `.env.example`

```
VITE_WS_PROXY_URL=wss://p.mutinynet.com
VITE_VSS_URL=/__vss_proxy/vss
```

### 5. Simplify `config.ts` dev/prod branch (optional)

With `VITE_VSS_URL` always set (locally via `.env`, on Vercel via dashboard), the ternary in `src/ldk/config.ts:11-13` that branches on `import.meta.env.DEV` becomes dead code. It can be simplified to just use the env var with a sensible fallback:

```typescript
vssUrl: (import.meta.env.VITE_VSS_URL as string | undefined) ?? '/__vss_proxy/vss',
```

This makes the behavior identical across local dev and Vercel — both go through `/__vss_proxy/vss`.

## System-Wide Impact

- **Interaction graph:** Vercel rewrites are transparent to the app — the browser sees `/__vss_proxy/vss` as a same-origin request, Vercel proxies it to `vss.mutinynet.com`. No app code changes required (except optional cleanup in step 5).
- **Error propagation:** If `vss.mutinynet.com` is down, the Vercel rewrite will return the upstream error (502/504). The app already handles VSS unavailability via `onVssUnavailable` callback (`src/hooks/useLdk.tsx:366`).
- **State lifecycle risks:** None — this is infrastructure configuration, not data flow changes.
- **API surface parity:** The `/__vss_proxy` path works identically in local dev (Vite proxy) and staging/production (Vercel rewrite).

## Acceptance Criteria

- [x] `vercel.json` has a `/__vss_proxy/:path*` rewrite rule pointing to `https://vss.mutinynet.com/:path*`
- [ ] `VITE_VSS_URL=/__vss_proxy/vss` is set in Vercel for Production and Preview environments
- [ ] `VITE_WS_PROXY_URL=wss://ln-ws-proxy-dev.conor-okus.workers.dev` is set in Vercel for Production
- [x] `.env.example` documents `VITE_VSS_URL`
- [ ] A wallet created on the staging URL can persist and restore channel state via VSS
- [ ] Preview deploys (per-PR URLs) can create a wallet, open a channel, and send/receive on signet

## Manual Steps (Post-Merge)

If the Vercel project hasn't been connected yet (from the March 16 plan):

1. Go to vercel.com/new, import the `zinqq` repo
2. Framework preset: Vite, build command: `pnpm build`, output: `dist`
3. Add environment variables per step 2 above
4. Verify the deployed URL loads the wallet and VSS requests succeed (check Network tab for `/__vss_proxy/vss` returning 200)

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-25-staging-environment-brainstorm.md](docs/brainstorms/2026-03-25-staging-environment-brainstorm.md) — Key decisions: Vercel hosting, Vercel rewrites for VSS CORS, shared mutinynet services, skip LNURL proxy
- **Previous plan:** [docs/plans/2026-03-16-001-feat-vercel-staging-deployment-plan.md](docs/plans/2026-03-16-001-feat-vercel-staging-deployment-plan.md) — Created vercel.json, wrangler.toml origins, .env.example
- **VSS CORS learning:** [docs/solutions/integration-issues/vss-cors-bypass-vite-proxy.md](docs/solutions/integration-issues/vss-cors-bypass-vite-proxy.md) — Documents why the proxy is needed
- **WS proxy learning:** [docs/solutions/infrastructure/websocket-tcp-proxy-cloudflare-workers.md](docs/solutions/infrastructure/websocket-tcp-proxy-cloudflare-workers.md) — Deployment guide and gotchas
- **Key files:** `vercel.json`, `src/ldk/config.ts:11-13`, `proxy/src/validation.ts:18-21`, `proxy/wrangler.toml:9-13`
