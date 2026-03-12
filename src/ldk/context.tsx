import { useEffect, useState, type ReactNode } from 'react'
import { initializeLdk } from './init'
import { LdkContext, defaultLdkContextValue, type LdkContextValue } from './ldk-context'
import { SIGNET_CONFIG } from './config'
import { EsploraClient } from './sync/esplora-client'
import { startSyncLoop } from './sync/chain-sync'

export function LdkProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LdkContextValue>(defaultLdkContextValue)

  useEffect(() => {
    let cancelled = false
    let syncHandle: { stop: () => void } | null = null

    initializeLdk()
      .then(({ node, watchState }) => {
        if (cancelled) return

        const esplora = new EsploraClient(SIGNET_CONFIG.esploraUrl)
        const confirmables = [
          node.channelManager.as_Confirm(),
          node.chainMonitor.as_Confirm(),
        ]

        syncHandle = startSyncLoop(
          confirmables,
          watchState,
          esplora,
          node.channelManager,
          node.chainMonitor,
          node.networkGraph,
          node.scorer,
          SIGNET_CONFIG.chainPollIntervalMs
        )

        setState({
          status: 'ready',
          node,
          nodeId: node.nodeId,
          error: null,
          syncStatus: 'syncing',
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          node: null,
          nodeId: null,
          error: err instanceof Error ? err : new Error(String(err)),
        })
      })

    return () => {
      cancelled = true
      syncHandle?.stop()
    }
  }, [])

  return <LdkContext value={state}>{children}</LdkContext>
}
