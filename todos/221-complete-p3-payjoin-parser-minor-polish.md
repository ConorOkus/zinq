---
status: complete
priority: p3
issue_id: '221'
tags: [code-review, payjoin, polish]
dependencies: []
---

# Minor polish items for payjoin parser + proxy

## Problem Statement

Several small items flagged across reviewers that don't warrant separate todos individually. Batched for triage efficiency.

## Findings

### A. `pj=` length bound off-by-one

- `src/ldk/payment-input.ts:278` — `pjValue.length < 2048` (strict less-than)
- `api/payjoin-proxy.ts:83` — `pathParam.length > 2048` (strict greater-than rejects)
- Inconsistent boundary. Pick one and apply everywhere.

### B. Conditional spread is unnecessarily clever

- `src/ldk/payment-input.ts:~282` — `return { type: 'onchain', address, amountSats, ...(payjoin && { payjoin }) }`
- If `exactOptionalPropertyTypes` is NOT enabled in `tsconfig.json`, simplify to `, payjoin`.
- If it IS enabled, add a one-line comment: `// exactOptionalPropertyTypes requires conditional spread`.

### C. `x-real-ip` / `x-forwarded-for` trust needs comment

- `api/payjoin-proxy.ts:100-107` — `clientIpOf` trusts these headers. Safe on Vercel Edge (they're set by the platform), but would be unsafe on any other host.
- Add: `// Trusted on Vercel Edge (set by platform). Not safe on other hosts.`

### D. Upstream content-type forwarding could be allowlisted

- `api/payjoin-proxy.ts:165` — forwards whatever upstream returns.
- Consider: strip to `application/octet-stream` | `text/plain` | `message/ohttp-res`.
- Low severity because caller is `fetch()` receiving opaque bytes, not a document.

### E. `PayjoinContext` type location

- `src/ldk/payment-input.ts:61-70` — Phase 3 should migrate this to `src/onchain/payjoin/types.ts`.
- Flag in Phase 3 plan; no action needed in Phase 1.

### F. `x-forwarded-for` stripping on outbound verified

- `api/payjoin-proxy.ts:155-160` — header allowlist is allowlist (only `content-type`, `content-length`, `user-agent`). Good; matches the PR-body claim.
- No action needed — confirms architecture review finding.

## Proposed Solution

**Batch polish pass.** One small PR that:

- Aligns `< 2048` / `> 2048` boundary.
- Simplifies or comments the conditional spread.
- Adds Vercel-trust comment.
- Optionally allowlists upstream content-type.

**Effort:** Small (30-60 min total).
**Risk:** Low.

## Recommended Action

_To be filled during triage._

## Technical Details

**Affected files:**

- `src/ldk/payment-input.ts`
- `api/payjoin-proxy.ts`

## Resources

- **PR:** #139
- **Reviewers:** security-sentinel P3-3/P3-5, kieran Q1, architecture #1

## Acceptance Criteria

- [ ] Length bound consistent across parser + proxy.
- [ ] Conditional spread either simplified or commented.
- [ ] Vercel-trust comment on `clientIpOf`.
- [ ] Decision on upstream content-type allowlist.
- [ ] Note `PayjoinContext` migration in Phase 3 plan.

## Work Log

### 2026-04-23 — Discovered in code review

**By:** Claude Code (ce:review)
