import { useMemo } from 'react'
import { useOnchain } from '../onchain/use-onchain'
import { useLdk } from '../ldk/use-ldk'
import { msatToSatFloor } from '../utils/msat'

export type UnifiedTransaction = {
  id: string
  direction: 'sent' | 'received'
  amountSats: bigint
  timestamp: number // unix ms for sorting
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

  // Extract granular deps so the memo doesn't recompute on unrelated context changes
  // (sync status, channel counter, etc.)
  const listTransactions = onchain.status === 'ready' ? onchain.listTransactions : null
  const onchainBalance = onchain.status === 'ready' ? onchain.balance : null
  const paymentHistory = ldk.status === 'ready' ? ldk.paymentHistory : null

  const transactions = useMemo(() => {
    const items: UnifiedTransaction[] = []

    // On-chain transactions
    if (listTransactions) {
      for (const tx of listTransactions()) {
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
              : 0,
          status: tx.isConfirmed ? 'confirmed' : 'pending',
          layer: 'onchain',
        })
      }
    }

    // Lightning payments from persisted history
    if (paymentHistory) {
      for (const p of paymentHistory) {
        if (p.status === 'failed') continue
        items.push({
          id: p.paymentHash,
          direction: p.direction === 'outbound' ? 'sent' : 'received',
          amountSats: msatToSatFloor(p.amountMsat),
          timestamp: p.createdAt,
          status: p.status === 'pending' ? 'pending' : 'confirmed',
          layer: 'lightning',
        })
      }
    }

    items.sort((a, b) => b.timestamp - a.timestamp)
    return items
    // onchainBalance is included as a recomputation signal — when balance changes
    // after a sync tick, new transactions may be available from listTransactions().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listTransactions, onchainBalance, paymentHistory])

  return { transactions, isLoading }
}
