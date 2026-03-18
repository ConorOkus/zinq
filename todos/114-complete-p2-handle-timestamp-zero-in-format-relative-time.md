---
status: pending
priority: p2
issue_id: 114
tags: [code-review, ui]
---

# formatRelativeTime(0) shows nonsensical time

## Problem Statement

When `timestamp === 0` (fallback for on-chain txs with no firstSeen or confirmationTime), `formatRelativeTime(0)` shows "2930w ago". Should return a meaningful fallback like "Unknown" or empty string.

## Acceptance Criteria

- [ ] `formatRelativeTime(0)` returns a reasonable fallback string
