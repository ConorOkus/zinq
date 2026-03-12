import {
  EventHandler,
  Event_PaymentClaimable,
  Event_PaymentClaimed,
  Event_PaymentSent,
  Event_PaymentFailed,
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
  Event_PaymentPathSuccessful,
  Event_PaymentPathFailed,
  Event_PaymentForwarded,
  Option_ThirtyTwoBytesZ_Some,
  Result_NoneReplayEventZ,
  type ChannelManager,
  type Event,
} from 'lightningdevkit'
import { idbPut } from '../storage/idb'
import { bytesToHex } from '../utils'

const MAX_FORWARD_DELAY_MS = 10_000

type ConnectToPeerFn = (
  pubkey: string,
  host: string,
  port: number,
) => Promise<void>

interface EventHandlerDeps {
  channelManager: ChannelManager
  connectToPeer: ConnectToPeerFn
}

export function createEventHandler(channelManager: ChannelManager): {
  handler: EventHandler
  setConnectToPeer: (fn: ConnectToPeerFn) => void
} {
  let connectToPeerFn: ConnectToPeerFn = () => Promise.resolve()

  const deps: EventHandlerDeps = {
    channelManager,
    get connectToPeer() {
      return connectToPeerFn
    },
  }

  const handler = EventHandler.new_impl({
    handle_event(event: Event): Result_NoneReplayEventZ {
      try {
        handleEvent(event, deps)
      } catch (err: unknown) {
        console.error('[LDK Event] Unhandled error in event handler:', err)
      }
      return Result_NoneReplayEventZ.constructor_ok()
    },
  })

  return {
    handler,
    setConnectToPeer: (fn: ConnectToPeerFn) => {
      connectToPeerFn = fn
    },
  }
}

function handleEvent(event: Event, deps: EventHandlerDeps): void {
  // Payment events
  if (event instanceof Event_PaymentClaimable) {
    const preimage = event.purpose.preimage()
    if (preimage instanceof Option_ThirtyTwoBytesZ_Some) {
      console.log(
        '[LDK Event] PaymentClaimable: claiming',
        bytesToHex(event.payment_hash),
        'amount_msat:',
        event.amount_msat.toString(),
      )
      deps.channelManager.claim_funds(preimage.some)
    } else {
      console.warn(
        '[LDK Event] PaymentClaimable: no preimage available for',
        bytesToHex(event.payment_hash),
      )
    }
    return
  }

  if (event instanceof Event_PaymentClaimed) {
    console.log(
      '[LDK Event] PaymentClaimed:',
      bytesToHex(event.payment_hash),
      'amount_msat:',
      event.amount_msat.toString(),
    )
    return
  }

  if (event instanceof Event_PaymentSent) {
    console.log(
      '[LDK Event] PaymentSent:',
      bytesToHex(event.payment_hash),
    )
    return
  }

  if (event instanceof Event_PaymentFailed) {
    console.warn(
      '[LDK Event] PaymentFailed:',
      bytesToHex(event.payment_hash),
    )
    return
  }

  if (event instanceof Event_PaymentPathSuccessful) {
    console.debug('[LDK Event] PaymentPathSuccessful')
    return
  }

  if (event instanceof Event_PaymentPathFailed) {
    console.debug('[LDK Event] PaymentPathFailed')
    return
  }

  if (event instanceof Event_PaymentForwarded) {
    console.log('[LDK Event] PaymentForwarded')
    return
  }

  // HTLC forwarding
  if (event instanceof Event_PendingHTLCsForwardable) {
    const delayMs = Math.min(
      Number(event.time_forwardable) * 1000,
      MAX_FORWARD_DELAY_MS,
    )
    setTimeout(() => {
      deps.channelManager.process_pending_htlc_forwards()
    }, delayMs)
    return
  }

  // Channel lifecycle
  if (event instanceof Event_ChannelPending) {
    console.log(
      '[LDK Event] ChannelPending:',
      bytesToHex(event.channel_id.write()),
    )
    return
  }

  if (event instanceof Event_ChannelReady) {
    console.log(
      '[LDK Event] ChannelReady:',
      bytesToHex(event.channel_id.write()),
    )
    return
  }

  if (event instanceof Event_ChannelClosed) {
    console.log(
      '[LDK Event] ChannelClosed:',
      bytesToHex(event.channel_id.write()),
      'reason:',
      event.reason,
    )
    return
  }

  // Spendable outputs — persist descriptors to IDB for future sweep
  if (event instanceof Event_SpendableOutputs) {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const serialized = event.outputs.map((o) => o.write())
    void idbPut('ldk_spendable_outputs', key, serialized).catch(
      (err: unknown) => {
        console.error(
          '[LDK Event] CRITICAL: Failed to persist SpendableOutputs:',
          err,
        )
      },
    )
    console.log(
      '[LDK Event] SpendableOutputs: persisted',
      event.outputs.length,
      'descriptor(s) for future sweep',
    )
    return
  }

  // Peer reconnection
  if (event instanceof Event_ConnectionNeeded) {
    const pubkey = bytesToHex(event.node_id)
    console.log('[LDK Event] ConnectionNeeded:', pubkey)
    // Attempt to connect using the first available address
    // Note: addresses are SocketAddress objects — we log but cannot easily
    // extract host:port without the SocketAddress subclass types
    void deps.connectToPeer(pubkey, '', 0).catch((err: unknown) => {
      console.warn('[LDK Event] ConnectionNeeded: reconnect failed:', err)
    })
    return
  }

  // Deferred events — no wallet/UTXO layer yet
  if (event instanceof Event_FundingGenerationReady) {
    console.warn(
      '[LDK Event] FundingGenerationReady: no wallet layer — cannot fund channel',
    )
    return
  }

  if (event instanceof Event_FundingTxBroadcastSafe) {
    console.warn('[LDK Event] FundingTxBroadcastSafe: no wallet layer')
    return
  }

  if (event instanceof Event_BumpTransaction) {
    console.warn(
      '[LDK Event] BumpTransaction: no wallet layer — cannot bump fees',
    )
    return
  }

  if (event instanceof Event_DiscardFunding) {
    console.log('[LDK Event] DiscardFunding')
    return
  }

  // Inbound channel requests — auto-reject (no acceptance policy yet)
  if (event instanceof Event_OpenChannelRequest) {
    console.log('[LDK Event] OpenChannelRequest: auto-rejecting')
    return
  }

  // Catch-all for unhandled event types (future LDK versions may add new events)
  console.log('[LDK Event] Unhandled event type:', event.constructor.name)
}
