---
title: Add project README
type: docs
status: completed
date: 2026-04-16
origin: docs/brainstorms/2026-04-16-descriptive-readme-brainstorm.md
---

# Add Project README

## Overview

Create a `README.md` at the project root describing Zinqq as a self-custodial, browser-based Bitcoin Lightning wallet PWA. The README targets developers and contributors reading the code (not end users, not casual browsers) and uses a reference/showcase posture — describe the thesis, features, and architecture without adding contribution boilerplate or exhaustive setup instructions.

Structure decided during brainstorming (see brainstorm: [docs/brainstorms/2026-04-16-descriptive-readme-brainstorm.md](../brainstorms/2026-04-16-descriptive-readme-brainstorm.md)):

1. Title + tagline + prominent experimental-software warning
2. **Why Zinqq** — design philosophy and differentiators
3. **What it does** — features, grouped by domain
4. **How it works** — architecture tier overview with a Mermaid flowchart

## Problem Statement / Motivation

No README exists at the project root today. New readers — whether engineers evaluating the codebase, Lightning-ecosystem folks curious about the approach, or future-self returning after a break — have no single document that explains what Zinqq is, what it can do, or how it's put together. Everything currently lives either implicitly in the code or in scattered planning and solution docs under `docs/`.

This plan produces the first README, scoped deliberately as a showcase writeup rather than an onboarding or marketing doc.

## Proposed Solution

Write one markdown file at the repo root: `README.md`. Target length ~180–260 lines. No images. One Mermaid diagram for the architecture section. Use GitHub alert syntax (`> [!WARNING]`) for the experimental banner.

Product name convention: use **Zinqq** consistently (matches `index.html` title and `src/ldk/context.tsx` wallet description). The PWA manifest in `vite.config.ts` still reads `Zinq` and gets aligned in this PR.

### File outline

````markdown
# Zinqq

> A self-custodial Bitcoin Lightning wallet that runs entirely in your browser.

> [!WARNING]
> Experimental software on Bitcoin mainnet...

## Why Zinqq

<prose + compact bullets>

## What it does

### Send & Receive

### Channels & liquidity

### Backup & recovery

### Progressive web app

## How it works

```mermaid
flowchart LR ...
```
````

### Browser

### Edge proxies

### External services

````

### Section-by-section content specification

#### 1. Hero + warning (~12 lines)

- `# Zinqq` title.
- One-line tagline below title (block-quote styled): *"A self-custodial Bitcoin Lightning wallet that runs entirely in your browser."*
- GitHub `> [!WARNING]` block with three points:
  - Experimental software on Bitcoin mainnet.
  - Active development; channel state format and storage layout may change.
  - Use only amounts you can afford to lose. Back up your 12-word seed before funding.

#### 2. Why Zinqq — philosophy & differentiators (~30–40 lines)

Short intro paragraph (2–3 sentences): Zinqq is a thesis about what a Lightning wallet should be in 2026 — browser-first, self-custodial, and Lightning-first with on-chain as an escape hatch.

Then a compact differentiators list (one line each, bolded lead-in):

- **Browser-only.** LDK and BDK both ship as WebAssembly; no native install, no custodian, no server-side signing. Installable as a PWA on iOS/Android/desktop.
- **Self-custodial by construction.** Seed never leaves the device. All signing happens client-side. VSS (Versioned Storage Service) sees only ChaCha20-Poly1305-encrypted blobs with hashed keys.
- **Lightning-first.** Payments always attempt Lightning. On-chain exists as an escape hatch (e.g. BIP 321 fallback), never a silent fallback. See the [lightning-first receive strategy](docs/brainstorms/) for the reasoning.
- **Instant inbound via LSPS2.** Zero-setup first receive: the wallet buys a just-in-time channel from a configured LSP the moment a user generates an invoice with no inbound capacity.
- **Anchor channels with a proactive reserve.** A small on-chain balance is kept available for CPFP fee-bumping at force-close.
- **Encrypted cross-device restore.** Restore from a 12-word seed alone and rebuild channel monitors, channel manager, scorer, network graph, and known peers from VSS.
- **Unified send UX.** One input box classifies BIP 321 URIs, BOLT 11 invoices, BOLT 12 offers, BIP 353 human-readable names, LNURL-pay, and raw on-chain addresses.

#### 3. What it does — features (~50–70 lines)

Four grouped subsections with short H3 headings. Each bullet names the capability and, where relevant, the supported spec or the source file for curious readers.

**Send & Receive**
- Send: BIP 321, BOLT 11, BOLT 12, BIP 353, LNURL-pay, on-chain (`src/ldk/payment-input.ts`).
- Receive: unified QR combining an on-chain address and a BOLT 11 invoice in a BIP 321 URI; separate BOLT 12 offer view.
- Just-in-time inbound via LSPS2 when no inbound capacity exists (`src/ldk/lsps2/`).
- Camera QR scanner for payment input.

**Channels & liquidity**
- Connect, disconnect, and forget peers.
- Open channels with chosen peers.
- Close channels gracefully; force-close when necessary.
- Force-close recovery flow that prompts for a small on-chain top-up to fund anchor-CPFP when balances are stuck.
- Automatic on-chain anchor reserve (currently ~10k sats, `src/onchain/context.tsx`).
- Spendable output sweeping via `KeysManager.spend_spendable_outputs` (`src/ldk/sweep.ts`).

**Backup & recovery**
- 12-word BIP 39 mnemonic with 60-second auto-hide reveal.
- Encrypted VSS sync of channel monitors, channel manager, network graph, scorer, known peers, payment history, and BOLT 12 offer (`src/ldk/storage/vss-client.ts`).
- Restore from seed on any device, rebuilding channel state from VSS.

**Progressive web app**
- Installable manifest with iOS "Add to Home Screen" hint.
- Offline-cached app shell via Workbox; NetworkFirst strategy for the LDK WASM blob.
- Update banner on new service-worker releases.

#### 4. How it works — architecture (~60–90 lines)

Short opening paragraph (3–4 sentences): Zinqq has three tiers — the browser runtime that does all signing and state, a small set of edge proxies that give the browser access to TCP peers and authenticated chain data, and the external services those proxies reach.

Then the Mermaid diagram (see [Mermaid diagram](#mermaid-diagram-specification) below), followed by three short subsections:

**Browser**
- React 19 UI with React Router v7 and Tailwind v4, built by Vite 7 with `vite-plugin-wasm` + `vite-plugin-top-level-await` + `vite-plugin-pwa`.
- **LDK node** (`lightningdevkit` 0.1.8-0, ~12 MB WASM) wires custom JS trait impls for logger, fee estimator, broadcaster, persist, filter, event handler, signer provider, and wallet source (`src/ldk/traits/`). Runs `ChainMonitor`, `ChannelManager`, `NetworkGraph`, `ProbabilisticScorer`, `OnionMessenger`, `PeerManager`, `P2PGossipSync`.
- **BDK wallet** (`@bitcoindevkit/bdk-wallet-web` 0.3.0 WASM) manages BIP 84 descriptors for the on-chain escape hatch; LDK pulls UTXOs and signs through BDK.
- **Local state** in IndexedDB (`src/storage/idb.ts`); every persisted blob is also mirrored to VSS encrypted.
- **Key hierarchy**: BIP 39 mnemonic → BIP 32 → separate hardened derivations for the LDK seed (`m/535'/0'`), VSS encryption key (`m/535'/1'`), VSS signing key (`m/535'/2'`), and BDK BIP 84 (`m/84'/0'/0'`).

**Edge proxies**
- **Cloudflare Worker WS→TCP bridge** (`proxy/`) at `wss://proxy.zinqq.app/<host>:<port>` — the only way a browser can talk BOLT 8 to a Lightning peer. Origin and port allowlisted.
- **Esplora proxy** (`api/esplora-proxy.ts`) — OAuth2-authenticated shim in front of Blockstream Enterprise Esplora. Used by both LDK's chain sync and BDK's full scan.
- **VSS proxy** (`api/vss-proxy.ts`) — thin pass-through to the VSS origin. Auth is a client-signed token; the proxy adds no trust.
- **LNURL CORS shim** (`api/lnurl-proxy.ts`) — works around CORS on arbitrary LNURL endpoints.

**External services**
- Lightning peers and LSPS2 LSP (Megalith mainnet).
- Blockstream Enterprise Esplora for chain data.
- VSS origin for encrypted state sync.
- Rapid Gossip Sync snapshot (`https://rapidsync.lightningdevkit.org`) for the network graph.

### Mermaid diagram specification

The diagram belongs inside the "How it works" section, immediately after the opening paragraph and before the three subsections. Exact content:

```mermaid
flowchart LR
  subgraph Browser["Browser (client)"]
    UI[React UI]
    LDK[LDK Node<br/>WASM]
    BDK[BDK Wallet<br/>WASM]
    IDB[(IndexedDB)]
    UI --> LDK
    UI --> BDK
    LDK <--> BDK
    LDK --> IDB
    BDK --> IDB
  end

  subgraph Proxies["Edge proxies"]
    WSProxy["Cloudflare Worker<br/>WS &rarr; TCP"]
    ESProxy["Esplora Proxy<br/>(Vercel)"]
    VSSProxy["VSS Proxy<br/>(Vercel)"]
    LNURLProxy["LNURL CORS Shim<br/>(Vercel)"]
  end

  subgraph External["External services"]
    Peers["LN Peers<br/>+ LSPS2 LSP"]
    Esplora["Blockstream<br/>Enterprise Esplora"]
    VSS[VSS Origin]
    RGS[Rapid Gossip Sync]
  end

  LDK -->|BOLT 8 over WSS| WSProxy --> Peers
  LDK -->|chain sync| ESProxy
  BDK -->|full scan| ESProxy --> Esplora
  LDK -->|encrypted blobs| VSSProxy --> VSS
  UI -->|LNURL-pay| LNURLProxy
  LDK -->|snapshot| RGS
````

Verify the diagram renders on github.com before calling the task complete. Preview via a draft PR or the GitHub web editor's preview tab.

## Technical Considerations

- **GitHub alert syntax.** `> [!WARNING]` renders on github.com and on most IDE previews. It is the right choice per the brainstorm decision to front-load the experimental warning.
- **Mermaid on GitHub.** GitHub renders Mermaid fenced blocks natively. Keep node labels short; escape `→` with HTML entity (`&rarr;`) if needed for broader renderer compatibility.
- **Naming.** Use "Zinqq" everywhere (matches the repo name, `index.html` title, and `src/ldk/context.tsx` wallet description). The PWA manifest in `vite.config.ts` is corrected to match in this same PR.
- **Spec list formatting.** List BIPs/BOLTs inline inside feature bullets, never as a standalone table — per brainstorm decision to skip a dedicated specs section.
- **Internal links.** Link into `src/` and `docs/solutions/` sparingly: only when the pointer adds real value (e.g., `src/ldk/payment-input.ts` for the unified-send classifier). Do not build a repo-layout tree.
- **Formatter.** The project uses Prettier; the README must pass `pnpm format:check`. Prettier's default markdown rules will wrap long lines — avoid over-long bullet lines (≤ ~120 chars) to keep diffs stable.
- **No license or contrib section.** Reference/showcase posture per brainstorm. If a license question comes up later, add a `LICENSE` file separately and a one-line reference.

## Acceptance Criteria

- [x] `README.md` exists at the repo root and is committed on a feature branch (never directly to `main`). Branch: `docs/add-readme`.
- [x] Opens with `# Zinqq`, tagline blockquote, and a GitHub `> [!WARNING]` block covering the three points listed in the outline.
- [x] Contains exactly three top-level sections after the hero: "Why Zinqq", "What it does", "How it works", in that order.
- [x] "What it does" groups features under the four H3 headings: Send & Receive, Channels & liquidity, Backup & recovery, Progressive web app.
- [x] Feature bullets name the relevant specs inline: BIP 39, BIP 32, BIP 84, BIP 321, BIP 353, BOLT 11, BOLT 12, LNURL-pay, LSPS2.
- [x] Mermaid diagram is present, follows the specification above, and renders on github.com. _Visual verification of rendering deferred to PR preview._
- [x] Architecture section has the three subsections: Browser, Edge proxies, External services.
- [x] File is between ~180 and ~260 lines of markdown. (180 lines.)
- [x] `pnpm format:check` passes for `README.md`. (Verified with `npx prettier --check README.md`; unrelated pre-existing docs files still fail the repo-wide check, out of scope here.)
- [x] No sections for local development setup, license, contributing, or repo-layout tree.
- [x] No screenshots or other images.
- [x] Name is spelled "Zinqq" everywhere in the README (no bare "Zinq"). Supersedes an earlier criterion that incorrectly asked for a Zinq/zinqq distinction; the aside line was removed and the PWA manifest corrected in the same PR.

## System-Wide Impact

- **Interaction graph.** Minimal code impact: the only code change is aligning the PWA manifest `name`/`short_name` in `vite.config.ts` from `Zinq` to `Zinqq`. The main artifact is the new `README.md`.
- **Error propagation.** N/A.
- **State lifecycle risks.** N/A.
- **API surface parity.** N/A.
- **Integration test scenarios.** None. Visual QA only: render on github.com and scroll through on a narrow viewport (mobile GitHub view) to check the Mermaid diagram and alert block don't overflow awkwardly.

## Dependencies & Risks

- **Mermaid render risk.** If GitHub updates Mermaid rendering and the diagram breaks visually, fall back to a simpler `flowchart TD` with fewer edges. Keep the diagram source simple enough to hand-edit.
- **Claim drift.** The README makes specific claims ("anchor reserve ~10k sats", "LDK 0.1.8-0", specific file paths). These can rot. Mitigation: whenever a feature listed in the README materially changes, update the README in the same PR. Do not link to line numbers — file paths only.
- **LSP identity.** The README names Megalith as the mainnet LSP. If this changes, update the "External services" subsection.

## Out of Scope

- Screenshots, logos, or hero imagery.
- Contribution guidelines, CLA, or code-of-conduct.
- A license section (separate concern; add if/when the repo is published).
- Detailed local development setup (prerequisites, pnpm install, env vars, running the Cloudflare proxy locally, running the Vercel dev server, etc.).
- A repo-layout tree of `src/`, `api/`, `proxy/`, `docs/`.
- A dedicated BIPs/BOLTs/LSPS support table.
- Separate tech-stack justifications section (the stack appears inline in the architecture section).
- FAQ / Troubleshooting / "Known issues".
- Security disclosure policy (add later with the license).

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-04-16-descriptive-readme-brainstorm.md](../brainstorms/2026-04-16-descriptive-readme-brainstorm.md). Key decisions carried forward:
  - Audience: developers / contributors (not end users, not LN community showcase).
  - Posture: reference / showcase — no contrib or license sections, no exhaustive setup.
  - Status framing: prominent `> [!WARNING]` block.
  - Structure: narrative-first, Why → What → How.
  - Diagram format: Mermaid flowchart (renders on GitHub).

### Internal References

- `package.json` — dependency versions to cite (LDK 0.1.8-0, BDK 0.3.0, React 19, Vite 7, Tailwind v4).
- `vite.config.ts:66-68` — canonical product name and description strings (`name: 'Zinqq'`, `description: 'Lightning wallet powered by LDK'`).
- `index.html:13` — CSP lock-down lists every external host the app contacts; useful cross-check for the "External services" section.
- `src/ldk/payment-input.ts` — unified payment classifier (Send feature).
- `src/ldk/lsps2/` — LSPS2 JIT channel client.
- `src/ldk/storage/vss-client.ts`, `src/ldk/storage/vss-crypto.ts` — VSS encrypted backup.
- `src/wallet/keys.ts` — key derivation hierarchy.
- `src/onchain/context.tsx` — anchor reserve constant.
- `src/ldk/sweep.ts` — spendable output sweeping.
- `proxy/src/index.ts`, `proxy/wrangler.toml` — Cloudflare WS→TCP bridge.
- `api/esplora-proxy.ts`, `api/vss-proxy.ts`, `api/lnurl-proxy.ts` — Vercel serverless proxies.
- `docs/solutions/integration-issues/esplora-request-batching-dedup-caching.md` — backing detail for Esplora client behavior (cite only if it earns its place).

### External References

- GitHub alerts syntax — https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts
- Mermaid flowchart syntax — https://mermaid.js.org/syntax/flowchart.html
- BOLT specifications — https://github.com/lightning/bolts
- BIP index — https://github.com/bitcoin/bips
- LSPS specifications — https://github.com/BitcoinAndLightningLayerSpecs/lsp

## Implementation Notes

- Create a feature branch (`docs/add-readme` or similar) before committing — do not commit directly to `main`.
- Write the file in one pass from the outline; do not incrementally merge partial drafts.
- After writing, open the file in a GitHub preview (either a draft PR or the GitHub web UI's Edit → Preview) to verify the Mermaid block and alert box render.
- Run `pnpm format:check README.md` before opening the PR.
- Wait for CI to pass before merging.
