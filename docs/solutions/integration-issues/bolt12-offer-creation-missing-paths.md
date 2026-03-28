---
title: 'BOLT 12 offer creation fails with MissingPaths before gossip sync'
category: integration-issues
date: 2026-03-20
tags: [bolt12, ldk, offer, onion-messenger, gossip, retry]
severity: medium
components: [src/ldk/context.tsx, src/ldk/storage/offer.ts]
---

# BOLT 12 offer creation fails with MissingPaths before gossip sync

## Problem

Calling `channelManager.create_offer_builder()` immediately after peer reconnection fails with `Bolt12SemanticError::MissingPaths` (error code 21):

```
Result_OfferWithDerivedMetadataBuilderBolt12SemanticErrorZ_Err {err: 21}
```

The error occurs because `create_offer_builder` delegates to `DefaultMessageRouter` to construct blinded onion message paths. The router needs the network graph to find a route through connected peers, but the graph is empty or incomplete because Rapid Gossip Sync (RGS) hasn't finished populating it yet.

## Root Cause

The timing sequence is:

1. LDK node initializes
2. Peers reconnect (noise handshake + channel reestablish) ~2-5s
3. `peersReconnected` flag set to true
4. **Offer creation attempted here** -- fails because gossip graph is empty
5. RGS gossip sync completes ~5-30s after init (depends on snapshot size)
6. Network graph now has routing data -- offer creation would succeed

`DefaultMessageRouter::create_blinded_paths` needs at least one path through the graph to the node's connected peers. Without gossip data, it can't construct any blinding path and returns `MissingPaths`.

## Solution

Retry `create_offer_builder` with exponential backoff. The gossip sync runs on a timer and populates the graph within seconds of startup. Key implementation details:

```typescript
const MAX_OFFER_RETRIES = 5
let offerCreationStarted = false
let offerRetryTimer: ReturnType<typeof setTimeout> | null = null

const loadOrCreateOffer = async (attempt = 0) => {
  if (cancelled) return
  if (attempt === 0) {
    if (offerCreationStarted) return
    offerCreationStarted = true
  }

  // Check IDB only on first attempt (nothing else writes to this store)
  const existing = attempt === 0 ? await getPersistedOffer() : undefined
  if (existing) {
    /* set state, return */
  }

  const builderResult = node.channelManager.create_offer_builder(Option_u64Z.constructor_none())
  if (!(builderResult instanceof Result_OK)) {
    if (attempt < MAX_OFFER_RETRIES) {
      const delayMs = 3000 * 2 ** attempt // 3s, 6s, 12s, 24s, 48s
      offerRetryTimer = setTimeout(() => void loadOrCreateOffer(attempt + 1), delayMs)
      return
    }
    // Give up after retries
    return
  }

  // Configure and persist the offer
  builder.chain(SIGNET_CONFIG.network) // REQUIRED for signet
  builder.description('zinqq wallet')
  const offer = builder.build()
  await putPersistedOffer(offer.res.to_str())
}
```

Critical safety details:

- **Check `cancelled` flag** at the top of each retry to prevent setState on unmounted components
- **Track the timer** (`offerRetryTimer`) and clear it in the useEffect cleanup
- **Idempotency guard** (`offerCreationStarted`) prevents concurrent invocations from multiple call sites
- **Skip IDB re-read on retries** -- if there was no persisted offer on attempt 0, there won't be one later

## Bolt12SemanticError Enum Reference

| Code   | Name                       | Meaning                                    |
| ------ | -------------------------- | ------------------------------------------ |
| 0      | AlreadyExpired             | Offer/invoice has expired                  |
| 1      | UnsupportedChain           | Chain not supported                        |
| 10     | MissingDescription         | No description set                         |
| 11     | MissingIssuerSigningPubkey | No signing pubkey                          |
| **21** | **MissingPaths**           | **No blinding paths could be constructed** |
| 27     | MissingSigningPubkey       | No signing pubkey for invoice              |

Full enum at: `node_modules/lightningdevkit/bindings.d.mts` (search `Bolt12SemanticError`).

## Prevention

- Never assume `create_offer_builder` will succeed on first call -- always implement retry logic
- The `.chain()` call is mandatory for non-mainnet networks; without it the offer defaults to mainnet and peers on signet will reject it
- Persist the offer string to IDB after creation -- the nonce may not be deterministic across restarts, so a shared offer could silently break if regenerated
- When adding retry timers inside a React useEffect, always track timer IDs and clear them in cleanup to prevent stale closure bugs

## Related

- `docs/solutions/integration-issues/ldk-wasm-foundation-layer-patterns.md` -- Result type narrowing patterns
- `docs/solutions/design-patterns/bdk-ldk-transaction-history-indexeddb-persistence.md` -- IDB persistence patterns
- `docs/solutions/integration-issues/ldk-trait-defensive-hardening-patterns.md` -- Retry and backoff patterns
