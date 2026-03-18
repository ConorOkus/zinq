---
title: Send Flow Reorder — Amount-First State Machine with Two-Phase Validation
category: design-patterns
date: 2026-03-16
module: src/pages/Send.tsx
tags: [send, state-machine, numpad, balance, validation, lightning, onchain, react]
severity: MEDIUM
related:
  - ../integration-issues/bdk-wasm-onchain-send-patterns.md
  - ../integration-issues/ldk-wasm-foundation-layer-patterns.md
---

# Send Flow Reorder — Amount-First State Machine

## Problem

The send flow used a recipient-first ordering (input → amount → review) which didn't match the Payy-inspired design system. Reordering to amount-first introduced several non-obvious challenges:

1. **Payment type unknown at amount entry** — can't validate against on-chain balance vs Lightning capacity
2. **Send max requires recipient address** for fee calculation, but address isn't known yet
3. **Fixed-amount invoices** conflict with the user-entered amount
4. **Error retry** must return to the right step, not always step 1

## Root Cause

The original state machine had separate `oc-amount` and `ln-amount` states because the payment type was known after the recipient step. Reordering means the amount step must be payment-type-agnostic.

## Solution

### Unified State Machine

Replace type-specific amount states with generic `amount` and `recipient` steps:

```typescript
// src/pages/Send.tsx:22-52
type SendStep =
  | { step: 'amount' }                    // First screen — numpad
  | { step: 'recipient' }                 // Second screen — text input
  | { step: 'oc-review'; address: string; amount: bigint; fee: bigint; feeRate: bigint; isSendMax: boolean }
  | { step: 'ln-review'; parsed: ParsedPaymentInput & { type: 'bolt11' | 'bolt12' | 'bip353' }; amountMsat: bigint }
  // ... terminal states unchanged
```

### Two-Phase Validation

- **Phase 1 (numpad):** Reject zero, enforce max 8 digits. No dust or capacity checks.
- **Phase 2 (after classification in `processRecipientInput`):** Enforce 294-sat dust minimum for on-chain, validate against on-chain balance or Lightning outbound capacity.

```typescript
// src/pages/Send.tsx:178-211
if (parsed.type === 'onchain') {
  if (effectiveAmount < MIN_DUST_SATS) {
    setInputError('Amount must be at least 294 sats (dust limit)')
    return
  }
  if (effectiveAmount > onchainBalance) {
    setInputError('Amount exceeds available on-chain balance')
    return
  }
  // ... fee estimation
}
```

### Unified Balance on Numpad

Show combined on-chain + Lightning balance since payment type is unknown:

```typescript
// src/pages/Send.tsx:101
const unified = useUnifiedBalance()
// ...
// src/pages/Send.tsx:689
{formatBtc(unified.total)} available
```

### Send Max Approximation

Use unified balance as approximate max on numpad. Recalculate exact amount after address entry:

```typescript
// src/pages/Send.tsx:139-143
const handleApproxSendMax = useCallback(() => {
  if (unified.total <= 0n) return
  setAmountDigits(unified.total.toString())
  setIsSendMax(true)
}, [unified.total])
```

After on-chain address entry, if `isSendMax`, call `estimateMaxSendable(address)` for exact fee-adjusted amount.

### Fixed-Amount Invoice Handling

When a BOLT 11 invoice or BIP 321 URI carries a fixed amount, use the parsed amount and discard the numpad amount:

```typescript
// src/pages/Send.tsx:233-240
const effectiveMsat = (parsed.type !== 'bip353' && parsed.amountMsat !== null)
  ? parsed.amountMsat
  : amountSats * 1000n
```

### Error Retry Preserves State

Error "Try Again" returns to recipient (not amount), preserving both `amountDigits` and `inputValue`. Non-retryable errors ("Done") navigate home:

```typescript
// src/pages/Send.tsx:493-498
if (sendStep.canRetry) {
  setSendStep({ step: 'recipient' })
} else {
  void navigate('/')
}
```

### Race Condition Guard

`processRecipientInput` uses a `processingRef` guard to prevent concurrent invocations from paste + click:

```typescript
// src/pages/Send.tsx:154,161
if (processingRef.current) return
processingRef.current = true
try { /* ... */ } finally { processingRef.current = false }
```

## Prevention

1. **Model flows as explicit state machines** — discriminated unions catch missing transitions at compile time
2. **Keep amount as provisional** until confirmation — label approximations clearly in the UI
3. **Map each error class to the earliest resolvable step** — don't unconditionally reset to step 1
4. **Write one test per valid transition edge** — reordering immediately reveals missed transitions
5. **Use refs for async guards** (`processingRef`, `sendingRef`) — `useState` is async and can't prevent races in the same event loop tick
