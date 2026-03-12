export interface BlockStatus {
  in_best_chain: boolean
  height: number
}

export interface TxStatus {
  confirmed: boolean
  block_height?: number
  block_hash?: string
}

export interface MerkleProof {
  block_height: number
  merkle: string[]
  pos: number
}

export interface OutspendStatus {
  spent: boolean
  txid?: string
  vin?: number
}
