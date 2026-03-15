import { formatBtc } from '../utils/format-btc'
import { ArrowUpRight, ArrowDownLeft } from '../components/icons'

// TODO: integrate with BDK transaction history
const MOCK_TRANSACTIONS = [
  { id: 'rx-001', type: 'received' as const, label: 'Received', amount: 250000n, time: '2 hours ago' },
  { id: 'tx-001', type: 'sent' as const, label: 'Sent to tb1q...8f3k', amount: 50000n, time: '1 day ago' },
  { id: 'rx-002', type: 'received' as const, label: 'Received', amount: 1000000n, time: '3 days ago' },
  { id: 'tx-002', type: 'sent' as const, label: 'Sent to tb1q...m2px', amount: 125000n, time: '5 days ago' },
  { id: 'rx-003', type: 'received' as const, label: 'Received', amount: 75000n, time: '1 week ago' },
  { id: 'tx-003', type: 'sent' as const, label: 'Sent to tb1q...v9ql', amount: 500000n, time: '2 weeks ago' },
  { id: 'rx-004', type: 'received' as const, label: 'Received', amount: 2500000n, time: '3 weeks ago' },
]

export function Activity() {
  return (
    <div className="flex min-h-dvh flex-col bg-accent pb-(--spacing-tab-bar) pt-6">
      <div className="mb-6 px-6">
        <h1 className="font-display text-3xl font-bold text-on-accent">
          Activity
        </h1>
      </div>

      {MOCK_TRANSACTIONS.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[var(--color-on-accent-muted)]">
            No transactions yet
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {MOCK_TRANSACTIONS.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center gap-4 px-6 py-4"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center text-on-accent">
                {tx.type === 'sent' ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-on-accent">{tx.label}</div>
                <div className="mt-0.5 text-xs text-[var(--color-on-accent-muted)]">
                  {tx.time}
                </div>
              </div>
              <div className="shrink-0 font-display font-bold text-on-accent">
                {tx.type === 'sent' ? '-' : '+'}
                {formatBtc(tx.amount)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
