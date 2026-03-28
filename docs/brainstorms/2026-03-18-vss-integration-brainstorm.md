# VSS Integration Brainstorm

**Date:** 2026-03-18
**Status:** Draft

## What We're Building

A TypeScript VSS (Versioned Storage Service) client that enables full channel state recovery for the zinqq browser wallet. The client communicates directly with a hosted VSS server over HTTP, using client-side encryption to protect state data. Combined with the existing IndexedDB storage, this creates a dual-write architecture where every critical state change is persisted both locally (fast reads) and remotely (durable recovery).

### The Problem

Today, if a user clears their browser data or loses their device, all Lightning channel state is permanently lost. The BIP39 mnemonic backup only recovers on-chain funds. There is no mechanism to recover open channels, in-flight payments, or channel balances.

### The Solution

Integrate VSS as a remote persistence layer alongside IndexedDB. Critical LDK state (ChannelMonitors, ChannelManager) is written to both stores before Lightning state advances. On recovery, state is restored from VSS instead of (or in addition to) local IndexedDB.

## Why This Approach

### TypeScript Client (not WASM bindings)

The official `vss-client` crate is Rust-only with no WASM support. Compiling it to WASM is impractical because it uses `reqwest` + `tokio` for HTTP, which don't target `wasm32` without significant patching.

The VSS server API is simple — 4 HTTP endpoints with protobuf serialization:

- `POST /getObject` — fetch a value by key
- `POST /putObjects` — write one or more items transactionally
- `POST /deleteObject` — delete a key-value pair
- `POST /listKeyVersions` — list keys with pagination

A TypeScript client for this is ~200-300 lines and fits naturally into zinqq's existing toolchain.

### Dual-Write (IDB + VSS)

- **Reads stay local** — LDK reads from IndexedDB with zero network latency
- **Writes go to both** — State advances only after both IDB and VSS confirm
- **Recovery from VSS** — On fresh device/browser, restore from VSS server
- **Incremental adoption** — Can roll out store-by-store

### Block on VSS Failure

When VSS is unreachable, Lightning operations block rather than proceeding with IDB-only. This ensures the recovery guarantee is absolute — there is never a window where local state is ahead of the server. This aligns with the VSS design philosophy: "VSS-powered wallets must be designed to hold off advancing the lightning state until everything's securely updated on the server."

## Key Decisions

1. **TypeScript client over WASM bindings** — The VSS HTTP API is simple enough that a native TS client is more practical than wrestling with Rust-to-WASM compilation of the vss-client crate.

2. **Dual-write architecture (IDB + VSS)** — IndexedDB remains the local read store for performance. VSS provides durable remote backup. Both must confirm writes before LDK state advances.

3. **Block on VSS failure** — Lightning operations pause if VSS is unreachable. No timeout or fallback. Recovery guarantee is absolute.

4. **Hosted VSS provider** — Use an existing third-party VSS provider rather than self-hosting. Server URL is configurable.

5. **Pluggable auth layer** — Auth mechanism (LNURL-auth, JWT, API key) is abstracted behind a header provider interface. Start with simple API key for development, upgrade to LNURL-auth later.

6. **Phased rollout of state stores:**
   - **Phase 1 (MVP):** ChannelMonitors + ChannelManager — the fund-critical state
   - **Phase 2:** NetworkGraph + Scorer + known peers — faster recovery experience
   - **Phase 3:** Payment history, BDK changeset, remaining metadata — full wallet state

7. **Client-side encryption** — All data encrypted before leaving the browser using ChaCha20-Poly1305 (via `@noble/ciphers` or similar). VSS server never sees plaintext state. Key obfuscation applied to storage keys.

## Architecture Sketch

```
Browser (zinqq)
├── LDK WASM Node
│   ├── Persist trait impl
│   │   ├── Write to IndexedDB (local, fast)
│   │   └── Write to VSS (remote, durable)
│   │   └── Both must succeed before returning
│   └── Reads from IndexedDB only
│
├── VSS TypeScript Client
│   ├── HTTP calls to VSS server
│   ├── Client-side encryption (ChaCha20-Poly1305)
│   ├── Key obfuscation
│   ├── Protobuf serialization
│   ├── Retry with exponential backoff
│   └── Pluggable auth (header provider)
│
└── Recovery Flow
    ├── User enters mnemonic on new device
    ├── Derive LDK seed + encryption key from mnemonic
    ├── Fetch all state from VSS
    ├── Decrypt and populate IndexedDB
    └── Initialize LDK from restored state
```

## Resolved Questions

1. **Protobuf vs JSON** — The VSS server is **protobuf-only**. It uses `prost::Message::decode()` for request parsing and `encode_to_vec()` for responses. The TS client will need `protobufjs` or a similar library, compiled from the `vss.proto` definition in the vss-server repo.

2. **Encryption key derivation** — Derive the encryption key from the mnemonic via a dedicated BIP32 derivation path (e.g. `m/535'/1'`). This is fully deterministic and recoverable from the mnemonic alone. Use ChaCha20-Poly1305 to match the vss-client's encryption scheme.

3. **VSS provider availability** — A hosted VSS provider is available for testing. Server URL will be configurable.

4. **Recovery UX** — Keep auto-create for onboarding. Add a "Restore from backup" option in Settings that wipes local state and re-imports from VSS. This avoids complicating the first-launch flow.

5. **Versioning strategy** — Use key-level versioning (not disabled). Even for single-device, versioning adds safety (catches bugs, detects stale writes) and prepares for potential multi-device support later.

6. **Store ID design** — Derive the `store_id` from the LDK node's public key (or a hash of it). This is unique per wallet, deterministic from the mnemonic, and supports multiple wallets on the same VSS provider.
