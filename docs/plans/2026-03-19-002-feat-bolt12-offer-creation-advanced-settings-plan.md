---
title: "feat: Add BOLT 12 offer creation and display in Advanced settings"
type: feat
status: completed
date: 2026-03-19
origin: docs/brainstorms/2026-03-19-bolt12-receive-brainstorm.md
---

# feat: Add BOLT 12 offer creation and display in Advanced settings

## Overview

Add the ability for zinq to create a reusable BOLT 12 offer and display it (string + QR + copy) in the Advanced settings page. This is the foundation for future BIP 353 Lightning Address support (`user@zinq.app`). (See brainstorm: `docs/brainstorms/2026-03-19-bolt12-receive-brainstorm.md`)

The offer only works while the wallet tab is open — the browser-based LDK node must be running to handle the onion message invoice request/response exchange.

## Problem Statement / Motivation

Zinq already supports **sending** to BOLT 12 offers but cannot **receive** via them. BOLT 12 offers are reusable payment codes (like a static Lightning address) that don't expire and support payer privacy via blinded paths. Adding offer creation is the first step toward a managed `user@zinq.app` Lightning Address service.

## Proposed Solution

1. Wire up `channelManager.create_offer_builder()` in the LDK context
2. Persist the offer string to IndexedDB (create once, reuse across sessions)
3. Display the offer on the Advanced settings page with QR code and copy button
4. Defer offer creation until `peersReconnected === true` so blinding paths are populated

### Builder Configuration

```typescript
const builderResult = node.channelManager.create_offer_builder(
  Option_u64Z.constructor_none() // no expiry
)
// ... check Result_OfferWithDerivedMetadataBuilderBolt12SemanticErrorZ_OK
const builder = builderResult.res
builder.chain(Network.LDKNetwork_Signet)
builder.description('zinq wallet')
const offerResult = builder.build()
// ... check Result_OfferBolt12SemanticErrorZ_OK
const offerStr = offerResult.res.to_str()
```

## Technical Considerations

- **Blinding paths require connected peers.** `create_offer_builder()` may produce an unreachable offer if called before peer reconnection. Defer creation until `peersReconnected === true`.
- **Signet chain required.** Must call `.chain(Network.LDKNetwork_Signet)` — without it, the offer defaults to mainnet and signet wallets will reject it.
- **Nonce may not be deterministic.** The offer must be persisted to IDB because `create_offer_builder()` may use a random nonce, producing a different offer on each call. (See brainstorm: resolved question 2)
- **Existing event handler works for BOLT 12 inbound.** `PaymentClaimable` at `event-handler.ts:149` claims via `purpose.preimage()` — BOLT 12 payments provide a preimage via `Bolt12OfferPayment` purpose. Verify on signet.
- **IDB bigint caveat.** If any bigint values are stored, convert to string first (per `bdk-ldk-transaction-history-indexeddb-persistence.md`). The offer is a plain string so this doesn't apply directly, but keep in mind.
- **Result type handling.** Use `instanceof` narrowing for all LDK Result types, never `as` casts (per `ldk-wasm-foundation-layer-patterns.md`).

## Acceptance Criteria

- [x] `createOffer()` function in LDK context creates a BOLT 12 offer via `create_offer_builder()`
- [x] Offer string persisted to new `ldk_bolt12_offer` IDB store on first creation
- [x] Subsequent calls return the persisted offer (no re-creation)
- [x] Advanced settings page displays offer string, QR code, and copy button
- [x] QR encodes raw `lno1...` string (not BIP 21 URI)
- [x] Copy button copies full offer string with "Copied!" feedback
- [x] Offer section shows loading state while node initializes
- [ ] Offer section shows "No channels" message when no inbound liquidity exists
- [x] Wallet restore (`clearAllStores()`) wipes the offer; next visit regenerates from new seed
- [x] Builder calls `.chain(Network.LDKNetwork_Signet)` and `.description('zinq wallet')`
- [x] Tests cover offer creation, persistence, and Advanced page display

## MVP

### Phase 1: Storage layer

#### `src/ldk/storage/idb.ts`

Add `'ldk_bolt12_offer'` to `STORES` array, bump `DB_VERSION` to 8.

#### `src/ldk/storage/offer.ts` (new file)

```typescript
import { idbGet, idbPut } from './idb'

const STORE = 'ldk_bolt12_offer' as const
const KEY = 'default'

export async function getPersistedOffer(): Promise<string | undefined> {
  return idbGet<string>(STORE, KEY)
}

export async function putPersistedOffer(offerStr: string): Promise<void> {
  return idbPut(STORE, KEY, offerStr)
}
```

### Phase 2: LDK context wiring

#### `src/ldk/ldk-context.ts`

Add to `LdkContextValue` ready state:

```typescript
bolt12Offer: string | null
```

#### `src/ldk/context.tsx`

- Add `bolt12Offer` state (`useState<string | null>(null)`)
- Add effect that runs when `peersReconnected === true`:
  1. Try `getPersistedOffer()` — if found, set state and return
  2. Otherwise call `channelManager.create_offer_builder(Option_u64Z.constructor_none())`
  3. Configure builder: `.chain(Network.LDKNetwork_Signet)`, `.description('zinq wallet')`
  4. Call `.build()`, get offer string via `.to_str()`
  5. Call `putPersistedOffer(offerStr)`, set state
- Expose `bolt12Offer` on the context value

### Phase 3: Advanced page UI

#### `src/pages/Advanced.tsx`

Add a section above the existing items list:

- When `ldk.status !== 'ready'` or `bolt12Offer === null`: show a subtle loading/placeholder
- When `bolt12Offer` is available: show:
  - Section header "BOLT 12 Offer"
  - QR code (`QRCodeSVG` from `qrcode.react`, already a dependency)
  - Truncated offer string with full-width copy button
  - Copy feedback ("Copied!" for 2s, same pattern as `Receive.tsx`)

### Phase 4: Tests

#### `src/ldk/storage/offer.test.ts` (new file)

- Test `putPersistedOffer` + `getPersistedOffer` round-trip
- Test `getPersistedOffer` returns `undefined` when empty

#### `src/pages/Advanced.test.tsx`

- Test offer string and QR code render when `bolt12Offer` is provided in context
- Test loading state when `bolt12Offer` is null
- Test copy button interaction

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-19-bolt12-receive-brainstorm.md](docs/brainstorms/2026-03-19-bolt12-receive-brainstorm.md) — key decisions: Advanced settings location, IDB persistence, online-only, existing LSP for future offline receive
- **LDK API:** `ChannelManager.create_offer_builder()` → `OfferWithDerivedMetadataBuilder` → `.build()` → `Offer.to_str()`
- **Storage pattern:** `src/ldk/storage/known-peers.ts` (simplest IDB wrapper example)
- **Context pattern:** `src/ldk/context.tsx:178-203` (`createInvoice` callback pattern)
- **Event handler:** `src/ldk/traits/event-handler.ts:149-169` (PaymentClaimable — works for BOLT 12)
- **OnionMessenger:** `src/ldk/init.ts:321-333` (already wired with `OffersMessageHandler`)
- **Learnings:** `docs/solutions/integration-issues/ldk-wasm-foundation-layer-patterns.md` (Result type narrowing), `docs/solutions/design-patterns/bdk-ldk-transaction-history-indexeddb-persistence.md` (IDB patterns)
