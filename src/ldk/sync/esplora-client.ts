import { hexToBytes } from '../utils'
import type { BlockStatus, TxStatus, MerkleProof, OutspendStatus } from './types'

const FETCH_TIMEOUT_MS = 10_000

function assertHex(value: string, label: string): void {
  if (!/^[0-9a-f]+$/.test(value)) {
    throw new Error(`[Esplora] Invalid hex in ${label}: ${value.slice(0, 20)}...`)
  }
}

export class EsploraClient {
  readonly baseUrl: string
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async getTipHash(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/blocks/tip/hash`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`[Esplora] GET /blocks/tip/hash failed: ${res.status}`)
    const hash = (await res.text()).trim()
    assertHex(hash, 'tipHash')
    return hash
  }

  async getTipHeight(): Promise<number> {
    const res = await fetch(`${this.baseUrl}/blocks/tip/height`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`[Esplora] GET /blocks/tip/height failed: ${res.status}`)
    const height = parseInt(await res.text(), 10)
    if (!Number.isFinite(height) || height < 0) {
      throw new Error(`[Esplora] Invalid tip height: ${String(height)}`)
    }
    return height
  }

  async getBlockHeader(hash: string): Promise<Uint8Array> {
    assertHex(hash, 'blockHash')
    const res = await fetch(`${this.baseUrl}/block/${hash}/header`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`[Esplora] GET /block/${hash}/header failed: ${res.status}`)
    const hex = (await res.text()).trim()
    assertHex(hex, 'blockHeader')
    return hexToBytes(hex)
  }

  async getBlockStatus(hash: string): Promise<BlockStatus> {
    assertHex(hash, 'blockHash')
    const res = await fetch(`${this.baseUrl}/block/${hash}/status`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`[Esplora] GET /block/${hash}/status failed: ${res.status}`)
    const data: unknown = await res.json()
    if (typeof data !== 'object' || data === null || !('in_best_chain' in data)) {
      throw new Error('[Esplora] Malformed block status response')
    }
    return data as BlockStatus
  }

  async getTxStatus(txid: string): Promise<TxStatus> {
    assertHex(txid, 'txid')
    const res = await fetch(`${this.baseUrl}/tx/${txid}/status`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`[Esplora] GET /tx/${txid}/status failed: ${res.status}`)
    const data: unknown = await res.json()
    if (typeof data !== 'object' || data === null || !('confirmed' in data)) {
      throw new Error('[Esplora] Malformed tx status response')
    }
    return data as TxStatus
  }

  async getTxHex(txid: string): Promise<Uint8Array> {
    assertHex(txid, 'txid')
    const res = await fetch(`${this.baseUrl}/tx/${txid}/hex`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`[Esplora] GET /tx/${txid}/hex failed: ${res.status}`)
    const hex = (await res.text()).trim()
    assertHex(hex, 'txHex')
    return hexToBytes(hex)
  }

  async getTxMerkleProof(txid: string): Promise<MerkleProof> {
    assertHex(txid, 'txid')
    const res = await fetch(`${this.baseUrl}/tx/${txid}/merkle-proof`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok)
      throw new Error(`[Esplora] GET /tx/${txid}/merkle-proof failed: ${res.status}`)
    const data: unknown = await res.json()
    if (typeof data !== 'object' || data === null || !('pos' in data) || !('block_height' in data)) {
      throw new Error('[Esplora] Malformed merkle proof response')
    }
    return data as MerkleProof
  }

  async getOutspend(txid: string, vout: number): Promise<OutspendStatus> {
    assertHex(txid, 'txid')
    const res = await fetch(`${this.baseUrl}/tx/${txid}/outspend/${vout}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok)
      throw new Error(`[Esplora] GET /tx/${txid}/outspend/${vout} failed: ${res.status}`)
    const data: unknown = await res.json()
    if (typeof data !== 'object' || data === null || !('spent' in data)) {
      throw new Error('[Esplora] Malformed outspend response')
    }
    return data as OutspendStatus
  }
}
