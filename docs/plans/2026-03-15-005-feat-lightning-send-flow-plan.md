---
title: 'feat: Lightning Send Flow with BIP 321, BOLT 11/12, and BIP 353 Support'
type: feat
status: completed
date: 2026-03-15
---

# feat: Lightning Send Flow with BIP 321, BOLT 11/12, and BIP 353 Support

## Overview

Implement a unified Lightning payment send flow that accepts multiple input formats through a single text field: BIP 321 unified URIs (with `lightning=` and `lno=` query parameters), raw BOLT 11 invoices, raw BOLT 12 offers, BIP 353 human-readable Bitcoin addresses (`user@domain`), and `lightning:` URI schemes. The flow extends the existing Send page to handle both on-chain and Lightning payments, using LDK WASM APIs for invoice parsing, offer payment, and DNS-resolved name payment.

## Problem Statement / Motivation

The wallet currently only supports on-chain Bitcoin sends. Lightning payments are the primary use case for a payments-focused wallet -- they're instant, low-fee, and the ecosystem is converging on BOLT 12 offers and BIP 353 human-readable names as the standard payment experience. Without Lightning send, the wallet is fundamentally incomplete.

## Proposed Solution

Extend the existing `/send` page into a unified send experience. A single input field classifies the pasted/scanned input and routes to the appropriate payment flow. The implementation is split into three phases: (1) OnionMessenger wiring as a prerequisite, (2) BOLT 11 invoice payments as the simplest path, (3) BOLT 12 offer and BIP 353 payments that build on the OnionMessenger foundation.

## Technical Approach

### Architecture

```
User Input → classifyInput() → PaymentMethod discriminated union
                                    │
                ┌───────────────────┼───────────────────┐
                ▼                   ▼                   ▼
           BOLT 11              BOLT 12             BIP 353
           parse invoice        parse offer         parse name
           extract params       check amount        show numpad
                │                   │                   │
                └───────────────────┼───────────────────┘
                                    ▼
                            Review Screen
                            (amount, recipient, fee estimate)
                                    │
                                    ▼
                            Payment Execution
                            (send_payment / pay_for_offer / pay_for_offer_from_human_readable_name)
                                    │
                                    ▼
                            Progress Screen
                            (polling list_recent_payments())
                                    │
                              ┌─────┴─────┐
                              ▼           ▼
                           Success      Error
                           (preimage)   (reason + retry?)
```

### Key Design Decisions

1. **Unified Send page** -- The existing `/send` route handles both on-chain and Lightning. The input classifier determines which flow to enter. This matches the BIP 321 unified URI philosophy and avoids fragmenting the UX.

2. **Payment state notification via polling** -- Use `channelManager.list_recent_payments()` polled at 1-second intervals during active payments. This is simpler than a pub/sub system and LDK already provides the API. The 10-second background timer continues for general event processing; the 1-second poll is local to the Send page during payment.

3. **OnionMessenger wired in init.ts** -- Replace `IgnoringMessageHandler` with a real `OnionMessenger` using `channelManager.as_OffersMessageHandler()`. This is a prerequisite for BOLT 12 and BIP 353 but also future-proofs for receiving offers.

4. **Input preference order for BIP 321** -- When a unified URI contains multiple payment options: BOLT 12 offer (`lno=`) > BOLT 11 invoice (`lightning=`) > on-chain address. This follows ecosystem direction and minimizes fees.

### Implementation Phases

#### Phase 1: OnionMessenger Wiring

Wire `OnionMessenger` into the LDK node initialization so BOLT 12 and BIP 353 flows can function.

**Tasks:**

- [x] Create `OnionMessenger` in `src/ldk/init.ts` using:
  - `keysManager.as_EntropySource()`
  - `keysManager.as_NodeSigner()`
  - `logger`
  - `channelManager.as_NodeIdLookUp()` (check availability; may need `NodeIdLookUp.new_impl()` with channel list lookup)
  - `messageRouter.as_MessageRouter()` (already created at line 199)
  - `channelManager.as_OffersMessageHandler()`
  - `ignorer.as_AsyncPaymentsMessageHandler()`
  - `ignorer.as_DNSResolverMessageHandler()` (upgrade later for BIP 353 if `ChannelManager` provides it)
  - `ignorer.as_CustomOnionMessageHandler()`
- [x] Replace `ignorer.as_OnionMessageHandler()` with `onionMessenger.as_OnionMessageHandler()` in `PeerManager` constructor (line 274)
- [x] Add `onionMessenger` to the `LdkNode` interface and return it from `initLdk()`
- [x] Process `onionMessenger.as_EventsProvider().process_pending_events(eventHandler)` in the event processing loop in `src/ldk/context.tsx` (alongside ChannelManager and ChainMonitor events)

**Files:**

- `src/ldk/init.ts` -- OnionMessenger creation, PeerManager wiring
- `src/ldk/ldk-context.ts` -- Add `onionMessenger` to `LdkNode` interface

```typescript
// src/ldk/init.ts -- Phase 1 addition
const onionMessenger = OnionMessenger.constructor_new(
  keysManager.as_EntropySource(),
  keysManager.as_NodeSigner(),
  logger,
  channelManager.as_NodeIdLookUp(),
  messageRouter.as_MessageRouter(),
  channelManager.as_OffersMessageHandler(),
  ignorer.as_AsyncPaymentsMessageHandler(),
  ignorer.as_DNSResolverMessageHandler(),
  ignorer.as_CustomOnionMessageHandler()
)

const peerManager = PeerManager.constructor_new(
  channelManager.as_ChannelMessageHandler(),
  ignorer.as_RoutingMessageHandler(),
  onionMessenger.as_OnionMessageHandler(), // was: ignorer.as_OnionMessageHandler()
  ignorer.as_CustomMessageHandler(),
  Math.floor(Date.now() / 1000),
  keysManager.as_EntropySource().get_secure_random_bytes(),
  logger,
  keysManager.as_NodeSigner()
)
```

**Verification:** After wiring, confirm `onionMessenger` is created without errors. BOLT 12 `pay_for_offer()` calls should no longer silently drop invoice requests.

#### Phase 2: Input Classification and BOLT 11 Payment

Build the unified input classifier and implement the simplest Lightning payment path (BOLT 11).

**Tasks:**

- [x] Create `src/ldk/payment-input.ts` -- unified input classifier

```typescript
// src/ldk/payment-input.ts
import { Bolt11Invoice, Offer, HumanReadableName } from 'lightningdevkit'

export type ParsedPaymentInput =
  | { type: 'bolt11'; invoice: Bolt11Invoice; raw: string; amountMsat: bigint | null }
  | { type: 'bolt12'; offer: Offer; raw: string; amountMsat: bigint | null }
  | { type: 'bip353'; name: HumanReadableName; raw: string }
  | { type: 'onchain'; address: string; amountSats: bigint | null }
  | { type: 'unknown'; raw: string }

export function classifyPaymentInput(raw: string): ParsedPaymentInput {
  const input = raw.trim()
  const lower = input.toLowerCase()

  // BIP 321 unified URI
  if (lower.startsWith('bitcoin:')) {
    return parseBip321(input)
  }

  // lightning: URI scheme
  if (lower.startsWith('lightning:')) {
    return classifyPaymentInput(input.slice('lightning:'.length))
  }

  // BOLT 11 invoice (signet: lntbs, mainnet: lnbc, testnet: lntb, regtest: lnbcrt)
  if (/^ln(bc|tb|tbs|bcrt)/.test(lower)) {
    return parseBolt11(input)
  }

  // BOLT 12 offer
  if (lower.startsWith('lno1')) {
    return parseBolt12Offer(input)
  }

  // BIP 353 human-readable name (user@domain, optionally with ₿ prefix)
  if (/^[\u20bf]?[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(input)) {
    return parseBip353(input)
  }

  // Fallback: try as on-chain address
  return { type: 'onchain', address: input, amountSats: null }
}
```

- [x] Implement `parseBip321()` -- extend the existing BIP 21 parser to extract `lightning=` and `lno=` query parameters, apply preference order (BOLT 12 > BOLT 11 > on-chain)
- [x] Implement `parseBolt11()` -- parse via `Bolt11Invoice.constructor_from_str()`, validate signature, check expiry, check network (must be Signet/`lntbs`), extract amount
- [x] Implement `parseBolt12Offer()` -- parse via `Offer.constructor_from_str()`, check expiry, extract amount/description
- [x] Implement `parseBip353()` -- parse via `HumanReadableName.constructor_from_encoded()` (strips `₿` prefix automatically)
- [ ] Add unit tests for all classifier paths in `src/ldk/payment-input.test.ts` (deferred — requires LDK WASM mock)

- [x] Expose `sendBolt11Payment` on LDK context in `src/ldk/ldk-context.ts`

```typescript
// Added to LdkContextValue 'ready' variant
sendBolt11Payment: (invoice: Bolt11Invoice, amountMsat?: bigint) => Promise<Uint8Array> // returns paymentId
```

- [x] Implement `sendBolt11Payment` in `src/ldk/context.tsx`

```typescript
// src/ldk/context.tsx -- inside the ready state provider
const sendBolt11Payment = async (
  invoice: Bolt11Invoice,
  amountMsat?: bigint
): Promise<Uint8Array> => {
  const hasAmount = invoice.amount_milli_satoshis() instanceof Option_u64Z_Some
  const paramsResult = hasAmount
    ? UtilMethods.constructor_payment_parameters_from_invoice(invoice)
    : UtilMethods.constructor_payment_parameters_from_variable_amount_invoice(invoice, amountMsat!)

  if (
    !(
      paramsResult instanceof
      Result_C3Tuple_ThirtyTwoBytesRecipientOnionFieldsRouteParametersZNoneZ_OK
    )
  ) {
    throw new Error('Failed to extract payment parameters from invoice')
  }

  const paymentHash = paramsResult.res.get_a()
  const recipientOnion = paramsResult.res.get_b()
  const routeParams = paramsResult.res.get_c()
  const paymentId = paymentHash // use payment hash as ID (guaranteed unique)

  const result = node.channelManager.send_payment(
    paymentHash,
    recipientOnion,
    paymentId,
    routeParams,
    Retry.constructor_attempts(3)
  )

  if (!result.is_ok()) {
    throw new Error(`Payment failed: ${result.err}`)
  }

  return paymentId
}
```

- [x] Extend the Send page state machine to handle Lightning flows

```typescript
// src/pages/Send.tsx -- extended state machine
type PaymentMethod =
  | { type: 'onchain'; address: string }
  | { type: 'bolt11'; invoice: Bolt11Invoice; raw: string }
  | { type: 'bolt12'; offer: Offer; raw: string }
  | { type: 'bip353'; name: HumanReadableName; raw: string }

type SendStep =
  // Shared entry
  | { step: 'input' }
  // On-chain flow (existing)
  | { step: 'amount'; address: string }
  | {
      step: 'reviewing'
      address: string
      amount: bigint
      fee: bigint
      feeRate: number
      isSendMax: boolean
    }
  | { step: 'broadcasting' }
  | { step: 'success'; txid: string; amount: bigint }
  // Lightning flow
  | { step: 'ln-amount'; method: PaymentMethod }
  | { step: 'ln-review'; method: PaymentMethod; amountMsat: bigint }
  | { step: 'ln-sending'; method: PaymentMethod; amountMsat: bigint; paymentId: Uint8Array }
  | { step: 'ln-success'; preimage: Uint8Array; amountMsat: bigint }
  // Shared
  | { step: 'error'; message: string }
```

- [x] Build the Lightning review screen showing: recipient (pubkey or offer description or `user@domain`), amount in sats, payment type badge
- [x] Build the Lightning progress screen that polls `channelManager.list_recent_payments()` at 1-second intervals to track payment state transitions
- [x] Handle `Event_PaymentSent` and `Event_PaymentFailed` in the event handler by updating a payment result store (simple `Map<string, PaymentResult>` exposed via LDK context)
- [x] Add invoice expiry display: reject expired invoices at parse time (countdown timer deferred)

**Files:**

- `src/ldk/payment-input.ts` (new) -- input classifier
- `src/ldk/payment-input.test.ts` (new) -- classifier tests
- `src/ldk/ldk-context.ts` -- add payment methods to context type
- `src/ldk/context.tsx` -- implement payment methods, payment result tracking
- `src/pages/Send.tsx` -- unified state machine, Lightning screens

#### Phase 3: BOLT 12 Offer and BIP 353 Payments

Build on the OnionMessenger foundation to support offers and human-readable names.

**Tasks:**

- [x] Expose `sendBolt12Payment` on LDK context

```typescript
sendBolt12Payment: (offer: Offer, amountMsat?: bigint, payerNote?: string) => Promise<Uint8Array>
```

- [x] Implement `sendBolt12Payment` in `src/ldk/context.tsx`

```typescript
const sendBolt12Payment = async (
  offer: Offer,
  amountMsat?: bigint,
  payerNote?: string
): Promise<Uint8Array> => {
  const paymentId = crypto.getRandomValues(new Uint8Array(32))

  const result = node.channelManager.pay_for_offer(
    offer,
    Option_u64Z.constructor_none(), // quantity
    amountMsat ? Option_u64Z.constructor_some(amountMsat) : Option_u64Z.constructor_none(),
    payerNote ? Option_StrZ.constructor_some(payerNote) : Option_StrZ.constructor_none(),
    paymentId,
    Retry.constructor_attempts(3),
    Option_u64Z.constructor_none() // max routing fee
  )

  if (!result.is_ok()) {
    throw new Error(`Offer payment failed: ${result.err}`)
  }

  return paymentId
}
```

- [x] Expose `sendBip353Payment` on LDK context

```typescript
sendBip353Payment: (name: HumanReadableName, amountMsat: bigint) => Promise<Uint8Array>
```

- [x] Implement `sendBip353Payment` -- calls `channelManager.pay_for_offer_from_human_readable_name()` with configured DNS resolver nodes
- [ ] Configure DNS resolver node destinations (bLIP 32 resolvers) -- empty array for now, no resolvers on Mutinynet
- [x] Extend the progress screen to show BOLT 12-specific states:
  - `AwaitingInvoice` -- "Requesting invoice..." with cancel button
  - `Pending` -- "Sending payment..."
  - `Fulfilled` / `Failed` -- terminal states
- [x] Extend the progress screen for BIP 353 (shares BOLT 12 progress states)
- [ ] Handle `Event_InvoiceReceived` in event handler (deferred — LDK auto-pays)
- [ ] Validate BOLT 12 offer amount constraints (deferred — needs min/max amount API)
- [x] Add user-initiated cancel via `channelManager.abandon_payment(paymentId)` for long-running BOLT 12/BIP 353 flows

**Files:**

- `src/ldk/ldk-context.ts` -- add BOLT 12 and BIP 353 payment methods
- `src/ldk/context.tsx` -- implement BOLT 12 and BIP 353 payment methods
- `src/ldk/traits/event-handler.ts` -- handle `Event_InvoiceReceived`
- `src/pages/Send.tsx` -- BOLT 12/BIP 353 progress states

## System-Wide Impact

### Interaction Graph

- `classifyPaymentInput()` feeds the Send page state machine
- `sendBolt11Payment()` calls `ChannelManager.send_payment()` which enqueues HTLCs processed on the next event loop tick
- `sendBolt12Payment()` calls `ChannelManager.pay_for_offer()` which enqueues an onion message via `OnionMessenger`, which sends the invoice request on the next `PeerManager.process_events()` tick
- `sendBip353Payment()` calls `ChannelManager.pay_for_offer_from_human_readable_name()` which sends a DNS query onion message first, then follows the BOLT 12 flow
- Payment events (`PaymentSent`, `PaymentFailed`) fire during `channelManager.as_EventsProvider().process_pending_events()` -- the event handler must write to the shared payment result store
- The Send page polls `list_recent_payments()` at 1s intervals during active payment to update progress UI

### Error Propagation

- `send_payment()` returns `Result_NoneRetryableSendFailureZ` synchronously -- immediate errors (RouteNotFound, DuplicatePayment) are caught and shown as errors on the Send page
- Async failures arrive via `Event_PaymentFailed` with `PaymentFailureReason` -- the polling loop detects these and transitions to error state
- BOLT 12 invoice request timeout: LDK fires `Event_PaymentFailed` with `InvoiceRequestExpired` reason
- BIP 353 DNS resolution failure: same path as BOLT 12 timeout (`InvoiceRequestExpired` or `InvoiceRequestRejected`)

### State Lifecycle Risks

- **Payment ID tracking**: If the Send page unmounts before payment completes (user navigates away), the payment continues in LDK but the UI loses the paymentId reference. Mitigation: persist active paymentIds to IndexedDB so they survive page navigation. Show pending payments on the Activity page.
- **Tab backgrounding**: Browser may throttle the 1s polling interval. The payment still completes in LDK (events are queued), but the UI won't update until the tab is foregrounded. The 10s background timer continues processing events. No fund safety risk -- just a UX delay.

### API Surface Parity

- `LdkContextValue` gains three new methods: `sendBolt11Payment`, `sendBolt12Payment`, `sendBip353Payment`
- The existing `OnchainContextValue.sendToAddress()` and `sendMax()` remain unchanged
- `parseBip21()` in `src/onchain/bip21.ts` should be replaced by the new `classifyPaymentInput()` for all input handling on the Send page

## Acceptance Criteria

### Functional Requirements

- [ ] User can paste a BOLT 11 invoice (`lntbs1...`) and send a Lightning payment
- [ ] User can paste a BOLT 11 invoice without amount and enter an amount via numpad
- [ ] User can paste a BOLT 12 offer (`lno1...`) and send a payment (with amount entry if needed)
- [ ] User can paste a BIP 353 address (`user@domain`) and send a payment with user-specified amount
- [ ] User can paste a BIP 321 URI (`bitcoin:?lightning=...&lno=...`) and the app selects the best payment method (BOLT 12 > BOLT 11 > on-chain)
- [ ] User can paste a `lightning:` prefixed URI and it is handled correctly
- [ ] Review screen shows: recipient info, amount in sats, payment type
- [ ] Progress screen shows real-time payment state (sending / awaiting invoice / resolving)
- [ ] Success screen shows payment preimage (truncated, copyable)
- [ ] Error screen shows human-readable failure reason
- [ ] Expired BOLT 11 invoices are rejected at parse time with a clear message
- [ ] Wrong-network invoices (non-signet) are rejected at parse time
- [ ] Payments exceeding available outbound channel capacity show an error before confirmation
- [ ] BOLT 12 and BIP 353 flows have a cancel button during the awaiting-invoice phase
- [ ] On-chain send flow continues to work as before

### Non-Functional Requirements

- [ ] Payment state polling is 1s during active payment, reverts to 10s background timer otherwise
- [ ] OnionMessenger events are processed in the same event loop as ChannelManager and ChainMonitor
- [ ] Input classification is synchronous and near-instant (no network calls)
- [ ] All LDK Result types are narrowed with `instanceof` (no `as` casts)

### Testing Requirements

- [ ] Unit tests for `classifyPaymentInput()` covering all input formats and edge cases
- [ ] Unit tests for BIP 321 parser with `lightning=` and `lno=` parameters
- [ ] Unit tests for expired invoice rejection, wrong-network rejection
- [ ] Integration test: BOLT 11 payment end-to-end on Mutinynet (requires two nodes)

## Dependencies & Risks

| Risk                                                                        | Likelihood | Impact                | Mitigation                                                                 |
| --------------------------------------------------------------------------- | ---------- | --------------------- | -------------------------------------------------------------------------- |
| OnionMessenger constructor fails with WASM type errors                      | Medium     | High (blocks BOLT 12) | Verify each `as_*` trait cast exists in .d.mts files before implementation |
| `ChannelManager.as_NodeIdLookUp()` not available in v0.1.8-0                | Medium     | Medium                | Fallback: implement `NodeIdLookUp.new_impl()` with channel list scan       |
| No bLIP 32 DNS resolver nodes on Mutinynet                                  | High       | High (blocks BIP 353) | BIP 353 may need to be deferred or tested against a self-hosted resolver   |
| BOLT 12 offer peers unreachable via onion message                           | Medium     | Medium                | Ensure test offers come from peers with direct or graph-routable paths     |
| `list_recent_payments()` doesn't expose BOLT 12 sub-states in WASM bindings | Low        | Medium                | Fallback: use event handler callbacks instead of polling                   |

## Sources & References

### Internal References

- Existing on-chain send flow: `src/pages/Send.tsx`
- Current BIP 21 parser: `src/onchain/bip21.ts`
- LDK node initialization: `src/ldk/init.ts`
- Event handler: `src/ldk/traits/event-handler.ts`
- LDK context: `src/ldk/ldk-context.ts`, `src/ldk/context.tsx`

### Institutional Learnings

- LDK WASM u128 BigInt overflow: `docs/solutions/integration-issues/ldk-wasm-u128-bigint-overflow.md` -- use 8 random bytes for payment IDs
- LDK WASM write vs direct Uint8Array: `docs/solutions/integration-issues/ldk-wasm-write-vs-direct-uint8array.md` -- check .d.mts types for serialization pattern
- LDK event handler patterns: `docs/solutions/integration-issues/ldk-event-handler-patterns.md` -- sync/async bridging, fund safety
- LDK Result type narrowing: `docs/solutions/integration-issues/ldk-wasm-foundation-layer-patterns.md` -- use instanceof, not as casts

### External References

- BIP 321 URI Scheme: https://bips.dev/321/
- BIP 353 DNS Payment Instructions: https://bips.dev/353/
- BOLT 11 Payment Encoding: https://github.com/lightning/bolts/blob/master/11-payment-encoding.md
- BOLT 12 Offer Encoding: https://github.com/lightning/bolts/blob/master/12-offer-encoding.md
- LDK BOLT 12 Blog: https://lightningdevkit.org/blog/bolt12-has-arrived/
- Unified QR codes: https://bitcoinqr.dev/
