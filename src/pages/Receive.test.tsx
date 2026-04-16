import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, it, expect, vi } from 'vitest'
import {
  OnchainContext,
  type OnchainContextValue,
  defaultOnchainContextValue,
} from '../onchain/onchain-context'
import { LdkContext, defaultLdkContextValue, type LdkContextValue } from '../ldk/ldk-context'
import { Receive } from './Receive'

function readyContext(
  overrides?: Partial<Extract<OnchainContextValue, { status: 'ready' }>>
): OnchainContextValue {
  return {
    status: 'ready',
    balance: { confirmed: 50000n, trustedPending: 0n, untrustedPending: 0n },
    generateAddress: () => 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    estimateFee: vi.fn().mockResolvedValue({ fee: 150n, feeRate: 1n }),
    estimateMaxSendable: vi.fn().mockResolvedValue({ amount: 49850n, fee: 150n, feeRate: 1n }),
    sendToAddress: vi.fn().mockResolvedValue('txid123'),
    sendMax: vi.fn().mockResolvedValue('txid123'),
    syncNow: vi.fn(),
    listTransactions: () => [],
    error: null,
    ...overrides,
  }
}

/** Create a mock ChannelDetails with the specified inbound capacity. */
function mockChannel(inboundCapacityMsat: bigint, isUsable = true) {
  return {
    get_is_usable: () => isUsable,
    get_inbound_capacity_msat: () => inboundCapacityMsat,
    get_outbound_capacity_msat: () => 500_000_000n,
    get_channel_id: () => ({ write: () => new Uint8Array(32) }),
    get_counterparty: () => ({ get_node_id: () => new Uint8Array(33) }),
    get_is_channel_ready: () => true,
  } as never
}

function readyLdkContext(
  overrides?: Partial<Extract<LdkContextValue, { status: 'ready' }>>
): LdkContextValue {
  return {
    ...defaultLdkContextValue,
    status: 'ready' as const,
    node: {} as never,
    nodeId: 'test',
    error: null,
    syncStatus: 'synced' as const,
    peersReconnected: true,
    connectToPeer: vi.fn(),
    forgetPeer: vi.fn(),
    disconnectPeer: vi.fn(),
    createChannel: vi.fn(),
    bdkWallet: {} as never,
    bdkEsploraClient: {} as never,
    setSyncNeeded: vi.fn(),
    createInvoice: vi.fn(() => ({ bolt11: 'lnbc1fakeinvoice', paymentHash: 'abc123' })),
    requestJitInvoice: vi.fn(),
    sendBolt11Payment: vi.fn(),
    sendBolt12Payment: vi.fn(),
    closeChannel: vi.fn(),
    forceCloseChannel: vi.fn(),
    listChannels: vi.fn(() => [mockChannel(1_000_000_000n)]),
    abandonPayment: vi.fn(),
    getPaymentResult: vi.fn(() => null),
    listRecentPayments: vi.fn(() => []),
    outboundCapacityMsat: vi.fn(() => 1_000_000_000n),
    lightningBalanceSats: 1_000_000n,
    channelChangeCounter: 0,
    paymentHistory: [],
    bolt12Offer: null,
    vssStatus: 'ok' as const,
    vssClient: null,
    shutdown: () => {},
    ...overrides,
  }
}

function renderReceive(contextValue?: OnchainContextValue, ldkValue?: LdkContextValue) {
  return render(
    <MemoryRouter>
      <LdkContext value={ldkValue ?? readyLdkContext()}>
        <OnchainContext value={contextValue ?? readyContext()}>
          <Receive />
        </OnchainContext>
      </LdkContext>
    </MemoryRouter>
  )
}

describe('Receive', () => {
  it('shows loading state', () => {
    renderReceive(defaultOnchainContextValue)
    expect(screen.queryByLabelText(/qr code/i)).not.toBeInTheDocument()
  })

  it('shows error state', () => {
    renderReceive({ status: 'error', balance: null, error: new Error('BDK failed') })
    expect(screen.getByText(/failed to load wallet/i)).toBeInTheDocument()
  })

  it('shows QR code when ready with inbound capacity', () => {
    renderReceive()
    expect(screen.getByLabelText(/qr code for bitcoin address/i)).toBeInTheDocument()
  })

  it('shows error when address generation fails', () => {
    renderReceive(
      readyContext({
        generateAddress: () => {
          throw new Error('BDK not initialized')
        },
      })
    )
    expect(screen.getByText(/BDK not initialized/)).toBeInTheDocument()
  })

  it('shows copy icon in header when QR is visible', () => {
    renderReceive()
    expect(screen.getByRole('button', { name: /copy payment request/i })).toBeInTheDocument()
  })

  it('opens numpad automatically when no channels exist', () => {
    renderReceive(
      undefined,
      readyLdkContext({
        listChannels: vi.fn(() => []),
      })
    )
    // Numpad is open, requesting an amount
    expect(screen.getByRole('button', { name: /request/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/qr code/i)).not.toBeInTheDocument()
  })

  it('shows Request heading', () => {
    renderReceive()
    expect(screen.getByText('Request')).toBeInTheDocument()
  })

  it('has a back button', () => {
    renderReceive()
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
  })

  it('opens bottom sheet when copy icon is tapped', async () => {
    const user = userEvent.setup()
    renderReceive()

    await user.click(screen.getByRole('button', { name: /copy payment request/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/payment request/i)).toBeInTheDocument()
  })

  describe('standard invoice path (with inbound capacity)', () => {
    it('calls createInvoice with no amount on initial load', () => {
      const createInvoice = vi.fn(() => ({
        bolt11: 'lnbc1fakeinvoice',
        paymentHash: 'abc123',
      }))
      renderReceive(undefined, readyLdkContext({ createInvoice }))
      expect(createInvoice).toHaveBeenCalledWith(undefined)
    })

    it('entering digits and confirming regenerates the invoice with amount', async () => {
      const user = userEvent.setup()
      const createInvoice = vi.fn(() => ({
        bolt11: 'lnbc1amountinvoice',
        paymentHash: 'abc123',
      }))
      renderReceive(undefined, readyLdkContext({ createInvoice }))

      await user.click(screen.getByRole('button', { name: /add amount/i }))
      await user.click(screen.getByRole('button', { name: '5' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: /done/i }))

      expect(createInvoice).toHaveBeenCalledWith(50_000_000n)
    })

    it('BIP 321 URI includes amount= when amount is set', async () => {
      const user = userEvent.setup()
      const createInvoice = vi.fn(() => ({
        bolt11: 'lnbc1amountinvoice',
        paymentHash: 'abc123',
      }))
      renderReceive(undefined, readyLdkContext({ createInvoice }))

      await user.click(screen.getByRole('button', { name: /add amount/i }))
      await user.click(screen.getByRole('button', { name: '1' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: /done/i }))

      expect(screen.getByLabelText(/amount ₿100/i)).toBeInTheDocument()
    })

    it('shows invoice error when regeneration fails with amount', async () => {
      const user = userEvent.setup()
      let callCount = 0
      const createInvoice = vi.fn(() => {
        callCount++
        if (callCount > 1) throw new Error('Invoice creation failed')
        return { bolt11: 'lnbc1fakeinvoice', paymentHash: 'abc123' }
      })
      renderReceive(undefined, readyLdkContext({ createInvoice }))

      await user.click(screen.getByRole('button', { name: /add amount/i }))
      await user.click(screen.getByRole('button', { name: '1' }))
      await user.click(screen.getByRole('button', { name: /done/i }))

      expect(screen.getByText(/failed to create lightning invoice/i)).toBeInTheDocument()
    })
  })

  describe('auto-detect: no channels (amount required)', () => {
    it('opens numpad when no channels exist', () => {
      renderReceive(
        undefined,
        readyLdkContext({
          listChannels: vi.fn(() => []),
        })
      )
      // Numpad shown with "Request" label — amount is required for JIT
      expect(screen.getByRole('button', { name: /request/i })).toBeInTheDocument()
      expect(screen.queryByLabelText(/qr code/i)).not.toBeInTheDocument()
    })
  })

  describe('auto-detect: JIT path (insufficient inbound)', () => {
    it('uses JIT when amount exceeds inbound capacity', async () => {
      const user = userEvent.setup()
      const requestJitInvoice = vi.fn().mockResolvedValue({
        bolt11: 'lnbc1jitinvoice',
        openingFeeMsat: 2500_000n,
        paymentHash: 'jithash',
      })

      renderReceive(
        undefined,
        readyLdkContext({
          listChannels: vi.fn(() => [mockChannel(10_000_000n)]), // 10k sats inbound
          requestJitInvoice,
        })
      )

      // Enter 50,000 sats (exceeds 10k inbound)
      await user.click(screen.getByRole('button', { name: /add amount/i }))
      await user.click(screen.getByRole('button', { name: '5' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: /done/i }))

      await waitFor(() => {
        expect(requestJitInvoice).toHaveBeenCalledWith(50_000_000n, 'zinqq wallet')
      })
    })

    it('shows opening fee when JIT invoice is ready', async () => {
      const user = userEvent.setup()
      const requestJitInvoice = vi.fn().mockResolvedValue({
        bolt11: 'lnbc1jitinvoice',
        openingFeeMsat: 2500_000n,
        paymentHash: 'jithash',
      })

      renderReceive(
        undefined,
        readyLdkContext({
          listChannels: vi.fn(() => []),
          requestJitInvoice,
        })
      )

      // Numpad already open (no channels → amount required)
      await user.click(screen.getByRole('button', { name: '1' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: /request/i }))

      await waitFor(() => {
        expect(screen.getByText(/setup fee/i)).toBeInTheDocument()
      })
    })

    it('shows negotiating state during JIT', async () => {
      const user = userEvent.setup()
      // Never resolves
      const requestJitInvoice = vi.fn().mockReturnValue(new Promise(() => {}))

      renderReceive(
        undefined,
        readyLdkContext({
          listChannels: vi.fn(() => []),
          requestJitInvoice,
        })
      )

      // Numpad already open
      await user.click(screen.getByRole('button', { name: '1' }))
      await user.click(screen.getByRole('button', { name: /request/i }))

      await waitFor(() => {
        expect(requestJitInvoice).toHaveBeenCalled()
      })
      // QR code should not be visible during negotiation
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('falls back to on-chain only when JIT fails', async () => {
      const user = userEvent.setup()
      const requestJitInvoice = vi.fn().mockRejectedValue(new Error('LSP unreachable'))

      renderReceive(
        undefined,
        readyLdkContext({
          listChannels: vi.fn(() => []),
          requestJitInvoice,
        })
      )

      // Numpad already open
      await user.click(screen.getByRole('button', { name: '1' }))
      await user.click(screen.getByRole('button', { name: /request/i }))

      // Should still show QR (on-chain fallback)
      await waitFor(() => {
        expect(screen.getByLabelText(/qr code for bitcoin address/i)).toBeInTheDocument()
      })
    })
  })

  describe('success detection', () => {
    it('shows success screen when payment is received', () => {
      renderReceive(
        undefined,
        readyLdkContext({
          paymentHistory: [
            {
              paymentHash: 'abc123',
              direction: 'inbound',
              amountMsat: 50_000_000n,
              status: 'succeeded',
              feePaidMsat: null,
              createdAt: Date.now(),
              failureReason: null,
            },
          ],
        })
      )

      expect(screen.getByText(/payment received/i)).toBeInTheDocument()
      expect(screen.getByText('₿50,000')).toBeInTheDocument()
    })
  })

  describe('amount entry', () => {
    it('shows "Add amount" label on initial render', () => {
      renderReceive()
      expect(screen.getByRole('button', { name: /add amount/i })).toBeInTheDocument()
    })

    it('tapping "Add amount" shows the numpad and hides the QR', async () => {
      const user = userEvent.setup()
      renderReceive()

      await user.click(screen.getByRole('button', { name: /add amount/i }))

      expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
      expect(screen.queryByLabelText(/qr code/i)).not.toBeInTheDocument()
    })

    it('cancel returns to QR without changing amount', async () => {
      const user = userEvent.setup()
      renderReceive()

      await user.click(screen.getByRole('button', { name: /add amount/i }))
      await user.click(screen.getByRole('button', { name: '5' }))
      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(screen.getByRole('button', { name: /add amount/i })).toBeInTheDocument()
      expect(screen.getByLabelText(/qr code/i)).toBeInTheDocument()
    })

    it('tapping "Edit amount" re-opens numpad with pre-populated digits', async () => {
      const user = userEvent.setup()
      renderReceive()

      await user.click(screen.getByRole('button', { name: /add amount/i }))
      await user.click(screen.getByRole('button', { name: '5' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: /done/i }))

      expect(screen.getByText('₿500')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /edit amount/i })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /edit amount/i }))

      expect(screen.getByText('₿500')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
    })

    it('remove amount clears back to zero-amount invoice', async () => {
      const user = userEvent.setup()
      const createInvoice = vi.fn(() => ({
        bolt11: 'lnbc1fakeinvoice',
        paymentHash: 'abc123',
      }))
      renderReceive(undefined, readyLdkContext({ createInvoice }))

      await user.click(screen.getByRole('button', { name: /add amount/i }))
      await user.click(screen.getByRole('button', { name: '1' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: '0' }))
      await user.click(screen.getByRole('button', { name: /done/i }))

      await user.click(screen.getByRole('button', { name: /edit amount/i }))
      await user.click(screen.getByRole('button', { name: /remove amount/i }))

      expect(screen.getByRole('button', { name: /add amount/i })).toBeInTheDocument()

      const lastCall = createInvoice.mock.calls[createInvoice.mock.calls.length - 1]
      expect(lastCall).toEqual([undefined])
    })
  })

  describe('peer reconnection', () => {
    it('shows loading spinner when peers not yet reconnected but channels exist', () => {
      renderReceive(
        undefined,
        readyLdkContext({
          peersReconnected: false,
          listChannels: vi.fn(() => [mockChannel(1_000_000_000n, false)]),
        })
      )
      expect(screen.queryByLabelText(/qr code/i)).not.toBeInTheDocument()
    })
  })
})
