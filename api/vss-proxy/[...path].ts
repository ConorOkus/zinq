export const config = { runtime: 'edge' }

/**
 * Vercel Edge Function that proxies VSS requests.
 * Uses Web API Request/Response for correct binary (protobuf) handling.
 * Reads VSS_ORIGIN from server-side env vars (not exposed to browser).
 */
export default async function handler(request: Request) {
  const vssOrigin = process.env.VSS_ORIGIN
  if (!vssOrigin) {
    return new Response(JSON.stringify({ error: 'VSS_ORIGIN not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(request.url)
  const segments = url.pathname.replace(/^\/api\/vss-proxy\/?/, '')
  const targetUrl = `${vssOrigin}/vss/${segments}`

  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: {
        'Content-Type':
          request.headers.get('content-type') ?? 'application/octet-stream',
      },
      body:
        request.method !== 'GET' && request.method !== 'HEAD'
          ? await request.arrayBuffer()
          : undefined,
      signal: AbortSignal.timeout(15_000),
    })

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'upstream unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
