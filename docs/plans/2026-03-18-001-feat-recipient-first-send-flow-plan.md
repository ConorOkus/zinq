---
title: "feat: Recipient-first send flow with amount auto-detection"
type: feat
status: completed
date: 2026-03-18
origin: docs/brainstorms/2026-03-18-send-flow-amount-autodetect-brainstorm.md
---

# feat: Recipient-first send flow with amount auto-detection

## Overview

Restructure the send flow from amount-first (`amount → recipient → review`) to recipient-first (`recipient → [amount if needed] → review`). When a payment input (BIP321 URI, BOLT11 invoice, BOLT12 offer) contains an embedded amount, skip the numpad entirely and go straight to review. When the user has insufficient balance for the embedded amount, block them on the recipient screen with an error before advancing.

(See brainstorm: `docs/brainstorms/2026-03-18-send-flow-amount-autodetect-brainstorm.md`)

## Problem Statement / Motivation

The current amount-first flow forces users to type an amount on the numpad even when the payment request already specifies one. This is redundant friction — most wallets use recipient-first, and the QR scanner branch already implements skip-to-review logic for scanned inputs with amounts. This change makes the manual flow consistent with the scanner flow and eliminates unnecessary steps.

## Proposed Solution

### New State Machine

```
recipient --> [amount if needed] --> oc-review / ln-review --> sending --> success
                                                           --> error (canRetry → review)
```

**Flow by input type:**

| Input Type | Has Amount? | Numpad? | Next Step |
|---|---|---|---|
| Plain on-chain address | No | Yes | `amount → oc-review` |
| BIP 321 URI + `?amount=` | Yes (sats) | Skip | `oc-review` |
| BOLT 11 (fixed amount) | Yes (msat) | Skip | `ln-review` |
| BOLT 11 (zero-amount) | No | Yes | `amount → ln-review` |
| BOLT 12 (fixed amount) | Yes (msat) | Skip | `ln-review` |
| BOLT 12 (no amount) | No | Yes | `amount → ln-review` |

### New `SendStep` Discriminated Union

```typescript
type SendStep =
  | { step: 'recipient' }
  | { step: 'amount'; parsedInput: ParsedPaymentInput; rawInput: string }
  | { step: 'oc-review'; address: string; amount: bigint; fee: bigint; feeRate: bigint; isSendMax: boolean }
  | { step: 'oc-broadcasting' }
  | { step: 'oc-success'; txid: string; amount: bigint }
  | { step: 'ln-review'; parsed: ParsedPaymentInput & { type: 'bolt11' | 'bolt12' | 'bip353' }; amountMsat: bigint }
  | { step: 'ln-sending'; parsed: ...; amountMsat: bigint; paymentId: Uint8Array }
  | { step: 'ln-success'; preimage: Uint8Array; amountMsat: bigint }
  | { step: 'error'; message: string; canRetry: boolean }
```

**Key change:** The `amount` step now carries `parsedInput` and `rawInput` from the recipient screen. This allows the numpad's "Next" to call `processRecipientInput(rawInput)` with the user-entered amount, without re-prompting for the recipient.

### Back Navigation

| From | Back goes to | Rationale |
|---|---|---|
| `recipient` | `/` (home) | First step in the flow |
| `amount` | `recipient` | Preserves `inputValue` so user doesn't re-enter |
| `oc-review` (numpad was shown) | `amount` | Preserve the manually entered amount |
| `oc-review` (numpad skipped) | `recipient` | Amount is fixed by payment request |
| `ln-review` (numpad was shown) | `amount` | Same as on-chain |
| `ln-review` (numpad skipped) | `recipient` | Same as on-chain |
| `error` (canRetry) | review step | Preserve all state, just retry (see brainstorm) |

To determine whether back from review goes to `amount` or `recipient`, track a `numpadWasShown` flag — or simply check whether the current `sendStep` transitioned from `amount` (has `parsedInput`) vs directly from `recipient`.

### Insufficient Balance Handling

Block on the recipient screen (before review) via `inputError`:
- **On-chain:** `effectiveAmount > onchainBalance` → `"Amount (X sats) exceeds available on-chain balance"`
- **Lightning:** `effectiveMsat > lnCapacityMsat` → `"Amount (X sats) exceeds available Lightning balance"`

This uses the existing `inputError` state and `processRecipientInput` error path — no new UI needed.

### QR Scanner Integration

When arriving from the QR scanner via `location.state.scannedInput`:
- **Input has amount:** Skip recipient entirely, go straight to review
- **Input has no amount:** Skip recipient, go straight to numpad (with `parsedInput` and `rawInput` set in the `amount` step)

This aligns with the existing QR scanner branch pattern (pass raw string, re-parse in Send.tsx). Build independently on main; reconcile with `feat/qr-code-scanner` during merge.

### Numpad Behavior

- **Available balance display:** Keep showing unified balance (`useUnifiedBalance().total`), consistent with current behavior
- **Send Max:** Use unified balance approximation as today. Exact type-specific max is computed during `processRecipientInput`
- **No changes to `Numpad.tsx` component** — it remains stateless/presentational

## Technical Considerations

### `processRecipientInput` Refactor

The function currently closes over `amountSats` and `isSendMax` from component state. In the new flow:

1. **When called from recipient screen (input has amount):** `amountSats` will be `0n` and `isSendMax` will be `false`. This is fine — the function already uses `parsed.amountSats ?? amountSats` for on-chain and `parsed.amountMsat` for lightning with fixed amounts.

2. **When called from numpad (input has no amount):** `amountSats` will be the user-entered value. The function uses `amountSats * 1000n` for lightning and `amountSats` for on-chain. This works as-is.

**No signature change needed.** The existing closure-based approach works because:
- Recipient-with-amount path: parsed amount overrides `amountSats` (which is 0)
- Numpad path: `amountSats` is set by the user before `processRecipientInput` is called

The only change is that the numpad's "Next" handler calls `processRecipientInput(sendStep.rawInput)` instead of `setSendStep({ step: 'recipient' })`.

### State Preservation

- `inputValue` (recipient text field) must be preserved when navigating back from `amount` to `recipient`
- `amountDigits` must be preserved when navigating back from review to `amount`
- Both are already component-level state that persists across `sendStep` changes

### Race Condition Guard

The existing `processingRef` guard in `processRecipientInput` prevents concurrent calls from paste + click. This remains important — no changes needed.

## System-Wide Impact

- **No API changes** — all changes are within `Send.tsx` and `Send.test.tsx`
- **No parser changes** — `payment-input.ts` already extracts amounts correctly
- **No balance hook changes** — `use-unified-balance.ts` unchanged
- **Design doc update** — `docs/solutions/design-patterns/react-send-flow-amount-first-state-machine.md` should be updated to reflect recipient-first ordering

## Acceptance Criteria

- [x] Send flow starts on recipient screen (text input for address/invoice/offer)
- [x] Pasting a BOLT11 invoice with amount skips numpad, goes to ln-review
- [x] Pasting a BIP321 URI with `?amount=` skips numpad, goes to oc-review
- [x] Pasting a BOLT12 offer with amount skips numpad, goes to ln-review
- [x] Pasting a plain on-chain address shows numpad, then oc-review
- [x] Pasting an amountless BOLT11 shows numpad, then ln-review
- [x] Insufficient on-chain balance shows error on amount screen (does not advance to review)
- [x] Insufficient Lightning capacity shows error on recipient screen (does not advance to review)
- [x] Back from review goes to numpad when amount was manually entered
- [x] Back from review goes to recipient when amount was auto-detected
- [x] Back from numpad goes to recipient with input preserved
- [x] Error with canRetry returns to review screen (preserving all state)
- [x] QR scanner with amount skips recipient and numpad, goes to review
- [x] QR scanner without amount skips recipient, goes to numpad
- [x] Existing on-chain send tests updated for recipient-first ordering
- [x] New tests for Lightning fixed-amount and amountless paths

## MVP

### src/pages/Send.tsx

The core changes — updated `SendStep` type, reordered initial step, conditional numpad routing, back navigation logic:

```typescript
// New initial state
const [sendStep, setSendStep] = useState<SendStep>({ step: 'recipient' })

// After processRecipientInput classifies input:
// - Has amount → transition to oc-review or ln-review (existing logic)
// - No amount → transition to { step: 'amount', parsedInput, rawInput }

// Numpad "Next" handler:
const handleAmountNext = useCallback(() => {
  if (amountSats <= 0n) return
  if (sendStep.step !== 'amount') return
  void processRecipientInput(sendStep.rawInput)
}, [amountSats, sendStep, processRecipientInput])

// Back from review — check if numpad was shown:
// If previous step was 'amount', go back to 'amount' (preserve parsedInput/rawInput)
// If previous step was 'recipient', go back to 'recipient'
```

### src/pages/Send.test.tsx

Update test helpers and add new test cases:

```typescript
// Updated helper — recipient is now the first screen
const goToAmountScreen = async (input: string) => {
  const recipientInput = screen.getByPlaceholderText(/address, invoice/i)
  await userEvent.clear(recipientInput)
  await userEvent.paste(input)
  // For no-amount inputs, this should show the numpad
}

// New test: BOLT11 with amount skips numpad
test('bolt11 with amount skips numpad and goes to review', ...)

// New test: insufficient balance blocks before review
test('shows error when bolt11 amount exceeds lightning capacity', ...)
```

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-18-send-flow-amount-autodetect-brainstorm.md](docs/brainstorms/2026-03-18-send-flow-amount-autodetect-brainstorm.md) — Key decisions: recipient-first flow, skip numpad for embedded amounts, BOLT12 as fixed, block before review on insufficient balance, back to recipient when numpad skipped
- Current state machine: `src/pages/Send.tsx:22-52`
- Payment parser: `src/ldk/payment-input.ts:13-18`
- Balance validation: `src/pages/Send.tsx:153-244` (`processRecipientInput`)
- Design doc (to update): `docs/solutions/design-patterns/react-send-flow-amount-first-state-machine.md`
- QR scanner integration doc: `docs/solutions/integration-issues/qr-scanner-camera-send-flow-integration.md`
