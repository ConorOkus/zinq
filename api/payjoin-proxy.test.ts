import { describe, it, expect } from 'vitest'
import { POST, isPrivateIp, parseTarget } from './payjoin-proxy'

describe('payjoin-proxy — isPrivateIp', () => {
  it('rejects loopback', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true)
    expect(isPrivateIp('127.5.5.5')).toBe(true)
    expect(isPrivateIp('localhost')).toBe(true)
    expect(isPrivateIp('::1')).toBe(true)
  })

  it('rejects RFC 1918 private ranges', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true)
    expect(isPrivateIp('192.168.1.1')).toBe(true)
    expect(isPrivateIp('172.16.0.1')).toBe(true)
    expect(isPrivateIp('172.31.255.255')).toBe(true)
  })

  it('rejects link-local and cloud metadata', () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true) // AWS/GCP metadata
    expect(isPrivateIp('fe80::1')).toBe(true)
  })

  it('rejects CGNAT range', () => {
    expect(isPrivateIp('100.64.0.1')).toBe(true)
    expect(isPrivateIp('100.127.255.255')).toBe(true)
  })

  it('rejects IPv4-mapped IPv6', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true)
  })

  it('rejects ULA IPv6', () => {
    expect(isPrivateIp('fc00::1')).toBe(true)
    expect(isPrivateIp('fd00::1')).toBe(true)
  })

  it('accepts public hostnames', () => {
    expect(isPrivateIp('payjo.in')).toBe(false)
    expect(isPrivateIp('btcpay.example.com')).toBe(false)
    expect(isPrivateIp('1.1.1.1')).toBe(false)
    expect(isPrivateIp('8.8.8.8')).toBe(false)
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

  it('rejects private IP targets', () => {
    expect(parseTarget('127.0.0.1/path')).toBeNull()
    expect(parseTarget('10.0.0.1/path')).toBeNull()
    expect(parseTarget('169.254.169.254/metadata')).toBeNull()
    expect(parseTarget('localhost/path')).toBeNull()
  })

  it('accepts v2 relay hosts', () => {
    expect(parseTarget('payjo.in/session/abc')?.hostname).toBe('payjo.in')
    expect(parseTarget('pj.benalleng.com/r/xyz')?.hostname).toBe('pj.benalleng.com')
    expect(parseTarget('ohttp.achow101.com/')?.hostname).toBe('ohttp.achow101.com')
  })
})

describe('payjoin-proxy — POST handler validation', () => {
  it('rejects malformed _path with 400', async () => {
    const req = new Request('https://zinqq.app/api/payjoin-proxy?_path=broken', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'dummy',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects private-IP target with 400', async () => {
    const req = new Request(
      'https://zinqq.app/api/payjoin-proxy?_path=127.0.0.1/hack',
      {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'dummy',
      }
    )
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects unsupported content-type with 415', async () => {
    const req = new Request(
      'https://zinqq.app/api/payjoin-proxy?_path=btcpay.example/payjoin/x',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }
    )
    const res = await POST(req)
    expect(res.status).toBe(415)
  })

  it('rejects oversized body via content-length with 413', async () => {
    const req = new Request(
      'https://zinqq.app/api/payjoin-proxy?_path=btcpay.example/payjoin/x',
      {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          'content-length': String(200 * 1024),
        },
        body: 'dummy',
      }
    )
    const res = await POST(req)
    expect(res.status).toBe(413)
  })

  const VALIDATION_REJECTS = new Set([400, 405, 413, 415, 429])

  it('accepts text/plain content-type for v1 (passes validation)', async () => {
    // The upstream may 502 (unreachable btcpay.example.com), may return a real
    // status from a live host, or may 200. Any status outside the validation-
    // rejection set proves the validation layer accepted the request.
    const req = new Request(
      'https://zinqq.app/api/payjoin-proxy?_path=btcpay.example/payjoin/x',
      {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'cHNidP8=',
      }
    )
    const res = await POST(req)
    expect(VALIDATION_REJECTS.has(res.status)).toBe(false)
  })

  it('accepts message/ohttp-req content-type for v2 (passes validation)', async () => {
    const req = new Request(
      'https://zinqq.app/api/payjoin-proxy?_path=payjo.in/abc/def',
      {
        method: 'POST',
        headers: { 'content-type': 'message/ohttp-req' },
        body: new Uint8Array([1, 2, 3, 4]),
      }
    )
    const res = await POST(req)
    expect(VALIDATION_REJECTS.has(res.status)).toBe(false)
  })
})
