---
status: complete
priority: p1
issue_id: '211'
tags: [code-review, security, payjoin, ssrf, dev-only]
dependencies: []
---

# Vite dev `/__payjoin_proxy` is an open SSRF

## Problem Statement

The dev-mode proxy in `vite.config.ts` (new `payjoinCorsProxy` plugin, lines 58-138) does NOT run the `isPrivateIp` / `parseTarget` checks that the production proxy does. A developer running `vite` bound to `0.0.0.0` (common for mobile LAN testing of PWAs) exposes an unauthenticated proxy that can POST to:

- `https://10.0.0.1/…` (LAN routers)
- `https://169.254.169.254/…` (AWS/GCP metadata)
- `https://127.0.0.1:*/…` (local services)

Anyone on the same LAN as the dev can use the exposed proxy as an SSRF pivot.

## Findings

- `vite.config.ts:58-138` — `payjoinCorsProxy` validates content-type, body size, CR/LF, userinfo, but skips the private-IP check that the prod proxy has at `api/payjoin-proxy.ts:56-74`.
- Comment at `vite.config.ts:54-57` acknowledges "minimal subset" but private-IP filtering is not optional security — it's the primary SSRF control.
- Security-sentinel flagged this as P1.

## Proposed Solutions

### Option 1: Port isPrivateIp/parseTarget to dev proxy (Recommended)

**Approach:** Share the validation helpers. Export `isPrivateIp` + `parseTarget` from a new `api/payjoin-proxy-helpers.ts` (or leave them in `api/payjoin-proxy.ts` since already exported for tests); import into `vite.config.ts` and apply before constructing `targetUrl`.

**Pros:** Dev ≈ prod parity; one source of truth for SSRF rules.
**Cons:** Cross-directory import from vite.config.ts to api/. Slightly unusual.
**Effort:** Small (30 min).
**Risk:** Low.

### Option 2: Inline the regex checks in dev proxy

**Approach:** Duplicate `isPrivateIp` logic in `payjoinCorsProxy`.

**Pros:** No cross-dir import.
**Cons:** Drift risk — prod gets updated, dev doesn't.
**Effort:** Small.
**Risk:** Medium (drift over time).

### Option 3: Gate dev proxy behind `localhost`-only bind

**Approach:** Refuse to start the dev proxy if `server.host !== 'localhost' && !== '127.0.0.1'`.

**Pros:** Eliminates the mobile-LAN exposure entirely.
**Cons:** Breaks legitimate mobile-LAN testing workflow.
**Effort:** Small.
**Risk:** Medium (UX regression for devs).

## Recommended Action

_To be filled during triage._ Likely Option 1.

## Technical Details

**Affected files:**

- `vite.config.ts:58-138` (dev proxy plugin)
- `api/payjoin-proxy.ts:56-92` (existing helpers to reuse)

## Resources

- **PR:** #139
- **Reviewer:** security-sentinel P1-3
- **Similar pattern:** `api/payjoin-proxy.ts` isPrivateIp + parseTarget

## Acceptance Criteria

- [ ] `payjoinCorsProxy` calls the same private-IP validation as prod.
- [ ] Test: POST to `/__payjoin_proxy/10.0.0.1/path` returns 400.
- [ ] Test: POST to `/__payjoin_proxy/169.254.169.254/metadata` returns 400.
- [ ] Ensure helper sharing doesn't break the Vitest test run (vitest.config include covers api/).

## Work Log

### 2026-04-23 — Discovered in code review

**By:** Claude Code (ce:review)

**Actions:**

- Ran security-sentinel on shipped Phase 1 code
- Identified dev proxy SSRF gap vs prod proxy
- Filed this todo
