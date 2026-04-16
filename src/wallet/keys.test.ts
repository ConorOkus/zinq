import { describe, it, expect } from 'vitest'
import {
  deriveLdkSeed,
  deriveBdkDescriptors,
  deriveVssEncryptionKey,
  deriveVssStoreId,
} from './keys'

// Well-known test mnemonic (BIP39 test vector #0)
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('deriveLdkSeed', () => {
  it('returns a 32-byte Uint8Array', () => {
    const seed = deriveLdkSeed(TEST_MNEMONIC)
    expect(seed).toBeInstanceOf(Uint8Array)
    expect(seed).toHaveLength(32)
  })

  it('is deterministic (same mnemonic → same seed)', () => {
    const seed1 = deriveLdkSeed(TEST_MNEMONIC)
    const seed2 = deriveLdkSeed(TEST_MNEMONIC)
    expect(Array.from(seed1)).toEqual(Array.from(seed2))
  })

  it('produces different seeds for different mnemonics', () => {
    const seed1 = deriveLdkSeed(TEST_MNEMONIC)
    const otherMnemonic = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'
    const seed2 = deriveLdkSeed(otherMnemonic)
    expect(Array.from(seed1)).not.toEqual(Array.from(seed2))
  })
})

describe('deriveBdkDescriptors', () => {
  it('returns external and internal descriptor strings', () => {
    const { external, internal } = deriveBdkDescriptors(TEST_MNEMONIC)
    expect(external).toMatch(/^wpkh\(\[/)
    expect(internal).toMatch(/^wpkh\(\[/)
    expect(external).toContain('/0/*)')
    expect(internal).toContain('/1/*)')
  })

  it('uses coin type 0 for mainnet', () => {
    const { external } = deriveBdkDescriptors(TEST_MNEMONIC)
    expect(external).toMatch(/84'\/0'\/0'/)
  })

  it('is deterministic', () => {
    const d1 = deriveBdkDescriptors(TEST_MNEMONIC)
    const d2 = deriveBdkDescriptors(TEST_MNEMONIC)
    expect(d1.external).toBe(d2.external)
    expect(d1.internal).toBe(d2.internal)
  })

  it('contains the master fingerprint in the origin', () => {
    const { external } = deriveBdkDescriptors(TEST_MNEMONIC)
    // The "abandon" mnemonic master fingerprint is 73c5da0a
    expect(external).toMatch(/\[73c5da0a\//)
  })

  it('uses xprv prefix', () => {
    const { external } = deriveBdkDescriptors(TEST_MNEMONIC)
    const match = external.match(/\](xprv[A-Za-z0-9]+)\/0\/\*\)/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(/^xprv/)
  })
})

describe('deriveVssEncryptionKey', () => {
  it('returns a 32-byte Uint8Array', () => {
    const key = deriveVssEncryptionKey(TEST_MNEMONIC)
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key).toHaveLength(32)
  })

  it('is deterministic', () => {
    const key1 = deriveVssEncryptionKey(TEST_MNEMONIC)
    const key2 = deriveVssEncryptionKey(TEST_MNEMONIC)
    expect(Array.from(key1)).toEqual(Array.from(key2))
  })

  it('differs from the LDK seed (different derivation path)', () => {
    const vssKey = deriveVssEncryptionKey(TEST_MNEMONIC)
    const ldkSeed = deriveLdkSeed(TEST_MNEMONIC)
    expect(Array.from(vssKey)).not.toEqual(Array.from(ldkSeed))
  })
})

describe('deriveVssStoreId', () => {
  it('returns a 64-character hex string', async () => {
    const seed = deriveLdkSeed(TEST_MNEMONIC)
    const storeId = await deriveVssStoreId(seed)
    expect(storeId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', async () => {
    const seed = deriveLdkSeed(TEST_MNEMONIC)
    const id1 = await deriveVssStoreId(seed)
    const id2 = await deriveVssStoreId(seed)
    expect(id1).toBe(id2)
  })

  it('differs for different seeds', async () => {
    const seed1 = deriveLdkSeed(TEST_MNEMONIC)
    const otherMnemonic = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'
    const seed2 = deriveLdkSeed(otherMnemonic)
    const id1 = await deriveVssStoreId(seed1)
    const id2 = await deriveVssStoreId(seed2)
    expect(id1).not.toBe(id2)
  })
})
