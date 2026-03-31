import {
  SignerProvider,
  type SignerProviderInterface,
  type KeysManager,
  Result_CVec_u8ZNoneZ,
  Result_ShutdownScriptNoneZ,
  ShutdownScript,
} from 'lightningdevkit'
import type { Wallet } from '@bitcoindevkit/bdk-wallet-web'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { revealNextAddress, peekAddressAtIndex } from '../../onchain/address-utils'

const CHANNEL_KEYS_DOMAIN = 'zinq/channel_keys_id/v1'

/**
 * Create a custom SignerProvider that delegates to KeysManager for signing
 * but overrides get_destination_script and get_shutdown_scriptpubkey to
 * return BDK wallet addresses. This ensures all channel close funds
 * (cooperative and force close) go to the on-chain BDK wallet.
 *
 * generate_channel_keys_id uses deterministic HMAC-SHA256 derivation from
 * the LDK seed so that cross-device recovery produces the same key IDs.
 *
 * get_destination_script derives addresses deterministically from
 * channel_keys_id so that cross-device VSS recovery produces the same
 * scripts. get_shutdown_scriptpubkey uses next_unused_address since
 * shutdown scripts are recorded at channel open time and replayed from
 * serialized state.
 */
export function createBdkSignerProvider(
  keysManager: KeysManager,
  bdkWallet: Wallet,
  ldkSeed: Uint8Array
): { signerProvider: SignerProvider } {
  const defaultProvider = keysManager.as_SignerProvider()

  const impl: SignerProviderInterface = {
    generate_channel_keys_id(
      inbound: boolean,
      channel_value_satoshis: bigint,
      user_channel_id: bigint
    ): Uint8Array {
      // Deterministic derivation from seed + channel parameters for cross-device
      // recovery. Uses domain-separated HMAC-SHA256 to produce a unique 32-byte
      // key ID that is reproducible from the seed on any device.
      //
      // WASM u128 note: We operate on the raw BigInt value directly rather than
      // re-encoding through LDK's encodeUint128 (which rejects values >= 2^124).
      const data = new Uint8Array(32 + 1 + 8 + 16) // seed + inbound + value + user_channel_id
      data.set(ldkSeed)
      data[32] = inbound ? 1 : 0
      const view = new DataView(data.buffer)
      view.setBigUint64(33, channel_value_satoshis, false)
      // Full 128-bit user_channel_id: lower 8 bytes, then upper 8 bytes
      view.setBigUint64(41, user_channel_id & 0xffffffffffffffffn, false)
      view.setBigUint64(49, user_channel_id >> 64n, false)

      const key = new TextEncoder().encode(CHANNEL_KEYS_DOMAIN)
      return hmac(sha256, key, data)
    },

    derive_channel_signer(channel_value_satoshis: bigint, channel_keys_id: Uint8Array) {
      return defaultProvider.derive_channel_signer(channel_value_satoshis, channel_keys_id)
    },

    read_chan_signer(reader: Uint8Array) {
      return defaultProvider.read_chan_signer(reader)
    },

    get_destination_script(channel_keys_id: Uint8Array) {
      // No fallback to KeysManager — if BDK address derivation fails, return
      // an error to LDK. LDK will fail the channel operation gracefully.
      // Falling back to KeysManager would send funds to an address the BDK
      // wallet doesn't watch, making them appear lost.
      try {
        const script = peekAddressAtIndex(bdkWallet, channel_keys_id)
        return Result_CVec_u8ZNoneZ.constructor_ok(script)
      } catch (err) {
        console.error('[BdkSignerProvider] CRITICAL: Cannot derive destination address:', err)
        return Result_CVec_u8ZNoneZ.constructor_err()
      }
    },

    get_shutdown_scriptpubkey() {
      // No fallback to KeysManager — return error if BDK fails.
      try {
        const script = revealNextAddress(bdkWallet, 'BdkSignerProvider')
        // Validate P2WPKH format: OP_0 (0x00) + PUSH_20 (0x14) + 20-byte pubkey hash = 22 bytes
        if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) {
          const pubkeyHash = script.slice(2)
          const shutdownScript = ShutdownScript.constructor_new_p2wpkh(pubkeyHash)
          return Result_ShutdownScriptNoneZ.constructor_ok(shutdownScript)
        }
        console.error(
          '[BdkSignerProvider] CRITICAL: Unexpected script format (length=%d, prefix=0x%s)',
          script.length,
          script[0]?.toString(16)
        )
      } catch (err) {
        console.error('[BdkSignerProvider] CRITICAL: Cannot derive shutdown address:', err)
      }
      return Result_ShutdownScriptNoneZ.constructor_err()
    },
  }

  const signerProvider = SignerProvider.new_impl(impl)

  return { signerProvider }
}
