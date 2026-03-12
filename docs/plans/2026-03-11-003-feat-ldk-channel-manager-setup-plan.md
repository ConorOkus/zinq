---
title: 'feat: LDK Channel Manager Setup'
type: feat
status: completed
date: 2026-03-11
origin: docs/brainstorms/2026-03-11-channel-manager-brainstorm.md
---

# feat: LDK Channel Manager Setup

## Overview

Wire up the full LDK ChannelManager stack in the browser wallet: ChainMonitor, ChannelManager (fresh creation + restore from IndexedDB), Esplora-based chain sync polling (~30s), NetworkGraph, ProbabilisticScorer, and all necessary persistence. This builds on the existing foundation layer (WASM init, KeysManager, traits, IndexedDB) and gets the node to the point where it can manage channels on Signet/Mutinynet.

## Problem Statement / Motivation

The foundation layer is complete — WASM loads, KeysManager works, traits are implemented, IndexedDB stores are provisioned. But without a ChannelManager, the node cannot open, close, or monitor channels. The ChannelManager is the core Lightning state machine and requires ChainMonitor, chain sync, and routing components (NetworkGraph, Scorer) to function. These components are tightly coupled and must be built as a unit (see brainstorm: `docs/brainstorms/2026-03-11-channel-manager-brainstorm.md`).

## Proposed Solution

Extend `initializeLdk()` with a multi-phase bootstrap:

1. **Phase 1 — ChainMonitor**: Create using existing traits + a Filter implementation for tx/output registration
2. **Phase 2 — Restore or Create**: Detect IndexedDB state → deserialize ChannelMonitors + ChannelManager, or create fresh
3. **Phase 3 — NetworkGraph + Scorer**: Restore from IndexedDB or create fresh, wire into DefaultRouter
4. **Phase 4 — Chain Sync**: Catch up from last known block to current Esplora tip, then start ~30s polling loop
5. **Phase 5 — Persistence Loop**: Periodic check of `get_and_clear_needs_persistence()`, serialize to IndexedDB

## Technical Approach

### Architecture

```
src/ldk/
  init.ts                    — Extended bootstrap (phases 1-5)
  config.ts                  — Add CHAIN_POLL_INTERVAL_MS, PERSIST_CHECK_INTERVAL_MS
  ldk-context.ts             — Extended LdkNode interface + sync status
  context.tsx                — Sync loop lifecycle management
  use-ldk.ts                 — (unchanged)
  traits/
    logger.ts                — (unchanged)
    fee-estimator.ts         — (unchanged)
    broadcaster.ts           — (unchanged)
    persist.ts               — Add ChainMonitor callback wiring
    filter.ts                — NEW: Filter trait capturing watch registrations
  sync/
    esplora-client.ts        — NEW: Typed Esplora REST API client
    chain-sync.ts            — NEW: Polling loop + Confirm interface orchestration
    types.ts                 — NEW: Esplora API response types
  storage/
    idb.ts                   — (unchanged)
    seed.ts                  — (unchanged)
    channel-manager.ts       — NEW: CM serialization/deserialization helpers
    network-graph.ts         — NEW: NetworkGraph serialization/deserialization
    scorer.ts                — NEW: Scorer serialization/deserialization
    channel-monitors.ts      — NEW: ChannelMonitor restore helpers
```

### Implementation Phases

#### Phase 1: Safety Prerequisites

Before adding channel management, address critical safety items:

**1a. Multi-tab lock** (`src/ldk/init.ts`)

Two browser tabs running independent ChannelManagers against the same IndexedDB is a fund-safety issue — conflicting commitment transactions could be broadcast. Use the Web Locks API:

```typescript
// At the start of initializeLdk():
const lock = await new Promise<Lock>((resolve, reject) => {
  navigator.locks.request('ldk-wallet-lock', { ifAvailable: true }, (lock) => {
    if (!lock) {
      reject(new Error('Wallet is already open in another tab'))
    }
    resolve(lock)
    // Hold the lock by returning a never-resolving promise
    return new Promise(() => {})
  })
})
```

**1b. WASM double-init guard** (`src/ldk/init.ts`)

Deduplicate `initializeWasmWebFetch` calls for React StrictMode:

```typescript
let wasmInitPromise: Promise<void> | null = null

function initWasm(): Promise<void> {
  if (!wasmInitPromise) {
    wasmInitPromise = initializeWasmWebFetch('/liblightningjs.wasm')
  }
  return wasmInitPromise
}
```

**1c. Update Persist trait with ChainMonitor callback** (`src/ldk/traits/persist.ts`)

Solve the circular dependency (Persist is passed to ChainMonitor constructor, but needs ChainMonitor ref for callback) with a late-binding setter:

```typescript
export function createPersister(): { persist: Persist; setChainMonitor: (cm: ChainMonitor) => void } {
  let chainMonitorRef: ChainMonitor | null = null

  const persist = Persist.new_impl({
    persist_new_channel(channelFundingOutpoint, data, updateId) {
      const key = outpointKey(channelFundingOutpoint)
      const bytes = data.write()
      idbPut('ldk_channel_monitors', key, bytes)
        .then(() => {
          if (chainMonitorRef) {
            chainMonitorRef.channel_monitor_updated(channelFundingOutpoint, updateId)
          }
        })
        .catch((err) => console.error('[LDK Persist] Failed to persist new channel:', err))
      return ChannelMonitorUpdateStatus_LDKChannelMonitorUpdateStatus_InProgress
    },
    update_persisted_channel(channelFundingOutpoint, _update, data, updateId) {
      const key = outpointKey(channelFundingOutpoint)
      const bytes = data.write()
      idbPut('ldk_channel_monitors', key, bytes)
        .then(() => {
          if (chainMonitorRef) {
            chainMonitorRef.channel_monitor_updated(channelFundingOutpoint, updateId)
          }
        })
        .catch((err) => console.error('[LDK Persist] Failed to update channel:', err))
      return ChannelMonitorUpdateStatus_LDKChannelMonitorUpdateStatus_InProgress
    },
    archive_persisted_channel(channelFundingOutpoint) {
      const key = outpointKey(channelFundingOutpoint)
      idbDelete('ldk_channel_monitors', key)
        .catch((err) => console.error('[LDK Persist] Failed to archive channel:', err))
    },
  })

  return {
    persist,
    setChainMonitor: (cm: ChainMonitor) => { chainMonitorRef = cm },
  }
}
```

#### Phase 2: Core Components

**2a. Filter trait** (`src/ldk/traits/filter.ts`)

Capture LDK's `register_tx` and `register_output` calls into a watch set for the sync loop:

```typescript
import { Filter, WatchedOutput } from 'lightningdevkit'

export interface WatchState {
  watchedTxids: Map<string, Uint8Array>      // hex txid -> script_pubkey
  watchedOutputs: Map<string, WatchedOutput>  // "txid:vout" -> WatchedOutput
}

export function createFilter(): { filter: Filter; watchState: WatchState } {
  const watchState: WatchState = {
    watchedTxids: new Map(),
    watchedOutputs: new Map(),
  }

  const filter = Filter.new_impl({
    register_tx(txid: Uint8Array, script_pubkey: Uint8Array): void {
      watchState.watchedTxids.set(bytesToHex(txid), script_pubkey)
    },
    register_output(output: WatchedOutput): void {
      const outpoint = output.get_outpoint()
      const key = `${bytesToHex(outpoint.get_txid())}:${outpoint.get_index()}`
      watchState.watchedOutputs.set(key, output)
    },
  })

  return { filter, watchState }
}
```

> **Note:** The brainstorm specified `Option_FilterZ.constructor_none()` (see brainstorm: decision #6), but SpecFlow analysis revealed this creates a gap — without Filter, the sync loop has no way to know which new transactions to watch. We implement Filter to build a watch list while keeping the same Esplora-based sync approach. This is the minimal change needed.

**2b. ChainMonitor creation** (`src/ldk/init.ts`)

```typescript
const { filter, watchState } = createFilter()
const chainMonitor = ChainMonitor.constructor_new(
  Option_FilterZ.constructor_some(filter),
  broadcaster,
  logger,
  feeEstimator,
  persist
)
persister.setChainMonitor(chainMonitor)
```

**2c. NetworkGraph + Scorer + Router** (`src/ldk/init.ts`)

```typescript
// Restore or create NetworkGraph
const ngBytes = await idbGet<Uint8Array>('ldk_network_graph', 'primary')
let networkGraph: NetworkGraph
if (ngBytes) {
  const result = NetworkGraph.constructor_read(ngBytes, logger)
  if (result instanceof Result_NetworkGraphDecodeErrorZ_OK) {
    networkGraph = result.res
  } else {
    console.warn('[LDK Init] Failed to restore NetworkGraph, creating fresh')
    networkGraph = NetworkGraph.constructor_new(Network.LDKNetwork_Signet, logger)
  }
} else {
  networkGraph = NetworkGraph.constructor_new(Network.LDKNetwork_Signet, logger)
}

// Restore or create Scorer
const decayParams = ProbabilisticScoringDecayParameters.constructor_default()
const scorerBytes = await idbGet<Uint8Array>('ldk_scorer', 'primary')
let scorer: ProbabilisticScorer
if (scorerBytes) {
  const result = ProbabilisticScorer.constructor_read(scorerBytes, decayParams, networkGraph, logger)
  if (result instanceof Result_ProbabilisticScorerDecodeErrorZ_OK) {
    scorer = result.res
  } else {
    console.warn('[LDK Init] Failed to restore Scorer, creating fresh')
    scorer = ProbabilisticScorer.constructor_new(decayParams, networkGraph, logger)
  }
} else {
  scorer = ProbabilisticScorer.constructor_new(decayParams, networkGraph, logger)
}

// Wire Router + MessageRouter
const lockableScore = MultiThreadedLockableScore.constructor_new(scorer.as_Score())
const router = DefaultRouter.constructor_new(
  networkGraph, logger, keysManager.as_EntropySource(),
  lockableScore.as_LockableScore(),
  ProbabilisticScoringFeeParameters.constructor_default()
)
const messageRouter = DefaultMessageRouter.constructor_new(
  networkGraph, keysManager.as_EntropySource()
)
```

**2d. ChannelManager — fresh or restore** (`src/ldk/init.ts`)

```typescript
// Restore ChannelMonitors
const monitorEntries = await idbGetAll<Uint8Array>('ldk_channel_monitors')
const channelMonitors: ChannelMonitor[] = []
for (const [_key, data] of monitorEntries) {
  const result = UtilMethods.constructor_C2Tuple_ThirtyTwoBytesChannelMonitorZ_read(
    data, keysManager.as_EntropySource(), keysManager.as_SignerProvider()
  )
  if (result instanceof Result_C2Tuple_ThirtyTwoBytesChannelMonitorZDecodeErrorZ_OK) {
    channelMonitors.push(result.res.get_b())
  } else {
    console.error('[LDK Init] Failed to deserialize a ChannelMonitor')
  }
}

// Restore or create ChannelManager
const cmBytes = await idbGet<Uint8Array>('ldk_channel_manager', 'primary')
let channelManager: ChannelManager

if (cmBytes) {
  // Restore from serialized bytes
  const result = UtilMethods.constructor_C2Tuple_ThirtyTwoBytesChannelManagerZ_read(
    cmBytes,
    keysManager.as_EntropySource(), keysManager.as_NodeSigner(), keysManager.as_SignerProvider(),
    feeEstimator, chainMonitor.as_Watch(), broadcaster,
    router.as_Router(), messageRouter.as_MessageRouter(),
    logger, UserConfig.constructor_default(), channelMonitors
  )
  if (!(result instanceof Result_C2Tuple_ThirtyTwoBytesChannelManagerZDecodeErrorZ_OK)) {
    throw new Error('[LDK Init] Failed to deserialize ChannelManager')
  }
  channelManager = result.res.get_b()

  // Register restored monitors with ChainMonitor
  const watch = chainMonitor.as_Watch()
  for (const monitor of channelMonitors) {
    const fundingTxo = monitor.get_funding_txo().get_a()
    watch.watch_channel(fundingTxo, monitor)
  }
} else {
  // Fresh ChannelManager
  const tipHash = await fetchTipHash(SIGNET_CONFIG.esploraUrl)
  const tipHeight = await fetchTipHeight(SIGNET_CONFIG.esploraUrl)
  const tipHashBytes = hexToBytes(tipHash)
  const bestBlock = BestBlock.constructor_new(tipHashBytes, tipHeight)
  const chainParams = ChainParameters.constructor_new(Network.LDKNetwork_Signet, bestBlock)

  channelManager = ChannelManager.constructor_new(
    feeEstimator, chainMonitor.as_Watch(), broadcaster,
    router.as_Router(), messageRouter.as_MessageRouter(),
    logger,
    keysManager.as_EntropySource(), keysManager.as_NodeSigner(), keysManager.as_SignerProvider(),
    UserConfig.constructor_default(), chainParams,
    Math.floor(Date.now() / 1000)
  )
}
```

**Partial state handling:** If `cmBytes` exists but monitors are missing/corrupt, the ChannelManager deserialization may fail — this throws and surfaces as an error state in the React context. If monitors exist but no ChannelManager, treat as fresh start (monitors without a ChannelManager are not actionable). Log a warning.

#### Phase 3: Esplora Chain Sync

**3a. Esplora client** (`src/ldk/sync/esplora-client.ts`)

Typed wrapper around Esplora REST endpoints:

```typescript
export class EsploraClient {
  constructor(private baseUrl: string) {}

  async getTipHash(): Promise<string> { /* GET /blocks/tip/hash */ }
  async getTipHeight(): Promise<number> { /* GET /blocks/tip/height */ }
  async getBlockHeader(hash: string): Promise<Uint8Array> { /* GET /block/{hash}/header -> decode hex to 80 bytes */ }
  async getBlockStatus(hash: string): Promise<{ in_best_chain: boolean; height: number }> { /* GET /block/{hash}/status */ }
  async getBlockHashAtHeight(height: number): Promise<string> { /* GET /block-height/{height} */ }
  async getTxStatus(txid: string): Promise<{ confirmed: boolean; block_height?: number; block_hash?: string }> { /* GET /tx/{txid}/status */ }
  async getTxHex(txid: string): Promise<Uint8Array> { /* GET /tx/{txid}/hex -> decode hex */ }
  async getTxMerkleProof(txid: string): Promise<{ block_height: number; pos: number }> { /* GET /tx/{txid}/merkle-proof */ }
  async getOutspend(txid: string, vout: number): Promise<{ spent: boolean; txid?: string; vin?: number }> { /* GET /tx/{txid}/outspend/{vout} */ }
}
```

**3b. Chain sync loop** (`src/ldk/sync/chain-sync.ts`)

```typescript
export async function syncOnce(
  confirmables: Confirm[],
  watchState: WatchState,
  esplora: EsploraClient,
  lastSyncTipHash: string | null
): Promise<string> {
  const tipHash = await esplora.getTipHash()
  if (tipHash === lastSyncTipHash) return tipHash

  // 1. Reorg detection: check get_relevant_txids() against chain
  for (const confirmable of confirmables) {
    const relevantTxids = confirmable.get_relevant_txids()
    for (const tuple of relevantTxids) {
      const txid = tuple.get_a()
      const blockHash = tuple.get_c()  // Option<Uint8Array>
      if (blockHash) {
        const status = await esplora.getBlockStatus(bytesToHex(blockHash))
        if (!status.in_best_chain) {
          confirmable.transaction_unconfirmed(txid)
        }
      }
    }
  }

  // 2. Update best block
  const tipHeight = await esplora.getTipHeight()
  const tipHeader = await esplora.getBlockHeader(tipHash)
  for (const confirmable of confirmables) {
    confirmable.best_block_updated(tipHeader, tipHeight)
  }

  // 3. Check watched txids/outputs for new confirmations
  for (const [txidHex] of watchState.watchedTxids) {
    const status = await esplora.getTxStatus(txidHex)
    if (status.confirmed && status.block_hash && status.block_height) {
      const header = await esplora.getBlockHeader(status.block_hash)
      const rawTx = await esplora.getTxHex(txidHex)
      const proof = await esplora.getTxMerkleProof(txidHex)
      const txdata = [TwoTuple_usizeTransactionZ.constructor_new(proof.pos, rawTx)]
      for (const confirmable of confirmables) {
        confirmable.transactions_confirmed(header, txdata, status.block_height)
      }
    }
  }

  for (const [key, output] of watchState.watchedOutputs) {
    const [txid, voutStr] = key.split(':')
    const spend = await esplora.getOutspend(txid, parseInt(voutStr))
    if (spend.spent && spend.txid) {
      // Fetch and confirm the spending transaction
      const status = await esplora.getTxStatus(spend.txid)
      if (status.confirmed && status.block_hash && status.block_height) {
        const header = await esplora.getBlockHeader(status.block_hash)
        const rawTx = await esplora.getTxHex(spend.txid)
        const proof = await esplora.getTxMerkleProof(spend.txid)
        const txdata = [TwoTuple_usizeTransactionZ.constructor_new(proof.pos, rawTx)]
        for (const confirmable of confirmables) {
          confirmable.transactions_confirmed(header, txdata, status.block_height)
        }
      }
    }
  }

  // 4. Verify tip didn't change mid-sync
  const postSyncTip = await esplora.getTipHash()
  if (postSyncTip !== tipHash) {
    // Tip changed during sync — retry on next interval
    console.warn('[LDK Sync] Tip changed during sync, will retry')
  }

  return tipHash
}
```

**3c. Polling loop lifecycle** (`src/ldk/sync/chain-sync.ts`)

```typescript
export function startSyncLoop(
  confirmables: Confirm[],
  watchState: WatchState,
  esplora: EsploraClient,
  channelManager: ChannelManager,
  chainMonitor: ChainMonitor,
  networkGraph: NetworkGraph,
  scorer: ProbabilisticScorer,
  intervalMs: number
): { stop: () => void } {
  let lastTipHash: string | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  async function tick() {
    if (stopped) return
    try {
      lastTipHash = await syncOnce(confirmables, watchState, esplora, lastTipHash)

      // Timer tick for ChannelManager housekeeping
      channelManager.timer_tick_occurred()

      // Rebroadcast pending claims
      chainMonitor.rebroadcast_pending_claims()

      // Persist ChannelManager if needed
      if (channelManager.get_and_clear_needs_persistence()) {
        await idbPut('ldk_channel_manager', 'primary', channelManager.write())
      }

      // Periodically persist NetworkGraph + Scorer (every 10th tick ≈ 5 min)
      // (tracked via a counter in the closure)
    } catch (err) {
      console.error('[LDK Sync] Sync error:', err)
    }

    if (!stopped) {
      timeoutId = setTimeout(tick, intervalMs)
    }
  }

  // Start first tick immediately
  tick()

  return {
    stop: () => {
      stopped = true
      if (timeoutId !== null) clearTimeout(timeoutId)
    },
  }
}
```

Uses recursive `setTimeout` (not `setInterval`) to prevent overlapping executions if a tick takes longer than the interval.

#### Phase 4: React Integration

**4a. Extend `LdkNode` interface** (`src/ldk/ldk-context.ts`)

```typescript
export interface LdkNode {
  nodeId: string
  keysManager: KeysManager
  logger: Logger
  feeEstimator: FeeEstimator
  broadcaster: BroadcasterInterface
  persister: Persist
  // New fields:
  chainMonitor: ChainMonitor
  channelManager: ChannelManager
  networkGraph: NetworkGraph
  scorer: ProbabilisticScorer
}
```

**4b. Extended context state** (`src/ldk/ldk-context.ts`)

Add `syncStatus` to the `ready` state variant:

```typescript
type LdkContextValue =
  | { status: 'loading'; node: null; nodeId: null; error: null }
  | { status: 'ready'; node: LdkNode; nodeId: string; error: null; syncStatus: 'syncing' | 'synced' | 'stale' }
  | { status: 'error'; node: null; nodeId: null; error: Error }
```

**4c. Sync loop cleanup** (`src/ldk/context.tsx`)

```typescript
useEffect(() => {
  let cancelled = false
  let syncHandle: { stop: () => void } | null = null

  initializeLdk().then((node) => {
    if (cancelled) return
    // Start sync loop
    const esplora = new EsploraClient(SIGNET_CONFIG.esploraUrl)
    const confirmables = [
      node.channelManager.as_Confirm(),
      node.chainMonitor.as_Confirm(),
    ]
    syncHandle = startSyncLoop(
      confirmables, watchState, esplora,
      node.channelManager, node.chainMonitor,
      node.networkGraph, node.scorer,
      SIGNET_CONFIG.chainPollIntervalMs
    )
    setState({ status: 'ready', node, nodeId: node.nodeId, error: null, syncStatus: 'syncing' })
  }).catch((error: unknown) => {
    if (cancelled) return
    setState({
      status: 'error', node: null, nodeId: null,
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    cancelled = true
    syncHandle?.stop()
  }
}, [])
```

#### Phase 5: Config Updates

Add to `src/ldk/config.ts`:

```typescript
export const SIGNET_CONFIG = {
  network: Network.LDKNetwork_Signet,
  esploraUrl: 'https://mutinynet.com/api',
  genesisBlockHash: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  chainPollIntervalMs: 30_000,
  persistCheckIntervalMs: 10_000,
  networkGraphPersistIntervalTicks: 10,  // ~5 min at 30s polling
} as const
```

### Alternative Approaches Considered

1. **No Filter trait** (brainstorm default) — Rejected after SpecFlow analysis showed that without Filter, the sync loop cannot discover new transactions to watch. `get_relevant_txids()` only covers reorg monitoring, not initial discovery.

2. **`setInterval` for polling** — Rejected in favor of recursive `setTimeout` to prevent overlapping sync iterations if a tick takes longer than 30s (e.g., during catch-up sync).

3. **Web Worker for sync** — Deferred per brainstorm decision. Simple main-thread polling is sufficient for now (see brainstorm: decision #2).

## System-Wide Impact

### Interaction Graph

`LdkProvider` mounts → `initializeLdk()` → acquires Web Lock → WASM init → KeysManager → traits → ChainMonitor → ChannelManager → sync loop starts → `syncOnce()` calls Esplora → feeds `Confirm` on both ChannelManager and ChainMonitor → Persist fires on monitor updates → IndexedDB write → `channel_monitor_updated` callback → ChainMonitor acknowledges

### Error Propagation

- Esplora fetch failures in sync loop: caught, logged, retried next tick (no state change)
- IndexedDB write failures in Persist: caught, logged, `channel_monitor_updated` NOT called (LDK pauses channel operations — safe but disruptive)
- ChannelManager deserialization failure: throws → context transitions to `error` state
- Web Lock acquisition failure: throws → context transitions to `error` with "wallet open in another tab" message
- WASM init failure: thrown, caught by existing error handling in context

### State Lifecycle Risks

- **Partial persistence on tab close**: ChannelManager serialized but monitor write in-flight. On restart, ChannelManager may reference a monitor state newer than what's persisted. LDK handles this — the `InProgress` monitors are replayed from the last known good state.
- **IndexedDB clear by user**: All state lost. The wallet starts fresh with the same seed but no channels. This is existing behavior, documented in the foundation plan.

### API Surface Parity

The `LdkNode` interface gains 4 new fields. All consumers (currently just `Home.tsx` displaying `nodeId`) continue working unchanged. New fields are available for future channel management UI.

## Acceptance Criteria

### Functional Requirements

- [x] ChainMonitor created with Filter trait capturing tx/output registrations
- [x] ChannelManager created fresh when no IndexedDB state exists
- [x] ChannelManager restored from IndexedDB when serialized bytes exist
- [x] ChannelMonitors deserialized and registered with ChainMonitor on restart
- [x] NetworkGraph created fresh or restored from IndexedDB
- [x] ProbabilisticScorer created fresh or restored from IndexedDB
- [x] DefaultRouter and DefaultMessageRouter wired with NetworkGraph + Scorer
- [x] Esplora chain sync polls every ~30s using Confirm interface
- [x] Reorg detection via `get_relevant_txids()` + Esplora block status check
- [x] `transactions_confirmed` and `best_block_updated` called on both ChannelManager and ChainMonitor
- [x] `transaction_unconfirmed` called when reorgs detected
- [x] ChannelManager serialized to IndexedDB when `get_and_clear_needs_persistence()` returns true
- [x] NetworkGraph and Scorer persisted periodically (~5 min)
- [x] Persist trait calls `chainMonitor.channel_monitor_updated()` after successful IndexedDB write
- [x] `LdkNode` interface extended with `chainMonitor`, `channelManager`, `networkGraph`, `scorer`
- [x] React context exposes `syncStatus` field on ready state
- [x] Sync loop starts after initialization and stops on provider unmount

### Non-Functional Requirements

- [x] Web Locks API prevents multiple tabs from running simultaneously
- [x] WASM double-init guarded with module-level promise deduplication
- [x] Recursive `setTimeout` prevents overlapping sync iterations
- [x] Esplora API errors do not crash the sync loop (caught, logged, retried next tick)
- [x] Failed ChannelManager deserialization surfaces as error state in React context
- [x] TypeScript strict mode passes with no `any` escape hatches
- [x] No new `bytesToHex` duplications — extract to shared utility

### Quality Gates

- [x] Unit tests for EsploraClient (mocked fetch)
- [x] Unit tests for chain-sync `syncOnce` logic (mocked Esplora + Confirm)
- [x] Unit tests for Filter trait watch state accumulation
- [ ] Unit tests for ChannelMonitor/ChannelManager serialization round-trip helpers
- [ ] Integration test for fresh-start init sequence (fake-indexeddb)
- [ ] Integration test for restore init sequence (pre-populated IndexedDB)
- [x] Existing tests continue passing

## Dependencies & Prerequisites

| Dependency | Status | Impact |
|---|---|---|
| Foundation layer (WASM, KeysManager, traits, IndexedDB) | Complete | Required base |
| `lightningdevkit@0.1.8-0` API stability | Pre-release | Pin version, wrap APIs |
| Mutinynet Esplora API availability | External | Sync fails gracefully, retries |
| Web Locks API browser support | Chrome 69+, Firefox 96+, Safari 15.4+ | Fallback: `console.warn` if unavailable |
| Todo #011 (WASM reinit guard) | Pending P2 | Resolved by this plan (Phase 1b) |
| Todo #010 (archive comment fix) | Pending P2 | Addressed by Persist refactor (Phase 1c) |

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| LDK WASM API differs from Rust docs | Build failures, wrong behavior | Verify against actual `.d.mts` type definitions in `node_modules/lightningdevkit/structs/` |
| Esplora rate limiting during catch-up | Sync stalls after long offline | Add request throttling with configurable delay between API calls |
| IndexedDB quota exceeded | Persist writes fail silently | Monitor quota usage, warn user when approaching limits |
| `channel_monitor_updated` callback timing | Channel operations paused | Test the late-binding pattern in isolation before full integration |
| Mutinynet block times (~30s) vs polling interval (~30s) | May miss blocks between polls | Acceptable — `best_block_updated` handles skipped intermediary blocks |
| Large catch-up sync blocking UI | Poor UX on return after long offline | Sync runs async, UI shows `syncStatus: 'syncing'` state |

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-11-channel-manager-brainstorm.md](docs/brainstorms/2026-03-11-channel-manager-brainstorm.md) — Key decisions carried forward: full ChannelManager setup as a unit, simple ~30s interval polling, NetworkGraph + Scorer included in scope.

### Internal References

- Foundation plan: `docs/plans/2026-03-11-002-feat-ldk-foundation-integration-plan.md`
- LDK patterns doc: `docs/solutions/integration-issues/ldk-wasm-foundation-layer-patterns.md`
- Current init: `src/ldk/init.ts:33-67`
- Persist trait: `src/ldk/traits/persist.ts`
- IndexedDB storage: `src/ldk/storage/idb.ts`
- React context: `src/ldk/context.tsx`
- Config: `src/ldk/config.ts`

### External References

- LDK `Confirm` trait: documented in `lightningdevkit/structs/Confirm.d.mts`
- LDK `ChainMonitor`: `lightningdevkit/structs/ChainMonitor.d.mts`
- LDK `ChannelManager`: `lightningdevkit/structs/ChannelManager.d.mts`
- Esplora API: Blockstream/esplora REST specification
- Web Locks API: MDN `navigator.locks`

### Related Work

- Todo #001: Persist returns InProgress (resolved, foundational for this work)
- Todo #010: archive_persisted_channel comment fix (addressed here)
- Todo #011: WASM reinit guard (resolved by Phase 1b)
- Todo #005: Deduplicate bytesToHex (should be resolved as part of this work)
