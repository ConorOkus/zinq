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
 *   - HTTPS targets only; private/loopback/link-local IP ranges rejected
 *   - Body capped at 100 KB
 *   - Content-type allowlist (text/plain for v1, message/ohttp-req for v2)
 *   - Inbound header allowlist (strip Cookie/Authorization/Origin/Referer/etc.)
 *   - 20s upstream timeout; redirects disabled (redirect: 'manual')
 *   - Per-IP rate limit (in-memory per edge region today; durable KV backend
 *     wired in follow-up PR before Phase 3 consumes this endpoint)
 */

export const config = { runtime: 'edge' }

/** v2 OHTTP relays + directory allowed as destinations. v1 endpoints are
 *  receiver-chosen and cannot be statically allowlisted — scheme + private-IP
 *  rejection are the available controls. */
const V2_HOSTS = new Set([
  'payjo.in',
  'pj.benalleng.com',
  'pj.bobspacebkk.com',
  'ohttp.achow101.com',
])

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

/** Reject if hostname resolves to a private / loopback / link-local range. */
export function isPrivateIp(hostname: string): boolean {
  // String-form check for literal IPs in _path. DNS-time check happens in the
  // fetch runtime and relies on Edge Runtime's built-in refusal of private
  // ranges for outbound fetches. Document residual DNS-rebinding risk in PR.
  if (hostname === 'localhost' || hostname === '0.0.0.0') return true
  if (/^127\./.test(hostname)) return true
  if (/^10\./.test(hostname)) return true
  if (/^192\.168\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true
  if (/^169\.254\./.test(hostname)) return true
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)) return true
  if (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd')) return true
  if (hostname.startsWith('fe80')) return true
  if (/^::ffff:/.test(hostname)) return true
  return false
}

export function parseTarget(pathParam: string): URL | null {
  if (!pathParam || pathParam.length > 2048) return null
  if (/[\r\n]/.test(pathParam)) return null

  const slashIdx = pathParam.indexOf('/')
  if (slashIdx === -1) return null

  const host = pathParam.slice(0, slashIdx)
  const path = pathParam.slice(slashIdx)

  // Reject userinfo embedded in host and any non-hostname chars.
  if (host.includes('@') || host.includes(':') || !/^[a-z0-9.-]+$/i.test(host)) return null
  if (isPrivateIp(host)) return null

  try {
    const target = new URL(`https://${host}${path}`)
    if (target.protocol !== 'https:') return null
    if (target.port && target.port !== '443') return null
    return target
  } catch {
    return null
  }
}

function clientIpOf(request: Request): string {
  // Vercel sets x-real-ip; fall back to x-forwarded-for first hop, else 'unknown'.
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() ?? 'unknown'
  return 'unknown'
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const pathParam = url.searchParams.get('_path') ?? ''
  const target = parseTarget(pathParam)
  if (!target) {
    return Response.json(
      { error: 'invalid target — expected /api/payjoin-proxy/DOMAIN/PATH with https scheme' },
      { status: 400 }
    )
  }

  // v1 allows any public https host (receiver-chosen). v2 requires allowlisted hosts.
  // We cannot reliably distinguish v1 vs v2 traffic from the HTTP layer alone, so we
  // enforce the public-https posture uniformly and accept v2 relays as a superset.
  if (!V2_HOSTS.has(target.hostname)) {
    // Host is a v1 receiver-chosen endpoint; pass through (private-IP already rejected).
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!ALLOWED_CONTENT_TYPES.some((ct) => contentType.startsWith(ct))) {
    return Response.json({ error: 'unsupported content-type' }, { status: 415 })
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'body too large' }, { status: 413 })
  }

  if (!checkRateLimit(clientIpOf(request))) {
    return Response.json({ error: 'rate limit exceeded' }, { status: 429 })
  }

  const body = await request.arrayBuffer()
  if (body.byteLength > MAX_BODY_BYTES) {
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
  } catch {
    return Response.json({ error: 'upstream unavailable' }, { status: 502 })
  }
}
