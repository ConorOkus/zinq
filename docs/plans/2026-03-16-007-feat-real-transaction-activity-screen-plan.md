---
title: "feat: Replace Activity screen with real transactions"
type: feat
status: completed
date: 2026-03-16
---

# feat: Replace Activity screen with real transactions

Replace mock data on the Activity screen with real on-chain transactions from BDK and Lightning payment history from LDK, persisted to IndexedDB. Fix padding consistency on the Activity page.

## Acceptance Criteria

- [x] Activity screen shows real on-chain transactions from `wallet.transactions()` + `wallet.sent_and_received(tx)`
- [x] Activity screen shows real Lightning payments (inbound + outbound), persisted to IDB
- [x] Transactions are merged into a single list sorted by time (newest first)
- [x] Each transaction shows: direction icon (sent/received), label, relative time, and BIP 177 formatted amount
- [x] Pending/unconfirmed transactions are visually distinguished (muted styling + "Pending" label)
- [x] Loading state shown while BDK/LDK contexts initialize
- [x] Empty state preserved ("No transactions yet") for fresh wallets
- [x] Activity page padding is consistent (`px-6` horizontal padding throughout)
- [x] Lightning amounts converted from msat to sats via `msatToSatFloor`

## Context

**Data sources:**

1. **On-chain (BDK):** `wallet.transactions()` returns `WalletTx[]` with `txid`, `chain_position` (confirmed/unconfirmed), `anchors` with `confirmation_time`, `first_seen`/`last_seen`. Direction via `wallet.sent_and_received(tx.tx)` → `SentAndReceived` where `[0]` is sent Amount, `[1]` is received Amount.

2. **Lightning outbound (LDK):** `listRecentPayments()` returns in-memory `RecentPaymentDetails` (Pending/Fulfilled/Abandoned). No timestamps, volatile — must persist at send time.

3. **Lightning inbound (LDK):** `Event_PaymentClaimed` in event handler — currently only logged, not persisted.

**Key files:**
- `src/pages/Activity.tsx` — the screen to replace
- `src/onchain/context.tsx` / `onchain-context.ts` — needs to expose transactions
- `src/ldk/traits/event-handler.ts` — needs to persist payment events
- `src/ldk/ldk-context.ts` / `context.tsx` — needs to expose payment history
- `src/ldk/storage/idb.ts` — IDB helpers, needs new store + DB version bump

**Institutional learnings:**
- Persist changesets after any `next_unused_address()` call (bdk-address-reveal-not-persisted)
- Use `useRef` for context dependencies to avoid sync loop teardown (bdk-wasm-onchain-wallet-integration-patterns)
- `sent_and_received(tx)` returns tuple: `[0]` sent, `[1]` received — direction is `sent > received ? 'sent' : 'received'`
- Self-transfers (consolidation) will show as small "sent" amounts equal to the fee — acceptable for v1

## MVP

### Step 1: Lightning payment persistence layer

#### src/ldk/storage/idb.ts

Add `'ldk_payment_history'` to `STORES` array and bump `DB_VERSION` to `7`.

#### src/ldk/storage/payment-history.ts (new)

```typescript
import { idbPut, idbGetAll, type StoreName } from './idb'

const STORE: StoreName = 'ldk_payment_history'

export interface PersistedPayment {
  paymentHash: string
  direction: 'inbound' | 'outbound'
  amountMsat: bigint
  status: 'pending' | 'succeeded' | 'failed'
  feePaidMsat: bigint | null
  createdAt: number // Date.now() unix ms
  failureReason: string | null
}

export async function persistPayment(payment: PersistedPayment): Promise<void> {
  await idbPut(STORE, payment.paymentHash, {
    ...payment,
    // bigint not directly storable in IDB — convert to string
    amountMsat: payment.amountMsat.toString(),
    feePaidMsat: payment.feePaidMsat?.toString() ?? null,
  })
}

export async function updatePaymentStatus(
  paymentHash: string,
  status: 'succeeded' | 'failed',
  feePaidMsat?: bigint | null,
  failureReason?: string,
): Promise<void> {
  // Read-modify-write; safe because single-threaded
  const all = await loadAllPayments()
  const existing = all.get(paymentHash)
  if (!existing) return
  await persistPayment({
    ...existing,
    status,
    feePaidMsat: feePaidMsat ?? existing.feePaidMsat,
    failureReason: failureReason ?? existing.failureReason,
  })
}

export async function loadAllPayments(): Promise<Map<string, PersistedPayment>> {
  const raw = await idbGetAll<Record<string, string | null>>(STORE)
  const result = new Map<string, PersistedPayment>()
  for (const [key, value] of raw) {
    result.set(key, {
      paymentHash: (value as any).paymentHash,
      direction: (value as any).direction,
      amountMsat: BigInt((value as any).amountMsat),
      status: (value as any).status,
      feePaidMsat: (value as any).feePaidMsat ? BigInt((value as any).feePaidMsat) : null,
      createdAt: (value as any).createdAt,
      failureReason: (value as any).failureReason,
    })
  }
  return result
}
```

### Step 2: Persist payment events

#### src/ldk/traits/event-handler.ts

In `Event_PaymentClaimed` handler (~line 163), add persistence:

```typescript
if (event instanceof Event_PaymentClaimed) {
  const paymentHash = bytesToHex(event.payment_hash)
  console.log('[LDK Event] PaymentClaimed:', paymentHash, 'amount_msat:', event.amount_msat.toString())
  void persistPayment({
    paymentHash,
    direction: 'inbound',
    amountMsat: event.amount_msat,
    status: 'succeeded',
    feePaidMsat: null,
    createdAt: Date.now(),
    failureReason: null,
  })
  return
}
```

In `Event_PaymentSent` handler (~line 173), add persistence update:

```typescript
void updatePaymentStatus(paymentHash, 'succeeded', feePaidMsat)
```

In `Event_PaymentFailed` handler (~line 190), add persistence update:

```typescript
void updatePaymentStatus(paymentIdHex, 'failed', null, reason)
```

#### src/ldk/context.tsx

In `sendBolt11Payment`, `sendBolt12Payment`, `sendBip353Payment` — persist outbound payment at send time:

```typescript
// After calling channelManager.send_payment / pay_for_offer
void persistPayment({
  paymentHash: bytesToHex(paymentId),
  direction: 'outbound',
  amountMsat: amountMsat,
  status: 'pending',
  feePaidMsat: null,
  createdAt: Date.now(),
  failureReason: null,
})
```

### Step 3: Expose on-chain transactions from OnchainContext

#### src/onchain/onchain-context.ts

Add `listTransactions` to the `ready` variant:

```typescript
| {
    status: 'ready'
    balance: OnchainBalance
    listTransactions: () => Array<{
      txid: string
      sent: bigint
      received: bigint
      confirmationTime: bigint | null
      firstSeen: bigint | null
      isConfirmed: boolean
    }>
    // ... existing methods
  }
```

#### src/onchain/context.tsx

Add `listTransactions` callback that reads from `walletRef`:

```typescript
const listTransactions = useCallback(() => {
  const wallet = walletRef.current
  if (!wallet) return []
  return wallet.transactions().map((wtx) => {
    const sr = wallet.sent_and_received(wtx.tx)
    const anchor = wtx.anchors[0]
    return {
      txid: wtx.txid.toString(),
      sent: sr[0].to_sat(),
      received: sr[1].to_sat(),
      confirmationTime: anchor?.confirmation_time ?? null,
      firstSeen: wtx.first_seen ?? null,
      isConfirmed: wtx.chain_position.is_confirmed,
    }
  })
}, [])
```

Include in the `setState` call inside `startOnchainSyncLoop` callback.

### Step 4: Unified transaction list hook

#### src/hooks/use-transaction-history.ts (new)

```typescript
import { useMemo } from 'react'
import { useOnchain } from '../onchain/use-onchain'
import { useLdk } from '../ldk/use-ldk'
import { msatToSatFloor } from '../utils/msat'

export type UnifiedTransaction = {
  id: string
  direction: 'sent' | 'received'
  amountSats: bigint
  timestamp: number // unix ms for sorting
  label: string
  status: 'confirmed' | 'pending' | 'failed'
  layer: 'onchain' | 'lightning'
}

export function useTransactionHistory(): {
  transactions: UnifiedTransaction[]
  isLoading: boolean
} {
  const onchain = useOnchain()
  const ldk = useLdk()

  const isLoading = onchain.status === 'loading' || ldk.status === 'loading'

  const transactions = useMemo(() => {
    const items: UnifiedTransaction[] = []

    // On-chain transactions
    if (onchain.status === 'ready') {
      for (const tx of onchain.listTransactions()) {
        const netSent = tx.sent - tx.received
        const netReceived = tx.received - tx.sent
        const isSend = tx.sent > tx.received
        items.push({
          id: tx.txid,
          direction: isSend ? 'sent' : 'received',
          amountSats: isSend ? netSent : netReceived,
          timestamp: tx.confirmationTime
            ? Number(tx.confirmationTime) * 1000
            : tx.firstSeen
              ? Number(tx.firstSeen) * 1000
              : Date.now(),
          label: isSend ? 'Sent' : 'Received',
          status: tx.isConfirmed ? 'confirmed' : 'pending',
          layer: 'onchain',
        })
      }
    }

    // Lightning payments loaded from IDB via LDK context
    // (see Step 5 for how ldk exposes paymentHistory)
    if (ldk.status === 'ready') {
      for (const p of ldk.paymentHistory) {
        if (p.status === 'failed') continue // hide failed payments
        items.push({
          id: p.paymentHash,
          direction: p.direction === 'outbound' ? 'sent' : 'received',
          amountSats: msatToSatFloor(p.amountMsat),
          timestamp: p.createdAt,
          label: p.direction === 'outbound' ? 'Sent' : 'Received',
          status: p.status === 'pending' ? 'pending' : 'confirmed',
          layer: 'lightning',
        })
      }
    }

    // Sort newest first
    items.sort((a, b) => b.timestamp - a.timestamp)
    return items
  }, [onchain, ldk])

  return { transactions, isLoading }
}
```

### Step 5: Expose payment history from LDK context

#### src/ldk/ldk-context.ts

Add `paymentHistory: PersistedPayment[]` to the `ready` variant.

#### src/ldk/context.tsx

Load payment history on init and refresh it when payment events fire. Store in state and pass through context. Use `loadAllPayments()` from the new storage module.

### Step 6: Replace Activity screen UI

#### src/pages/Activity.tsx

```tsx
import { useTransactionHistory, type UnifiedTransaction } from '../hooks/use-transaction-history'
import { formatBtc } from '../utils/format-btc'
import { ArrowUpRight, ArrowDownLeft } from '../components/icons'

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

export function Activity() {
  const { transactions, isLoading } = useTransactionHistory()

  return (
    <div className="flex min-h-dvh flex-col bg-accent px-6 pb-(--spacing-tab-bar) pt-6">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold text-on-accent">Activity</h1>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[var(--color-on-accent-muted)]">Loading...</p>
        </div>
      ) : transactions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[var(--color-on-accent-muted)]">No transactions yet</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto -mx-6">
          {transactions.map((tx) => (
            <div key={tx.id} className="flex items-center gap-4 px-6 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center text-on-accent">
                {tx.direction === 'sent'
                  ? <ArrowUpRight className="h-5 w-5" />
                  : <ArrowDownLeft className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-on-accent">
                  {tx.label}
                  {tx.status === 'pending' && (
                    <span className="ml-2 text-xs font-normal text-[var(--color-on-accent-muted)]">
                      Pending
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-[var(--color-on-accent-muted)]">
                  {tx.layer === 'lightning' ? '⚡ ' : ''}{formatRelativeTime(tx.timestamp)}
                </div>
              </div>
              <div className={`shrink-0 font-display font-bold ${
                tx.status === 'pending' ? 'text-[var(--color-on-accent-muted)]' : 'text-on-accent'
              }`}>
                {tx.direction === 'sent' ? '-' : '+'}
                {formatBtc(tx.amountSats)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Padding fix:** Move `px-6` to the outer container. Transaction rows use `-mx-6` on the scroll container and `px-6` on each row, so padding is consistently 24px on all edges. The title `div` no longer needs its own `px-6`.

## Sources

- BDK WASM API: `wallet.transactions()`, `wallet.sent_and_received(tx)`, `WalletTx`, `SentAndReceived`, `ChainPosition`
- LDK API: `listRecentPayments()`, `RecentPaymentDetails`, `Event_PaymentClaimed`, `Event_PaymentSent`, `Event_PaymentFailed`
- Existing IDB pattern: `src/ldk/storage/idb.ts` with `idbPut`/`idbGet`/`idbGetAll`
- Format utilities: `src/utils/format-btc.ts` (BIP 177), `src/utils/msat.ts` (`msatToSatFloor`)
- Learnings: `docs/solutions/logic-errors/bdk-address-reveal-not-persisted.md`, `docs/solutions/integration-issues/bdk-wasm-onchain-wallet-integration-patterns.md`
