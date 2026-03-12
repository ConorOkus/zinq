import { BroadcasterInterface } from 'lightningdevkit'
import { bytesToHex } from '../utils'

export function createBroadcaster(esploraUrl: string): BroadcasterInterface {
  return BroadcasterInterface.new_impl({
    broadcast_transactions(txs: Uint8Array[]): void {
      for (const tx of txs) {
        const txHex = bytesToHex(tx)
        fetch(`${esploraUrl}/tx`, {
          method: 'POST',
          body: txHex,
        })
          .then((res) => {
            if (!res.ok) {
              return res.text().then((body) => {
                console.error(
                  `[LDK Broadcaster] Failed to broadcast tx: ${res.status.toString()}`,
                  body
                )
              })
            }
            return res.text().then((txid) => {
              console.info(`[LDK Broadcaster] Broadcast tx: ${txid}`)
            })
          })
          .catch((err: unknown) => {
            console.error('[LDK Broadcaster] Network error broadcasting tx:', err)
          })
      }
    },
  })
}
