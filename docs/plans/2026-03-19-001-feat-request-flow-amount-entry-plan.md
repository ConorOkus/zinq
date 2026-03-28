---
title: 'feat: Add amount entry to request flow'
type: feat
status: completed
date: 2026-03-19
origin: docs/brainstorms/2026-03-19-request-flow-amount-brainstorm.md
---

# feat: Add amount entry to request flow

## Overview

Add an optional amount input to the Receive screen. The screen loads as today (zero-amount QR), but the user can tap to enter an amount via the existing `Numpad` component. Confirming regenerates the BOLT 11 invoice and BIP 21 URI with the amount embedded. (See brainstorm: `docs/brainstorms/2026-03-19-request-flow-amount-brainstorm.md`)

## Proposed Solution

**Two-mode single screen** — toggle between QR display and inline numpad on the same `Receive.tsx` component. No new routes, no state machine. A simple `editingAmount` boolean controls which view renders.

### User Flow

1. Screen loads → zero-amount QR displayed (unchanged)
2. Tappable "Add amount" label visible below the QR
3. Tap → numpad replaces QR area; amount display above numpad
4. Enter digits → tap "Done" → invoice + URI regenerate → QR returns with amount
5. Amount now displayed as tappable label (e.g., `₿50,000`) — tap to re-edit
6. To clear: tap amount → backspace all digits → tap "Remove amount" link

## Technical Approach

### 1. Update `createInvoice` signature

**Files:** `src/ldk/ldk-context.ts:33`, `src/ldk/context.tsx:178-199`

Add optional `amountMsat` as the first parameter:

```typescript
// ldk-context.ts
createInvoice: (amountMsat?: bigint, description?: string) => string

// context.tsx
const createInvoice = (amountMsat?: bigint, description = 'Zinqq Wallet'): string => {
  const amountOption =
    amountMsat != null
      ? Option_u64Z.constructor_some(amountMsat)
      : Option_u64Z_None.constructor_none()

  const result = UtilMethods.constructor_create_invoice_from_channelmanager(
    node.channelManager,
    amountOption,
    description,
    3600,
    Option_u16Z_None.constructor_none()
  )
  // ... existing error handling
}
```

The only existing caller (`Receive.tsx`) passes no arguments, so this is backwards-compatible.

### 2. Add `satsToBtcString` utility

**File:** `src/onchain/bip21.ts` (alongside existing `btcStringToSats`)

```typescript
export function satsToBtcString(sats: bigint): string {
  const whole = sats / 100_000_000n
  const frac = (sats % 100_000_000n).toString().padStart(8, '0')
  return `${whole}.${frac}`
}
```

Always emits 8 decimal places for maximum wallet compatibility. Uses bigint arithmetic to avoid floating-point errors.

### 3. Update `Numpad` component — configurable button label

**File:** `src/components/Numpad.tsx`

Add optional `nextLabel` prop (default: `"Next"`):

```typescript
interface NumpadProps {
  onKey: (key: NumpadKey) => void
  onNext: () => void
  nextDisabled: boolean
  nextLabel?: string // NEW — defaults to "Next"
}
```

Receive screen passes `nextLabel="Done"`. Send flow unchanged.

### 4. Update `Receive.tsx` — two-mode toggle

**File:** `src/pages/Receive.tsx`

**New state:**

- `editingAmount: boolean` — controls QR vs numpad view
- `amountDigits: string` — raw digit input (same pattern as Send flow)
- Derived: `amountSats = amountDigits ? BigInt(amountDigits) : 0n`
- Derived: `amountMsat = amountSats * 1000n`

**Invoice generation changes:**

- Current: single `useEffect` calls `createInvoice()` once on mount
- New: call `createInvoice(amountMsat || undefined)` imperatively when the user confirms an amount, or via effect on initial load
- Store invoice in state; regenerate when amount changes

**URI construction:**

- Zero amount (current): `bitcoin:${address}?lightning=${invoice}`
- With amount: `bitcoin:${address}?amount=${satsToBtcString(amountSats)}&lightning=${invoice}`

**Numpad cancel:** Add a "Cancel" text button above the `Numpad` in the Receive layout (not in the shared component). Tapping it sets `editingAmount = false` without changing the amount. This resolves the gap where the `Numpad` has no dismiss affordance.

**Remove amount:** When `editingAmount` is true and an amount was previously set, show a "Remove amount" link. Tapping it clears `amountDigits`, regenerates a zero-amount invoice, and exits numpad mode.

**Pre-population on re-edit:** When tapping the amount to re-edit, pre-populate `amountDigits` with the current value so the user can make small adjustments.

**Amount display pattern** (reused from Send flow):

- `formatBtc(amountSats)` for the tappable label
- Dynamic font sizing: `amountDigits.length > 5 ? 'text-5xl' : 'text-7xl'`
- Replaces "Add amount" label when amount > 0

**Invoice failure on regeneration:** Show inline error text below the QR. Fall back to on-chain-only URI with `amount=` param so on-chain payments still work.

**Focus management:** Move focus to the first numpad key when entering edit mode; return focus to the amount label when exiting.

### 5. Update tests

**File:** `src/pages/Receive.test.tsx`

New test cases:

- [ ] "Add amount" label is visible on initial render
- [ ] Tapping "Add amount" shows the numpad and hides the QR
- [ ] Entering digits and confirming regenerates the QR with updated URI
- [ ] `createInvoice` is called with `amountMsat` when amount is set
- [ ] BIP 21 URI includes `?amount=` when amount > 0
- [ ] Cancel returns to QR without changing amount
- [ ] Tapping displayed amount re-opens numpad with pre-populated digits
- [ ] Remove amount clears back to zero-amount invoice
- [ ] Invoice failure shows error, falls back to on-chain-only URI

Update existing `createInvoice` mock to accept optional `amountMsat` parameter.

## Acceptance Criteria

- [x] Receive screen loads with zero-amount QR (current behavior preserved)
- [x] "Add amount" label is tappable and shows inline numpad
- [x] Numpad confirms with "Done" button (not "Next")
- [x] Cancel exits numpad without changing amount
- [x] Confirming regenerates BOLT 11 invoice with amount in msat
- [x] BIP 21 URI includes `?amount=<btc>` when amount is set
- [x] QR code updates to reflect new URI
- [x] Displayed amount is tappable to re-edit (pre-populated)
- [x] "Remove amount" clears back to zero-amount invoice
- [x] Invoice regeneration failure shows error, falls back to on-chain-only
- [x] Copy button copies the current (amount-bearing) URI
- [x] All existing Receive tests still pass
- [x] New tests cover amount entry, cancel, remove, and error flows

## Files Changed

| File                         | Change                                          |
| ---------------------------- | ----------------------------------------------- |
| `src/ldk/ldk-context.ts`     | Update `createInvoice` type signature           |
| `src/ldk/context.tsx`        | Accept optional `amountMsat` in `createInvoice` |
| `src/onchain/bip21.ts`       | Add `satsToBtcString` utility                   |
| `src/components/Numpad.tsx`  | Add optional `nextLabel` prop                   |
| `src/pages/Receive.tsx`      | Two-mode toggle, amount state, URI construction |
| `src/pages/Receive.test.tsx` | New test cases for amount entry flows           |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-19-request-flow-amount-brainstorm.md](docs/brainstorms/2026-03-19-request-flow-amount-brainstorm.md) — key decisions: default-zero editable, inline numpad, sats only, BIP 21 amount included
- **Send flow amount pattern:** `src/pages/Send.tsx:111-151` — `amountDigits` string, `handleNumpadKey`, `MAX_DIGITS`
- **Existing invoice generation:** `src/ldk/context.tsx:178-199` — `createInvoice` with `Option_u64Z`
- **BIP 21 parsing:** `src/onchain/bip21.ts` — `btcStringToSats` (inverse of new `satsToBtcString`)
- **Institutional learning:** `docs/solutions/integration-issues/bip321-unified-uri-bolt11-invoice-generation.md` — uppercase QR, preserve clipboard case, silent Lightning fallback
- **Send flow state machine learning:** `docs/solutions/design-patterns/react-send-flow-amount-first-state-machine.md` — two-phase validation, digit string pattern
