---
title: 'feat: Implement Open Channel UI Flow'
type: feat
status: completed
date: 2026-03-15
---

# feat: Implement Open Channel UI Flow

## Overview

Add a multi-step UI flow for opening a Lightning Network payment channel. The backend event handling already exists (`FundingGenerationReady`, `FundingTxBroadcastSafe`, `ChannelPending`, `ChannelReady`). This plan covers the UI page, LDK context wrapper, routing, and wiring.

## Problem Statement / Motivation

The Advanced page has placeholder "Open Channel" and "Close Channel" buttons with `route: null`. Users cannot open channels through the UI — they have no way to lock on-chain funds into a Lightning channel for off-chain payments. This is the critical next step after peer connectivity.

## Proposed Solution

A new `OpenChannel` page following the Send page's discriminated union state machine pattern with steps: **select peer → enter amount → review → opening → success/error**. A `createChannel` method is added to the LDK context following the `connectToPeer` pattern.

## Key Design Decisions

1. **`create_channel()` success = terminal UI state.** The event handler processes `FundingGenerationReady` → `FundingTxBroadcastSafe` asynchronously. Rather than building an event subscription system, the UI treats a successful `create_channel()` return as "channel opening initiated" and shows a success screen. The channel will appear in a future channel list once confirmed. This matches the wallet's existing fire-and-forget async pattern.

2. **Approximate fee estimation.** The actual funding tx fee is unknown until the event handler builds it. The review screen displays an approximate fee: `feeRate * 140 vB` (standard 1-input P2TR funding tx weight ~560 WU). Labeled "≈" to indicate it's an estimate.

3. **Connected peers only.** The peer selection step shows only currently connected peers. If none are connected, an empty state links to the Peers page. This avoids needing inline reconnection logic.

4. **Gate on both LDK and onchain readiness.** The page requires `ldk.status === 'ready'` AND `onchain.status === 'ready'` to prevent the silent failure where `FundingGenerationReady` fires but `bdkWallet` is null.

5. **`userChannelId` via `crypto.getRandomValues`.** Generate 16 random bytes, convert to `BigInt` for the U128 parameter.

6. **`push_msat` hardcoded to `0n`.** No initial balance push to counterparty. Can be user-configurable later.

7. **Double-submit protection** via `useRef(false)` guard, matching Send.tsx's `sendingRef` pattern.

## Technical Considerations

### Architecture

- Follows the established three-file context pattern: types in `ldk-context.ts`, provider in `context.tsx`, hook in `use-ldk.ts`
- Page component follows Send.tsx pattern: single `useState<OpenChannelStep>`, sequential `if` blocks for rendering, `useCallback` handlers for transitions
- No new shared components needed — reuses `ScreenHeader`, `Numpad`, `formatBtc`

### State Machine

```typescript
type OpenChannelStep =
  | { step: 'select-peer' }
  | { step: 'amount'; peer: ConnectedPeer }
  | {
      step: 'reviewing'
      peer: ConnectedPeer
      amountSats: bigint
      estimatedFeeSats: bigint
      feeRate: bigint
    }
  | { step: 'opening' }
  | { step: 'success' }
  | { step: 'error'; message: string }
```

Where `ConnectedPeer` is `{ pubkey: string; host?: string; port?: number }`.

### Back Navigation

- `select-peer` → back navigates to Advanced page
- `amount` → back goes to `select-peer`
- `reviewing` → back goes to `amount`
- `error` → "Try Again" goes to `amount`

### Error Handling

`create_channel()` returns an LDK `Result` type. Known failure modes:

- Peer not connected → "Peer is no longer connected. Please reconnect and try again."
- Amount below minimum → "Channel amount must be at least 20,000 sats."
- Generic failure → Log full error, show sanitized message to user

### Fund Safety

- The funding tx build, sign, and broadcast are handled by the existing event handler (`src/ldk/traits/event-handler.ts:214-298`). This plan does not modify that code.
- The `fundingTxCache` is in-memory only. If the tab reloads between `FundingGenerationReady` and `FundingTxBroadcastSafe`, the cached tx is lost and the channel will time out. This is an accepted limitation for testnet (documented in existing code).
- Balance validation is approximate (amount + estimated fee ≤ on-chain balance). The actual fee may differ slightly.

## System-Wide Impact

- **Interaction graph**: `createChannel()` → `channelManager.create_channel()` → LDK internally queues `FundingGenerationReady` → event processing loop (10s interval) fires event handler → BDK builds + signs tx → `funding_transaction_generated()` → LDK queues `FundingTxBroadcastSafe` → next event loop broadcasts via Esplora
- **Error propagation**: `create_channel()` errors are caught in the page. Post-create errors (BDK failure, broadcast failure) are logged by the event handler but invisible to the UI — accepted tradeoff per Decision 1
- **State lifecycle risks**: No new persistence. The existing `fundingTxCache` leak on `DiscardFunding` is already documented. No orphaned state risk from the UI layer
- **API surface parity**: No other interface exposes channel opening — this is the first

## Acceptance Criteria

- [x] Tapping "Open Channel" on the Advanced page navigates to the new page
- [x] Peer selection shows currently connected peers with truncated pubkey and host
- [x] Empty state shown when no peers are connected, with link to Peers page
- [x] Numpad allows entering channel capacity in sats, displayed as BTC
- [x] Amount validated: ≥ 20,000 sats and ≤ (on-chain balance - estimated fee)
- [x] Review screen shows: peer (truncated pubkey), channel amount, estimated fee, fee rate
- [x] Confirm calls `channelManager.create_channel()` with correct parameters
- [x] Success screen shown on successful `create_channel()` return
- [x] Error screen shown on failure with descriptive message and "Try Again" option
- [x] Double-click protection prevents multiple `create_channel()` calls
- [x] Page gated on both LDK and onchain context readiness
- [x] Back navigation works correctly at each step
- [x] Dark background, ScreenHeader, Numpad — consistent with Send page styling

## Implementation Phases

### Phase 1: Context Layer

**Files:**

- `src/ldk/ldk-context.ts` — Add `createChannel` to the `ready` variant of `LdkContextValue`
- `src/ldk/context.tsx` — Implement `createChannel` as a `useCallback`, add to state

**`createChannel` signature:**

```typescript
createChannel: (counterpartyPubkey: Uint8Array, channelValueSats: bigint) =>
  Result_ChannelIdAPIError
```

**Implementation:**

- Generate `userChannelId` from 16 random bytes → `BigInt`
- Call `channelManager.create_channel(counterpartyPubkey, channelValueSats, 0n, userChannelId, null)`
- Return the Result for the page to handle

### Phase 2: Page and Route

**Files:**

- `src/pages/OpenChannel.tsx` — New page component (primary work)
- `src/routes/router.tsx` — Add route `settings/advanced/open-channel`
- `src/pages/Advanced.tsx` — Change `route: null` to `'/settings/advanced/open-channel'` on line 15

**Page structure (following Send.tsx pattern):**

1. Early returns for `ldk.status !== 'ready'` or `onchain.status !== 'ready'`
2. `useState<OpenChannelStep>({ step: 'select-peer' })` for state machine
3. `useRef(false)` for double-submit guard
4. Peer list fetched via `ldk.node.peerManager.list_peers()` (same pattern as Peers.tsx)
5. Fee rate from `onchain.estimateFee()` or fee estimator
6. Sequential `if` blocks rendering each step
7. `useCallback` handlers for: `handleSelectPeer`, `handleAmountConfirm`, `handleConfirm`, `handleBack`

**Step renders:**

- **select-peer**: ScreenHeader + list of connected peers as tappable rows (truncated pubkey + host)
- **amount**: ScreenHeader + balance display + Numpad + "Next" button + validation error
- **reviewing**: ScreenHeader + peer info + amount + estimated fee + fee rate + "Open Channel" button
- **opening**: Centered spinner + "Opening channel..."
- **success**: Checkmark icon + "Channel Opening" + "Your channel is being set up" + "Done" button → navigate to Home
- **error**: X icon + error message + "Try Again" button → back to `amount` step

### Phase 3: Polish

- Verify the flow end-to-end on Mutinynet with a real peer
- Ensure consistent styling with Send page (font-display buttons, uppercase tracking, safe-area padding)

## Sources & References

### Internal References

- Send page state machine pattern: `src/pages/Send.tsx:11-24`
- LDK context method pattern (`connectToPeer`): `src/ldk/context.tsx:22-31`
- Event handler funding flow: `src/ldk/traits/event-handler.ts:214-298`
- Peer listing pattern: `src/pages/Peers.tsx:25-71`
- Router: `src/routes/router.tsx:12-27`
- Advanced page placeholder: `src/pages/Advanced.tsx:6-16`
- LdkNode interface: `src/ldk/init.ts:45-58`

### Institutional Learnings

- BDK-LDK cross-WASM tx bridge: `docs/solutions/integration-issues/bdk-ldk-cross-wasm-transaction-bridge.md`
- LDK event handler sync/async patterns: `docs/solutions/integration-issues/ldk-event-handler-patterns.md`
- Discriminated union state machine pattern: `docs/solutions/design-patterns/secure-sensitive-data-display-with-state-machine.md`
- LDK trait defensive hardening: `docs/solutions/integration-issues/ldk-trait-defensive-hardening-patterns.md`
