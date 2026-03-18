# Brainstorm: Send Flow Amount Auto-Detection

**Date:** 2026-03-18
**Status:** Draft

## What We're Building

Restructure the send flow from **amount-first** to **recipient-first**, so that payment inputs with embedded amounts (BIP321 URIs, BOLT11 invoices, BOLT12 offers) automatically skip the numpad and go straight to the review screen. When the user has insufficient balance for the embedded amount, block them before the review screen with a clear error.

### New Flow

```
recipient --> [amount if needed] --> review --> sending --> success
                                            --> error
```

- **Input has amount:** recipient → review (skip numpad)
- **Input has no amount:** recipient → numpad → review (current numpad step)

### Scope

- BIP321 URIs with `?amount=` parameter
- BOLT11 invoices with embedded amounts
- BOLT12 offers with amounts (treated as fixed, not minimum)
- Plain on-chain addresses and amountless invoices still go through the numpad
- Insufficient balance detection before review screen

## Why This Approach

The current flow is amount → recipient → review. This forces users to manually type an amount on the numpad even when the payment request already specifies one. Most wallets use a recipient-first flow, and the QR scanner branch already implements skip-to-review logic for scanned inputs with amounts. This change makes the manual paste/type flow consistent with the scanner flow.

**Rejected alternatives:**
- **Recipient-first with always-show-amount:** Adds an unnecessary confirmation tap for fixed-amount invoices.
- **Keep amount-first with paste on numpad:** Awkward UX — paste button on a numpad is unexpected and doesn't fix the ordering issue.

## Key Decisions

1. **Recipient-first flow** — Flip the state machine from `amount → recipient → review` to `recipient → amount (if needed) → review`.
2. **Skip numpad for embedded amounts** — When BIP321/BOLT11/BOLT12 input includes an amount, go directly from recipient to review.
3. **BOLT12 amounts are fixed** — Treat offer amounts as exact, not as a pre-filled minimum. No numpad shown.
4. **Block before review on insufficient balance** — Show an error/toast on the recipient screen immediately after parsing. Do not advance to review.
5. **Amountless inputs show numpad** — Plain addresses, amountless BOLT11, and amountless offers still route through the numpad step.

## Resolved Questions

1. **QR scanner branch alignment** — Build independently on main. The `feat/qr-code-scanner` branch has related skip logic but will be reconciled during merge.
2. **Back navigation** — Back from review (when numpad was skipped) goes to the recipient screen. The amount is fixed by the payment request, so there's no numpad to edit.
