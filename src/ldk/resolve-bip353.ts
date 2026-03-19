import { classifyPaymentInput, type ParsedPaymentInput } from './payment-input'

const DOH_URL = 'https://cloudflare-dns.com/dns-query'

interface DohResponse {
  Status: number
  AD: boolean
  Answer?: Array<{ type: number; data: string }>
}

/**
 * Resolve a BIP 353 human-readable name via DNS-over-HTTPS (Cloudflare).
 * Queries the TXT record at `user.user._bitcoin-payment.domain` and parses
 * the `bitcoin:` URI found in the response.
 *
 * Returns null if no valid BIP 353 record is found, DNSSEC is not authenticated,
 * or the DNS query fails.
 */
export async function resolveBip353(
  user: string,
  domain: string,
  signal?: AbortSignal,
): Promise<ParsedPaymentInput | null> {
  const name = `${user}.user._bitcoin-payment.${domain}`
  const url = `${DOH_URL}?name=${encodeURIComponent(name)}&type=TXT`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/dns-json' },
      signal,
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  let data: DohResponse
  try {
    data = (await response.json()) as DohResponse
  } catch {
    return null
  }

  // NXDOMAIN or other DNS error
  if (data.Status !== 0) return null

  // Require DNSSEC authentication
  if (!data.AD) return null

  // Find bitcoin: TXT record (type 16 = TXT)
  const txtRecords = data.Answer?.filter((r) => r.type === 16) ?? []
  for (const record of txtRecords) {
    // TXT record data is quoted in DoH JSON responses; records >255 bytes are
    // split into multiple quoted segments (e.g., "part1" "part2")
    const txt = record.data.replace(/^"|"$/g, '').replace(/" "/g, '')
    if (txt.startsWith('bitcoin:')) {
      const parsed = classifyPaymentInput(txt)
      if (parsed.type !== 'error') return parsed
    }
  }

  return null
}
