---
status: complete
priority: p2
issue_id: '271'
tags: [code-review, ux, simplicity, send-flow]
dependencies: []
---

# Collapse `oc-broadcasting` step into a Confirm-button busy state

## Problem Statement

`oc-broadcasting` was a state-machine step that earned its keep when `handleOcConfirm` could spend tens of seconds in the Payjoin proposal exchange. After PR #147 stripped Payjoin, the on-chain confirm path is just `BDK build (sync) → sign (sync) → one Esplora broadcast HTTP POST`. On mainnet this typically resolves in ~200–600ms.

The dedicated full-screen spinner (`Send.tsx:817-825`) flashes for less time than a single render frame in many cases. Worse, on a fast failure the user sees a brief spinner→error transition because the review screen is unmounted before the error lands. Standard "submit button busy state" pattern would be both simpler and a better UX.

## Findings

- `src/pages/Send.tsx:584-603` — `handleOcConfirm` sets `oc-broadcasting`, then awaits broadcast, then sets `oc-success` or `error`. No long-running async work remains.
- `src/pages/Send.tsx:817-825` — full-screen spinner render gate.
- `src/pages/Send.tsx` `SendStep` discriminated union — `oc-broadcasting` variant has no payload, so removing it has zero ripple in type land.
- Flagged by `code-simplicity-reviewer` as P1 simplification.

## Proposed Solutions

### Option 1: Disable + relabel the Confirm button (recommended)

Replace the `oc-broadcasting` step with local `isBroadcasting` state. Disable the Confirm button and relabel to "Sending…" while the broadcast is in flight.

```tsx
const [isBroadcasting, setIsBroadcasting] = useState(false)

// in handleOcConfirm
sendingRef.current = true
setIsBroadcasting(true)
try { ... } finally {
  sendingRef.current = false
  setIsBroadcasting(false)
}
```

Drop the `oc-broadcasting` variant from `SendStep` and the render gate.

**Pros:** Standard pattern, ~15 LOC saved, no flash on fast failure.

**Cons:** None.

**Effort:** 30 min.

**Risk:** Low.

### Option 2: Keep `oc-broadcasting` for visual consistency with `ln-sending`

Lightning sends genuinely take seconds — `ln-sending` is justified. Keeping `oc-broadcasting` mirrors the structure even if it flashes.

**Pros:** Symmetry between LN and on-chain flows.

**Cons:** Symmetry isn't a real benefit; the two flows have different latency profiles.

**Effort:** 0 min.

**Risk:** N/A.

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:** `src/pages/Send.tsx`, `src/pages/Send.test.tsx` (any test that asserts on the broadcasting screen).

## Acceptance Criteria

- [ ] `oc-broadcasting` removed from `SendStep` union.
- [ ] Confirm button shows "Sending…" / spinner while broadcast in flight.
- [ ] Fast-failure case lands directly on the error screen from the review screen.
- [ ] All existing on-chain Send tests still pass (or are updated to the new state shape).

## Resources

- **PR:** #147
- **Reviewer:** `code-simplicity-reviewer`

## Work Log

### 2026-04-29 — Surfaced during PR #147 review

**By:** code-simplicity-reviewer
