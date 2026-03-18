import { Filter, type WatchedOutput } from 'lightningdevkit'
import { txidBytesToHex } from '../utils'

export interface WatchState {
  watchedTxids: Map<string, Uint8Array>
  watchedOutputs: Map<string, WatchedOutput>
}

export function createFilter(): { filter: Filter; watchState: WatchState } {
  const watchState: WatchState = {
    watchedTxids: new Map(),
    watchedOutputs: new Map(),
  }

  const filter = Filter.new_impl({
    register_tx(txid: Uint8Array, script_pubkey: Uint8Array): void {
      const txidHex = txidBytesToHex(txid)
      console.log(`[LDK Filter] register_tx: ${txidHex}`)
      watchState.watchedTxids.set(txidHex, script_pubkey)
    },
    register_output(output: WatchedOutput): void {
      const outpoint = output.get_outpoint()
      const key = `${txidBytesToHex(outpoint.get_txid())}:${outpoint.get_index()}`
      console.log(`[LDK Filter] register_output: ${key}`)
      watchState.watchedOutputs.set(key, output)
    },
  })

  return { filter, watchState }
}
