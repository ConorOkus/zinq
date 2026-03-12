import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockClaimFunds = vi.fn()
const mockProcessPendingHtlcForwards = vi.fn()

vi.mock('lightningdevkit', () => {
  class MockEvent {}
  class Event_PaymentClaimable extends MockEvent {
    payment_hash = new Uint8Array([1, 2, 3])
    amount_msat = BigInt(100000)
    purpose = {
      preimage: () => new Option_ThirtyTwoBytesZ_Some(new Uint8Array([4, 5, 6])),
    }
  }
  class Event_PaymentClaimed extends MockEvent {
    payment_hash = new Uint8Array([1, 2, 3])
    amount_msat = BigInt(100000)
  }
  class Event_PaymentSent extends MockEvent {
    payment_hash = new Uint8Array([1, 2, 3])
  }
  class Event_PaymentFailed extends MockEvent {
    payment_hash = new Uint8Array([1, 2, 3])
  }
  class Event_PaymentPathSuccessful extends MockEvent {}
  class Event_PaymentPathFailed extends MockEvent {}
  class Event_PaymentForwarded extends MockEvent {}
  class Event_PendingHTLCsForwardable extends MockEvent {
    time_forwardable = BigInt(2)
  }
  class Event_SpendableOutputs extends MockEvent {
    outputs = [{ write: () => new Uint8Array([10, 20, 30]) }]
  }
  class Event_ChannelPending extends MockEvent {
    channel_id = { write: () => new Uint8Array([7, 8]) }
  }
  class Event_ChannelReady extends MockEvent {
    channel_id = { write: () => new Uint8Array([7, 8]) }
  }
  class Event_ChannelClosed extends MockEvent {
    channel_id = { write: () => new Uint8Array([7, 8]) }
    reason = 'CooperativeClosure'
  }
  class Event_ConnectionNeeded extends MockEvent {
    node_id = new Uint8Array([9, 10, 11])
    addresses: unknown[] = []
  }
  class Event_FundingGenerationReady extends MockEvent {}
  class Event_FundingTxBroadcastSafe extends MockEvent {}
  class Event_BumpTransaction extends MockEvent {}
  class Event_OpenChannelRequest extends MockEvent {}
  class Event_DiscardFunding extends MockEvent {}

  class Option_ThirtyTwoBytesZ_Some {
    some: Uint8Array
    constructor(s: Uint8Array) {
      this.some = s
    }
  }

  return {
    EventHandler: {
      new_impl: vi.fn(
        (impl: { handle_event: (event: unknown) => unknown }) => ({
          _impl: impl,
        }),
      ),
    },
    Event_PaymentClaimable,
    Event_PaymentClaimed,
    Event_PaymentSent,
    Event_PaymentFailed,
    Event_PaymentPathSuccessful,
    Event_PaymentPathFailed,
    Event_PaymentForwarded,
    Event_PendingHTLCsForwardable,
    Event_SpendableOutputs,
    Event_ChannelPending,
    Event_ChannelReady,
    Event_ChannelClosed,
    Event_FundingGenerationReady,
    Event_FundingTxBroadcastSafe,
    Event_OpenChannelRequest,
    Event_ConnectionNeeded,
    Event_BumpTransaction,
    Event_DiscardFunding,
    Option_ThirtyTwoBytesZ_Some,
    Result_NoneReplayEventZ: {
      constructor_ok: vi.fn(() => ({ is_ok: () => true })),
    },
  }
})

vi.mock('../storage/idb', () => ({
  idbPut: vi.fn(() => Promise.resolve()),
}))

vi.mock('../utils', () => ({
  bytesToHex: vi.fn((bytes: Uint8Array) =>
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  ),
}))

import { createEventHandler } from './event-handler'
import { idbPut } from '../storage/idb'
import {
  Event_PaymentClaimable,
  Event_PaymentClaimed,
  Event_PaymentSent,
  Event_PaymentFailed,
  Event_PendingHTLCsForwardable,
  Event_SpendableOutputs,
  Event_ChannelPending,
  Event_ChannelReady,
  Event_ChannelClosed,
  Event_ConnectionNeeded,
  Event_FundingGenerationReady,
  Event_BumpTransaction,
  Event_OpenChannelRequest,
  Event_DiscardFunding,
} from 'lightningdevkit'

function createMockChannelManager() {
  return {
    claim_funds: mockClaimFunds,
    process_pending_htlc_forwards: mockProcessPendingHtlcForwards,
  } as never
}

type HandleEventFn = (event: unknown) => unknown

describe('createEventHandler', () => {
  let handleEvent: HandleEventFn
  const mockConnectToPeer = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    const cm = createMockChannelManager()
    const { handler, setConnectToPeer } = createEventHandler(cm)
    setConnectToPeer(mockConnectToPeer)
    handleEvent = (
      handler as unknown as { _impl: { handle_event: HandleEventFn } }
    )._impl.handle_event
  })

  it('claims payment on PaymentClaimable with preimage', () => {
    handleEvent(new Event_PaymentClaimable())
    expect(mockClaimFunds).toHaveBeenCalledWith(new Uint8Array([4, 5, 6]))
  })

  it('logs PaymentClaimed', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    handleEvent(new Event_PaymentClaimed())
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('PaymentClaimed'),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    )
    spy.mockRestore()
  })

  it('logs PaymentSent', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    handleEvent(new Event_PaymentSent())
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('PaymentSent'),
      expect.any(String),
    )
    spy.mockRestore()
  })

  it('warns on PaymentFailed', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    handleEvent(new Event_PaymentFailed())
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('PaymentFailed'),
      expect.any(String),
    )
    spy.mockRestore()
  })

  it('schedules HTLC forwarding with delay', () => {
    handleEvent(new Event_PendingHTLCsForwardable())
    expect(mockProcessPendingHtlcForwards).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(mockProcessPendingHtlcForwards).toHaveBeenCalledOnce()
  })

  it('clamps HTLC forwarding delay to 10s max', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const event = Object.assign(new Event_PendingHTLCsForwardable(), {
      time_forwardable: BigInt(999),
    })
    handleEvent(event)
    vi.advanceTimersByTime(9999)
    expect(mockProcessPendingHtlcForwards).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(mockProcessPendingHtlcForwards).toHaveBeenCalledOnce()
  })

  it('persists SpendableOutputs to IDB', () => {
    handleEvent(new Event_SpendableOutputs())
    expect(idbPut).toHaveBeenCalledWith(
      'ldk_spendable_outputs',
      expect.any(String),
      [expect.any(Uint8Array)],
    )
  })

  it('logs ChannelPending', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    handleEvent(new Event_ChannelPending())
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('ChannelPending'),
      expect.any(String),
    )
    spy.mockRestore()
  })

  it('logs ChannelReady', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    handleEvent(new Event_ChannelReady())
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('ChannelReady'),
      expect.any(String),
    )
    spy.mockRestore()
  })

  it('logs ChannelClosed with reason', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    handleEvent(new Event_ChannelClosed())
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('ChannelClosed'),
      expect.any(String),
      'reason:',
      'CooperativeClosure',
    )
    spy.mockRestore()
  })

  it('calls connectToPeer on ConnectionNeeded', () => {
    handleEvent(new Event_ConnectionNeeded())
    expect(mockConnectToPeer).toHaveBeenCalled()
  })

  it('warns on FundingGenerationReady (deferred)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    handleEvent(new Event_FundingGenerationReady())
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('FundingGenerationReady'),
    )
    spy.mockRestore()
  })

  it('warns on BumpTransaction (deferred)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    handleEvent(new Event_BumpTransaction())
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('BumpTransaction'),
    )
    spy.mockRestore()
  })

  it('logs OpenChannelRequest (auto-reject)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    handleEvent(new Event_OpenChannelRequest())
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('OpenChannelRequest'),
    )
    spy.mockRestore()
  })

  it('logs DiscardFunding', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    handleEvent(new Event_DiscardFunding())
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('DiscardFunding'))
    spy.mockRestore()
  })

  it('handles unknown events without throwing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(() => handleEvent({})).not.toThrow()
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled event'),
      expect.any(String),
    )
    spy.mockRestore()
  })

  it('catches errors in handler without throwing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const badEvent = Object.assign(new Event_PaymentClaimable(), {
      purpose: null,
    })
    expect(() => handleEvent(badEvent)).not.toThrow()
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled error'),
      expect.anything(),
    )
    spy.mockRestore()
  })
})
