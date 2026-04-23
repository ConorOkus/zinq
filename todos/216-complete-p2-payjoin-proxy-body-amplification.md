---
status: complete
priority: p2
issue_id: '216'
tags: [code-review, security, payjoin]
dependencies: []
---

# content-length spoofing lets attacker buffer ~4 MB before rejection

## Problem Statement

`api/payjoin-proxy.ts:132-144`:

```ts
const contentLength = Number(request.headers.get('content-length') ?? 0)
if (contentLength > MAX_BODY_BYTES) {
  return Response.json({ error: 'body too large' }, { status: 413 })
}
// ...
const body = await request.arrayBuffer()
if (body.byteLength > MAX_BODY_BYTES) {
  return Response.json({ error: 'body too large' }, { status: 413 })
}
```

A client can send `content-length: 100` with an actual body of arbitrary size. The post-read check catches it, but only after Vercel Edge has already buffered the full body — up to Edge Runtime's documented 4 MB limit. That's a 40× amplification window (100 KB declared → 4 MB actual).

This is a subtle resource-consumption vector: the caller makes us process ~40 × the bytes they admit to sending.

Simultaneously, the pre-read `content-length` header check is largely redundant (attacker lies about it) — it's only useful against honest clients with oversized payloads.

## Findings

- `api/payjoin-proxy.ts:132-144` — two checks, both bypassable or redundant against a lying client.
- Vercel Edge request body limit: ~4 MB (per Vercel docs).
- Reviewer: security-sentinel P2-3, simplicity (redundant check).

## Proposed Solutions

### Option 1: Stream-and-short-circuit at MAX_BODY_BYTES (Recommended)

**Approach:** Use `request.body` (ReadableStream) and read chunks up to `MAX_BODY_BYTES`. Abort with 413 when the limit is exceeded, before buffering more.

```ts
const reader = request.body?.getReader()
if (!reader) return Response.json({ error: 'no body' }, { status: 400 })
const chunks: Uint8Array[] = []
let total = 0
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  total += value.length
  if (total > MAX_BODY_BYTES) {
    reader.cancel()
    return Response.json({ error: 'body too large' }, { status: 413 })
  }
  chunks.push(value)
}
const body = new Uint8Array(total)
let offset = 0
for (const c of chunks) {
  body.set(c, offset)
  offset += c.length
}
```

**Pros:** Eliminates amplification; removes redundant pre-read.
**Cons:** More code than `await request.arrayBuffer()`.
**Effort:** Medium (1-2 hours including tests).
**Risk:** Low.

### Option 2: Keep `arrayBuffer()` but drop the pre-read

**Approach:** Remove the content-length header check (redundant). Accept that Edge's 4 MB cap is our effective limit; document it.

**Pros:** Simpler; fewer LOC.
**Cons:** Keeps the amplification window.
**Effort:** Small.
**Risk:** Low (documented tradeoff).

## Recommended Action

_To be filled during triage._ Option 1 for security; Option 2 if simplicity reviewer's "too speculative" concern wins.

## Technical Details

**Affected files:**

- `api/payjoin-proxy.ts:132-144`
- `api/payjoin-proxy.test.ts` (new test: declared CL ≪ actual body → 413)

## Resources

- **PR:** #139
- **Reviewer:** security-sentinel P2-3, simplicity reviewer
- **Reference:** [Vercel Edge body limits](https://vercel.com/docs/functions/edge-middleware/edge-runtime)

## Acceptance Criteria

- [ ] Body size short-circuits BEFORE buffering the full payload.
- [ ] Test: declared content-length=100 + actual 1 MB body → 413 without buffering 1 MB.
- [ ] Redundant pre-read check removed (or kept with explicit comment explaining why).

## Work Log

### 2026-04-23 — Discovered in code review

**By:** Claude Code (ce:review)
