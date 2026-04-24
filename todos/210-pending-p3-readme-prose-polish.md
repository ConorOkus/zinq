---
status: pending
priority: p3
issue_id: '210'
tags: [code-review, documentation, readme, simplicity]
dependencies: []
---

# README: prose polish — dead words, CSP footer, RGS hostname

## Problem Statement

Small prose-level improvements that would not move the needle individually but collectively tighten the README. None are blocking.

Flagged by code-simplicity-reviewer during review of PR #138.

## Findings

- `README.md:15` — "working answer to a single question…" is rhetorical throat-clearing; "Zinqq trusts nothing outside the device it runs on." carries the same meaning.
- `README.md:23` — "Self-custodial **by construction**." — "by construction" is a buzzword the rest of the bullet already justifies.
- `README.md:88-91` — The three-tier opening paragraph is paraphrased by the Mermaid subgraph labels immediately below. A shorter sentence ("Three tiers: browser, edge proxies, external services.") would suffice.
- `README.md:173-174` — The bare hostname `rapidsync.lightningdevkit.org` is not load-bearing; "The LDK public snapshot seeds the network graph." reads cleaner.
- `README.md:176-178` — Closing paragraph about CSP in `index.html` is a meta-observation about a cross-check; not architecture. The plan listed CSP as a research source, not as README content. Can be dropped.
- `docs/plans/2026-04-16-001-docs-add-project-readme-plan.md` — The embedded file-outline block (~35 lines inside a markdown code fence) duplicates the section-by-section spec immediately below it. Plans are protected artifacts and must not be deleted, but the outline can be safely trimmed since the section spec is authoritative.

## Proposed Solution

Take the trims that are unambiguous wins:
1. Cut "working answer to a single question:" from line 15.
2. Drop "by construction" from the Self-custodial headline.
3. Collapse the three-tier paragraph (lines 88–91) to one sentence.
4. Drop the bare RGS hostname (line 174).
5. Drop the CSP footer paragraph (lines 176–178).
6. Optionally trim the plan's embedded file-outline block.

## Acceptance Criteria

- [ ] Dead-word trims applied to lines 15, 23, 88–91, 174
- [ ] CSP footer paragraph removed
- [ ] README still passes Prettier and stays within 170–260 lines
- [ ] Plan embedded outline block trimmed (optional)
