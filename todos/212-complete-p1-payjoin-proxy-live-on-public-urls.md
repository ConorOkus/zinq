---
status: complete
priority: p1
issue_id: '212'
tags: [code-review, security, payjoin, abuse, production]
dependencies: []
---

# `/api/payjoin-proxy` is live on public Vercel URLs without a consumer

## Problem Statement

Once PR #139 merges, `/api/payjoin-proxy` is deployed to both preview and production Vercel URLs. The proxy:

- Accepts POST from any caller (no origin check, no auth)
- Has an **in-memory** per-IP rate limit that resets on cold start, per edge region
- Is not yet wired into any user flow

This makes it an open outbound HTTPS cannon for ~60 req/min/region/instance — easily bypassed by an attacker spreading across Vercel regions or triggering cold starts.

Meaningful residual controls: `isPrivateIp` rejects internal targets, 100 KB body cap, 20s timeout, content-type allowlist. Remaining abuse surface: credential-stuffing amplification against third-party hosts (headers are stripped, but body forwarding is valid POST).

The PR body claim "no caller = no DoS" is incorrect: public Vercel preview URLs are indexable.

## Findings

- `api/payjoin-proxy.ts:44-56` — in-memory Map rate limit, explicitly TODO'd for Vercel KV.
- `vercel.json:8` — rewrite `/api/payjoin-proxy/:path(.*)` is live in prod on merge.
- No env guard in the handler; it runs unconditionally.
- Reviewer: security-sentinel P2-1, architecture-strategist #7.

## Proposed Solutions

### Option 1: Gate behind `process.env.VERCEL_ENV` + feature flag (Recommended)

**Approach:** At the top of `POST(request)`, return `503` unless `process.env.PAYJOIN_PROXY_ENABLED === '1'` OR the request carries a shared-secret header. Defaults to disabled; flipped on only when Phase 3 wires the consumer. Can still test via preview by setting the env var.

**Pros:** Minimal code change; instant kill switch; no abuse until deliberate enable; survives cold starts.
**Cons:** One more env var to manage.
**Effort:** Small (15 min + env var setup).
**Risk:** Low.

### Option 2: Implement durable KV rate limit now

**Approach:** Add `@vercel/kv` dependency; replace in-memory Map with KV-backed counter. Higher limit (say 600/hour/IP) still deters casual abuse.

**Pros:** Also unblocks Phase 3.
**Cons:** Brings in new dep + env vars; larger surface to review; doesn't protect against credential-stuffing-style abuse where the attacker doesn't care about rate limit (they just want the forwarded POST).
**Effort:** Medium (2-4 hours).
**Risk:** Low-Medium (depends on KV availability in the target Vercel project).

### Option 3: Defer merge until KV is ready

**Approach:** Hold this PR; do KV integration on same branch.
**Pros:** One PR, no interim exposure.
**Cons:** Delays scaffolding landing; couples two otherwise-independent concerns.
**Effort:** Medium.
**Risk:** Low.

## Recommended Action

_To be filled during triage._ Likely Option 1 for fastest safe merge; KV follows before Phase 3 consumer lands.

## Technical Details

**Affected files:**

- `api/payjoin-proxy.ts` (early-return guard)
- `.env.example` (document `PAYJOIN_PROXY_ENABLED`)

## Resources

- **PR:** #139
- **Reviewer:** security-sentinel P2-1 ("Rate limit is ornamental, not functional"), architecture-strategist #7 ("Live-path exposure")

## Acceptance Criteria

- [ ] Proxy returns 503 in production unless feature flag is set.
- [ ] Env var documented in `.env.example`.
- [ ] Test covering the disabled path.
- [ ] Preview deploys can opt-in via env var for testing.

## Work Log

### 2026-04-23 — Discovered in code review

**By:** Claude Code (ce:review)

**Actions:**

- security-sentinel flagged in-memory rate limit as per-edge-region ineffective
- architecture-strategist flagged live-path exposure
- Consolidated into this P1 with options
