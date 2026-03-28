# Brainstorm: BOLT 12 Receive (Offer Creation)

**Date:** 2026-03-19

## What We're Building

Add the ability for zinqq to create and display BOLT 12 offers so the wallet can receive payments via the modern offer protocol. This is the first step toward full BIP 353 Lightning Address support (`user@zinqq.app`).

### MVP (This Phase)

- Generate a BOLT 12 offer from the LDK channel manager
- Display the offer string and QR code in **Advanced settings**
- Offer is reusable — same string works for multiple payments
- Offer only works while the wallet tab is open (browser-based LDK node must be running to handle onion message exchange)

### Future Phases (Out of Scope)

- **Managed DNS service:** Auto-publish the offer as a BIP 353 TXT record at `user@zinqq.app`
- **LSP relay:** Partner with an existing LSP to proxy onion messages when the wallet is offline, enabling always-on receive
- **BIP 321 integration:** Add `lno=` parameter to the Receive page's unified QR code
- **Receive page offer tab:** Promote offer display from Advanced to the main Receive flow

## Why This Approach

Starting with offer creation in Advanced settings lets us:

1. **Prove the LDK plumbing works** — `create_offer_builder()` and inbound onion message handling need to be wired up and tested on signet before building infrastructure on top
2. **Keep scope minimal** — No DNS, no LSP, no UI redesign. Just one new function and a display section
3. **Design for extension** — The offer string is the same regardless of how it's later published (DNS, QR, NFC). Getting generation right first means future phases are additive

## Key Decisions

- **Location:** Advanced settings page, not the main Receive flow (yet)
- **Offer persistence:** Generate once, persist to IndexedDB, and reuse — the nonce may not be deterministic across restarts
- **Online-only:** Accept the limitation that the offer only works when the tab is open. This is fine for signet/demo use
- **LSP strategy:** When offline receive is needed, integrate with an existing LSP rather than building our own relay infrastructure

## What Already Exists

- **Sending to offers:** Fully supported — `parseBolt12Offer()` in `payment-input.ts`, `sendBolt12Payment()` in `context.tsx`
- **OnionMessenger:** Already initialized in `init.ts` (line 321) with `channelManager.as_OffersMessageHandler()`
- **LDK Offer API:** `Offer` type imported from `lightningdevkit`, `Result_OfferBolt12ParseErrorZ_OK` used for parsing
- **Advanced page:** Exists at `src/pages/Advanced.tsx` — will be the home for the offer display

## Resolved Questions

1. **Does LDK WASM expose `create_offer_builder()` on the channel manager?** — Yes. `ChannelManager.create_offer_builder(absolute_expiry: Option_u64Z)` returns `Result_OfferWithDerivedMetadataBuilderBolt12SemanticErrorZ`. The builder supports `.chain()`, `.description()`, `.amount_msats()`, `.path()`, and `.build()` which returns a `Result_OfferBolt12SemanticErrorZ`.
2. **Offer persistence format** — Persist the offer string to IndexedDB on first creation. Even though LDK derives offers from the channel manager's `ExpandedKey` and a `Nonce`, the nonce may not be deterministic across restarts. Persisting avoids a subtle bug where a shared offer silently stops working after a restart.
3. **Inbound payment handling** — The existing `Event_PaymentClaimable` handler in `event-handler.ts` (line 149) calls `channelManager.claim_funds(preimage)` when a preimage is available. BOLT 12 inbound payments provide a preimage via `purpose.preimage()`, so the existing handler should work without changes.

## Open Questions

None — all questions resolved.
