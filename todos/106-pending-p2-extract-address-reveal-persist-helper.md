---
status: pending
priority: p2
issue_id: '106'
tags: [code-review, quality, architecture]
dependencies: []
---

# Duplicated address-reveal-persist pattern across 3 locations

## Problem Statement

The pattern `next_unused_address()` → `take_staged()` → `putChangeset()` is copy-pasted in 3 places: `bdk-signer-provider.ts:31-40`, `event-handler.ts:105-112`, and `event-handler.ts:264-271`. The fire-and-forget `void putChangeset().catch()` pattern also means a crash between reveal and persistence loses the address. Extracting a shared helper consolidates the logic and makes it easier to add durability later.

## Findings

- **Identified by**: security-sentinel (H2), code-simplicity-reviewer
- **Impact**: ~15 LOC saved, eliminates risk of the three copies diverging

## Proposed Solution

Extract `getNextAddressScript(wallet: Wallet): Uint8Array` helper into `src/onchain/address-utils.ts` that handles reveal + persistence internally.

- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] Single shared helper for address reveal + changeset persistence
- [ ] All 3 call sites use the shared helper
- [ ] Helper persists changeset (fire-and-forget is acceptable for now)
