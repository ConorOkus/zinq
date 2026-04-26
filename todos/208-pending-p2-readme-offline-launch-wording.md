---
status: pending
priority: p2
issue_id: '208'
tags: [code-review, documentation, pwa, readme]
dependencies: []
---

# README overstates offline capability in PWA bullet

## Problem Statement

`README.md:82-84` (PWA section) claims:

> Workbox service worker caches the app shell for offline launch and uses a NetworkFirst strategy for the LDK WASM blob.

"Offline launch" implies the app is usable offline. In practice the shell loads offline but Zinqq cannot do anything useful until it can reach the CSP-whitelisted hosts (Esplora proxy, VSS proxy, WS→TCP proxy, RGS). Claim invites a reasonable reader to expect full offline operation that doesn't exist.

Flagged by architecture-strategist during review of PR #138.

## Findings

- `README.md:82-84` — "Workbox service worker caches the app shell for offline launch..."
- `index.html:13` — CSP `connect-src` enumerates the runtime hosts the app needs.
- Runtime: LDK chain sync, peer transport, and VSS all require network; only the UI shell is offline-capable.

## Proposed Solution

Tighten the sentence so it doesn't promise more than the PWA delivers. Example:

> Workbox service worker caches the app shell so the UI loads without a round-trip; a NetworkFirst strategy keeps the LDK WASM blob fresh.

Drop the word "launch" and the implied end-to-end offline capability.

## Acceptance Criteria

- [ ] `README.md` PWA bullet no longer says "offline launch"
- [ ] The replacement wording accurately describes shell caching without implying the wallet is fully offline-capable
- [ ] Prettier still passes
