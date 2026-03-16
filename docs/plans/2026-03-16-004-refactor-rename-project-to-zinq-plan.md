---
title: "Rename project to Zinq"
type: refactor
status: completed
date: 2026-03-16
---

# Rename Project to Zinq

## Overview

Rename the project from "browser-wallet" / "Browser Wallet" to "Zinq" / "zinq" across the codebase, GitHub repository, and deployment infrastructure.

**Naming convention:**
- Display name: **Zinq** (title case)
- Package/identifier: **zinq** (lowercase)
- Derived names: `zinq-ldk` (IndexedDB), `zinq-lock` (Web Lock)

## Problem Statement / Motivation

"Browser Wallet" is a generic, descriptive name. "Zinq" gives the project a distinct brand identity suitable for a user-facing payments app.

## Proposed Solution

Systematic find-and-replace across source code, configuration, and infrastructure. Historical documentation (plans, brainstorms, solutions) is left unchanged — those references are accurate for when they were written.

## Technical Considerations

### IndexedDB Rename (No Migration)

The IndexedDB database name changes from `browser-wallet-ldk` to `zinq-ldk`. No migration code is needed — there are no production users with persisted wallet data. Any dev/test data in the old database will be abandoned (developers can manually delete via DevTools).

### Web Lock Rename

The Web Lock name changes from `browser-wallet-lock` to `zinq-lock`. Same rationale — no production users means no multi-tab transition risk.

### Vercel / Cloudflare Proxy Coordination

The Vercel project rename will change the default domain. The Cloudflare Worker's `ALLOWED_ORIGINS` must be updated in the same deployment window to avoid breaking WebSocket connectivity.

**Deployment order:**
1. Update `proxy/wrangler.toml` `ALLOWED_ORIGINS` to include both old and new Vercel domains
2. Deploy the Cloudflare Worker
3. Rename the Vercel project
4. Remove the old domain from `ALLOWED_ORIGINS` after confirming the new domain works
5. Redeploy the Cloudflare Worker

### localStorage

The only localStorage key is `balance-visible` in `BalanceDisplay.tsx` — generic, no rename needed.

## Acceptance Criteria

### Source Code Changes

- [x] `package.json:2` — `"name": "browser-wallet"` → `"name": "zinq"`
- [x] `index.html:11` — `<title>Browser Wallet</title>` → `<title>Zinq</title>`
- [x] `src/ldk/storage/idb.ts:1` — `DB_NAME = 'browser-wallet-ldk'` → `DB_NAME = 'zinq-ldk'`
- [x] `src/ldk/init.ts:96` — `'browser-wallet-lock'` → `'zinq-lock'`
- [x] `src/onchain/storage/changeset.test.ts:30` — `'browser-wallet-ldk'` → `'zinq-ldk'`
- [x] `src/wallet/mnemonic.test.ts:10` — `'browser-wallet-ldk'` → `'zinq-ldk'`

### Design Prototype Files

- [x] `design/index.html:6` — `<title>Browser Wallet — Design Prototype</title>` → `<title>Zinq — Design Prototype</title>`
- [x] `design/styles.css:2` — Comment: `Browser Wallet` → `Zinq`
- [x] `design/app.js:2` — Comment: `Browser Wallet` → `Zinq`

### Infrastructure

- [x] `proxy/wrangler.toml:12` — Update `ALLOWED_ORIGINS` to include new Zinq Vercel domain (kept old domain for transition)
- [ ] Rename Vercel project from `browser-wallet` to `zinq` *(manual step — Vercel dashboard)*
- [ ] Rename GitHub repo from `ConorOkus/browser-wallet` to `ConorOkus/zinq` *(manual step — GitHub settings)*
- [ ] Update local git remote: `git remote set-url origin git@github.com:ConorOkus/zinq.git` *(after GitHub rename)*

### NOT in Scope

- Historical docs in `docs/plans/`, `docs/brainstorms/`, `docs/solutions/` — left as-is
- GitHub PR URLs in solution docs — GitHub auto-redirects after repo rename
- Cloudflare Worker project name (`ln-ws-proxy`) — does not reference "browser-wallet"
- Local project directory rename (`browser-wallet/` → `zinq/`) — optional, developer preference
- Favicon / PWA manifest / OG tags — separate branding task

## System-Wide Impact

- **Interaction graph**: The rename is purely cosmetic in source code. No runtime behavior changes except the IndexedDB database name and Web Lock name, which affects where data is stored/read.
- **Error propagation**: No new error paths. The only risk is the Vercel/proxy coordination window where WebSocket connections could fail if `ALLOWED_ORIGINS` is stale.
- **State lifecycle risks**: Existing dev IndexedDB data in `browser-wallet-ldk` becomes orphaned. This is accepted — no production users exist.
- **API surface parity**: No API changes.
- **Integration test scenarios**: After rename, verify LDK initialization succeeds (DB opens under new name, lock acquired under new name). Verify WebSocket proxy accepts connections from new Vercel domain.

## Success Metrics

- All tests pass after rename
- `pnpm dev` serves app with "Zinq" in the title
- Staging deployment works on new Vercel domain
- WebSocket proxy accepts connections from new origin

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Vercel/proxy domain mismatch breaks WS connectivity | Medium | High | Deploy proxy with both domains first |
| Forgotten reference causes runtime error | Low | Medium | Global grep for "browser-wallet" after all changes |
| GitHub redirect stops working | Very Low | Low | GitHub maintains redirects indefinitely for renamed repos |

## Sources & References

- Similar pattern: Vercel project settings → Settings → General → Project Name
- GitHub docs on repo rename: redirects are automatic and permanent
- Current staging URL: `https://browser-wallet-theta.vercel.app`
- Cloudflare Worker config: `proxy/wrangler.toml`
