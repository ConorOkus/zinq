# Brainstorm: Descriptive README for Zinqq

**Date:** 2026-04-16
**Author:** Conor (with Claude)
**Status:** Ready for planning

## What We're Building

A `README.md` at the project root that serves as the first-impression technical writeup for Zinqq — a self-custodial, browser-based Bitcoin Lightning wallet PWA that runs a full LDK node in the browser via WebAssembly.

**Primary audience:** developers and contributors reading the code (not end users, not casual browsers).

**Posture:** reference/showcase. Document what the project is and how it's built; skip exhaustive contributor onboarding, license boilerplate, and exhaustive setup.

**Structure chosen:** narrative-first — Why → What → How — opening with a prominent experimental-software warning.

## Why This Approach

The reference/showcase posture means the README's job is to make a technically literate reader _understand the project quickly_ — not to onboard them as contributors. The narrative flow (philosophy → features → architecture) mirrors how the author would explain Zinqq in person: lead with the thesis, then show what falls out of it, then reveal the machinery. This also avoids the generic "installation / usage / contributing" template that doesn't fit a showcase project.

The prominent experimental warning is non-negotiable: Zinqq is mainnet and the code handles real funds, so even a developer-focused README needs to front-load that context so no one reads the feature list and installs it for day-to-day use without understanding the risk.

## Key Decisions

- **Audience:** developers / contributors (not end users, not LN community showcase).
- **Posture:** reference/showcase — no contribution guidelines, no exhaustive local setup section.
- **Status framing:** prominent `> [!WARNING]` block at the top. Call out: experimental, mainnet, real funds at risk, use small amounts, active development.
- **Sections (in order):**
  1. Title + tagline + experimental warning
  2. **Why Zinqq** — design philosophy / differentiators (lightning-first, browser-only, self-custodial guarantees, LSPS2 JIT, anchor reserve, encrypted VSS)
  3. **What it does** — features list grouped by domain (send/receive, channels, backup/restore, PWA)
  4. **How it works** — architecture overview with a Mermaid flowchart + prose explaining the three tiers (browser, proxies, external services)
- **Diagram format:** Mermaid flowchart (renders natively on GitHub).
- **Explicitly excluded:**
  - Local dev setup / prereqs / pnpm commands
  - Repo layout tree
  - Tech stack justifications section (stack appears inline in the architecture section)
  - Explicit BIPs/BOLTs/LSPS support table (mentioned inline in features, not called out separately)
  - License / contribution guidelines

## What the README Should Communicate

**Tagline candidate:** "A self-custodial Lightning wallet that runs entirely in your browser."

**Three things a reader should leave knowing:**

1. _What makes Zinqq different:_ LDK + BDK both run as WASM in the browser, seed never leaves the device, VSS stores only encrypted blobs, LSPS2 gives JIT inbound, anchor channels get a proactive on-chain reserve.
2. _What you can do with it:_ unified send across BIP 321 / BOLT 11 / BOLT 12 / BIP 353 / LNURL-pay / on-chain, receive with JIT channels, channel management, cross-device seed restore, installable PWA.
3. _How it hangs together:_ browser tier (React + LDK WASM + BDK WASM + IndexedDB) ↔ proxy tier (Cloudflare WS→TCP worker, Esplora proxy, VSS proxy) ↔ external services (LN peers, Blockstream Enterprise Esplora, VSS origin).

## Architecture Diagram Sketch (for the Mermaid block)

Three tiers, flowing left-to-right:

- **Browser (client):** React UI → LDK WASM node ↔ BDK WASM wallet → IndexedDB (local state) + encrypted VSS sync.
- **Proxies (edge):** Cloudflare Worker WS→TCP proxy (LN peer transport), Vercel Esplora proxy (OAuth to Blockstream Enterprise), Vercel VSS proxy, LNURL CORS shim.
- **External:** Lightning peers + LSPS2 LSP, Blockstream Enterprise Esplora, VSS origin, Rapid Gossip Sync snapshot.

## Open Questions

_(none — all resolved during brainstorming)_

## Resolved Questions

- **Audience?** Developers / contributors.
- **Posture?** Reference/showcase (not open-for-contributions, not personal-only).
- **Status framing?** Prominent experimental warning.
- **Sections?** Features list + Architecture overview + Design philosophy/differentiators (plus implicit hero + warning).
- **Structure?** Narrative-first: Why → What → How.
- **Diagram?** Mermaid flowchart.

## Next Step

Run `/ce:plan` to turn this into a concrete writing plan (section-by-section outline with word-count targets, the exact Mermaid diagram, and the feature-list bullets sourced from the repo research).
