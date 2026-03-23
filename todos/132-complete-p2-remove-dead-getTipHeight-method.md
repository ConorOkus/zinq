---
status: pending
priority: p2
issue_id: '132'
tags: [code-review, quality]
---

# Remove dead getTipHeight() method

## Problem Statement

`EsploraClient.getTipHeight()` is no longer called by any production code after the chain sync fix replaced it with `getBlockHeight(tipHash)`. Keeping dead code increases maintenance surface and could mislead developers into using the inconsistent API.

## Findings

- Flagged by TypeScript reviewer and Simplicity reviewer
- `src/ldk/sync/esplora-client.ts` lines 39-46: dead method
- `src/ldk/sync/chain-sync.test.ts` line 32: dead mock property
- No production imports remain

## Proposed Solutions

### Option A: Delete method and update tests

- Remove `getTipHeight()` from `EsploraClient`
- Remove from chain-sync test mock
- Remove any standalone tests for it
- Effort: Tiny (~10 LOC)

## Technical Details

- **Affected files:** `src/ldk/sync/esplora-client.ts`, `src/ldk/sync/chain-sync.test.ts`, `src/ldk/sync/esplora-client.test.ts`

## Acceptance Criteria

- [ ] `getTipHeight` removed from EsploraClient
- [ ] No test references remain
- [ ] All tests pass
