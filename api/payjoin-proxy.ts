/**
 * Vercel serverless function that proxies Payjoin (BIP 78 v1 + BIP 77 v2)
 * sender traffic. The browser cannot POST cross-origin to arbitrary receiver
 * endpoints (CORS), and we must never expose the user's IP to the receiver.
 *
 * Vercel rewrite maps /api/payjoin-proxy/DOMAIN/PATH to
 * /api/payjoin-proxy?_path=DOMAIN/PATH
 *
 * Security controls:
 *   - POST-only
 *   - Gated behind PAYJOIN_PROXY_ENABLED env var (returns 503 if unset)
 *   - HTTPS targets only; private/loopback/link-local IP ranges rejected
 *   - Hostname normalized via URL parser; trailing dot / double dot rejected
 *   - Body streamed with 100 KB short-circuit (no arrayBuffer() amplification)
 *   - Content-type allowlist (text/plain for v1, message/ohttp-req for v2)
 *   - Inbound header allowlist (strip Cookie/Authorization/Origin/Referer/etc.)
 *   - 20s upstream timeout; redirects disabled (redirect: 'manual')
 *   - Per-IP rate limit (in-memory per edge region today; durable KV backend
 *     wired in follow-up PR before Phase 3 consumes this endpoint)
 */

export const config = { runtime: 'edge' }

/** Content types permitted from the browser. */
const ALLOWED_CONTENT_TYPES = ['text/plain', 'message/ohttp-req']

const MAX_BODY_BYTES = 100 * 1024
const UPSTREAM_TIMEOUT_MS = 20_000
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60

// TODO(phase-3): replace with @vercel/kv or @upstash/redis before proxy is
// wired into the send flow. In-memory is per-edge-region and resets on cold
// start — not durable enough to rely on for the production ship. KV_REST_API_*
// env vars are assumed provisioned in Vercel dashboard.
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(key)
  if (!bucket || bucket.resetAt < now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false
  bucket.count += 1
  return true
}

/**
 * Reject private / loopback / link-local / CGNAT IPv4 ranges.
 * Invariant: IPv6 literals (including ULA fc00::/7, link-local fe80::/10,
 * loopback ::1, mapped ::ffff:) are rejected earlier by parseTarget's `:`
 * filter, so we do not check them here. Do not lift the `:` filter without
 * also adding explicit IPv6 range checks to this function.
 */
export function isPrivateIp(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '0.0.0.0') return true
  if (/^127\./.test(hostname)) return true
  if (/^10\./.test(hostname)) return true
  if (/^192\.168\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true
  if (/^169\.254\./.test(hostname)) return true
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)) return true
  return false
}

export function parseTarget(pathParam: string): URL | null {
  if (!pathParam || pathParam.length > 2048) return null
  if (/[\r\n]/.test(pathParam)) return null

  const slashIdx = pathParam.indexOf('/')
  if (slashIdx === -1) return null

  const host = pathParam.slice(0, slashIdx)
  const path = pathParam.slice(slashIdx)

  // Reject userinfo embedded in host and any non-hostname chars (rejects IPv6
  // literals entirely via `:`).
  if (host.includes('@') || host.includes(':') || !/^[a-z0-9.-]+$/i.test(host)) return null
  // Reject malformed labels: leading/trailing/double dots.
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null
  // Reject labels with leading/trailing hyphen (RFC 1035 violation).
  for (const label of host.split('.')) {
    if (label.length === 0) return null
    if (label.startsWith('-') || label.endsWith('-')) return null
  }
  if (isPrivateIp(host)) return null

  let target: URL
  try {
    target = new URL(`https://${host}${path}`)
  } catch {
    return null
  }
  if (target.protocol !== 'https:') return null
  if (target.port && target.port !== '443') return null
  // URL normalization sanity: the hostname we assembled must round-trip as-is
  // (catches punycode surprises and internal parser quirks).
  if (target.hostname !== host.toLowerCase()) return null
  return target
}

function clientIpOf(request: Request): string {
  // Vercel Edge sets x-real-ip and x-forwarded-for at the platform layer;
  // these are trustworthy for inbound traffic through Vercel's CDN. This
  // function is NOT safe on any other host — review before porting.
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() ?? 'unknown'
  return 'unknown'
}

/**
 * Read request body into a Uint8Array, aborting as soon as the running total
 * exceeds MAX_BODY_BYTES. Prevents content-length-spoofing amplification where
 * a caller declares a small content-length and then streams a large body —
 * `request.arrayBuffer()` would buffer the whole thing before we could reject.
 */
async function readCappedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    body.set(c, offset)
    offset += c.length
  }
  return body
}

export async function POST(request: Request): Promise<Response> {
  // Gate: the proxy is deployed to public Vercel URLs but has no consumer
  // until Phase 3 wires it in. Default to disabled to avoid being used as an
  // open outbound POST cannon. Flip PAYJOIN_PROXY_ENABLED=1 in the Vercel
  // dashboard when a preview needs live testing, and before Phase 3 ship.
  if (process.env.PAYJOIN_PROXY_ENABLED !== '1') {
    return Response.json({ error: 'payjoin proxy disabled' }, { status: 503 })
  }

  const url = new URL(request.url)
  const pathParam = url.searchParams.get('_path') ?? ''
  const target = parseTarget(pathParam)
  if (!target) {
    return Response.json(
      { error: 'invalid target — expected /api/payjoin-proxy/DOMAIN/PATH with https scheme' },
      { status: 400 }
    )
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!ALLOWED_CONTENT_TYPES.some((ct) => contentType.startsWith(ct))) {
    return Response.json({ error: 'unsupported content-type' }, { status: 415 })
  }

  if (!checkRateLimit(clientIpOf(request))) {
    return Response.json({ error: 'rate limit exceeded' }, { status: 429 })
  }

  const body = await readCappedBody(request)
  if (body === null) {
    return Response.json({ error: 'body too large' }, { status: 413 })
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: 'POST',
      // Header allowlist — do NOT forward Cookie, Authorization, Origin,
      // Referer, X-Forwarded-For, User-Agent, Accept-Language, etc.
      headers: {
        'content-type': contentType,
        'content-length': String(body.byteLength),
        'user-agent': 'payjoin-client/1.0',
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    // Forward only safe response headers.
    const responseHeaders: Record<string, string> = {
      'Cache-Control': 'no-store',
    }
    const upstreamCt = upstream.headers.get('content-type')
    if (upstreamCt) responseHeaders['content-type'] = upstreamCt

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (err) {
    // Surface the cause for ops. Response body stays generic (no info leak).
    console.error(
      '[payjoin-proxy] upstream error',
      err instanceof Error ? err.message : String(err)
    )
    return Response.json({ error: 'upstream unavailable' }, { status: 502 })
  }
}
