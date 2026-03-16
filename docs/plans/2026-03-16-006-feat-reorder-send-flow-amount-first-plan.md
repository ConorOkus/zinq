---
title: "feat: Reorder send flow to amount-first with recipient input"
type: feat
status: completed
date: 2026-03-16
origin: docs/brainstorms/2026-03-14-onchain-send-brainstorm.md
---

# feat: Reorder send flow to amount-first with recipient input

## Overview

Reorder the send flow from **recipient → amount → review** to **amount (numpad) → recipient → review**. The recipient input placeholder should read `"payment request or user@domain"`, indicating support for BIP 321 URIs ("payment requests") and BIP 353 human-readable names. BIP 353 DNS resolution is deferred — UI accepts the format only.

This aligns the React app with the design prototype (`design/index.html`), which already uses amount-first ordering (see brainstorm: `docs/brainstorms/2026-03-15-ui-ux-design-system-brainstorm.md`).

## Problem Statement / Motivation

The current send flow asks for the recipient first, then the amount. This creates friction:

- Most users think "I want to send X sats" before "I want to send to Y address"
- The Payy-inspired design system places the numpad as the first interaction after tapping Send
- Amount-first enables a cleaner UX where fixed-amount invoices can skip the numpad entirely
- The placeholder text should guide users toward the supported input formats

## Proposed Solution

### New State Machine

Replace the current `SendStep` discriminated union with a reordered flow:

```
amount → recipient → oc-review | ln-review → broadcasting/sending → success | error
```

**New states:**

| State | Carries | Description |
|-------|---------|-------------|
| `amount` | — | Numpad entry. Shows unified balance. |
| `recipient` | `amountSats: bigint` | Text input for address/invoice/offer/HRN. Placeholder: `"payment request or user@domain"` |
| `oc-review` | `address, amountSats, fee, feeRate` | On-chain review (unchanged) |
| `ln-review` | `parsed, amountSats` | Lightning review (unchanged) |
| `oc-broadcasting` | txid pending | Spinner (unchanged) |
| `ln-sending` | payment pending | Spinner + polling (unchanged) |
| `oc-success` | txid | Success screen (unchanged) |
| `ln-success` | preimage | Success screen (unchanged) |
| `error` | message, retryStep? | Error with retry to review (not back to step 1) |

### Key Design Decisions

**1. Fixed-amount inputs skip the numpad**

When the user pastes a BOLT 11 invoice with a fixed amount, a BIP 321 URI with `?amount=`, or a fixed-amount BOLT 12 offer on the recipient screen — the parsed amount is used directly and the flow proceeds to review. The numpad amount is discarded. This avoids any conflict dialog since the invoice/URI amount is authoritative.

**2. Unified balance on the numpad**

The numpad shows combined on-chain + lightning balance as `"up to X available"` since the payment type isn't known yet. Post-classification, the review screen validates against the correct balance (on-chain balance or lightning outbound capacity).

**3. Send Max approximation on the numpad**

Show an approximate max using the unified balance. After the recipient is entered and classified as on-chain, recalculate the exact max using `estimateMaxSendable(address)`. For lightning, the outbound capacity is already exact.

**4. Two-phase validation**

- **Phase 1 (numpad):** Reject zero amount, enforce max 8 digits
- **Phase 2 (after classification):** Enforce 294-sat dust minimum for on-chain, validate against on-chain balance or lightning outbound capacity

**5. Recipient placeholder text**

```
placeholder="payment request or user@domain"
```

This hints at BIP 321 URI support ("payment request") and future BIP 353 support ("user@domain"). Currently `classifyPaymentInput()` handles BIP 321/BOLT 11/BOLT 12; BIP 353 resolution is deferred.

**6. Error retry preserves state**

The error screen's "Try Again" returns to the review screen with all data preserved, not back to the amount screen.

## Technical Considerations

### Files to modify

- **`src/pages/Send.tsx`** — Primary refactor: reorder state machine, move numpad to first step, add recipient step with new placeholder, update transitions
- **`src/pages/Send.test.tsx`** — Update all test flows to amount-first ordering
- **`src/components/Numpad.tsx`** — No changes needed (already reusable)
- **`src/ldk/payment-input.ts`** — No changes needed (`classifyPaymentInput()` already handles all input types)

### State preservation on back navigation

- Back from recipient → numpad: preserve `amountDigits`
- Back from review → recipient: preserve `inputValue`
- Back from numpad → home: clear all state, navigate to `/`

### classifyPaymentInput() interaction

The classifier returns `ParsedPaymentInput` with optional `amountSats`/`amountMsat`. The recipient step logic:

1. Call `classifyPaymentInput(inputValue)`
2. If parsed input has a fixed amount → use it, proceed to review (numpad amount discarded)
3. If parsed input has no amount → use numpad `amountSats`, proceed to review
4. If error → show inline error on recipient screen

### Balance display on numpad

Use `useUnifiedBalance()` hook (already exists at `src/hooks/use-unified-balance.ts`) to get combined balance. Display as:

```
formatBtc(unifiedBalance) + " available"
```

Tapping the balance triggers send-max approximation.

### Send Max approximation

On the numpad (before address is known):
- Use `unifiedBalance` as the approximate max
- After address entry, if on-chain: recalculate with `estimateMaxSendable(address)` and update the review screen amount
- If lightning: outbound capacity is already exact, no recalculation needed

## Acceptance Criteria

- [x] Tapping "Send" on home opens the numpad (amount entry) as the first screen
- [x] Numpad shows unified balance as "up to X available"
- [x] Tapping "Next" on numpad (with valid amount) proceeds to recipient screen
- [x] Recipient input placeholder reads `"payment request or user@domain"`
- [x] Pasting a bare bitcoin address proceeds to on-chain review with numpad amount
- [x] Pasting a BIP 321 URI with `?amount=` uses the URI's amount (discards numpad amount) and proceeds to review
- [x] Pasting a zero-amount BOLT 11 invoice proceeds to lightning review with numpad amount
- [x] Pasting a fixed-amount BOLT 11 invoice uses the invoice's amount and proceeds to lightning review
- [x] Pasting a BOLT 12 offer (no amount) proceeds to lightning review with numpad amount
- [x] Back navigation preserves entered amount and recipient values
- [x] Error retry returns to review screen, not back to amount entry
- [x] Send Max on numpad uses approximate unified balance; exact amount recalculated after address entry for on-chain
- [x] Dust limit (294 sats) validated after on-chain classification, not on numpad
- [x] Existing tests updated to reflect new flow order
- [x] Zero amount rejected on numpad (Next disabled)

## Success Metrics

- Send flow matches design prototype ordering (amount → recipient → review)
- All existing payment types (on-chain, BOLT 11, BOLT 12) still work correctly
- No regressions in Send.test.tsx

## Dependencies & Risks

- **`useUnifiedBalance()` hook** — already exists, provides combined balance
- **`classifyPaymentInput()`** — no changes needed, already handles all input types
- **Risk: Send Max accuracy** — approximate max on numpad may differ from actual max after fee calculation. Mitigation: recalculate on review screen and show updated amount.
- **Risk: Dust limit surprise** — user enters 100 sats, then gets an error after entering an on-chain address. Mitigation: clear error message directing user back to adjust amount.
- **Risk: Fixed-amount invoice discards numpad amount** — user may not notice. Mitigation: review screen prominently shows the amount with source attribution (e.g., "Amount set by invoice").

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-14-onchain-send-brainstorm.md](docs/brainstorms/2026-03-14-onchain-send-brainstorm.md) — two-step flow design, BIP 21 support, fee estimation patterns
- **Design system brainstorm:** [docs/brainstorms/2026-03-15-ui-ux-design-system-brainstorm.md](docs/brainstorms/2026-03-15-ui-ux-design-system-brainstorm.md) — Payy-inspired numpad-first send flow, custom numpad design
- **Design prototype:** `design/index.html` — amount-first send flow already prototyped
- **Key files:** `src/pages/Send.tsx`, `src/ldk/payment-input.ts`, `src/components/Numpad.tsx`, `src/hooks/use-unified-balance.ts`
- **Learnings:** `docs/solutions/integration-issues/bdk-wasm-onchain-send-patterns.md` — send pipeline safety patterns (double-submit guard, fee drift prevention, changeset persistence)
