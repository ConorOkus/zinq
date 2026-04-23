---
status: complete
priority: p2
issue_id: '214'
tags: [code-review, security, payjoin]
dependencies: []
---

# Hostname regex allows DNS-rebinding tricks

## Problem Statement

The hostname regex in `parseTarget` at `api/payjoin-proxy.ts:87` is:

```ts
if (host.includes('@') || host.includes(':') || !/^[a-z0-9.-]+$/i.test(host)) return null
```

This passes hostnames like:

- `evil.com.` (trailing dot) — valid DNS, but `'evil.com.' !== 'evil.com'` bypasses equality-check allowlists
- `.evil.com` (leading dot) — invalid DNS, should reject
- `evil..com` (double dot) — invalid, should reject
- `-evil.com`, `evil-.com` (leading/trailing hyphens in labels) — invalid per RFC 1035

Not a vulnerability today because `V2_HOSTS` is not currently enforced (see todo 215), but becomes a real bypass the moment v2 allowlisting goes live.

## Findings

- `api/payjoin-proxy.ts:87` — regex admits trailing dot and malformed labels.
- Security-sentinel P2-2.
- Trailing-dot FQDN is a known CSP and DNS-rebinding trick.

## Proposed Solutions

### Option 1: Normalize via URL parser (Recommended)

**Approach:** Build the URL first and use `new URL(...).hostname` which normalizes. Reject if the normalized form differs from input:

```ts
const target = new URL(`https://${host}${path}`)
if (target.hostname !== host.toLowerCase()) return null
if (target.hostname.endsWith('.')) return null
if (/\.\./.test(target.hostname)) return null
```

**Pros:** Uses the same parser the runtime will use; catches most cases.
**Cons:** Slight over-rejection (internationalized hosts get normalized to Punycode; that's probably fine for Payjoin).
**Effort:** Small (20 min).
**Risk:** Low.

### Option 2: Stricter regex

**Approach:** Replace with `/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i` (RFC-ish label validation).

**Pros:** Explicit.
**Cons:** Hand-rolled DNS regex is famously hard to get right.
**Effort:** Small.
**Risk:** Medium.

## Recommended Action

_To be filled during triage._ Likely Option 1.

## Technical Details

**Affected files:**

- `api/payjoin-proxy.ts:87` (parseTarget)
- `api/payjoin-proxy.test.ts` (add tests for normalization)

## Resources

- **PR:** #139
- **Reviewer:** security-sentinel P2-2

## Acceptance Criteria

- [ ] `parseTarget('evil.com./path')` returns null (or normalizes to `evil.com`).
- [ ] `parseTarget('.evil.com/path')` returns null.
- [ ] `parseTarget('evil..com/path')` returns null.
- [ ] `parseTarget('-evil.com/path')` returns null.
- [ ] New tests added to `api/payjoin-proxy.test.ts`.

## Work Log

### 2026-04-23 — Discovered in code review

**By:** Claude Code (ce:review)
