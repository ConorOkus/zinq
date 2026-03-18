---
status: pending
priority: p1
issue_id: 122
tags: [code-review, security, fund-safety, onchain]
dependencies: []
---

# Fix syncNow() concurrency guard — syncRequested flag is a no-op

## Problem Statement

The `syncRequested` flag in `syncNow()` is set to `true` then immediately set back to `false` in the same synchronous block (lines 103-111 of `src/onchain/sync.ts`). This means the guard `if (stopped || syncRequested) return` can never be tripped by `syncRequested` — it's always `false` when checked.

This creates two issues:
1. Multiple rapid `syncNow()` calls (e.g., batch channel closes) each fire a new `void tick()`, causing overlapping async sync operations on the non-thread-safe BDK WASM Wallet.
2. Overlapping `tick()` calls cause `take_staged()` interleaving — one call consumes the changeset, the second gets empty, potentially losing persistence of the closing tx discovery.

## Findings

- **TypeScript reviewer**: "syncRequested flag cleared immediately, provides no concurrency guard" — BLOCKING BUG
- **Security reviewer**: "Two interleaved async tick() calls create a take_staged() loss window" — MEDIUM severity
- **Architecture reviewer**: "Dead guard that should either be removed or fixed to actually debounce rapid syncNow() calls"
- **Simplicity reviewer**: "Dead code that adds confusion — 4 LOC to remove"

## Proposed Solutions

### Option A: Fix syncRequested as debounce + add isSyncing guard
- Clear `syncRequested` in `scheduleNext()` when retries exhaust, not in `syncNow()`
- Add `isSyncing` flag in `tick()` to prevent overlapping async operations
- **Effort**: Small (10 lines)
- **Risk**: Low — strictly more correct than current behavior

### Option B: Remove syncRequested, rely on single-threaded JS
- Remove the flag entirely since JS event loop prevents true parallel execution
- The timeout clear + `void tick()` pattern is inherently sequential
- **Effort**: Small (4 lines removed)
- **Risk**: Low — but doesn't debounce multiple syncNow() calls during retry window

## Technical Details

- **File**: `src/onchain/sync.ts` lines 26, 102-113
- **Related**: `scheduleNext()` at lines 73-82

## Acceptance Criteria

- [ ] `syncNow()` called twice rapidly does NOT trigger overlapping `tick()` executions
- [ ] `syncRequested` flag is either removed or properly guards during retry window
- [ ] Existing tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-17 | Created from PR #30 code review | All 4 reviewers flagged this independently |

## Resources

- PR: #30
- Related learning: `docs/solutions/integration-issues/bdk-wasm-onchain-wallet-integration-patterns.md`
