import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveBip353 } from './resolve-bip353'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function dohResponse(opts: { Status?: number; AD?: boolean; Answer?: Array<{ type: number; data: string }> }) {
  return {
    ok: true,
    json: () => Promise.resolve({ Status: 0, AD: true, ...opts }),
  }
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('resolveBip353', () => {
  it('resolves a valid BIP 353 TXT record with BOLT 12 offer', async () => {
    // We can't construct a real BOLT 12 offer in tests, so test with an on-chain address
    // that parseBip321 can handle
    mockFetch.mockResolvedValueOnce(
      dohResponse({
        Answer: [
          { type: 16, data: '"bitcoin:tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"' },
        ],
      }),
    )

    const result = await resolveBip353('alice', 'example.com')
    expect(result).not.toBeNull()
    expect(result!.type).toBe('onchain')
    if (result!.type === 'onchain') {
      expect(result!.address).toBe('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')
    }

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('alice.user._bitcoin-payment.example.com'),
      expect.objectContaining({ headers: { Accept: 'application/dns-json' } }),
    )
  })

  it('returns null for NXDOMAIN (Status !== 0)', async () => {
    mockFetch.mockResolvedValueOnce(dohResponse({ Status: 3 }))

    const result = await resolveBip353('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null when AD flag is false (no DNSSEC)', async () => {
    mockFetch.mockResolvedValueOnce(
      dohResponse({
        AD: false,
        Answer: [
          { type: 16, data: '"bitcoin:tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"' },
        ],
      }),
    )

    const result = await resolveBip353('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null when no bitcoin: TXT record exists', async () => {
    mockFetch.mockResolvedValueOnce(
      dohResponse({
        Answer: [
          { type: 16, data: '"v=spf1 include:example.com ~all"' },
        ],
      }),
    )

    const result = await resolveBip353('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null when Answer array is empty', async () => {
    mockFetch.mockResolvedValueOnce(dohResponse({ Answer: [] }))

    const result = await resolveBip353('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null when no Answer field', async () => {
    mockFetch.mockResolvedValueOnce(dohResponse({}))

    const result = await resolveBip353('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const result = await resolveBip353('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    const result = await resolveBip353('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('returns null on invalid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    })

    const result = await resolveBip353('alice', 'example.com')
    expect(result).toBeNull()
  })

  it('skips non-TXT record types', async () => {
    mockFetch.mockResolvedValueOnce(
      dohResponse({
        Answer: [
          { type: 1, data: '1.2.3.4' }, // A record
          { type: 16, data: '"bitcoin:tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"' },
        ],
      }),
    )

    const result = await resolveBip353('alice', 'example.com')
    expect(result).not.toBeNull()
    expect(result!.type).toBe('onchain')
  })

  it('passes AbortSignal to fetch', async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValueOnce(dohResponse({ Answer: [] }))

    await resolveBip353('alice', 'example.com', controller.signal)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('handles multi-segment TXT records (>255 bytes)', async () => {
    // DNS TXT records longer than 255 bytes are split into multiple quoted segments
    const addr = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
    mockFetch.mockResolvedValueOnce(
      dohResponse({
        Answer: [
          { type: 16, data: `"bitcoin:${addr}?amount=" "0.001"` },
        ],
      }),
    )

    const result = await resolveBip353('alice', 'example.com')
    expect(result).not.toBeNull()
    expect(result!.type).toBe('onchain')
  })

  it('skips bitcoin: TXT records that produce parse errors', async () => {
    mockFetch.mockResolvedValueOnce(
      dohResponse({
        Answer: [
          { type: 16, data: '"bitcoin:"' }, // empty URI → error
        ],
      }),
    )

    const result = await resolveBip353('alice', 'example.com')
    expect(result).toBeNull()
  })
})
