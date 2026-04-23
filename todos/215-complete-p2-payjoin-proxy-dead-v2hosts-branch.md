---
status: complete
priority: p2
issue_id: '215'
tags: [code-review, payjoin, dead-code, simplicity]
dependencies: []
---

# Dead `V2_HOSTS` branch in payjoin-proxy

## Problem Statement

`api/payjoin-proxy.ts:120-125` contains an empty `if` block:

```ts
if (!V2_HOSTS.has(target.hostname)) {
  // Host is a v1 receiver-chosen endpoint; pass through (private-IP already rejected).
}
```

The `V2_HOSTS` constant is declared at line 25 but never used at runtime — only referenced in tests. The empty `if` pretends to enforce policy but does nothing. Simplicity review flagged this as a "no-op that pretends to enforce policy."

## Findings

- `api/payjoin-proxy.ts:25-30` — `V2_HOSTS` Set declared.
- `api/payjoin-proxy.ts:120-125` — empty `if` block.
- `api/payjoin-proxy.test.ts` — tests reference `V2_HOSTS` indirectly.
- Simplicity reviewer: dead code.

## Proposed Solutions

### Option 1: Delete both the set and the if-block (Recommended)

**Approach:** Remove `V2_HOSTS` entirely. v1 hosts are receiver-chosen and can't be allowlisted; v2 hosts reach the proxy through PDK's OHTTP encapsulation which targets known relays (also shipped in `vercel.json` CSP allowlist). The private-IP check + scheme check is the actual security boundary.

**Pros:** Honest code; no pretend enforcement.
**Cons:** If we later want to enforce v2-only for some path, we'd re-add.
**Effort:** Small (5 min).
**Risk:** Low.

### Option 2: Actually enforce v2 allowlist when URL shape signals v2

**Approach:** Differentiate v1 (target has `/payjoin/`-style path) from v2 (target is OHTTP-encapsulated to `payjo.in` / relays). Reject v2 requests targeting hosts not in `V2_HOSTS`.

**Pros:** Adds real defense.
**Cons:** Hard to reliably distinguish v1 vs v2 from the HTTP layer; PDK obscures this.
**Effort:** Medium.
**Risk:** Medium (false rejections).

## Recommended Action

_To be filled during triage._ Likely Option 1.

## Technical Details

**Affected files:**

- `api/payjoin-proxy.ts:25-30, 120-125`
- `api/payjoin-proxy.test.ts` (may reference V2_HOSTS; check)

## Resources

- **PR:** #139
- **Reviewer:** code-simplicity-reviewer, security-sentinel P2-2 (mentions V2_HOSTS not enforced)

## Acceptance Criteria

- [ ] `V2_HOSTS` either removed or actually enforced.
- [ ] No empty `if` block remains.
- [ ] Tests pass.

## Work Log

### 2026-04-23 — Discovered in code review

**By:** Claude Code (ce:review)
