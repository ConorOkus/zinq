---
status: pending
priority: p2
issue_id: 118
tags: [code-review, architecture, ldk]
dependencies: []
---

# Extract peer reconnection into dedicated module

## Problem Statement

The `maybeReconnectPeers` function (~60 lines) is defined inline inside the `useEffect` closure of `LdkProvider` in `src/ldk/context.tsx`. This file is already 685+ lines, and the peer timer callback now handles four distinct responsibilities: timer ticks, event processing, peer reconnection, and balance/channel detection. The reconnection logic also partially duplicates the startup auto-reconnect block.

## Findings

- **TypeScript reviewer**: "The reconnection logic is a self-contained concern that could be extracted... This makes it testable in isolation and keeps context.tsx from growing further."
- **Architecture reviewer**: "Future peer management additions (exponential backoff, max retry limits, connectivity status reporting) would benefit from extracting a PeerReconnector."
- **Simplicity reviewer**: "Duplicate reconnection logic — extract a shared `reconnectDisconnectedPeers` helper and call it from both places."

## Proposed Solutions

### Option A: Extract to standalone module (Recommended)

Create `src/ldk/peers/peer-reconnect.ts` with a factory function that encapsulates the reconnection concern. Both the startup auto-reconnect and periodic reconnect can share the core logic.

- **Pros**: Independently testable, reduces context.tsx size, enables future enhancements (backoff, retry limits)
- **Cons**: Requires passing node/activeConnections references
- **Effort**: Small
- **Risk**: Low

### Option B: Extract to custom hook

Create `useReconnectPeers` hook that manages its own interval and reconnection state.

- **Pros**: React-idiomatic, encapsulates interval lifecycle
- **Cons**: More complex, hook dependencies need careful management
- **Effort**: Medium
- **Risk**: Low

## Recommended Action

Option A — extract to `src/ldk/peers/peer-reconnect.ts`

## Technical Details

- **Affected files**: `src/ldk/context.tsx`, new `src/ldk/peers/peer-reconnect.ts`
- **Components**: LdkProvider peer timer, startup auto-reconnect

## Acceptance Criteria

- [ ] `maybeReconnectPeers` logic extracted to `src/ldk/peers/peer-reconnect.ts`
- [ ] Startup auto-reconnect and periodic reconnect share core logic
- [ ] `src/ldk/context.tsx` net reduction of ~40 lines
- [ ] Unit test for the reconnection logic in isolation

## Work Log

| Date       | Action                     | Learnings                             |
| ---------- | -------------------------- | ------------------------------------- |
| 2026-03-16 | Created from PR #29 review | Multiple reviewers flagged extraction |

## Resources

- PR: #29
- File: `src/ldk/context.tsx:435-487` (periodic reconnect), `src/ldk/context.tsx:531-582` (startup reconnect)
