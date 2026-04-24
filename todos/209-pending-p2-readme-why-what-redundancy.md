---
status: pending
priority: p2
issue_id: '209'
tags: [code-review, documentation, readme, simplicity]
dependencies: []
---

# README restates the same points across the Why intro, Why bullets, and Send & Receive bullet

## Problem Statement

The Why section's intro paragraph enumerates four "no"s (no custodian, no server-side signing, no native install, no hidden on-chain fallback) — and then each of those is expanded as its own bullet directly beneath. The pattern repeats when "Send & Receive" opens by re-listing the BIP/BOLT payment formats that the "Unified send UX" bullet in Why already enumerated.

The effect is ~10 lines of restatement in a 180-line README.

Flagged by code-simplicity-reviewer during review of PR #138.

## Findings

- `README.md:17-18` — Second sentence of the Why intro ("No custodian, no server-side signing, no native install, and no hidden on-chain fallback.") duplicates what the four following bullets already say.
- `README.md:20-22` — Browser-only bullet ends with "but it doesn't require installation to run" — restates the headline ("Browser-only").
- `README.md:23-26` — Self-custodial bullet opens with "The BIP 39 seed never leaves the device" — already covered by "no custodian" and the tagline.
- `README.md:48-50` — Send & Receive opens by re-listing BIP 321 / BOLT 11 / BOLT 12 / BIP 353 / LNURL-pay / on-chain, which the Why "Unified send UX" bullet already enumerated.

## Proposed Solutions

### Option A — trim the intro, keep the bullets
Cut the second sentence of the Why intro. Let the bullets carry the four "no"s.
- **Pros:** smallest change, zero risk.
- **Cons:** intro loses some rhetorical punch.
- **Effort:** Small.

### Option B — trim the bullets, keep the intro
Keep the intro's four-nos line and shorten the corresponding bullets so they don't restate their headline.
- **Pros:** intro stays punchy; bullets become shorter.
- **Cons:** more edits; harder to keep tone consistent.
- **Effort:** Small.

### Option C — trim both lightly (recommended)
Cut the intro's second sentence; also drop the first-sentence restatement in the Self-custodial bullet; collapse the Send & Receive first bullet to stop re-listing specs.
- **Pros:** every bullet earns its line; saves ~8 lines total.
- **Cons:** needs careful re-reading to keep flow.
- **Effort:** Small.

## Acceptance Criteria

- [ ] Why intro no longer enumerates the four "no"s inline (pick one location for them)
- [ ] Send & Receive first bullet does not re-list the payment formats already named in the Why "Unified send UX" bullet
- [ ] README still reads coherently; total length stays within the 180–260 line target
- [ ] Prettier still passes
