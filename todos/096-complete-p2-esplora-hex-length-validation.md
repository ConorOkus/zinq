---
status: pending
priority: p2
issue_id: '096'
tags: [code-review, security, input-validation]
dependencies: []
---

# assertHex does not validate expected hex lengths for txids/block hashes

## Problem Statement

`assertHex` in `esplora-client.ts` validates that input is valid hex but does not check expected lengths. Block hashes and txids should be exactly 64 hex characters. A truncated or extended value passes validation but could cause downstream issues.

## Findings

- **File**: `src/ldk/sync/esplora-client.ts:6-9`
- **Identified by**: security-sentinel

## Proposed Solution

Add length assertions to Esplora methods that accept txids or block hashes:
```typescript
function assertTxid(value: string): void {
  assertHex(value, 'txid')
  if (value.length !== 64) throw new Error(`[Esplora] Invalid txid length: ${value.length}`)
}
```
