---
status: pending
priority: p3
issue_id: "029"
tags: [code-review, architecture, quality]
dependencies: []
---

# Extract init helpers and split sync/maintenance concerns

## Problem Statement

`initializeLdk()` is ~130 lines handling everything from WASM init to node ID derivation. `startSyncLoop` takes 8 positional arguments and mixes sync + persistence + LDK maintenance. Both will grow when PeerManager and event processing are added.

## Findings

- **Source:** TypeScript Reviewer, Architecture Strategist, Agent-Native Reviewer
- **Recommendations:**
  1. Extract `restoreOrCreate<T>()` helper for NetworkGraph/Scorer/ChannelManager restore blocks
  2. Split `startSyncLoop` into sync tick + maintenance tick
  3. Use options object instead of 8 positional args
  4. Consider `bootNode()` function that encapsulates init + sync start for headless use
  5. Encapsulate WatchState inside init return (return `startSync` closure instead of raw WatchState)

## Acceptance Criteria

- [ ] Init function broken into smaller, testable units
- [ ] Sync loop separated from maintenance/persistence concerns
- [ ] Options object replaces positional args

## Work Log

| Date | Action | Details |
|------|--------|---------|
| 2026-03-11 | Created | From PR #3 code review |
