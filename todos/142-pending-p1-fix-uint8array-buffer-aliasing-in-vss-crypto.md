---
status: pending
priority: p1
issue_id: 142
tags: [code-review, security, crypto]
dependencies: []
---

# Fix Uint8Array .buffer aliasing in VSS crypto and key derivation

## Problem Statement

`Uint8Array.prototype.buffer` returns the **entire underlying ArrayBuffer**, which may be larger than the view if the array was created via `.subarray()` or from a library that returns views into pooled buffers. Passing `.buffer` to Web Crypto API (`importKey`, `digest`) would silently operate on wrong bytes.

This is a Bitcoin wallet — deriving the wrong encryption key from aliased bytes would make VSS backups **unrecoverable**.

Flagged by: TypeScript reviewer, Security sentinel, Architecture strategist (all three).

## Findings

- `src/ldk/storage/vss-crypto.ts:45` — `encryptionKey.buffer as ArrayBuffer` passed to `crypto.subtle.importKey`
- `src/wallet/keys.ts:47` — `ldkSeed.buffer as ArrayBuffer` passed to `crypto.subtle.digest`
- Currently safe because `@scure/bip32` returns fresh Uint8Arrays, but this is a latent bug if upstream changes or any intermediate code wraps the key in a subarray.

## Proposed Solutions

### Option A: Copy before accessing buffer (Recommended)
Replace `.buffer as ArrayBuffer` with `new Uint8Array(source).buffer`:
```typescript
// vss-crypto.ts
new Uint8Array(encryptionKey).buffer
// keys.ts
new Uint8Array(ldkSeed).buffer
```
- **Pros**: Simple, eliminates the `as ArrayBuffer` cast, guaranteed safe
- **Cons**: One extra copy (~32 bytes, negligible)
- **Effort**: Small
- **Risk**: None

## Acceptance Criteria

- [ ] No `.buffer as ArrayBuffer` patterns remain in VSS-related code
- [ ] Tests still pass (round-trip encryption, key derivation determinism)
