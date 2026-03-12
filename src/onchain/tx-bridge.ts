// TEMPORARY: Remove this entire module when bdk-wasm exposes Transaction.to_bytes() (bdk-wasm#38)
// https://github.com/bitcoindevkit/bdk-wasm/issues/38

import { Transaction } from '@scure/btc-signer'

/**
 * Extract raw consensus-encoded transaction bytes from a finalized BDK PSBT base64 string.
 * Uses @scure/btc-signer to parse the PSBT and extract the signed transaction.
 */
export function extractTxBytes(psbtBase64: string): Uint8Array {
  const psbtBytes = base64ToBytes(psbtBase64)
  const tx = Transaction.fromPSBT(psbtBytes)
  tx.finalize()
  return tx.extract()
}

/** Convert raw transaction bytes to hex string for Esplora broadcasting */
export function txBytesToHex(txBytes: Uint8Array): string {
  return Array.from(txBytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Broadcast a raw transaction hex to Esplora POST /tx, returns the txid */
export async function broadcastTransaction(
  txHex: string,
  esploraUrl: string,
): Promise<string> {
  const response = await fetch(`${esploraUrl}/tx`, {
    method: 'POST',
    body: txHex,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Esplora broadcast failed: ${response.status} ${body}`)
  }
  return response.text()
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
