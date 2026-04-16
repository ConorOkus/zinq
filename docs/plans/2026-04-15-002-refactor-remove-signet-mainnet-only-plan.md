---
title: 'refactor: Remove signet/testnet infrastructure — mainnet only'
type: refactor
status: completed
date: 2026-04-15
origin: docs/brainstorms/2026-04-15-remove-signet-mainnet-only-brainstorm.md
---

# refactor: Remove signet/testnet infrastructure — mainnet only

## Overview

Strip all signet/mutinynet/testnet code paths, configuration, and infrastructure from the codebase. zinqq becomes a mainnet-only wallet — no `NetworkId` type, no `VITE_NETWORK` env var, no conditional branches.

The architecture is clean: everything flows through `ACTIVE_NETWORK` exported from `src/ldk/config.ts`. This makes the change tractable — update the hub, then update each consumer.

## Problem Statement / Motivation

Every network conditional is dead code on mainnet. The dual-network abstraction:

- Adds cognitive overhead to every file that imports `ACTIVE_NETWORK`
- Means local development defaults to signet (a network with different fee markets, LSP availability, and peer connectivity than production)
- Doubles the config surface for no benefit — there are no signet users to protect

Developing exclusively on mainnet surfaces real-world bugs earlier and eliminates the class of "works on signet, fails on mainnet" issues (see: `docs/brainstorms/2026-04-02-bolt11-signing-preimage-fix-brainstorm.md` where routing failures only manifested on mainnet).

(See brainstorm: `docs/brainstorms/2026-04-15-remove-signet-mainnet-only-brainstorm.md`)

## Proposed Solution

Remove the `NetworkId` union type, the `NETWORK_CONFIGS` record, and the `VITE_NETWORK` env var. Hardcode mainnet values in every file that currently branches on `ACTIVE_NETWORK`. Delete the `NetworkBadge` component. Update all tests to use mainnet prefixes.

All changes land atomically in a single commit — the `NetworkId` type is imported across 5+ source files, so removing it from `config.ts` before removing it from consumers causes TypeScript errors.

## Technical Considerations

### Institutional learnings (from `docs/solutions/`)

1. **VITE\_ vars are baked into the JS bundle at build time** (`docs/solutions/infrastructure/vercel-mainnet-env-vars-fix.md`). After removing `VITE_NETWORK` from code, leftover `VITE_NETWORK=mainnet` in Vercel env vars is harmless at runtime — but `vite.config.ts` line 54 reads `env.VITE_NETWORK === 'mainnet'` to gate production optimizations. If not updated, `isMainnetProd` silently becomes `false` and production builds stop stripping `console.debug` and `debugger` statements. **Fix: change to `mode === 'production'`.**

2. **IDB naming must be preserved** (`docs/solutions/design-patterns/bdk-ldk-transaction-history-indexeddb-persistence.md`). Keep `zinqq-ldk-mainnet` as the hardcoded DB name to preserve existing mainnet wallet state.

3. **After removing conditional init paths, verify all caches are still seeded** (`docs/solutions/logic-errors/vss-version-cache-startup-seeding-fix.md`). The network removal doesn't change init branching, but verify that no conditional path depended on `ACTIVE_NETWORK`.

### BOLT 11 detection regex — keep broad

`payment-input.ts` line 78 uses `/^ln(bc|tb|tbs|bcrt)/i` to classify BOLT 11 invoices. Keep this broad: if a user pastes a signet invoice, they get "Invoice is for a different Bitcoin network" (helpful) rather than "Unrecognized payment format" (confusing). The subsequent currency check (`Currency.LDKCurrency_Bitcoin`) handles rejection.

### `deriveBdkDescriptors` — remove network parameter

`src/wallet/keys.ts` exports `deriveBdkDescriptors(mnemonic, network: 'signet' | 'bitcoin')`. The only caller will always pass `'bitcoin'`. Remove the `network` parameter entirely, delete `TESTNET_VERSIONS`, hardcode `coinType = 0`. Full removal, consistent with the brainstorm's "no thin abstraction" decision.

### PWA service worker cache

Existing signet users who auto-update will get the mainnet-only build. Their `zinqq-ldk-signet` IDB is silently orphaned — they see a fresh wallet. Acceptable: no real signet users to protect.

## Acceptance Criteria

- [x] `NetworkId` type deleted from `src/ldk/config.ts`
- [x] `VITE_NETWORK` env var no longer read anywhere in the codebase
- [x] All source files hardcode mainnet values (no `ACTIVE_NETWORK` conditionals)
- [x] `NetworkBadge` component deleted, import removed from `Layout.tsx`
- [x] All tests pass using mainnet prefixes (bc1q, lnbc, xprv, coin type 0)
- [x] `pnpm build` succeeds without `VITE_NETWORK` set
- [x] `pnpm test` passes
- [x] Production builds strip `console.debug` and `debugger` (vite.config.ts fixed)
- [x] CSP in `index.html` has no mutinynet URLs
- [x] `.env` and `.env.example` updated to mainnet defaults
- [x] `grep -r "signet\|mutinynet\|testnet\|VITE_NETWORK" src/` returns zero matches (excluding comments explaining the removal)

## Implementation Phases

All changes land in a **single atomic commit** to avoid intermediate TypeScript errors.

### Phase 1: Config Hub (`src/ldk/config.ts`)

**This is the keystone change — everything else follows from it.**

`src/ldk/config.ts`:

- Delete `NetworkId` type (line 3)
- Delete `NETWORK_CONFIGS` record (lines 27-57) — replace with a single flat config object using mainnet values
- Delete `VITE_NETWORK` parsing and validation (lines 59-64)
- Delete `ACTIVE_NETWORK` export (line 108) — consumers that only used it for branching no longer need it
- Keep `LdkConfig` interface and export the single mainnet config object

`src/onchain/config.ts`:

- Delete `BdkNetwork` type (line 3)
- Delete `ONCHAIN_CONFIGS` record (lines 15-34) — replace with single mainnet config
- Remove `NetworkId` import
- Remove `ACTIVE_NETWORK` import

### Phase 2: Source File Consumers (10 files)

Each file removes its `ACTIVE_NETWORK` import and hardcodes the mainnet value:

| File                                            | Change                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/TransactionDetail.tsx:9`             | Hardcode `https://mempool.space/tx`                                                                                                                         |
| `src/shared/fee-cache.ts:6-10,77`               | Delete `SIGNET_DEFAULTS`, inline mainnet defaults `{1:25, 6:10, 12:5, 144:2}`                                                                               |
| `src/ldk/sweep.ts:16`                           | Hardcode `const MIN_FEE_RATE_SAT_VB = 2`                                                                                                                    |
| `src/onchain/context.tsx:32`                    | Hardcode `const MIN_FEE_RATE_SAT_VB = 2n`                                                                                                                   |
| `src/wallet/context.tsx:25`                     | Hardcode `'bitcoin'` in `deriveBdkDescriptors` call                                                                                                         |
| `src/ldk/payment-input.ts:15-23,95,110,160,245` | Delete `NETWORK_CURRENCY` and `ON_CHAIN_RE` maps; hardcode `Currency.LDKCurrency_Bitcoin` and mainnet address regex `/(bc1)/`; simplify BOLT 12 chain check |
| `src/ldk/lsps2/bolt11-encoder.ts:18-21`         | Delete `NETWORK_PREFIX` map; hardcode `'lnbc'` prefix                                                                                                       |
| `src/storage/idb.ts:3`                          | Hardcode `export const DB_NAME = 'zinqq-ldk-mainnet'`                                                                                                       |
| `src/wallet/keys.ts:8,78-85`                    | Delete `TESTNET_VERSIONS`; remove `network` parameter from `deriveBdkDescriptors`; hardcode `coinType = 0`                                                  |
| `src/ldk/init.ts:238`                           | Update error message (remove network name interpolation)                                                                                                    |

### Phase 3: Delete NetworkBadge

- Delete `src/components/NetworkBadge.tsx`
- In `src/components/Layout.tsx`: remove `import { NetworkBadge }` (line 3) and `<NetworkBadge />` (line 11)

### Phase 4: Config & Deployment Files (5 files)

| File                  | Change                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite.config.ts:54`   | Change `const isMainnetProd = env.VITE_NETWORK === 'mainnet' && mode === 'production'` to `const isProd = mode === 'production'`; update references at lines 107-108 |
| `index.html:13`       | Remove `https://mutinynet.com`, `https://*.mutinynet.com`, `https://rgs.mutinynet.com`, `wss://p.mutinynet.com` from `connect-src`                                   |
| `.env.example`        | Remove `VITE_NETWORK` lines; update `VITE_WS_PROXY_URL` default to `wss://proxy.zinqq.app`; remove signet comments                                                   |
| `.env`                | Remove `VITE_NETWORK` if present; clear signet LSP values; update WS proxy URL                                                                                       |
| `proxy/wrangler.toml` | Remove `https://zinqq-app-testnet.vercel.app` from dev origins (line 12); remove `https://testnet.zinqq.app` from production origins (line 23)                       |

### Phase 5: Test Files (13 files)

Update all test fixtures and mocks to mainnet values:

| File                                    | Key Changes                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ldk/config.test.ts`                | Assert mainnet config values; remove signet assertions                                                                                                                        |
| `src/ldk/init-recovery.test.ts`         | Update mock config to mainnet genesis hash `000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f`; update mock `EsploraClient.getBlockHash()` to return same hash |
| `src/ldk/payment-input.test.ts`         | Remove `ACTIVE_NETWORK` mock; use `bc1q` addresses; use `lnbc` invoices; flip acceptance/rejection assertions (accept bc1q, reject tb1q)                                      |
| `src/ldk/lsps2/bolt11-encoder.test.ts`  | Expect `lnbc` prefix in all assertions                                                                                                                                        |
| `src/ldk/sync/esplora-client.test.ts`   | Change `BASE_URL` from `https://mutinynet.com/api` to `/api/esplora` (or a test mock URL)                                                                                     |
| `src/onchain/bip321.test.ts`            | Replace `tb1q` addresses with `bc1q` addresses                                                                                                                                |
| `src/wallet/keys.test.ts`               | Test `deriveBdkDescriptors(mnemonic)` (no network param); assert coin type 0, xprv prefix                                                                                     |
| `src/pages/Send.test.tsx`               | Replace `tb1qtest` → `bc1qtest`; replace `lntbs` → `lnbc`                                                                                                                     |
| `src/pages/Receive.test.tsx`            | Replace `lntbs` → `lnbc`; replace `tb1q` → `bc1q`                                                                                                                             |
| `src/pages/Home.test.tsx`               | Replace `tb1qtest` → `bc1qtest`                                                                                                                                               |
| `src/hooks/use-unified-balance.test.ts` | Replace `tb1qtest` → `bc1qtest`                                                                                                                                               |
| `src/ldk/resolve-bip353.test.ts`        | Replace `tb1q` → `bc1q` addresses                                                                                                                                             |
| `src/lnurl/resolve-lnurl.test.ts`       | Replace `lntbs` → `lnbc` invoice prefixes (cosmetic consistency)                                                                                                              |

### Phase 6: Verification

- [x] `pnpm tsc --noEmit` — no TypeScript errors
- [x] `pnpm test` — all tests pass
- [x] `pnpm build` — production build succeeds without `VITE_NETWORK`
- [x] `grep -r "ACTIVE_NETWORK" src/` — zero matches
- [x] `grep -r "NetworkId" src/` — zero matches
- [x] `grep -r "VITE_NETWORK" src/` — zero matches
- [x] `grep -r "signet" src/ --include="*.ts" --include="*.tsx"` — zero matches in non-test code (test files may have signet in rejection test cases)

## Post-Merge Deployment Coordination

These steps happen after the PR merges, not in the code change:

1. **Vercel mainnet project:** Remove `VITE_NETWORK` env var (harmless but confusing if left)
2. **Vercel testnet project:** Decommission `testnet.zinqq.app` — it would deploy mainnet-only code, which is misleading
3. **Cloudflare Workers:** Deploy updated `wrangler.toml` to remove testnet origins from ALLOWED_ORIGINS

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-04-15-remove-signet-mainnet-only-brainstorm.md](docs/brainstorms/2026-04-15-remove-signet-mainnet-only-brainstorm.md) — Key decisions carried forward: full removal (no thin abstraction), tests use mainnet values, IDB name stays `zinqq-ldk-mainnet`

### Internal References

- Network config hub: `src/ldk/config.ts:3-108`
- On-chain config: `src/onchain/config.ts:15-36`
- VITE_NETWORK build-time baking: `docs/solutions/infrastructure/vercel-mainnet-env-vars-fix.md`
- IDB persistence patterns: `docs/solutions/design-patterns/bdk-ldk-transaction-history-indexeddb-persistence.md`
- VSS cache seeding: `docs/solutions/logic-errors/vss-version-cache-startup-seeding-fix.md`
