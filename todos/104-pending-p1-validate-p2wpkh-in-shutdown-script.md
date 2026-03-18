---
status: pending
priority: p1
issue_id: '104'
tags: [code-review, security, fund-safety]
dependencies: []
---

# ShutdownScript assumes P2WPKH without validation — fund loss risk

## Problem Statement

`bdk-signer-provider.ts` line 75 does `script.slice(2)` assuming P2WPKH format (22 bytes: OP_0 + 20-byte hash) and passes the result to `ShutdownScript.constructor_new_p2wpkh()`. If BDK ever returns a different address type (P2TR, P2WSH), the slice produces a wrong-length byte array, creating a malformed shutdown script. Cooperative close funds would go to an unspendable address — **permanent fund loss**.

## Findings

- **File**: `src/ldk/traits/bdk-signer-provider.ts:70-78`
- **Identified by**: security-sentinel (C1), architecture-strategist
- **Known Pattern**: See `docs/solutions/integration-issues/ldk-trait-defensive-hardening-patterns.md` — all trait adapters must validate inputs defensively

## Proposed Solutions

### Option A: Validate P2WPKH format, fall back to KeysManager on mismatch
Add explicit check: `script.length === 22 && script[0] === 0x00 && script[1] === 0x14`. If validation fails, fall back to `defaultProvider.get_shutdown_scriptpubkey()`.

- **Pros**: Simple, safe, minimal code
- **Cons**: Falls back to non-BDK address if format changes
- **Effort**: Small
- **Risk**: Low

### Option B: Support both P2WPKH and P2TR
Check script prefix and length, construct appropriate ShutdownScript for each type using `constructor_new_p2wpkh` or `constructor_new_witness_program`.

- **Pros**: Future-proof for taproot wallets
- **Cons**: More code, P2TR may not be needed yet
- **Effort**: Small-Medium
- **Risk**: Low

## Acceptance Criteria

- [ ] Script format validated before slicing
- [ ] Invalid format falls back to KeysManager default
- [ ] Unit test covers P2WPKH happy path and invalid script fallback
