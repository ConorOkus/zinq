import { mnemonicToSeedSync } from '@scure/bip39'
import { HDKey } from '@scure/bip32'

const LDK_DERIVATION_PATH = "m/535'/0'"
const VSS_ENCRYPTION_KEY_PATH = "m/535'/1'"
const VSS_SIGNING_KEY_PATH = "m/535'/2'"

/**
 * Derive a 32-byte seed for LDK's KeysManager from a BIP39 mnemonic.
 * Uses the private key at m/535'/0' — a dedicated path that won't
 * collide with standard BIP44/49/84/86 derivations.
 */
export function deriveLdkSeed(mnemonic: string): Uint8Array {
  const seed = mnemonicToSeedSync(mnemonic)
  const master = HDKey.fromMasterSeed(seed)
  const child = master.derive(LDK_DERIVATION_PATH)
  if (!child.privateKey) {
    throw new Error('Failed to derive LDK seed: no private key at ' + LDK_DERIVATION_PATH)
  }
  return child.privateKey
}

/**
 * Derive a 32-byte encryption key for VSS client-side encryption.
 * Uses a dedicated path m/535'/1' separate from the LDK seed (m/535'/0').
 */
export function deriveVssEncryptionKey(mnemonic: string): Uint8Array {
  const seed = mnemonicToSeedSync(mnemonic)
  const master = HDKey.fromMasterSeed(seed)
  const child = master.derive(VSS_ENCRYPTION_KEY_PATH)
  if (!child.privateKey) {
    throw new Error('Failed to derive VSS encryption key at ' + VSS_ENCRYPTION_KEY_PATH)
  }
  return child.privateKey
}

/**
 * Derive a 32-byte signing key for VSS authentication headers.
 * Uses a dedicated path m/535'/2' separate from LDK seed (m/535'/0')
 * and VSS encryption key (m/535'/1').
 */
export function deriveVssSigningKey(mnemonic: string): Uint8Array {
  const seed = mnemonicToSeedSync(mnemonic)
  const master = HDKey.fromMasterSeed(seed)
  const child = master.derive(VSS_SIGNING_KEY_PATH)
  if (!child.privateKey) {
    throw new Error('Failed to derive VSS signing key at ' + VSS_SIGNING_KEY_PATH)
  }
  return child.privateKey
}

/**
 * Derive a deterministic VSS store_id from an LDK seed.
 * Computes SHA-256 of the raw seed bytes and returns the hex string.
 * This is unique per wallet and reproducible from the mnemonic alone.
 */
export async function deriveVssStoreId(ldkSeed: Uint8Array): Promise<string> {
  // Copy to guarantee a fresh ArrayBuffer (avoids TypedArray view aliasing)
  const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(ldkSeed).buffer)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Derive BDK-compatible BIP84 wpkh() descriptor strings from a BIP39 mnemonic.
 *
 * Returns external (receive) and internal (change) descriptors in the format:
 *   wpkh([fingerprint/84'/0'/0']xprv/0/*)
 *   wpkh([fingerprint/84'/0'/0']xprv/1/*)
 */
export function deriveBdkDescriptors(mnemonic: string): { external: string; internal: string } {
  const path = "m/84'/0'/0'"

  const seed = mnemonicToSeedSync(mnemonic)
  const master = HDKey.fromMasterSeed(seed)
  const fingerprint = master.fingerprint.toString(16).padStart(8, '0')
  const account = master.derive(path)
  const xprv = account.privateExtendedKey

  const origin = `${fingerprint}/84'/0'/0'`
  const external = `wpkh([${origin}]${xprv}/0/*)`
  const internal = `wpkh([${origin}]${xprv}/1/*)`

  return { external, internal }
}
