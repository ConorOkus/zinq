---
status: pending
priority: p2
issue_id: 120
tags: [code-review, ldk, peers]
dependencies: []
---

# Disconnect stale connection before overwriting in reconnect path

## Problem Statement

In `maybeReconnectPeers`, when a new connection is established, the code sets `activeConnections.current.set(pk, conn)` without first disconnecting any existing stale connection in the map. The manual `connectToPeer` callback at line 55 correctly calls `.get(pubkey)?.disconnect()` before overwriting. This inconsistency could leak WebSocket handles.

## Findings

- **Security reviewer**: "The reconnection path skips the disconnect step, which could leak WebSocket handles if a half-open connection still exists in the map."
- **TypeScript reviewer**: Flagged the same inconsistency with the manual connect path.

## Proposed Solutions

### Option A: Add disconnect before set (Recommended)

```typescript
activeConnections.current.get(pk)?.disconnect()
const conn = await doConnectToPeer(node.peerManager, pk, host, port)
activeConnections.current.set(pk, conn)
```

- **Effort**: Small (one line)
- **Risk**: Low

## Technical Details

- **Affected files**: `src/ldk/context.tsx` (reconnect handler, ~line 471)

## Acceptance Criteria

- [ ] `activeConnections.current.get(pk)?.disconnect()` called before `.set(pk, conn)` in reconnect path

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created from PR #29 review | Consistency with manual connect path |

## Resources

- PR: #29
- File: `src/ldk/context.tsx:469-472` (reconnect), `src/ldk/context.tsx:55` (manual connect)
