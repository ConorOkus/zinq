---
status: complete
priority: p1
issue_id: '213'
tags: [code-review, security, payjoin, dead-code]
dependencies: []
---

# Dead IPv6 branches in `isPrivateIp` have false-positive hostname matches

## Problem Statement

`isPrivateIp` at `api/payjoin-proxy.ts:70-72` has three IPv6 checks:

```ts
if (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd')) return true
if (hostname.startsWith('fe80')) return true
if (/^::ffff:/.test(hostname)) return true
```

Two problems:

1. **False positives**: `startsWith('fc')` and `startsWith('fd')` match legitimate DNS names like `fc-example.com`, `fd-service.net`, `fdic.gov`, `fcc.gov`. Those are blocked by the proxy — a correctness bug.
2. **Dead code**: `parseTarget` at line 87 rejects any hostname containing `:`, so IPv6 literals (including `::1`, `fc00::1`, `fe80::1`, `::ffff:127.0.0.1`) never reach `isPrivateIp`. The IPv6 branches are unreachable.

The net effect is bad: the code both blocks real hosts (false positives) AND pretends to protect against IPv6 private ranges that it in fact can never see.

## Findings

- `api/payjoin-proxy.ts:70-72` — three IPv6 branches that match on hostname prefix.
- `api/payjoin-proxy.ts:87` — regex `/^[a-z0-9.-]+$/i` + explicit `host.includes(':')` → rejects IPv6 literals outright.
- Flagged by security-sentinel P1-1 as "dangerously incomplete" — the deeper problem is "dangerously misleading."

## Proposed Solutions

### Option 1: Delete dead IPv6 branches, document invariant (Recommended)

**Approach:** Remove the three unreachable IPv6 checks. Add a comment to `isPrivateIp`:

```ts
// Hostnames only (IPv4 literals or DNS names). IPv6 literals are rejected
// at parseTarget by the ':' filter before reaching this function.
```

**Pros:** Honest; fixes the false positives; removes a landmine for future refactors.
**Cons:** If a future change lifts the `:` filter, IPv6 private ranges become reachable.
**Effort:** Small (10 min).
**Risk:** Low (adds a comment to guard the invariant).

### Option 2: Fix the IPv6 branches AND lift the `:` filter

**Approach:** Enable bracketed IPv6 literals via `parseTarget`. Update `isPrivateIp` with proper IPv6 parsing (ULA `fc00::/7`, link-local `fe80::/10`, loopback `::1`, mapped `::ffff::/96`, unspecified `::`, NAT64 `64:ff9b::/96`, documentation `2001:db8::/32`, multicast `ff00::/8`).

**Pros:** Correct IPv6 support.
**Cons:** Significantly more code; Payjoin relays advertised today are DNS names, not literals; ROI unclear for Phase 1.
**Effort:** Medium.
**Risk:** Medium (IPv6 parsing is a fingerprinting surface).

### Option 3: Keep branches, fix false positives

**Approach:** Make `fc` / `fd` checks stricter: `/^(fc|fd)[0-9a-f]{2}:/i` (ULA literal pattern).

**Pros:** No false positives.
**Cons:** Still dead code (IPv6 literals rejected at parseTarget); adds complexity for zero runtime effect.
**Effort:** Small.
**Risk:** Low.

## Recommended Action

_To be filled during triage._ Likely Option 1 (simplest, most honest).

## Technical Details

**Affected files:**

- `api/payjoin-proxy.ts:70-72` (dead branches)
- `api/payjoin-proxy.test.ts:32-38` (IPv6 tests will fail after delete — rewrite to assert parseTarget rejects them)

## Resources

- **PR:** #139
- **Reviewer:** security-sentinel P1-1

## Acceptance Criteria

- [ ] IPv6 branches in `isPrivateIp` either deleted (Option 1) or fixed for correctness (Option 2/3).
- [ ] No false-positive hostnames blocked (test `fc-example.com`, `fd-service.net` → not rejected).
- [ ] Test suite passes after update.
- [ ] Invariant documented if Option 1 chosen.

## Work Log

### 2026-04-23 — Discovered in code review

**By:** Claude Code (ce:review)

**Actions:**

- security-sentinel flagged IPv6 regex incompleteness
- Confirmed branches are unreachable due to `:` filter in parseTarget
- Filed as P1 because of false positives (real hosts blocked)
