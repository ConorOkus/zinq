import { useState, useEffect, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useLdk } from '../ldk/use-ldk'
import { ScreenHeader } from '../components/ScreenHeader'

export function Bolt12Offer() {
  const ldk = useLdk()
  const bolt12Offer = ldk.status === 'ready' ? ldk.bolt12Offer : null
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!bolt12Offer) return
    try {
      await navigator.clipboard.writeText(bolt12Offer)
      setCopied(true)
    } catch {
      // Offer string is displayed and selectable as fallback
    }
  }, [bolt12Offer])

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  const truncated = bolt12Offer
    ? `${bolt12Offer.slice(0, 12)}...${bolt12Offer.slice(-8)}`
    : ''

  return (
    <div className="flex min-h-dvh flex-col bg-dark text-on-dark">
      <ScreenHeader title="BOLT 12 Offer" backTo="/settings/advanced" />

      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8">
          {bolt12Offer ? (
            <>
              <div
                className="flex h-[260px] w-[260px] items-center justify-center rounded-2xl bg-white p-5"
                aria-label="QR code for BOLT 12 offer"
              >
                <QRCodeSVG value={bolt12Offer.toUpperCase()} size={220} />
              </div>

              <div className="flex max-w-full items-center gap-3 rounded-full bg-dark-elevated px-5 py-3">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-sm text-[var(--color-on-dark-muted)]">
                  {truncated}
                </span>
                <button
                  className="shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-transform active:scale-95"
                  onClick={() => void handleCopy()}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </>
          ) : (
            <p className="text-[var(--color-on-dark-muted)]">
              {ldk.status === 'ready' ? 'Creating offer...' : 'Loading...'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
