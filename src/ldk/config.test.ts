import { describe, it, expect } from 'vitest'
import { LDK_CONFIG } from './config'

describe('LDK_CONFIG', () => {
  it('has required configuration fields', () => {
    expect(LDK_CONFIG.esploraUrl).toBeTruthy()
    expect(LDK_CONFIG.wsProxyUrl).toBeTruthy()
  })

  it('defaults to mainnet network', () => {
    // Network.LDKNetwork_Bitcoin = 0
    expect(LDK_CONFIG.network).toBe(0)
  })

  it('has the mainnet genesis block hash', () => {
    expect(LDK_CONFIG.genesisBlockHash).toBe(
      '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
    )
  })
})
