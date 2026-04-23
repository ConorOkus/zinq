---
status: complete
priority: p2
issue_id: '219'
tags: [code-review, testing, payjoin, hygiene]
dependencies: []
---

# Payjoin proxy tests hit live DNS / network

## Problem Statement

`api/payjoin-proxy.test.ts:146-173` contains two tests that make real `fetch()` calls:

- `btcpay.example/payjoin/x` — resolves (`.example` is IANA-reserved, hits NXDOMAIN, takes ~20s timeout)
- `payjo.in/abc/def` — hits real Payjoin directory (404 on random session)

Problems:

1. **CI flake vector**: DNS / network dependencies make tests non-deterministic.
2. **Slow CI**: 20s timeout × N test runs = significant wall time.
3. **`VALIDATION_REJECTS` heuristic is weak**: the test asserts the response status is NOT in `{400, 405, 413, 415, 429}`. Any upstream server that coincidentally returns one of those passes the test falsely.
4. **Missing 429 test**: `checkRateLimit` has branching logic that's untested.
5. **Missing 502 timeout test**: the 20s upstream timeout path is only hit by accident.

## Findings

- `api/payjoin-proxy.test.ts:133-173` — two tests with live fetch.
- `checkRateLimit` at `api/payjoin-proxy.ts:44-56` — branching untested.
- Kieran TypeScript reviewer Q7, security-sentinel P3-1.

## Proposed Solutions

### Option 1: Mock global fetch with vi.spyOn (Recommended)

**Approach:** Stub `globalThis.fetch` in the two live-network tests; assert `fetch` was called with the expected URL + headers. Add positive-signal assertions instead of double-negative `!VALIDATION_REJECTS.has(status)`.

```ts
const fetchSpy = vi
  .spyOn(globalThis, 'fetch')
  .mockResolvedValue(new Response('ok', { status: 200 }))
// ...
expect(fetchSpy).toHaveBeenCalledWith('https://btcpay.example/payjoin/x', expect.any(Object))
```

Also add:

- Rate-limit 429 test (call >= 60 times in < 60s)
- 502 timeout test (mock fetch that rejects with DOMException 'TimeoutError')

**Pros:** Deterministic; fast; exercises branches that currently aren't.
**Cons:** More verbose than the current lazy assertion.
**Effort:** Small-Medium (1-2 hours).
**Risk:** Low.

### Option 2: Add dedicated `describe.skipIf(network-disabled)` gating

**Approach:** Mark live-network tests as skippable; default to mock.

**Pros:** Can still run against real endpoints locally.
**Cons:** Maintenance burden.
**Effort:** Small.
**Risk:** Low.

## Recommended Action

_To be filled during triage._ Likely Option 1.

## Technical Details

**Affected files:**

- `api/payjoin-proxy.test.ts:133-173` (rewrite with mocks)
- Add tests for: 429 rate limit, 502 timeout, POST-method-only rejection (handlers accept only POST today; add explicit test).

## Resources

- **PR:** #139
- **Reviewer:** kieran-typescript-reviewer Q7, security-sentinel P3-1

## Acceptance Criteria

- [ ] No `fetch()` calls to external hosts in unit tests.
- [ ] `fetch` is stubbed via `vi.spyOn(globalThis, 'fetch')`.
- [ ] Test asserts `fetch` was called with correct target URL + headers (positive signal).
- [ ] New test: 429 rate-limit path.
- [ ] New test: 502 upstream timeout path.
- [ ] Test runtime reduced (no 20s NXDOMAIN timeouts).

## Work Log

### 2026-04-23 — Discovered in code review

**By:** Claude Code (ce:review)
