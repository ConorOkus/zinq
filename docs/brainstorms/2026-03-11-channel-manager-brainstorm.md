# Brainstorm: LDK Channel Manager Setup

**Date:** 2026-03-11
**Status:** Draft

## What We're Building

A full LDK ChannelManager integration for the browser wallet, including:

- **ChainMonitor** — Watches on-chain state for channel activity using existing trait implementations (logger, fee estimator, broadcaster, persister)
- **ChannelManager** — Core Lightning channel state machine, wired to KeysManager, ChainMonitor, and network config (Signet/Mutinynet)
- **Esplora chain sync** — Simple interval polling (~30s) to feed new blocks and relevant transactions to ChainMonitor and ChannelManager
- **ChannelManager persistence** — Serialize/deserialize to the existing `ldk_channel_manager` IndexedDB store
- **NetworkGraph** — Routing graph for pathfinding, persisted to `ldk_network_graph` store
- **Scorer** — Probabilistic scorer for payment routing, persisted to `ldk_scorer` store

## Why This Approach

- **Full ChannelManager setup** was chosen over incremental because the components are tightly coupled — ChainMonitor needs the ChannelManager, chain sync feeds both, and persistence ties them together. Building them as a unit avoids partial states.
- **Simple interval polling** over Web Workers or on-demand sync because it's straightforward, reliable for time-sensitive channel events (force-close deadlines), and appropriate complexity for a browser wallet. Can move to Web Workers later if needed.
- **Including NetworkGraph + Scorer** because the IndexedDB stores already exist, the components are cheap to initialize, and they're required for the next logical step (sending payments). Adding them now avoids a separate wiring pass.

## Key Decisions

1. **Chain sync polling interval: ~30 seconds** — Balances freshness with Esplora rate limits. Configurable via `config.ts`.
2. **Simple interval polling on main thread** — No Web Worker complexity for now. Can be extracted later if UX suffers.
3. **NetworkGraph + Scorer included in scope** — Initialized and persisted alongside ChannelManager.
4. **Existing patterns maintained** — Factory functions (`create*()`), discriminated unions for state, fire-and-forget async for sync LDK callbacks, `[LDK <Component>]` log prefixes.
5. **ChannelManager added to `LdkNode` interface** — Exposed through existing React context and `useLdk()` hook.
6. **Filter trait: `Option_FilterZ.constructor_none()` for now** — As noted in the existing plan. Can add transaction filtering later for efficiency.

## Scope

### In scope
- ChainMonitor creation
- ChannelManager creation and serialization/deserialization
- Esplora-based chain sync (block polling + transaction confirmation)
- NetworkGraph initialization and persistence
- ProbabilisticScorer initialization and persistence
- Extending `LdkNode` interface and React context
- ChannelMonitor restoration on startup

### Out of scope
- PeerManager / WebSocket networking (next phase)
- Channel open/close UI
- Payment sending/receiving
- Web Worker extraction
- Transaction filtering optimization (Filter trait)

## Open Questions

_None — all key decisions resolved during brainstorm._
