# Brainstorm: Add Amount to Request Flow

**Date:** 2026-03-19
**Status:** Ready for planning

## What We're Building

Adding the ability to specify an amount when requesting a payment. The Receive screen currently generates a zero-amount BOLT 11 invoice + on-chain address and displays a unified BIP 21 QR code. We want to let the user optionally set an amount, which regenerates the invoice and URI with the specified value.

**User flow:**

1. User taps "Request" from Home — Receive screen loads with a zero-amount QR (current behavior, unchanged)
2. A tappable "Add amount" label is visible on the screen
3. Tapping it switches the view to show the `Numpad` component inline (temporarily replacing the QR)
4. User enters an amount in sats, confirms
5. The invoice and URI regenerate with the amount embedded — QR view returns with the updated code
6. User can tap the displayed amount to edit it again

## Why This Approach

**Two-mode single screen** was chosen over a state machine or bottom sheet because:

- Preserves the current zero-amount default UX — no extra steps for users who don't need an amount
- Minimal structural change to `Receive.tsx` — just toggling between QR and numpad views
- Reuses the existing `Numpad` component from the Send flow
- Simpler than overlay/sheet approaches which add UI layering complexity

## Key Decisions

- **Amount is default-zero, editable** — The screen loads immediately with a zero-amount invoice (preserving current behavior). User can tap to add an amount and regenerate.
- **Sats only** — No denomination toggle. Consistent with the Send flow's use of sats and `formatBtc()`.
- **Inline numpad** — Tapping "Add amount" shows the `Numpad` on the same screen, replacing the QR temporarily. No navigation or separate screen.
- **BIP 21 amount parameter included** — When an amount is set, the `bitcoin:` URI includes `?amount=X.XXXXX` (in BTC) so both lightning and on-chain paths carry the amount.
- **`createInvoice` gets optional amount parameter** — The LDK context's `createInvoice` function needs to accept an optional `amountMsat` to pass to `Option_u64Z.constructor_some()`.

## Scope

### In scope

- Amount entry UI on Receive screen (numpad toggle)
- Updating `createInvoice` to accept optional amount
- Including amount in BIP 21 URI when set
- Regenerating QR when amount changes

### Out of scope

- Denomination toggle (sats/BTC)
- Description/memo field
- BOLT 12 offers
- Fiat conversion display
