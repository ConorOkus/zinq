interface OnchainConfig {
  network: 'bitcoin'
  esploraUrl: string
  explorerUrl: string
  syncIntervalMs: number
  fullScanGapLimit: number
  syncParallelRequests: number
  esploraMaxRetries: number
}

const DEFAULTS: OnchainConfig = {
  network: 'bitcoin',
  esploraUrl: '/api/esplora',
  explorerUrl: 'https://mempool.space',
  syncIntervalMs: 180_000,
  fullScanGapLimit: 20,
  syncParallelRequests: 2,
  esploraMaxRetries: 3,
}

/** BDK's WASM reqwest client cannot resolve relative URLs — resolve against page origin. */
function resolveUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`
}

export const ONCHAIN_CONFIG: OnchainConfig = {
  ...DEFAULTS,
  esploraUrl: resolveUrl(
    (import.meta.env.VITE_ESPLORA_URL as string | undefined) ?? DEFAULTS.esploraUrl
  ),
  explorerUrl: (import.meta.env.VITE_EXPLORER_URL as string | undefined) ?? DEFAULTS.explorerUrl,
}
