---
status: complete
priority: p2
issue_id: '275'
tags: [code-review, parser, error-handling, bip321]
dependencies: []
---

# `parseBip321` silently skips malformed `%`-sequences in query pairs

## Problem Statement

PR #147 stripped Payjoin from `parseBip321` and, alongside the `pj=` parsing logic, removed both the `console.warn` and the comment that explained why malformed `%`-sequences must surface ("Surface in dev so a corrupt `pj=` doesn't silently degrade to a non-Payjoin send (privacy footgun)").

The catch block now silently `continue`s on any `decodeURIComponent` failure for _any_ key — so a URI like `bitcoin:bc1q…?amount=0.00%ZZ` will silently drop the `amount=` and route the user to the numpad to enter an amount, rather than surfacing "Malformed Bitcoin URI." The privacy-footgun framing is gone, but the silent-degradation pattern remains for non-payjoin keys.

## Findings

- `src/ldk/payment-input.ts:223-224` (post-PR #147) — `try { decodeURIComponent(...) } catch { continue }`, no logging, no error surface.
- Flagged by `kieran-typescript-reviewer` as P3; raising to P2 because malformed `amount=` silent-skip is a real send-flow regression for non-payjoin URIs.

## Proposed Solutions

### Option 1: Surface as a parse error (recommended)

Treat any `%`-decode failure on the BIP 21 query as a hard error: return `{ type: 'error', message: 'Malformed Bitcoin URI' }` from the catch block. RFC 3986 says `%` followed by non-hex is invalid; we don't need to be lenient.

**Pros:** No silent degradation. Explicit "this URI is broken" feedback to the user.

**Cons:** Stricter than browsers. Hand-typed URIs with stray `%` will fail loudly.

**Effort:** 10 min.

**Risk:** Low.

### Option 2: Restore the `console.warn` only

```ts
} catch {
  console.warn('parseBip321: skipped malformed query pair', rawKey)
  continue
}
```

**Pros:** Preserves the legacy "surface in dev" intent without changing user-visible behavior.

**Cons:** Still silently degrades in prod (warn is no-op for end users).

**Effort:** 5 min.

**Risk:** Low.

## Recommended Action

To be filled during triage. Option 1 preferred — silent skip on malformed URI input is a poor send-flow UX.

## Technical Details

**Affected files:** `src/ldk/payment-input.ts`.

## Acceptance Criteria

- [ ] A malformed query pair in a `bitcoin:` URI either fails loudly with a parse error or emits a dev-only warn — verified with a unit test.

## Resources

- **PR:** #147
- **Reviewer:** `kieran-typescript-reviewer`

## Work Log

### 2026-04-29 — Surfaced during PR #147 review

**By:** kieran-typescript-reviewer
