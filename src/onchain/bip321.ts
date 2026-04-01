export interface Bip321ParseResult {
  address: string
  amountSats?: bigint
}

/** Convert a BTC-denominated string to satoshis using fixed-point parsing. */
function btcStringToSats(btcStr: string): bigint | null {
  const trimmed = btcStr.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const parts = trimmed.split('.')
  const whole = parts[0] ?? '0'
  const frac = parts[1] ?? ''
  const padded = (frac + '00000000').slice(0, 8)
  return BigInt(whole) * 100_000_000n + BigInt(padded)
}

/** Convert satoshis to a BTC-denominated string with 8 decimal places. */
export function satsToBtcString(sats: bigint): string {
  if (sats < 0n) throw new RangeError('satsToBtcString: negative input')
  const whole = sats / 100_000_000n
  const frac = (sats % 100_000_000n).toString().padStart(8, '0')
  return `${whole}.${frac}`
}

export interface BuildBip321Options {
  address: string
  amountSats?: bigint
  invoice?: string | null
  b12?: string | null
}

/** Build a BIP 321 URI from an address and optional query parameters. */
export function buildBip321Uri({ address, amountSats, invoice, b12 }: BuildBip321Options): string {
  const base = `bitcoin:${address.toUpperCase()}`
  const params: string[] = []
  if (amountSats !== undefined && amountSats > 0n) {
    params.push(`amount=${satsToBtcString(amountSats)}`)
  }
  if (invoice) {
    params.push(`lightning=${invoice}`)
  }
  if (b12) {
    params.push(`b12=${b12}`)
  }
  return params.length > 0 ? `${base}?${params.join('&')}` : base
}

export function parseBip321(input: string): Bip321ParseResult | null {
  if (!input.toLowerCase().startsWith('bitcoin:')) return null

  // BIP 321: bitcoin:<address>?amount=<btc>&label=...
  const withoutScheme = input.slice('bitcoin:'.length)
  const parts = withoutScheme.split('?', 2)
  const address = (parts[0] ?? '').trim()
  if (!address) return null

  let amountSats: bigint | undefined
  const queryPart = parts[1]
  if (queryPart) {
    const params = new URLSearchParams(queryPart)
    const amountBtc = params.get('amount')
    if (amountBtc) {
      const parsed = btcStringToSats(amountBtc)
      if (parsed !== null) {
        amountSats = parsed
      }
    }
  }

  return { address, amountSats }
}
