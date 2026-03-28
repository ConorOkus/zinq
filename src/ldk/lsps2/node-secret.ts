/**
 * Derive the node secret key from the LDK seed.
 *
 * LDK's KeysManager derives the node secret as BIP32 m/0' from the seed.
 * This matches the Rust implementation in KeysManager::new().
 *
 * The derived key can be verified at runtime by comparing its public key
 * against keysManager.as_NodeSigner().get_node_id().
 */

import { HDKey } from '@scure/bip32'

export function deriveNodeSecret(ldkSeed: Uint8Array): Uint8Array {
  const master = HDKey.fromMasterSeed(ldkSeed)
  const child = master.derive("m/0'")
  if (!child.privateKey) {
    throw new Error('Failed to derive node secret key from LDK seed')
  }
  return child.privateKey
}
