# Brainstorm: Remove Signet/Mutinynet Infrastructure — Mainnet Only

**Date:** 2026-04-15

## What We're Building

Strip all signet/mutinynet/testnet code paths, configuration, and infrastructure from the codebase. zinqq becomes a mainnet-only wallet. No network toggle, no conditional branches, no signet defaults.

### Scope

- Delete the `NetworkId` type and all network-conditional logic
- Remove signet config blocks from `src/ldk/config.ts` and `src/onchain/config.ts`
- Hardcode mainnet values everywhere (esplora URLs, genesis hash, fee rates, invoice prefixes, address prefixes, derivation paths)
- Delete `NetworkBadge` component (only displayed on non-mainnet)
- Update all tests to use mainnet values (bc1q addresses, lnbc invoices)
- Update `.env.example` to default to mainnet
- Clean up CSP in `index.html` (remove mutinynet.com URLs)
- Remove testnet origins from Cloudflare Worker proxy config
- Keep IndexedDB name as `zinqq-ldk-mainnet` for continuity

### Out of Scope

- LSP selection (still configured via env vars — just needs mainnet LSP values)
- Vercel deployment changes (handled separately)
- Closing/migrating existing signet channels (orphaned, no real funds)

## Why This Approach

1. **Simplicity** — Every network conditional is dead code on mainnet. Removing it eliminates ~half the config surface and makes every file that touches network config shorter and easier to reason about.
2. **No signet users to protect** — This is a development wallet. No real users have signet state worth preserving.
3. **Full removal over thin abstraction** — If a second network is ever needed again, re-adding it is a straightforward config change. Keeping the abstraction now is premature complexity for a scenario that may never happen.
4. **Development velocity** — Developing and testing against mainnet means bugs surface in the real environment, not behind a testnet that behaves differently (different fee market, different LSP availability, different peer connectivity).

## Key Decisions

1. **Full removal** — Delete `NetworkId` type, all signet config blocks, all conditional branches. Hardcode mainnet everywhere. No thin abstraction kept around.
2. **Tests use mainnet values** — All test fixtures switch to mainnet prefixes (bc1q, lnbc, xprv, coin type 0). Tests don't touch the network, so this is safe.
3. **IDB name stays `zinqq-ldk-mainnet`** — Preserves continuity for any existing mainnet wallet state. Signet databases are silently orphaned.
4. **VITE_NETWORK env var removed** — No longer needed. The app is always mainnet.
5. **NetworkBadge component deleted** — It only renders on non-mainnet. With mainnet-only, it's dead code.

## What Already Exists

- **Clean architecture** — All network logic flows through `ACTIVE_NETWORK` exported from `src/ldk/config.ts`. No scattered network detection.
- **Mainnet Esplora proxy** — `api/esplora-proxy.ts` already proxies to Blockstream Enterprise for mainnet. Stays as-is.
- **Mainnet config blocks** — Already defined in both `src/ldk/config.ts` and `src/onchain/config.ts`. These become the only config.

## Affected Files

**Source files (12):**

- `src/ldk/config.ts` — Remove signet config, NetworkId type, VITE_NETWORK parsing
- `src/onchain/config.ts` — Remove signet config, simplify to single object
- `src/pages/TransactionDetail.tsx` — Hardcode mempool.space explorer URL
- `src/shared/fee-cache.ts` — Remove SIGNET_DEFAULTS, keep mainnet defaults only
- `src/ldk/sweep.ts` — Hardcode MIN_FEE_RATE to 2
- `src/onchain/context.tsx` — Hardcode MIN_FEE_RATE to 2n
- `src/wallet/context.tsx` — Hardcode 'bitcoin' network string
- `src/ldk/payment-input.ts` — Remove signet currency/regex, simplify chain check
- `src/ldk/lsps2/bolt11-encoder.ts` — Hardcode 'lnbc' prefix
- `src/components/NetworkBadge.tsx` — Delete entirely
- `src/storage/idb.ts` — Hardcode DB name `zinqq-ldk-mainnet`
- `src/wallet/keys.ts` — Remove testnet derivation paths, hardcode coin type 0

**Test files (12):**

- `src/ldk/config.test.ts`
- `src/ldk/init-recovery.test.ts`
- `src/ldk/payment-input.test.ts`
- `src/ldk/lsps2/bolt11-encoder.test.ts`
- `src/ldk/sync/esplora-client.test.ts`
- `src/onchain/bip321.test.ts`
- `src/wallet/keys.test.ts`
- `src/pages/Send.test.tsx`
- `src/pages/Receive.test.tsx`
- `src/pages/Home.test.tsx`
- `src/hooks/use-unified-balance.test.ts`
- `src/ldk/resolve-bip353.test.ts`

**Config/deployment (5):**

- `.env` / `.env.example` — Remove VITE_NETWORK, default URLs to mainnet
- `vite.config.ts` — Simplify (no isMainnetProd conditional needed)
- `index.html` — Remove mutinynet URLs from CSP connect-src
- `proxy/wrangler.toml` — Remove testnet.zinqq.app origin

## Resolved Questions

1. **Testing strategy** — Tests use mainnet values (bc1q, lnbc). No mocking abstraction needed.
2. **IDB migration** — Keep `zinqq-ldk-mainnet` name. Existing mainnet data preserved.
3. **Cleanup depth** — Full removal. No thin abstraction retained.

## Open Questions

None — all questions resolved.
