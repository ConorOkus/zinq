import { hexToBytes } from '../utils'
import type { BlockStatus, TxStatus, MerkleProof, OutspendStatus } from './types'

export class EsploraClient {
  constructor(private baseUrl: string) {}

  async getTipHash(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/blocks/tip/hash`)
    if (!res.ok) throw new Error(`[Esplora] GET /blocks/tip/hash failed: ${res.status}`)
    return (await res.text()).trim()
  }

  async getTipHeight(): Promise<number> {
    const res = await fetch(`${this.baseUrl}/blocks/tip/height`)
    if (!res.ok) throw new Error(`[Esplora] GET /blocks/tip/height failed: ${res.status}`)
    return parseInt(await res.text(), 10)
  }

  async getBlockHeader(hash: string): Promise<Uint8Array> {
    const res = await fetch(`${this.baseUrl}/block/${hash}/header`)
    if (!res.ok) throw new Error(`[Esplora] GET /block/${hash}/header failed: ${res.status}`)
    const hex = (await res.text()).trim()
    return hexToBytes(hex)
  }

  async getBlockStatus(hash: string): Promise<BlockStatus> {
    const res = await fetch(`${this.baseUrl}/block/${hash}/status`)
    if (!res.ok) throw new Error(`[Esplora] GET /block/${hash}/status failed: ${res.status}`)
    return (await res.json()) as BlockStatus
  }

  async getBlockHashAtHeight(height: number): Promise<string> {
    const res = await fetch(`${this.baseUrl}/block-height/${height}`)
    if (!res.ok)
      throw new Error(`[Esplora] GET /block-height/${height} failed: ${res.status}`)
    return (await res.text()).trim()
  }

  async getTxStatus(txid: string): Promise<TxStatus> {
    const res = await fetch(`${this.baseUrl}/tx/${txid}/status`)
    if (!res.ok) throw new Error(`[Esplora] GET /tx/${txid}/status failed: ${res.status}`)
    return (await res.json()) as TxStatus
  }

  async getTxHex(txid: string): Promise<Uint8Array> {
    const res = await fetch(`${this.baseUrl}/tx/${txid}/hex`)
    if (!res.ok) throw new Error(`[Esplora] GET /tx/${txid}/hex failed: ${res.status}`)
    const hex = (await res.text()).trim()
    return hexToBytes(hex)
  }

  async getTxMerkleProof(txid: string): Promise<MerkleProof> {
    const res = await fetch(`${this.baseUrl}/tx/${txid}/merkle-proof`)
    if (!res.ok)
      throw new Error(`[Esplora] GET /tx/${txid}/merkle-proof failed: ${res.status}`)
    return (await res.json()) as MerkleProof
  }

  async getOutspend(txid: string, vout: number): Promise<OutspendStatus> {
    const res = await fetch(`${this.baseUrl}/tx/${txid}/outspend/${vout}`)
    if (!res.ok)
      throw new Error(`[Esplora] GET /tx/${txid}/outspend/${vout} failed: ${res.status}`)
    return (await res.json()) as OutspendStatus
  }
}
