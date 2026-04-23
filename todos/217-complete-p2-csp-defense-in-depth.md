---
status: complete
priority: p2
issue_id: '217'
tags: [code-review, security, csp, payjoin]
dependencies: []
---

# CSP missing defense-in-depth directives + first-deploy canary risk

## Problem Statement

`vercel.json` adds the project's first `Content-Security-Policy` header. Two concerns:

1. **Missing directives.** `default-src 'self'` covers most fallbacks, but browsers historically differ on whether `default-src` applies to `<object>`, `<embed>`, or `<manifest>`. Explicit directives:
   - `object-src 'none'` (modern CSP guides recommend explicit)
   - `manifest-src 'self'` (PWA manifest may not fall through `default-src` on some browsers)
   - `frame-src 'none'` (paired with `frame-ancestors 'none'` already present)
2. **First-deploy canary risk.** This is the first CSP on the project. If any runtime-used host is missing from `connect-src`, users get silent `Refused to connect` errors on any route. Sentry, analytics, blob workers from Vite-PWA are common misses.

## Findings

- `vercel.json:32` — single CSP string; no report-only canary.
- Simplicity reviewer: "one missing host = silent breakage."
- Architecture reviewer: CSP coverage matches known hosts (cloudflare-dns, mempool, rapidsync, wss://proxy, payjo.in, 3 OHTTP relays), but `connect-src` could still miss a non-obvious host.
- Security-sentinel P2-4.

## Proposed Solutions

### Option 1: Add missing directives + Report-Only canary (Recommended)

**Approach:**

1. Add `object-src 'none'; manifest-src 'self'; frame-src 'none'` to the CSP.
2. Deploy with `Content-Security-Policy-Report-Only` header (same value) for 48 hours first.
3. Monitor preview + early prod for violations; fix before promoting to enforcing `Content-Security-Policy`.

**Pros:** Catches misses without breaking users.
**Cons:** Report-Only needs a `report-uri` / `report-to` endpoint or in-browser devtools checking; requires a follow-up flip to enforcing.
**Effort:** Small (config) + Medium (reporting endpoint if needed).
**Risk:** Low.

### Option 2: Add directives, ship enforcing, smoke-test manually

**Approach:** Add the three missing directives; manually verify Home / Send / Receive / Settings pages on preview load with no CSP errors in DevTools console; merge.

**Pros:** Simpler; no new endpoint.
**Cons:** Misses edge cases (only-loads-on-error, BIP 353 DoH, etc.).
**Effort:** Small.
**Risk:** Medium (silent breakage in rare paths).

### Option 3: Keep as-is, revisit later

**Approach:** Ship current CSP; fix directives + any breakage in follow-up.

**Pros:** Unblocks merge now.
**Cons:** If something breaks in prod, we're playing catch-up.
**Effort:** Zero now.
**Risk:** Medium.

## Recommended Action

_To be filled during triage._ Option 2 is pragmatic; Option 1 is ideal but may be overkill for Phase 1 scaffolding.

## Technical Details

**Affected files:**

- `vercel.json` (CSP header)
- Manual test plan on preview deploy

## Resources

- **PR:** #139
- **Reviewer:** security-sentinel P2-4, architecture #5, simplicity (canary)
- **Reference:** [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy)

## Acceptance Criteria

- [ ] `object-src 'none'`, `manifest-src 'self'`, `frame-src 'none'` added.
- [ ] Manifest loads on `/` in preview with no CSP errors.
- [ ] Home/Send/Receive/Settings verified in DevTools (no CSP violations).
- [ ] If Option 1: Report-Only deploy precedes enforcing.

## Work Log

### 2026-04-23 — Discovered in code review

**By:** Claude Code (ce:review)
