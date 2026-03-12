import {
  Persist,
  ChannelMonitorUpdateStatus,
  type OutPoint,
  type ChannelMonitor,
  type ChannelMonitorUpdate,
  type ChainMonitor,
} from 'lightningdevkit'
import { idbPut, idbDelete } from '../storage/idb'
import { bytesToHex } from '../utils'

function outpointKey(outpoint: OutPoint): string {
  return `${bytesToHex(outpoint.get_txid())}:${outpoint.get_index().toString()}`
}

export function createPersister(): {
  persist: Persist
  setChainMonitor: (cm: ChainMonitor) => void
} {
  let chainMonitorRef: ChainMonitor | null = null

  const persist = Persist.new_impl({
    persist_new_channel(
      channel_funding_outpoint: OutPoint,
      monitor: ChannelMonitor
    ): ChannelMonitorUpdateStatus {
      const key = outpointKey(channel_funding_outpoint)
      const data = monitor.write()
      const updateId = monitor.get_latest_update_id()

      idbPut('ldk_channel_monitors', key, data)
        .then(() => {
          if (chainMonitorRef) {
            chainMonitorRef.channel_monitor_updated(channel_funding_outpoint, updateId)
          }
        })
        .catch((err: unknown) => {
          console.error('[LDK Persist] Failed to persist new channel monitor:', err)
        })

      return ChannelMonitorUpdateStatus.LDKChannelMonitorUpdateStatus_InProgress
    },

    update_persisted_channel(
      channel_funding_outpoint: OutPoint,
      _monitor_update: ChannelMonitorUpdate | null,
      monitor: ChannelMonitor
    ): ChannelMonitorUpdateStatus {
      const key = outpointKey(channel_funding_outpoint)
      const data = monitor.write()
      const updateId = monitor.get_latest_update_id()

      idbPut('ldk_channel_monitors', key, data)
        .then(() => {
          if (chainMonitorRef) {
            chainMonitorRef.channel_monitor_updated(channel_funding_outpoint, updateId)
          }
        })
        .catch((err: unknown) => {
          console.error('[LDK Persist] Failed to update channel monitor:', err)
        })

      return ChannelMonitorUpdateStatus.LDKChannelMonitorUpdateStatus_InProgress
    },

    archive_persisted_channel(channel_funding_outpoint: OutPoint): void {
      const key = outpointKey(channel_funding_outpoint)
      idbDelete('ldk_channel_monitors', key).catch((err: unknown) => {
        console.error('[LDK Persist] Failed to delete archived channel monitor:', err)
      })
    },
  })

  return {
    persist,
    setChainMonitor: (cm: ChainMonitor) => {
      chainMonitorRef = cm
    },
  }
}
