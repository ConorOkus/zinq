import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EsploraClient } from './esplora-client'

const BASE_URL = 'https://mutinynet.com/api'

describe('EsploraClient', () => {
  let client: EsploraClient

  beforeEach(() => {
    client = new EsploraClient(BASE_URL)
    vi.restoreAllMocks()
  })

  it('getTipHash returns trimmed hash string', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('abc123def456\n', { status: 200 })
    )
    const hash = await client.getTipHash()
    expect(hash).toBe('abc123def456')
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/blocks/tip/hash`)
  })

  it('getTipHeight returns parsed number', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('42000', { status: 200 })
    )
    const height = await client.getTipHeight()
    expect(height).toBe(42000)
  })

  it('getBlockHeader returns decoded hex bytes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('0a0b0c', { status: 200 })
    )
    const header = await client.getBlockHeader('somehash')
    expect(Array.from(header)).toEqual([10, 11, 12])
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/block/somehash/header`)
  })

  it('getBlockStatus returns parsed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ in_best_chain: true, height: 100 }), { status: 200 })
    )
    const status = await client.getBlockStatus('somehash')
    expect(status.in_best_chain).toBe(true)
    expect(status.height).toBe(100)
  })

  it('getTxStatus returns parsed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ confirmed: true, block_height: 50, block_hash: 'abc' }),
        { status: 200 }
      )
    )
    const status = await client.getTxStatus('txid123')
    expect(status.confirmed).toBe(true)
    expect(status.block_height).toBe(50)
  })

  it('getOutspend returns parsed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ spent: true, txid: 'spend_txid', vin: 0 }),
        { status: 200 }
      )
    )
    const result = await client.getOutspend('txid', 1)
    expect(result.spent).toBe(true)
    expect(result.txid).toBe('spend_txid')
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/tx/txid/outspend/1`)
  })

  it('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not found', { status: 404 })
    )
    await expect(client.getTipHash()).rejects.toThrow('failed: 404')
  })
})
