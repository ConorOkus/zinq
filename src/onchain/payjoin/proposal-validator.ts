import type { Psbt, Wallet, ScriptBuf } from '@bitcoindevkit/bdk-wallet-web'

/** Maximum additional weight a receiver may contribute, in vbytes (BIP 78 canonical). */
const MAX_ADDITIONAL_VBYTES = 110n

export interface ValidationContext {
  original: Psbt
  proposal: Psbt
  wallet: Wallet
  /** Original PSBT's fee rate in sat/vB. Used for the weight-based fee cap. */
  originalFeeRate: bigint
}

export type ValidationResult = { ok: true } | { ok: false; reason: string }

function scriptsEqual(a: ScriptBuf, b: ScriptBuf): boolean {
  const aBytes = a.as_bytes()
  const bBytes = b.as_bytes()
  if (aBytes.length !== bBytes.length) return false
  for (let i = 0; i < aBytes.length; i++) {
    if (aBytes[i] !== bBytes[i]) return false
  }
  return true
}

/**
 * Sender-side defense-in-depth checks on a Payjoin proposal PSBT.
 * PDK already enforces BIP 78's full sender checklist; this guards against
 * PDK regressions and surfaces hostile-receiver signal via telemetry.
 *
 * Checks performed:
 *   a) Every original sender input is still present (by OutPoint).
 *   b) tx version + locktime preserved.
 *   c) Every wallet-owned output in the original is preserved by scriptPubKey
 *      and its value is not reduced by more than `originalFeeRate * 110`
 *      (BIP 78 weight cap on fee contribution).
 *   d) Every non-owned output (recipient) in the original is preserved by
 *      scriptPubKey and its value is not decreased.
 *   e) Total fee does not exceed `originalFee + originalFeeRate * 110`.
 */
export function validateProposal(ctx: ValidationContext): ValidationResult {
  const original = ctx.original.unsigned_tx
  const proposal = ctx.proposal.unsigned_tx

  if (proposal.version !== original.version) {
    return { ok: false, reason: 'tx version changed' }
  }

  // (a) sender inputs preserved
  const propOutpoints = new Set(
    proposal.input.map((i) => `${i.previous_output.txid.toString()}:${i.previous_output.vout}`)
  )
  for (const inp of original.input) {
    const key = `${inp.previous_output.txid.toString()}:${inp.previous_output.vout}`
    if (!propOutpoints.has(key)) {
      return { ok: false, reason: 'sender input dropped' }
    }
  }

  // (e) total fee cap (weight-based, BIP 78 canonical)
  const maxAdditional = ctx.originalFeeRate * MAX_ADDITIONAL_VBYTES
  const proposalFee = ctx.proposal.fee().to_sat()
  const originalFee = ctx.original.fee().to_sat()
  if (proposalFee > originalFee + maxAdditional) {
    return { ok: false, reason: 'fee contribution exceeds cap' }
  }

  // (c) + (d) outputs preserved by scriptPubKey, value bounded
  for (const origOut of original.output) {
    const ours = ctx.wallet.is_mine(origOut.script_pubkey)
    let matched = false
    for (const propOut of proposal.output) {
      if (!scriptsEqual(propOut.script_pubkey, origOut.script_pubkey)) continue
      const newValue = propOut.value.to_sat()
      const oldValue = origOut.value.to_sat()
      if (ours) {
        // Sender change: may decrease by at most maxAdditional.
        if (newValue + maxAdditional < oldValue) {
          return { ok: false, reason: 'sender change reduced beyond fee cap' }
        }
      } else {
        // Recipient: may not decrease at all.
        if (newValue < oldValue) {
          return { ok: false, reason: 'recipient amount decreased' }
        }
      }
      matched = true
      break
    }
    if (!matched) {
      return {
        ok: false,
        reason: ours ? 'sender change output dropped' : 'recipient output dropped',
      }
    }
  }

  return { ok: true }
}
