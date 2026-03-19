---
title: "feat: Support Lightning Address and BIP 353 Address Resolution"
type: feat
status: completed
date: 2026-03-18
---

# feat: Support Lightning Address and BIP 353 Address Resolution

## Overview

Enable sending to `user@domain` addresses by resolving them via BIP 353 (DNS-based, preferred) with LNURL-pay (LUD-16) as fallback. BIP 353 is the default because it offers better privacy (no HTTP to recipient server), produces BOLT 12 offers (reusable, blinded paths), and requires no web server infrastructure. LNURL fallback ensures compatibility with the large existing ecosystem of Lightning Address providers.

## Problem Statement / Motivation

Users expect to send payments to human-readable `user@domain` addresses — the most common payment identifier in the Lightning ecosystem. Currently, entering `user@domain` in the send flow returns an error: "BIP 353 addresses (user@domain) are not yet supported on this network." This blocks a primary use case for any Lightning wallet.

## Proposed Solution

### Resolution Strategy

For any `user@domain` input, resolve sequentially:

1. **BIP 353 via DNS-over-HTTPS (DoH)** — Query `user.user._bitcoin-payment.domain` TXT record via Cloudflare DoH (`https://cloudflare-dns.com/dns-query`). Parse the BIP 21 URI from the response. Extract the BOLT 12 offer (`lno=` parameter). Pay via `pay_for_offer()`.

2. **LNURL-pay (LUD-16) fallback** — If no BIP 353 record exists, fetch `https://domain/.well-known/lnurlp/user` (through a CORS proxy). Get payment metadata and amount constraints. After user enters amount, fetch BOLT 11 invoice from callback. Pay via `send_payment()`.

3. **Error** — If both fail, show a clear error message.

### Why DoH Instead of bLIP 32 Onion Messages

LDK's `pay_for_offer_from_human_readable_name()` uses bLIP 32 DNS resolver nodes to resolve names via onion messages — the ideal privacy-preserving approach. However, **no known bLIP 32 resolver nodes exist on signet/mutinynet**. DoH is a practical alternative that works today:

- Cloudflare DoH has permissive CORS headers — works directly from browsers
- No infrastructure dependency beyond Cloudflare (highly available)
- DNSSEC validation via the `AD` (Authenticated Data) flag in DoH responses
- Can be replaced with bLIP 32 resolution in the future when resolvers become available

### Architecture

Resolution is **asynchronous** and happens after `classifyPaymentInput()` returns `{ type: 'bip353' }`. A new `resolving` step in the `SendStep` state machine handles the loading state.

```
user@domain input
    │
    ▼
classifyPaymentInput() → { type: 'bip353', name, raw }  (synchronous, unchanged)
    │
    ▼
processRecipientInput() enters 'resolving' step
    │
    ▼
resolveHumanReadableName(user, domain)  (async)
    │
    ├─ Try BIP 353 DoH ──── found ──→ ParsedPaymentInput (bolt12 or onchain)
    │       │
    │       └─ not found / error
    │               │
    │               ▼
    │       Try LNURL-pay ──── found ──→ LnurlPayMetadata
    │               │
    │               └─ not found / error ──→ Error
    │
    ▼
Route to existing amount/review flow based on resolved type
```

## Technical Approach

### Phase 1: BIP 353 via DoH

**New file: `src/ldk/resolve-bip353.ts`**

```typescript
// resolve-bip353.ts
export interface Bip353Result {
  uri: string          // Raw BIP 21 URI from TXT record
  parsed: ParsedPaymentInput  // Parsed via existing parseBip321
}

export async function resolveBip353(
  user: string,
  domain: string,
  signal?: AbortSignal,
): Promise<Bip353Result | null>
```

Implementation:
- Construct DNS name: `${user}.user._bitcoin-payment.${domain}`
- Fetch via Cloudflare DoH: `GET https://cloudflare-dns.com/dns-query?name=...&type=TXT` with `Accept: application/dns-json`
- Validate response: check `AD: true` (DNSSEC authenticated), check `Status: 0` (NOERROR)
- Extract TXT record data — find the one starting with `bitcoin:`
- Parse via existing `parseBip321()` (already handles `lno=` > `lightning=` > on-chain preference)
- Return null if no record found (NXDOMAIN) or no `bitcoin:` TXT record
- Timeout: 5 seconds via AbortSignal

**Enable the existing `parseBip353()` in `payment-input.ts`:**

Uncomment the `HumanReadableName.constructor_from_encoded()` logic. Remove the hardcoded error. The function remains synchronous — it just validates the format and produces a `HumanReadableName` object.

### Phase 2: LNURL-pay (LUD-16) Resolution

**New file: `src/lnurl/resolve-lnurl.ts`**

```typescript
// resolve-lnurl.ts
export interface LnurlPayMetadata {
  domain: string
  user: string
  callback: string
  minSendableMsat: bigint
  maxSendableMsat: bigint
  description: string
  tag: 'payRequest'
}

export async function resolveLnurlPay(
  user: string,
  domain: string,
  signal?: AbortSignal,
): Promise<LnurlPayMetadata | null>

export async function fetchLnurlInvoice(
  callback: string,
  amountMsat: bigint,
  signal?: AbortSignal,
): Promise<string>  // Returns BOLT 11 invoice string
```

**CORS proxy strategy:**

LNURL endpoints on arbitrary domains typically don't set CORS headers. Two options:

- **Option A (recommended for MVP):** Try direct `fetch()` first. If it fails with a CORS error, show a specific error: "This Lightning Address provider doesn't support browser wallets." This avoids a proxy infrastructure dependency and is honest about the limitation. Many major providers (e.g., those running LNbits, getalby.com) do support CORS.
- **Option B (future):** Deploy a minimal Cloudflare Worker CORS proxy alongside the existing WebSocket proxy at `proxy.mutinynet.com`. Route LNURL requests through it.

For MVP, go with Option A. BIP 353 is the primary path and has no CORS issues.

**Implementation details:**
- Fetch `https://${domain}/.well-known/lnurlp/${user}`
- Validate response: `tag === 'payRequest'`, `callback` is HTTPS URL, `minSendable`/`maxSendable` are valid
- `fetchLnurlInvoice`: append `?amount=${amountMsat}` to callback URL, validate returned `pr` field is a valid BOLT 11 invoice, verify invoice amount matches request
- Timeout: 5 seconds per request

### Phase 3: Send Flow Integration

**New `ParsedPaymentInput` variant for LNURL:**

```typescript
export type ParsedPaymentInput =
  | { type: 'bolt11'; ... }
  | { type: 'bolt12'; ... }
  | { type: 'bip353'; name: HumanReadableName; raw: string }
  | { type: 'lnurl'; domain: string; user: string; metadata: LnurlPayMetadata; raw: string }
  | { type: 'onchain'; ... }
  | { type: 'error'; ... }
```

**New `SendStep` variant for resolution loading state:**

```typescript
| { step: 'resolving'; raw: string }
```

**Updated `processRecipientInput` flow:**

When `classifyPaymentInput` returns `{ type: 'bip353' }`:
1. Transition to `{ step: 'resolving', raw }` — shows spinner with "Resolving address..."
2. Call `resolveBip353(user, domain, signal)` with AbortController
3. If BIP 353 succeeds → re-enter flow with the resolved `ParsedPaymentInput` (bolt12, bolt11, or onchain)
4. If BIP 353 fails → call `resolveLnurlPay(user, domain, signal)`
5. If LNURL succeeds → transition to amount step with min/max constraints
6. If both fail → transition to error step

**LNURL amount constraints on numpad:**

Add optional `minSat`/`maxSat` fields to the `amount` step:

```typescript
| {
    step: 'amount'
    parsedInput: ParsedPaymentInput
    rawInput: string
    minSat?: bigint  // From LNURL minSendable
    maxSat?: bigint  // From LNURL maxSendable
  }
```

The numpad validates against these constraints on "Next". Display the range below the amount. If `minSat === maxSat`, skip numpad and go directly to review.

**LNURL invoice fetch between amount and review:**

After user confirms amount on numpad for LNURL type:
1. Show resolving state briefly: "Requesting invoice..."
2. Call `fetchLnurlInvoice(callback, amountMsat)`
3. Parse returned BOLT 11 invoice via existing `parseBolt11()`
4. Verify invoice amount matches
5. Transition to `ln-review` with the BOLT 11 invoice

**Preserve `user@domain` label through resolution:**

Add optional `recipientLabel` to the `ln-review` and `oc-review` steps. When set, `recipientLabel()` uses it instead of deriving from the parsed type. This shows "alice@example.com" on the review screen rather than "Lightning Offer".

```typescript
| {
    step: 'ln-review'
    parsed: ParsedPaymentInput & { type: 'bolt11' | 'bolt12' }
    amountMsat: bigint
    fromStep: 'recipient' | 'amount'
    label?: string  // "alice@example.com"
  }
```

### Phase 4: Future — bLIP 32 Native Resolution

When bLIP 32 resolver nodes become available on signet:
- Add resolver node pubkeys to `SIGNET_CONFIG`
- Re-enable `sendBip353Payment()` with populated `dns_resolvers` array
- Add as a third resolution tier: bLIP 32 (best privacy) > DoH (good) > LNURL (fallback)

This requires no architectural changes — just configuration.

## System-Wide Impact

- **State machine expansion:** Adding `resolving` step and `lnurl` type to `SendStep` and `ParsedPaymentInput`. All existing switch/if-else chains on these types need updating.
- **Error propagation:** DoH and LNURL failures are caught and converted to `{ step: 'error' }` states. Network timeouts use AbortController with 5s deadline.
- **Payment history:** Payments resolved via DoH flow through existing `sendBolt12Payment` or `sendBolt11Payment` — stored the same way. LNURL payments are BOLT 11 invoices. The `user@domain` label is UI-only (review screen) and not persisted.
- **Bundle size:** Minimal — DoH resolution is a single `fetch` call with JSON parsing. LNURL is two `fetch` calls. No new dependencies required.

## Acceptance Criteria

### Functional Requirements

- [x] Entering `user@domain` in send flow triggers async resolution (shows loading spinner)
- [x] BIP 353 resolution via DoH: queries Cloudflare DoH for TXT record at `user.user._bitcoin-payment.domain`
- [x] BIP 353 DoH: validates `AD` flag in response (DNSSEC authenticated)
- [x] BIP 353 DoH: parses BIP 21 URI from TXT record, extracts BOLT 12 offer (preferred) or BOLT 11 invoice
- [x] BIP 353 DoH: routes resolved offer/invoice to existing payment flow (`sendBolt12Payment` / `sendBolt11Payment`)
- [x] LNURL fallback: if no BIP 353 record, fetches `/.well-known/lnurlp/user` from domain
- [x] LNURL: displays amount constraints (min/max) on numpad
- [x] LNURL: fetches BOLT 11 invoice from callback with user-entered amount
- [ ] LNURL: validates invoice amount matches request
- [x] LNURL: pays via existing `sendBolt11Payment`
- [x] Review screen shows `user@domain` as recipient label (not raw offer/invoice)
- [x] Error shown if both resolution methods fail
- [x] Back/cancel from resolving state returns to recipient input
- [x] AbortController cancels in-flight requests on navigation away
- [x] QR-scanned `user@domain` inputs trigger the same resolution flow

### Non-Functional Requirements

- [x] DoH resolution timeout: 5 seconds
- [x] LNURL request timeout: 5 seconds each
- [x] Total worst-case resolution: ~10 seconds (sequential DoH timeout + LNURL)
- [x] No new npm dependencies (uses native `fetch` and JSON parsing)

### Testing

- [x] Unit tests for `resolveBip353()` with mocked DoH responses (success, NXDOMAIN, no AD flag, invalid TXT)
- [x] Unit tests for `resolveLnurlPay()` with mocked HTTP responses (success, error, invalid JSON, CORS failure)
- [x] Unit tests for `fetchLnurlInvoice()` with mocked callback responses
- [x] Unit tests for updated `parseBip353()` (re-enabled parsing)
- [ ] Integration test: `user@domain` → resolving → BIP 353 DoH → BOLT 12 review
- [ ] Integration test: `user@domain` → resolving → DoH fails → LNURL → amount → review
- [ ] Integration test: `user@domain` → resolving → both fail → error screen

## MVP

### `src/ldk/resolve-bip353.ts`

```typescript
import type { ParsedPaymentInput } from './payment-input'
import { classifyPaymentInput } from './payment-input'

const DOH_URL = 'https://cloudflare-dns.com/dns-query'

interface DohResponse {
  Status: number
  AD: boolean
  Answer?: Array<{ type: number; data: string }>
}

export async function resolveBip353(
  user: string,
  domain: string,
  signal?: AbortSignal,
): Promise<ParsedPaymentInput | null> {
  const name = `${user}.user._bitcoin-payment.${domain}`
  const url = `${DOH_URL}?name=${encodeURIComponent(name)}&type=TXT`

  const response = await fetch(url, {
    headers: { Accept: 'application/dns-json' },
    signal,
  })

  if (!response.ok) return null

  const data: DohResponse = await response.json()

  // NXDOMAIN or other DNS error
  if (data.Status !== 0) return null

  // Require DNSSEC authentication
  if (!data.AD) return null

  // Find bitcoin: TXT record
  const txtRecords = data.Answer?.filter((r) => r.type === 16) ?? []
  for (const record of txtRecords) {
    // TXT record data is quoted in DoH JSON responses
    const txt = record.data.replace(/^"|"$/g, '')
    if (txt.startsWith('bitcoin:')) {
      return classifyPaymentInput(txt)
    }
  }

  return null
}
```

### `src/lnurl/resolve-lnurl.ts`

```typescript
export interface LnurlPayMetadata {
  domain: string
  user: string
  callback: string
  minSendableMsat: bigint
  maxSendableMsat: bigint
  description: string
}

export async function resolveLnurlPay(
  user: string,
  domain: string,
  signal?: AbortSignal,
): Promise<LnurlPayMetadata | null> {
  const url = `https://${domain}/.well-known/lnurlp/${user}`

  const response = await fetch(url, { signal })
  if (!response.ok) return null

  const data = await response.json()

  if (data.status === 'ERROR') return null
  if (data.tag !== 'payRequest') return null
  if (!data.callback || !data.minSendable || !data.maxSendable) return null

  const metadata = JSON.parse(data.metadata ?? '[]') as string[][]
  const description =
    metadata.find(([mime]) => mime === 'text/plain')?.[1] ?? `${user}@${domain}`

  return {
    domain,
    user,
    callback: data.callback,
    minSendableMsat: BigInt(data.minSendable),
    maxSendableMsat: BigInt(data.maxSendable),
    description,
  }
}

export async function fetchLnurlInvoice(
  callback: string,
  amountMsat: bigint,
  signal?: AbortSignal,
): Promise<string> {
  const separator = callback.includes('?') ? '&' : '?'
  const url = `${callback}${separator}amount=${amountMsat}`

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Failed to fetch invoice')

  const data = await response.json()
  if (data.status === 'ERROR') throw new Error(data.reason ?? 'LNURL error')
  if (!data.pr) throw new Error('No invoice in response')

  return data.pr
}
```

### Updated `src/ldk/payment-input.ts` — `parseBip353` function

```typescript
import {
  Result_HumanReadableNameNoneZ_OK,
} from 'lightningdevkit'

function parseBip353(raw: string): ParsedPaymentInput {
  const cleaned = raw.replace(/^\u20bf/, '')
  const result = HumanReadableName.constructor_from_encoded(cleaned)
  if (!(result instanceof Result_HumanReadableNameNoneZ_OK)) {
    return { type: 'error', message: 'Invalid address format' }
  }
  return { type: 'bip353', name: result.res, raw: cleaned }
}
```

### Key changes to `src/pages/Send.tsx`

```typescript
// New SendStep variant
| { step: 'resolving'; raw: string }

// New ParsedPaymentInput variant
| { type: 'lnurl'; domain: string; user: string; metadata: LnurlPayMetadata; raw: string }

// Updated amount step with optional constraints
| { step: 'amount'; parsedInput: ParsedPaymentInput; rawInput: string; minSat?: bigint; maxSat?: bigint }

// Updated ln-review with optional label
| { step: 'ln-review'; parsed: ...; amountMsat: bigint; fromStep: ...; label?: string }
```

## Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| DoH provider (Cloudflare) unavailable | BIP 353 resolution fails | Fall back to LNURL. Could add Google DoH as secondary. |
| CORS blocks LNURL requests | LNURL resolution fails for most providers | BIP 353 is the primary path. Clear error message. Future: CORS proxy worker. |
| DNSSEC not enabled on domain | DoH returns `AD: false`, resolution rejected | Fall through to LNURL. Most BIP 353-aware domains will have DNSSEC. |
| DoH response format changes | Parsing breaks | Pin to `application/dns-json` format which is RFC 8484 standard. |
| LNURL server returns wrong invoice amount | User overpays | Verify invoice amount matches requested amount before paying. |
| No BIP 353 records exist on signet test domains | Can't test BIP 353 flow | Create test records via [twelve.cash](https://twelve.cash) or self-hosted DNS. |

## Sources & References

### Specifications

- [BIP 353: DNS Payment Instructions](https://bips.dev/353/)
- [bLIP 32: DNSSEC Proof Queries over Onion Messages](https://github.com/lightning/blips/blob/master/blip-0032.md)
- [LUD-06: LNURL-pay](https://github.com/lnurl/luds/blob/luds/06.md)
- [LUD-16: Lightning Address (pay to internet identifier)](https://github.com/lnurl/luds/blob/luds/16.md)
- [RFC 8484: DNS Queries over HTTPS (DoH)](https://datatracker.ietf.org/doc/html/rfc8484)

### LDK APIs

- `ChannelManager.pay_for_offer()` — BOLT 12 payment (used after DoH resolution)
- `ChannelManager.pay_for_offer_from_human_readable_name()` — bLIP 32 payment (future, when resolvers exist)
- `HumanReadableName.constructor_from_encoded()` — Parse `user@domain` string

### Internal References

- `src/ldk/payment-input.ts:129` — Disabled `parseBip353()` stub to re-enable
- `src/ldk/context.tsx:310` — Existing `sendBip353Payment()` (bLIP 32 path, empty resolvers)
- `src/ldk/context.tsx:266` — `sendBolt12Payment()` (used for DoH-resolved offers)
- `src/pages/Send.tsx:22` — `SendStep` state machine to extend
- `src/ldk/init.ts:321` — OnionMessenger already wired with DNS resolver handler

### Tools

- [twelve.cash](https://twelve.cash) — Create BIP 353 DNS records for testing
- [satsto.me](https://satsto.me/) — Web-based BIP 353 lookup tool for verification
