export interface LnurlPayMetadata {
  domain: string
  user: string
  callback: string
  minSendableMsat: bigint
  maxSendableMsat: bigint
  description: string
}

/**
 * Resolve a Lightning Address (LUD-16) to LNURL-pay metadata.
 * Fetches `https://domain/.well-known/lnurlp/user` and validates the response.
 *
 * Returns null if the endpoint is unreachable, returns an error, or CORS blocks the request.
 */
export async function resolveLnurlPay(
  user: string,
  domain: string,
  signal?: AbortSignal,
): Promise<LnurlPayMetadata | null> {
  const url = `https://${domain}/.well-known/lnurlp/${user}`

  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch {
    // Network error or CORS block
    return null
  }

  if (!response.ok) return null

  interface LnurlPayResponse {
    status?: string
    tag?: string
    callback?: string
    minSendable?: number
    maxSendable?: number
    metadata?: string
  }

  let data: LnurlPayResponse
  try {
    data = (await response.json()) as LnurlPayResponse
  } catch {
    return null
  }

  if (data.status === 'ERROR') return null
  if (data.tag !== 'payRequest') return null
  if (!data.callback || !data.minSendable || !data.maxSendable) return null

  // Validate callback is HTTPS and domain matches the original LNURL domain
  const callback = data.callback
  if (!callback.startsWith('https://')) return null
  try {
    const callbackHost = new URL(callback).hostname
    if (callbackHost !== domain && !callbackHost.endsWith('.' + domain)) return null
  } catch {
    return null
  }

  let description: string
  try {
    const metadata = JSON.parse(data.metadata ?? '[]') as string[][]
    description = metadata.find(([mime]) => mime === 'text/plain')?.[1] ?? `${user}@${domain}`
  } catch {
    description = `${user}@${domain}`
  }

  return {
    domain,
    user,
    callback,
    minSendableMsat: BigInt(data.minSendable),
    maxSendableMsat: BigInt(data.maxSendable),
    description,
  }
}

/**
 * Fetch a BOLT 11 invoice from an LNURL-pay callback.
 * Appends the amount in millisatoshis as a query parameter.
 */
export async function fetchLnurlInvoice(
  callback: string,
  amountMsat: bigint,
  signal?: AbortSignal,
): Promise<string> {
  const separator = callback.includes('?') ? '&' : '?'
  const url = `${callback}${separator}amount=${amountMsat}`

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Failed to fetch invoice')

  const data = (await response.json()) as { status?: string; reason?: string; pr?: string }
  if (data.status === 'ERROR') throw new Error(data.reason ?? 'LNURL error')
  if (!data.pr) throw new Error('No invoice in response')

  return data.pr
}
