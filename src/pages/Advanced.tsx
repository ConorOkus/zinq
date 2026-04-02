import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ScreenHeader } from '../components/ScreenHeader'
import { useLdk } from '../ldk/use-ldk'

const ADVANCED_ITEMS = [
  {
    label: 'Balance',
    detail: 'Onchain · Lightning',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[22px] w-[22px]"
      >
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    ),
    route: '/settings/advanced/balance',
  },
  {
    label: 'Peers',
    detail: 'Connected',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[22px] w-[22px]"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    route: '/settings/advanced/peers',
  },
]

export function Advanced() {
  const navigate = useNavigate()
  const ldk = useLdk()
  const [copied, setCopied] = useState(false)

  const nodeId = ldk.status === 'ready' ? ldk.nodeId : null

  const copyNodeId = () => {
    if (!nodeId) return
    void navigator.clipboard.writeText(nodeId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex min-h-dvh flex-col bg-dark text-on-dark">
      <ScreenHeader title="Advanced" backTo="/settings" />
      <div className="p-4">
        {nodeId && (
          <button
            onClick={copyNodeId}
            className="mb-4 w-full rounded-xl bg-dark-elevated p-4 text-left transition-colors active:bg-dark-elevated/70"
          >
            <div className="mb-1 text-xs font-medium text-[var(--color-on-dark-muted)]">
              Node ID
            </div>
            <div className="break-all font-mono text-xs leading-relaxed">{nodeId}</div>
            <div className="mt-2 text-xs text-[var(--color-on-dark-muted)]">
              {copied ? 'Copied!' : 'Tap to copy'}
            </div>
          </button>
        )}
        {ADVANCED_ITEMS.map((item) => (
          <button
            key={item.label}
            className="flex w-full items-center gap-4 rounded-xl px-2 py-4 transition-colors active:bg-dark-elevated"
            onClick={() => {
              if (item.route) void navigate(item.route)
            }}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-dark-elevated text-[var(--color-on-dark-muted)]">
              {item.icon}
            </div>
            <span className="flex-1 text-left font-semibold">{item.label}</span>
            <span className="text-sm text-[var(--color-on-dark-muted)]">{item.detail}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
