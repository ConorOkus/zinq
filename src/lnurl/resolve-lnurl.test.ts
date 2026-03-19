import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveLnurlPay, fetchLnurlInvoice } from './resolve-lnurl'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

function lnurlPayResponse(overrides?: Record<string, unknown>) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        tag: 'payRequest',
        callback: 'https://example.com/lnurlp/alice/callback',
        minSendable: 1000,
        maxSendable: 100000000,
        metadata: '[["text/plain","Pay alice"],["text/identifier","alice@example.com"]]',
        ...overrides,
      }),
  }
}

describe('resolveLnurlPay', () => {
  it('resolves a valid LNURL-pay response', async () => {
    mockFetch.mockResolvedValueOnce(lnurlPayResponse())

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).not.toBeNull()
    expect(result!.domain).toBe('example.com')
    expect(result!.user).toBe('alice')
    expect(result!.callback).toBe('https://example.com/lnurlp/alice/callback')
    expect(result!.minSendableMsat).toBe(1000n)
    expect(result!.maxSendableMsat).toBe(100000000n)
    expect(result!.description).toBe('Pay alice')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/.well-known/lnurlp/alice',
      expect.any(Object),
    )
  })

  it('returns null on network error (CORS)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null on LNURL error response', async () => {
    mockFetch.mockResolvedValueOnce(
      lnurlPayResponse({ status: 'ERROR', reason: 'User not found' }),
    )

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null on wrong tag', async () => {
    mockFetch.mockResolvedValueOnce(lnurlPayResponse({ tag: 'withdrawRequest' }))

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null when missing required fields', async () => {
    mockFetch.mockResolvedValueOnce(lnurlPayResponse({ callback: undefined }))

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null when callback is not HTTPS', async () => {
    mockFetch.mockResolvedValueOnce(
      lnurlPayResponse({ callback: 'http://example.com/callback' }),
    )

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null when callback domain does not match original domain', async () => {
    mockFetch.mockResolvedValueOnce(
      lnurlPayResponse({ callback: 'https://evil.com/lnurlp/callback' }),
    )

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('allows callback on subdomain of original domain', async () => {
    mockFetch.mockResolvedValueOnce(
      lnurlPayResponse({ callback: 'https://api.example.com/lnurlp/callback' }),
    )

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).not.toBeNull()
    expect(result!.callback).toBe('https://api.example.com/lnurlp/callback')
  })

  it('returns null on invalid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    })

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('uses fallback description when metadata is invalid', async () => {
    mockFetch.mockResolvedValueOnce(lnurlPayResponse({ metadata: 'invalid' }))

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).not.toBeNull()
    expect(result!.description).toBe('alice@example.com')
  })

  it('uses fallback description when no text/plain in metadata', async () => {
    mockFetch.mockResolvedValueOnce(
      lnurlPayResponse({ metadata: '[["text/identifier","alice@example.com"]]' }),
    )

    const result = await resolveLnurlPay('alice', 'example.com')
    expect(result).not.toBeNull()
    expect(result!.description).toBe('alice@example.com')
  })

  it('passes AbortSignal to fetch', async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValueOnce(lnurlPayResponse())

    await resolveLnurlPay('alice', 'example.com', controller.signal)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })
})

describe('fetchLnurlInvoice', () => {
  it('fetches an invoice from the callback URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ pr: 'lntbs100n1pj...' }),
    })

    const invoice = await fetchLnurlInvoice(
      'https://example.com/lnurlp/alice/callback',
      50000n,
    )
    expect(invoice).toBe('lntbs100n1pj...')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/lnurlp/alice/callback?amount=50000',
      expect.any(Object),
    )
  })

  it('appends amount with & when callback has existing query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ pr: 'lntbs100n1pj...' }),
    })

    await fetchLnurlInvoice(
      'https://example.com/callback?key=val',
      50000n,
    )

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/callback?key=val&amount=50000',
      expect.any(Object),
    )
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(fetchLnurlInvoice('https://example.com/cb', 50000n)).rejects.toThrow(
      'Failed to fetch invoice',
    )
  })

  it('throws on LNURL error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'ERROR', reason: 'Amount too low' }),
    })

    await expect(fetchLnurlInvoice('https://example.com/cb', 50000n)).rejects.toThrow(
      'Amount too low',
    )
  })

  it('throws when no pr field in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ routes: [] }),
    })

    await expect(fetchLnurlInvoice('https://example.com/cb', 50000n)).rejects.toThrow(
      'No invoice in response',
    )
  })

  it('passes AbortSignal to fetch', async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ pr: 'lntbs...' }),
    })

    await fetchLnurlInvoice('https://example.com/cb', 50000n, controller.signal)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })
})
