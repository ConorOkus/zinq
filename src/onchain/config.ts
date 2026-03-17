export const ONCHAIN_CONFIG = {
  network: 'signet' as const,
  esploraUrl: 'https://mutinynet.com/api',
  explorerUrl: 'https://mutinynet.com',
  syncIntervalMs: 80_000,
  fullScanGapLimit: 20,
  syncParallelRequests: 5,
  esploraMaxRetries: 3,
} as const
