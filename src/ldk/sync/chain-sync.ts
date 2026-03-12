import {
  TwoTuple_usizeTransactionZ,
  type Confirm,
  type ChannelManager,
  type ChainMonitor,
  type NetworkGraph,
  type ProbabilisticScorer,
} from 'lightningdevkit'
import type { EsploraClient } from './esplora-client'
import type { WatchState } from '../traits/filter'
import { bytesToHex } from '../utils'
import { idbPut } from '../storage/idb'

export async function syncOnce(
  confirmables: Confirm[],
  watchState: WatchState,
  esplora: EsploraClient,
  lastSyncTipHash: string | null
): Promise<string> {
  const tipHash = await esplora.getTipHash()
  if (tipHash === lastSyncTipHash) return tipHash

  // 1. Reorg detection: check get_relevant_txids() against chain
  for (const confirmable of confirmables) {
    const relevantTxids = confirmable.get_relevant_txids()
    for (const tuple of relevantTxids) {
      const txid = tuple.get_a()
      const blockHashOpt = tuple.get_c()
      if (blockHashOpt) {
        const blockHashHex = bytesToHex(blockHashOpt)
        const status = await esplora.getBlockStatus(blockHashHex)
        if (!status.in_best_chain) {
          confirmable.transaction_unconfirmed(txid)
        }
      }
    }
  }

  // 2. Update best block
  const tipHeight = await esplora.getTipHeight()
  const tipHeader = await esplora.getBlockHeader(tipHash)
  for (const confirmable of confirmables) {
    confirmable.best_block_updated(tipHeader, tipHeight)
  }

  // 3. Check watched txids for new confirmations
  for (const [txidHex] of watchState.watchedTxids) {
    const status = await esplora.getTxStatus(txidHex)
    if (status.confirmed && status.block_hash && status.block_height != null) {
      const header = await esplora.getBlockHeader(status.block_hash)
      const rawTx = await esplora.getTxHex(txidHex)
      const proof = await esplora.getTxMerkleProof(txidHex)
      const txdata = [TwoTuple_usizeTransactionZ.constructor_new(proof.pos, rawTx)]
      for (const confirmable of confirmables) {
        confirmable.transactions_confirmed(header, txdata, status.block_height)
      }
    }
  }

  // 4. Check watched outputs for spends
  for (const [key] of watchState.watchedOutputs) {
    const [txid, voutStr] = key.split(':')
    const spend = await esplora.getOutspend(txid, parseInt(voutStr, 10))
    if (spend.spent && spend.txid) {
      const status = await esplora.getTxStatus(spend.txid)
      if (status.confirmed && status.block_hash && status.block_height != null) {
        const header = await esplora.getBlockHeader(status.block_hash)
        const rawTx = await esplora.getTxHex(spend.txid)
        const proof = await esplora.getTxMerkleProof(spend.txid)
        const txdata = [TwoTuple_usizeTransactionZ.constructor_new(proof.pos, rawTx)]
        for (const confirmable of confirmables) {
          confirmable.transactions_confirmed(header, txdata, status.block_height)
        }
      }
    }
  }

  // 5. Verify tip didn't change mid-sync
  const postSyncTip = await esplora.getTipHash()
  if (postSyncTip !== tipHash) {
    console.warn('[LDK Sync] Tip changed during sync, will retry next tick')
  }

  return tipHash
}

export interface SyncLoopHandle {
  stop: () => void
}

export function startSyncLoop(
  confirmables: Confirm[],
  watchState: WatchState,
  esplora: EsploraClient,
  channelManager: ChannelManager,
  chainMonitor: ChainMonitor,
  networkGraph: NetworkGraph,
  scorer: ProbabilisticScorer,
  intervalMs: number
): SyncLoopHandle {
  let lastTipHash: string | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let tickCount = 0

  async function tick() {
    if (stopped) return
    try {
      lastTipHash = await syncOnce(confirmables, watchState, esplora, lastTipHash)

      channelManager.timer_tick_occurred()
      chainMonitor.rebroadcast_pending_claims()

      // Persist ChannelManager if needed
      if (channelManager.get_and_clear_needs_persistence()) {
        await idbPut('ldk_channel_manager', 'primary', channelManager.write())
      }

      // Persist NetworkGraph + Scorer every ~10 ticks (~5 min at 30s interval)
      tickCount++
      if (tickCount % 10 === 0) {
        await idbPut('ldk_network_graph', 'primary', networkGraph.write())
        await idbPut('ldk_scorer', 'primary', scorer.write())
      }
    } catch (err) {
      console.error('[LDK Sync] Sync error:', err)
    }

    if (!stopped) {
      timeoutId = setTimeout(tick, intervalMs)
    }
  }

  // Start first tick immediately (fire-and-forget, errors caught inside tick)
  void tick()

  return {
    stop: () => {
      stopped = true
      if (timeoutId !== null) clearTimeout(timeoutId)
    },
  }
}
