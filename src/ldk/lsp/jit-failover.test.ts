// Mocks intentionally use `async () => ...` for clarity even when they have
// no `await`; the require-await rule would force `() => Promise.resolve(...)`
// or a sentinel `await Promise.resolve()`, both of which obscure intent.
/* eslint-disable @typescript-eslint/require-await */
import { describe, it, expect, vi } from 'vitest'
import {
  runJitInvoiceFlow,
  JitPeerConnectError,
  JitPaymentSizeOutOfRangeError,
} from '../context'
import type { LdkNode } from '../init'
import type { LspContact } from './contacts'

// runJitInvoiceFlow's orchestrator only forwards `node` to the injected
// `attempt`. A bare object suffices.
const FAKE_NODE = {} as unknown as LdkNode

const FAKE_CONNECT = vi.fn(async () => undefined)

const LQWD: LspContact = {
  nodeId: '02'.padEnd(66, '0'),
  host: '3.68.244.94',
  port: 26000,
  token: null,
  label: 'lqwd',
}

const MEGALITH: LspContact = {
  nodeId: '03'.padEnd(66, '1'),
  host: 'megalith.example',
  port: 9735,
  token: 'megalith-token',
  label: 'megalith',
}

const RESULT_LQWD = {
  bolt11: 'lnbc1pjlqwd...',
  openingFeeMsat: 1000n,
  paymentHash: 'aa'.padEnd(64, '0'),
}

const RESULT_MEGALITH = {
  bolt11: 'lnbc1pjmega...',
  openingFeeMsat: 2000n,
  paymentHash: 'bb'.padEnd(64, '0'),
}

describe('runJitInvoiceFlow — primary/fallback orchestration', () => {
  it('uses primary on the happy path and never touches fallback', async () => {
    const attempt = vi.fn(async (_node, contact: LspContact) => {
      if (contact.label === 'lqwd') return RESULT_LQWD
      throw new Error('should not call megalith')
    })

    const result = await runJitInvoiceFlow({
      node: FAKE_NODE,
      amountMsat: 50_000_000n,
      description: 'test',
      connect: FAKE_CONNECT,
      contacts: { primary: LQWD, fallback: MEGALITH },
      attempt,
    })

    expect(result).toBe(RESULT_LQWD)
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(attempt.mock.calls[0][1].label).toBe('lqwd')
    expect(attempt.mock.calls[0][5]).toEqual({ retryConnectOnce: false })
  })

  // Scenario 1: LQwD /get_info 5xx → resolveLspContacts returned primary=null
  // → fallback runs the full LSPS2 dance against Megalith.
  it('falls back to Megalith when primary discovery (HTTP preflight) failed', async () => {
    const attempt = vi.fn(async (_node, contact: LspContact) => {
      if (contact.label === 'megalith') return RESULT_MEGALITH
      throw new Error('lqwd should never be attempted')
    })

    const result = await runJitInvoiceFlow({
      node: FAKE_NODE,
      amountMsat: 50_000_000n,
      description: 'test',
      connect: FAKE_CONNECT,
      contacts: { primary: null, fallback: MEGALITH },
      attempt,
    })

    expect(result).toBe(RESULT_MEGALITH)
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(attempt.mock.calls[0][1].label).toBe('megalith')
    expect(attempt.mock.calls[0][5]).toEqual({ retryConnectOnce: true })
  })

  // Scenario 2 (rolled in via the discovery test suite): malformed JSON / empty
  // uris cause `fetchLqwdContact` to reject → `resolveLspContacts` returns
  // primary=null → same path as Scenario 1, asserted there.

  // Scenario 3: peer-connect to LQwD fails → fallback to Megalith.
  it('falls back when LQwD peer connect throws', async () => {
    const attempt = vi.fn(async (_node, contact: LspContact) => {
      if (contact.label === 'lqwd') {
        throw new JitPeerConnectError('peer_connect (lqwd): timeout')
      }
      return RESULT_MEGALITH
    })

    const result = await runJitInvoiceFlow({
      node: FAKE_NODE,
      amountMsat: 50_000_000n,
      description: 'test',
      connect: FAKE_CONNECT,
      contacts: { primary: LQWD, fallback: MEGALITH },
      attempt,
    })

    expect(result).toBe(RESULT_MEGALITH)
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(attempt.mock.calls[0][1].label).toBe('lqwd')
    expect(attempt.mock.calls[1][1].label).toBe('megalith')
    expect(attempt.mock.calls[1][5]).toEqual({ retryConnectOnce: true })
  })

  // Scenario 4: payment size outside LQwD's range → fallback to Megalith.
  it('falls back when amount is outside LQwD range (payment_size_filter)', async () => {
    const attempt = vi.fn(async (_node, contact: LspContact) => {
      if (contact.label === 'lqwd') {
        throw new JitPaymentSizeOutOfRangeError(
          'no fee params accept 200000000 msat from lqwd'
        )
      }
      return RESULT_MEGALITH
    })

    const result = await runJitInvoiceFlow({
      node: FAKE_NODE,
      amountMsat: 200_000_000n,
      description: 'test',
      connect: FAKE_CONNECT,
      contacts: { primary: LQWD, fallback: MEGALITH },
      attempt,
    })

    expect(result).toBe(RESULT_MEGALITH)
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  // Scenario 5: both LSPs fail → throws → Receive.tsx degrades to on-chain.
  it('throws when both primary and fallback fail (degrading to on-chain)', async () => {
    const attempt = vi.fn(async (_node, contact: LspContact) => {
      throw new Error(`${contact.label} unreachable`)
    })

    await expect(
      runJitInvoiceFlow({
        node: FAKE_NODE,
        amountMsat: 50_000_000n,
        description: 'test',
        connect: FAKE_CONNECT,
        contacts: { primary: LQWD, fallback: MEGALITH },
        attempt,
      })
    ).rejects.toThrow(/megalith unreachable/)

    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('throws when no LSP is configured at all', async () => {
    const attempt = vi.fn()
    await expect(
      runJitInvoiceFlow({
        node: FAKE_NODE,
        amountMsat: 50_000_000n,
        description: 'test',
        connect: FAKE_CONNECT,
        contacts: { primary: null, fallback: null },
        attempt,
      })
    ).rejects.toThrow(/LSP not configured/)
    expect(attempt).not.toHaveBeenCalled()
  })

  it('throws when primary fails and no fallback is configured', async () => {
    const attempt = vi.fn(async () => {
      throw new JitPeerConnectError('lqwd unreachable')
    })

    await expect(
      runJitInvoiceFlow({
        node: FAKE_NODE,
        amountMsat: 50_000_000n,
        description: 'test',
        connect: FAKE_CONNECT,
        contacts: { primary: LQWD, fallback: null },
        attempt,
      })
    ).rejects.toThrow(/lqwd unreachable/)

    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('passes the user-provided amount and description through to attempt', async () => {
    const attempt = vi.fn(async () => RESULT_LQWD)
    await runJitInvoiceFlow({
      node: FAKE_NODE,
      amountMsat: 12_345_678n,
      description: 'my-description',
      connect: FAKE_CONNECT,
      contacts: { primary: LQWD, fallback: MEGALITH },
      attempt,
    })
    expect(attempt.mock.calls[0][2]).toBe(12_345_678n)
    expect(attempt.mock.calls[0][3]).toBe('my-description')
  })
})
