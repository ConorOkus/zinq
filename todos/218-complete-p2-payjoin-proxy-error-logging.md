---
status: complete
priority: p2
issue_id: '218'
tags: [code-review, observability, payjoin]
dependencies: []
---

# Payjoin proxy swallows errors without logging; ops can't diagnose

## Problem Statement

`api/payjoin-proxy.ts:171-173`:

```ts
} catch {
  return Response.json({ error: 'upstream unavailable' }, { status: 502 })
}
```

The catch block discards the error entirely. A failing upstream (timeout, DNS failure, TLS error, receiver returning malformed response) is invisible to ops — Vercel logs show nothing beyond the 502. Debugging a production incident is significantly harder than it needs to be.

## Findings

- `api/payjoin-proxy.ts:171-173` — error swallowed.
- Kieran TypeScript reviewer Q3.
- Dev middleware at `vite.config.ts:132` does log the error message (good). Prod is silent.

## Proposed Solutions

### Option 1: `console.error` before return (Recommended)

**Approach:**

```ts
} catch (err) {
  console.error('[payjoin-proxy]', err instanceof Error ? err.message : String(err))
  return Response.json({ error: 'upstream unavailable' }, { status: 502 })
}
```

**Pros:** Minimal; Vercel log aggregation picks it up; no change to response body (no info leak to caller).
**Cons:** Plain string logging — no structured fields.
**Effort:** Trivial.
**Risk:** Low.

### Option 2: Structured logging with request context

**Approach:** Log the target URL, status, elapsed ms, error class. Consider integrating with existing `captureError` if available from server side.

**Pros:** Better on-call debuggability.
**Cons:** `captureError` is client-side (`src/storage/error-log.ts`); would need a different logger.
**Effort:** Medium.
**Risk:** Low.

## Recommended Action

_To be filled during triage._ Option 1 is sufficient for Phase 1; Option 2 when the proxy sees real traffic.

## Technical Details

**Affected files:**

- `api/payjoin-proxy.ts:171-173`

## Resources

- **PR:** #139
- **Reviewer:** kieran-typescript-reviewer Q3

## Acceptance Criteria

- [ ] Catch branch logs the error before returning 502.
- [ ] Log line appears in `vercel logs` output on failure.
- [ ] Response body unchanged (no info leak to caller).

## Work Log

### 2026-04-23 — Discovered in code review

**By:** Claude Code (ce:review)
