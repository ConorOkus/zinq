/**
 * Vercel serverless function that proxies Esplora requests to Blockstream
 * Enterprise, keeping OAuth2 credentials server-side.
 *
 * Vercel rewrite maps /api/esplora/SEGMENTS to /api/esplora-proxy?_path=SEGMENTS
 *
 * Requires env vars (NOT VITE_ prefixed — server-only):
 *   BLOCKSTREAM_CLIENT_ID
 *   BLOCKSTREAM_CLIENT_SECRET
 */

const TOKEN_URL =
  'https://login.blockstream.com/realms/blockstream-public/protocol/openid-connect/token'
const UPSTREAM_BASE = 'https://enterprise.blockstream.info/api'
const TOKEN_REFRESH_BUFFER_MS = 30_000
const UPSTREAM_TIMEOUT_MS = 15_000

let cachedToken: string | null = null
let expiresAt = 0
let pendingRefresh: Promise<string> | null = null

async function getToken(): Promise<string> {
  const clientId = process.env.BLOCKSTREAM_CLIENT_ID
  const clientSecret = process.env.BLOCKSTREAM_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('BLOCKSTREAM_CLIENT_ID / BLOCKSTREAM_CLIENT_SECRET not configured')
  }

  if (cachedToken && Date.now() < expiresAt) return cachedToken

  if (pendingRefresh) return pendingRefresh

  pendingRefresh = (async () => {
    const params = new URLSearchParams()
    params.append('client_id', clientId)
    params.append('client_secret', clientSecret)
    params.append('grant_type', 'client_credentials')
    params.append('scope', 'openid')

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })

    if (!res.ok) {
      throw new Error(`Token request failed: HTTP ${res.status.toString()}`)
    }

    const data = (await res.json()) as { access_token: string; expires_in: number }
    cachedToken = data.access_token
    expiresAt = Date.now() + data.expires_in * 1000 - TOKEN_REFRESH_BUFFER_MS
    return cachedToken
  })().finally(() => {
    pendingRefresh = null
  })

  return pendingRefresh
}

export async function GET(request: Request): Promise<Response> {
  return proxyToEsplora(request)
}

export async function POST(request: Request): Promise<Response> {
  return proxyToEsplora(request)
}

async function proxyToEsplora(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const esploraPath = url.searchParams.get('_path') ?? ''
  const targetUrl = `${UPSTREAM_BASE}/${esploraPath}`

  let token: string
  try {
    token = await getToken()
  } catch {
    return Response.json({ error: 'auth unavailable' }, { status: 502 })
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    }
    if (request.method === 'POST') {
      headers['Content-Type'] = request.headers.get('content-type') ?? 'text/plain'
    }

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body:
        request.method !== 'GET' && request.method !== 'HEAD'
          ? await request.text()
          : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'text/plain',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return Response.json({ error: 'upstream unavailable' }, { status: 502 })
  }
}
