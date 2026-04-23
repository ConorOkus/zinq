import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { POST, isPrivateIp, parseTarget } from './payjoin-proxy'

describe('payjoin-proxy — isPrivateIp', () => {
  it('rejects loopback', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true)
    expect(isPrivateIp('127.5.5.5')).toBe(true)
    expect(isPrivateIp('localhost')).toBe(true)
  })

  it('rejects RFC 1918 private ranges', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true)
    expect(isPrivateIp('192.168.1.1')).toBe(true)
    expect(isPrivateIp('172.16.0.1')).toBe(true)
    expect(isPrivateIp('172.31.255.255')).toBe(true)
  })

  it('rejects link-local and cloud metadata', () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true) // AWS/GCP metadata
  })

  it('rejects CGNAT range', () => {
    expect(isPrivateIp('100.64.0.1')).toBe(true)
    expect(isPrivateIp('100.127.255.255')).toBe(true)
  })

  it('accepts public hostnames', () => {
    expect(isPrivateIp('payjo.in')).toBe(false)
    expect(isPrivateIp('btcpay.example.com')).toBe(false)
    expect(isPrivateIp('1.1.1.1')).toBe(false)
    expect(isPrivateIp('8.8.8.8')).toBe(false)
  })

  it('does not false-match hostnames starting with fc/fd/fe80', () => {
    // Regression for a prior bug where startsWith('fc')/startsWith('fd') blocked
    // legitimate hostnames. IPv6 literals are rejected at parseTarget, not here.
    expect(isPrivateIp('fc-example.com')).toBe(false)
    expect(isPrivateIp('fd-service.net')).toBe(false)
    expect(isPrivateIp('fdic.gov')).toBe(false)
    expect(isPrivateIp('fe80-docs.net')).toBe(false)
  })
})

describe('payjoin-proxy — parseTarget', () => {
  it('parses valid public https target', () => {
    const url = parseTarget('btcpay.example.com/payjoin/xyz')
    expect(url?.href).toBe('https://btcpay.example.com/payjoin/xyz')
  })

  it('rejects missing slash', () => {
    expect(parseTarget('btcpay.example.com')).toBeNull()
  })

  it('rejects empty', () => {
    expect(parseTarget('')).toBeNull()
  })

  it('rejects pathologically long input', () => {
    expect(parseTarget('a.example/' + 'x'.repeat(2100))).toBeNull()
  })

  it('rejects CR/LF (header injection)', () => {
    expect(parseTarget('a.example\r\n/path')).toBeNull()
    expect(parseTarget('a.example/path\r\ninjected')).toBeNull()
  })

  it('rejects userinfo in host', () => {
    expect(parseTarget('user@evil.com/path')).toBeNull()
  })

  it('rejects explicit port', () => {
    expect(parseTarget('a.example:8080/path')).toBeNull()
  })

  it('rejects IPv6 literal via `:` filter', () => {
    // Documented invariant: parseTarget rejects IPv6 literals by the ':' char
    // check; isPrivateIp does NOT need IPv6 range checks.
    expect(parseTarget('[::1]/path')).toBeNull()
    expect(parseTarget('[fc00::1]/path')).toBeNull()
  })

  it('rejects private IP targets', () => {
    expect(parseTarget('127.0.0.1/path')).toBeNull()
    expect(parseTarget('10.0.0.1/path')).toBeNull()
    expect(parseTarget('169.254.169.254/metadata')).toBeNull()
    expect(parseTarget('localhost/path')).toBeNull()
  })

  it('rejects trailing-dot FQDN', () => {
    expect(parseTarget('evil.com./path')).toBeNull()
  })

  it('rejects leading dot', () => {
    expect(parseTarget('.evil.com/path')).toBeNull()
  })

  it('rejects double dot', () => {
    expect(parseTarget('evil..com/path')).toBeNull()
  })

  it('rejects leading/trailing hyphen labels', () => {
    expect(parseTarget('-evil.com/path')).toBeNull()
    expect(parseTarget('evil-.com/path')).toBeNull()
  })

  it('accepts v2 relay hosts', () => {
    expect(parseTarget('payjo.in/session/abc')?.hostname).toBe('payjo.in')
    expect(parseTarget('pj.benalleng.com/r/xyz')?.hostname).toBe('pj.benalleng.com')
    expect(parseTarget('ohttp.achow101.com/')?.hostname).toBe('ohttp.achow101.com')
  })
})

describe('payjoin-proxy — POST handler', () => {
  const ENABLED_ENV = { PAYJOIN_PROXY_ENABLED: '1' }
  const fetchSpy = vi.spyOn(globalThis, 'fetch')

  beforeEach(() => {
    vi.stubEnv('PAYJOIN_PROXY_ENABLED', '1')
    fetchSpy.mockReset()
    // mockImplementation so every call gets a fresh Response (bodies are single-read).
    fetchSpy.mockImplementation(() => Promise.resolve(new Response('upstream-ok', { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function makeRequest(opts: {
    pathParam?: string
    contentType?: string
    body?: BodyInit | null
    clientIp?: string
  }): Request {
    const {
      pathParam = 'btcpay.example.com/payjoin/x',
      contentType = 'text/plain',
      body = 'cHNidP8=',
      clientIp,
    } = opts
    const headers: HeadersInit = { 'content-type': contentType }
    if (clientIp) headers['x-real-ip'] = clientIp
    return new Request(
      `https://zinqq.app/api/payjoin-proxy?_path=${encodeURIComponent(pathParam)}`,
      { method: 'POST', headers, body }
    )
  }

  it('returns 503 when PAYJOIN_PROXY_ENABLED is not set', async () => {
    vi.stubEnv('PAYJOIN_PROXY_ENABLED', '')
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(503)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns 503 when PAYJOIN_PROXY_ENABLED is not "1"', async () => {
    vi.stubEnv('PAYJOIN_PROXY_ENABLED', 'true')
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(503)
  })

  it('rejects malformed _path with 400', async () => {
    const res = await POST(makeRequest({ pathParam: 'broken' }))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects private-IP target with 400', async () => {
    const res = await POST(makeRequest({ pathParam: '127.0.0.1/hack' }))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects unsupported content-type with 415', async () => {
    const res = await POST(makeRequest({ contentType: 'application/json' }))
    expect(res.status).toBe(415)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects streaming body exceeding MAX_BODY_BYTES with 413 (no arrayBuffer amplification)', async () => {
    const oversized = new Uint8Array(200 * 1024) // 200 KB actual, beats 100 KB cap
    // Lie in the content-length header to simulate the amplification attack.
    const req = new Request(
      'https://zinqq.app/api/payjoin-proxy?_path=btcpay.example.com/payjoin/x',
      {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'content-length': '100' },
        body: oversized,
      }
    )
    const res = await POST(req)
    expect(res.status).toBe(413)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('forwards to upstream with only allowlisted headers on the happy path', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://btcpay.example.com/payjoin/x')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('manual')
    const hdrs = init?.headers as Record<string, string>
    expect(Object.keys(hdrs).sort()).toEqual(['content-length', 'content-type', 'user-agent'])
    expect(hdrs['user-agent']).toBe('payjoin-client/1.0')
    // Critical: no Cookie, Authorization, Origin, Referer, X-Forwarded-For.
    expect(hdrs['cookie']).toBeUndefined()
    expect(hdrs['origin']).toBeUndefined()
    expect(hdrs['referer']).toBeUndefined()
  })

  it('routes v2 OHTTP content-type through', async () => {
    const res = await POST(
      makeRequest({
        pathParam: 'payjo.in/abc/def',
        contentType: 'message/ohttp-req',
        body: new Uint8Array([1, 2, 3, 4]),
      })
    )
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://payjo.in/abc/def')
  })

  it('returns 502 and logs on upstream failure', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchSpy.mockRejectedValue(new Error('network unreachable'))
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(502)
    expect(errSpy).toHaveBeenCalledWith('[payjoin-proxy] upstream error', 'network unreachable')
    errSpy.mockRestore()
  })

  it('returns 502 on upstream timeout', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchSpy.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(502)
    errSpy.mockRestore()
  })

  it('rate-limits after RATE_LIMIT_MAX requests from the same IP (429)', async () => {
    // RATE_LIMIT_MAX = 60 in module. Fire 61 requests from the same IP.
    const ip = '203.0.113.42'
    let lastStatus = 0
    for (let i = 0; i < 61; i++) {
      const res = await POST(makeRequest({ clientIp: ip }))
      lastStatus = res.status
      if (res.status === 429) break
    }
    expect(lastStatus).toBe(429)
  })
})
