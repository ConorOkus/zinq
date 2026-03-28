---
title: VSS server CORS bypass via Vite dev proxy
category: integration-issues
date: 2026-03-19
tags: [vss, cors, vite, proxy, development]
---

## Problem

Connecting to a new VSS server endpoint (`http://98.207.69.189:52146/vss`) from the browser triggers two sequential errors:

1. **CSP block** — `connect-src` doesn't include the new origin.
2. **CORS block** — Even after adding the origin to CSP, the VSS server doesn't return `Access-Control-Allow-Origin` headers, so the browser blocks the preflight `OPTIONS` response.

## Root Cause

The VSS server (rust `vss-server`) does not set CORS headers. This is a server-side configuration issue, but we can't control the server's CORS policy.

## Solution

Proxy VSS requests through Vite's dev server so they become same-origin, bypassing both CSP and CORS:

**`vite.config.ts`** — Add a proxy rule:

```ts
proxy: {
  '/__vss_proxy': {
    target: 'http://98.207.69.189:52146',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/__vss_proxy/, ''),
  },
},
```

**`src/ldk/config.ts`** — Route through proxy in dev, direct in production:

```ts
vssUrl:
  (import.meta.env.VITE_VSS_URL as string | undefined) ??
  (import.meta.env.DEV ? '/__vss_proxy/vss' : 'http://98.207.69.189:52146/vss'),
```

No CSP changes needed — proxied requests are same-origin (`'self'`).

## Prevention

- When connecting to a new external API from the browser, check CORS support first with `curl -I -X OPTIONS <url>`.
- Prefer Vite proxy for development over CSP allowlisting raw IPs — it's cleaner and avoids leaking test infrastructure into the HTML.
- For production, the VSS server will need either CORS headers or a reverse proxy (e.g., Cloudflare, nginx) in front of it.
