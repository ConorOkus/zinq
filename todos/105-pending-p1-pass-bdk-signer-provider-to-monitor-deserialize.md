---
status: pending
priority: p1
issue_id: '105'
tags: [code-review, security, fund-safety]
dependencies: []
---

# deserializeMonitors uses default KeysManager SignerProvider instead of bdkSignerProvider

## Problem Statement

`deserializeMonitors()` in `init.ts` line 376 passes `keysManager.as_SignerProvider()` instead of the custom `bdkSignerProvider`. Channel monitors carry their own signer instances from deserialization. When the ChainMonitor needs to reconstruct force-close claim transactions, the monitor's embedded signer will use KeysManager-derived destination scripts, not BDK wallet addresses. Force close funds would go to addresses BDK doesn't track.

## Findings

- **File**: `src/ldk/init.ts:376` — `keysManager.as_SignerProvider()` in `deserializeMonitors`
- **Identified by**: security-sentinel (H1)
- **Context**: Lines 224 and 273 correctly use `bdkSignerProvider`, but the monitor deserialization at line 376 was missed

## Proposed Solution

Pass `bdkSignerProvider` to `deserializeMonitors` instead of `keysManager`. Refactor the function signature to accept a `SignerProvider` parameter.

```typescript
function deserializeMonitors(
  entries: Map<string, Uint8Array>,
  keysManager: KeysManager,
  signerProvider: SignerProvider,  // add this
): ChannelMonitor[] {
```

- **Effort**: Small (3-line change)
- **Risk**: Low

## Acceptance Criteria

- [ ] `deserializeMonitors` uses `bdkSignerProvider` for channel monitor deserialization
- [ ] Force close destination scripts go to BDK wallet addresses
