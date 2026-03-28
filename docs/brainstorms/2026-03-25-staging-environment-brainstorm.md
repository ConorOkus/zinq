# Staging Environment Deployment

**Date:** 2026-03-25
**Status:** Brainstorm

## What We're Building

A staging environment on Vercel that mirrors the local development setup, providing:

1. **Preview deploys per PR** — every PR gets a unique URL for testing before merge
2. **Stable staging URL** — a persistent URL (e.g., `staging-zinqq.vercel.app`) that reflects `main`
3. **Shareable for demos** — anyone with the URL can try the app on signet

The staging environment connects to the same mutinynet services used locally (Esplora, RGS, VSS, WS proxy), keeping infrastructure minimal.

## Why This Approach

Zinqq is a fully client-side app with no server component — it's a static Vite build that talks to external services. This makes Vercel an ideal fit:

- **Already partially configured** — `vercel.json` exists with build command, output dir, SPA rewrites, and security headers
- **Automatic preview deploys** — Vercel creates a unique URL for every PR with zero config
- **Free tier** — more than sufficient for a signet wallet's traffic
- **Minimal delta from local** — the only differences are the VSS and LNURL CORS proxies, which Vite handles locally but need Vercel rewrites or a serverless function in staging

## Key Decisions

### 1. Frontend hosting: Vercel

Vercel is already referenced in the codebase (`wrangler.toml` allows `zinqq.vercel.app`). A `vercel.json` already exists. Git integration gives automatic deploys on push to `main` and preview deploys on PRs.

### 2. Backend services: shared mutinynet endpoints

Staging will use the same services as local dev:

- Esplora: `https://mutinynet.com/api`
- RGS: `https://rgs.mutinynet.com/snapshot`
- VSS: `https://vss.mutinynet.com/vss` (via proxy)
- WS proxy: existing `ln-ws-proxy-dev` Cloudflare Worker

This is appropriate because everything runs on signet — no real funds at risk.

### 3. VSS CORS: Vercel rewrites

Locally, Vite proxies `/__vss_proxy` to the VSS server. In staging/production, Vercel rewrites will do the same thing. This requires:

- Adding a rewrite rule in `vercel.json`: `/__vss_proxy/:path*` -> `https://vss.mutinynet.com/:path*`
- The frontend code in `config.ts` already falls back to `https://vss.mutinynet.com/vss` in non-dev mode, but using Vercel rewrites lets us keep the `/__vss_proxy` path consistently, avoiding the dev/prod branch

### 4. LNURL CORS: Vercel serverless function

Locally, the `lnurlCorsProxy` Vite plugin handles LNURL CORS issues. In staging, a Vercel serverless function at `api/lnurl-proxy.ts` can replicate this behavior, proxying `/__lnurl_proxy/DOMAIN/PATH` to `https://DOMAIN/PATH`.

### 5. WS proxy: reuse existing dev Worker

The `ln-ws-proxy-dev` Cloudflare Worker already allows `https://zinqq.vercel.app`. It needs to also allow Vercel preview URLs. Options:

- Add a wildcard pattern like `https://*-conor-okus.vercel.app` (if the Worker supports pattern matching)
- Or add a broader `https://*.vercel.app` allow (less restrictive but still signet-only)
- Or list specific preview domains as needed (tedious)

### 6. Environment variables

Vercel environment variables needed:

- `VITE_WS_PROXY_URL` = `wss://ln-ws-proxy-dev.conor-okus.workers.dev` (same as local `.env`)
- `VITE_VSS_URL` = `/__vss_proxy/vss` (if using Vercel rewrites to keep consistent path)

## What Changes

| Component   | Local (today)                | Staging (proposed)                  |
| ----------- | ---------------------------- | ----------------------------------- |
| Frontend    | `pnpm dev` on localhost:5173 | Vercel static deploy                |
| VSS proxy   | Vite dev proxy -> VSS server | Vercel rewrite -> vss.mutinynet.com |
| LNURL proxy | Vite plugin (lnurlCorsProxy) | Vercel serverless function          |
| WS proxy    | ln-ws-proxy-dev Worker       | Same Worker (add preview origins)   |
| Esplora/RGS | Direct to mutinynet.com      | Same, no change                     |

## Resolved Questions

1. **LNURL proxy in production** — Skip for now. The CORS issue only affects specific servers with malformed headers; on signet this is rare. Can add a Vercel serverless function later if needed.

2. **Custom domain** — Default Vercel URL is fine (e.g., `zinqq.vercel.app`). No custom domain needed.

3. **Access control** — Public is fine. It's signet-only, no real funds at risk.
