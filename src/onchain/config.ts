import { ACTIVE_NETWORK, type NetworkId } from '../ldk/config'

type BdkNetwork = 'bitcoin' | 'signet'

interface OnchainConfig {
  network: BdkNetwork
  esploraUrl: string
  explorerUrl: string
  syncIntervalMs: number
  fullScanGapLimit: number
  syncParallelRequests: number
  esploraMaxRetries: number
}

const ONCHAIN_CONFIGS: Record<NetworkId, OnchainConfig> = {
  signet: {
    network: 'signet',
    esploraUrl: 'https://mutinynet.com/api',
    explorerUrl: 'https://mutinynet.com',
    syncIntervalMs: 180_000,
    fullScanGapLimit: 20,
    syncParallelRequests: 2,
    esploraMaxRetries: 3,
  },
  mainnet: {
    network: 'bitcoin',
    esploraUrl: '/api/esplora',
    explorerUrl: 'https://mempool.space',
    syncIntervalMs: 180_000,
    fullScanGapLimit: 20,
    syncParallelRequests: 2,
    esploraMaxRetries: 3,
  },
}

const onchainBase = ONCHAIN_CONFIGS[ACTIVE_NETWORK]

/** BDK's WASM reqwest client cannot resolve relative URLs — resolve against page origin. */
function resolveUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`
}

export const ONCHAIN_CONFIG: OnchainConfig = {
  ...onchainBase,
  esploraUrl: resolveUrl(
    (import.meta.env.VITE_ESPLORA_URL as string | undefined) ?? onchainBase.esploraUrl
  ),
  explorerUrl: (import.meta.env.VITE_EXPLORER_URL as string | undefined) ?? onchainBase.explorerUrl,
}
