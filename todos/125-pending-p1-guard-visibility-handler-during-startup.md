---
status: pending
priority: p1
issue_id: 125
tags: [code-review, connectivity, race-condition]
dependencies: []
---

# Guard visibility handler during startup reconnection

## Problem Statement

The `visibilitychange` handler calls `disconnect_all_peers()` unconditionally when the tab becomes visible. If this fires during startup reconnection (before `peersReconnectedRef.current` is `true`), it nukes the in-flight startup connections. Then `maybeReconnectPeers()` bails out because the startup guard (`!peersReconnectedRef.current`) returns early. Result: all peers disconnected with no recovery path until `peersReconnectedRef` is eventually set to `true` by the (now-destroyed) startup promise.

Additionally, there is no debounce — rapid tab switching triggers a full disconnect/reconnect cycle each time, preventing `channel_reestablish` from ever completing.

## Findings

- **TypeScript Reviewer**: Identified the startup race as critical — `disconnect_all_peers()` destroys startup reconnection, then guard prevents recovery.
- **Security Reviewer**: Identified unbounded disconnect/reconnect on rapid tab switching as medium severity self-DoS.
- **Both recommend**: Add startup guard AND debounce/cooldown to the visibility handler.

## Proposed Solutions

### Option A: Startup guard + timestamp debounce (Recommended)
Add `if (!peersReconnectedRef.current) return` at top of visible handler. Add a `lastReconnectTimestamp` check (5s cooldown).

- **Pros**: Simple, addresses both issues, minimal code
- **Cons**: None significant
- **Effort**: Small (5 lines)
- **Risk**: Low

### Option B: Startup guard + setTimeout debounce
Guard startup. Use `setTimeout(500ms)` for reconnection, cancelled on next `hidden` event.

- **Pros**: More precise — only reconnects after sustained visibility
- **Cons**: Slightly more complex (need to track timeout ID)
- **Effort**: Small
- **Risk**: Low

## Technical Details

**Affected files:** `src/ldk/context.tsx` (visibility handler, ~line 716)

## Acceptance Criteria

- [ ] Visibility handler returns early if `peersReconnectedRef.current` is false
- [ ] Rapid tab switching does not trigger multiple disconnect/reconnect cycles
- [ ] Normal tab-return-from-background still triggers reconnection after startup
