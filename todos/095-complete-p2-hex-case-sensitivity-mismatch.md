---
status: pending
priority: p2
issue_id: '095'
tags: [code-review, quality, type-safety]
dependencies: []
---

# Hex validation case sensitivity mismatch between assertHex and hexToBytes

## Problem Statement

`assertHex` in `esplora-client.ts` only accepts lowercase hex (`/^[0-9a-f]+$/`), while `hexToBytes` in `utils.ts` accepts mixed case (`/^[0-9a-f]*$/i`). This inconsistency could cause latent bugs if `hexToBytes` is called with uppercase hex from a path that also passes through `assertHex`.

Additionally, `hexToBytes` allows empty strings (using `*` instead of `+`), producing an empty `Uint8Array` silently.

## Findings

- **File**: `src/ldk/sync/esplora-client.ts:7` — lowercase only, `+` quantifier
- **File**: `src/ldk/utils.ts:22` — case-insensitive, `*` quantifier
- **Identified by**: security-sentinel, kieran-typescript-reviewer

## Proposed Solution

Align both to lowercase-only with `+` quantifier:
```typescript
// utils.ts
if (hex.length % 2 !== 0) throw new Error('Hex string must have even length')
if (!/^[0-9a-f]+$/.test(hex)) throw new Error('Invalid hex characters')
```
