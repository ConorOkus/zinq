---
title: 'refactor: Remove onboarding screens, auto-create wallet silently'
type: refactor
status: completed
date: 2026-03-16
---

# Remove Onboarding Screens, Auto-Create Wallet Silently

## Overview

Remove the Welcome and Backup onboarding screens. When no wallet exists, silently generate a mnemonic, store it, derive keys, and enter the app immediately. Existing wallets load as before. Backup remains accessible via Settings > Backup. Import wallet is out of scope (follow-up plan).

## Problem Statement / Motivation

The current onboarding flow (Welcome → Create Wallet → View 12 Words → Confirm Backup) adds friction for new users. For a signet/testnet wallet, mandatory backup before entry is unnecessary. Users should land in the app instantly and back up at their convenience.

## Proposed Solution

**Simplify the `WalletProvider` state machine:**

- Remove the `new` and `backup` states
- The `loading` state now handles auto-creation when no mnemonic is found
- State transitions: `loading` → `ready` (always) or `loading` → `error`

**Simplify `WalletGate`:**

- Remove Welcome screen, `ImportWalletForm`, and backup screen rendering
- Only render a loading spinner for `loading` state and an error screen for `error` state
- Pass through to children for `ready` state (unchanged)

**Auto-create flow in `WalletProvider`:**

1. `useEffect` fires, sets `status: 'loading'`
2. Calls `getMnemonic()` from IndexedDB
3. If mnemonic exists → derive keys → `status: 'ready'` (unchanged)
4. If no mnemonic → `generateMnemonic()` → `storeMnemonic()` → derive keys → `status: 'ready'`

## Technical Considerations

### Race Condition: React StrictMode Double-Effect

In development, `useEffect` fires twice. Both invocations will see no mnemonic and race to generate + store different mnemonics. The second `storeMnemonic()` will throw ("Mnemonic already exists"), putting the app in error state.

**Fix:** Use a module-level promise deduplication guard, matching the existing pattern in `src/ldk/init.ts:115-121`:

```typescript
// src/wallet/context.tsx
let walletInitPromise: Promise<WalletReadyState> | null = null

function initializeWallet(): Promise<WalletReadyState> {
  if (!walletInitPromise) {
    walletInitPromise = doInitializeWallet()
  }
  return walletInitPromise
}
```

### Race Condition: Multi-Tab Auto-Create

Two fresh tabs could both auto-create different mnemonics. The `storeMnemonic()` safety guard has a TOCTOU gap (read in one IDB transaction, write in another).

**Fix:** Make `storeMnemonic()` use a single `readwrite` transaction that checks-and-writes atomically. This is the minimal change — the Web Lock (`zinqq-lock`) is acquired later in `doInitializeLdk` and covers subsequent operations.

```typescript
// src/wallet/mnemonic.ts — storeMnemonic update
async function storeMnemonic(mnemonic: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('wallet_mnemonic', 'readwrite')
  const store = tx.objectStore('wallet_mnemonic')
  const existing = await store.get('primary')
  if (existing) {
    throw new Error('Mnemonic already exists')
  }
  await store.put(mnemonic, 'primary')
  await tx.done
}
```

### Component Preservation

- `MnemonicWordGrid` is used by `src/pages/Backup.tsx` — **must not be deleted**
- `ImportWalletForm` and `normalizeMnemonic` in `wallet-gate.tsx` can be removed (import is out of scope; will be re-implemented in follow-up plan)

### Mnemonic Overwrite Safety

The `storeMnemonic()` safety guard (throws if mnemonic exists) **must be preserved**. The auto-create flow calls it exactly once per wallet lifetime. The atomic transaction fix above strengthens this guarantee.

## System-Wide Impact

- **Interaction graph**: `WalletProvider` → `storeMnemonic()` → IndexedDB. Then `WalletGate` passes through → `LdkProvider` → `doInitializeLdk()` → `storeDerivedSeed()`. No change to downstream providers.
- **Error propagation**: Auto-create errors surface as `status: 'error'` in `WalletGate`. No change to LDK/BDK error handling.
- **State lifecycle risks**: If `storeMnemonic()` succeeds but key derivation throws, the mnemonic is persisted. On reload, `getMnemonic()` finds it and follows the existing-wallet path — this is correct self-healing behavior.
- **API surface parity**: No external APIs affected. The wallet state machine type narrows (fewer states), which may affect tests.

## Acceptance Criteria

- [x] New user opens app → sees loading spinner → lands on Home screen (no onboarding screens)
- [x] Mnemonic is silently generated and stored in IndexedDB on first launch
- [x] Existing user opens app → loads wallet as before (no behavior change)
- [x] Settings > Wallet Backup still shows the mnemonic correctly
- [x] `WalletProvider` state machine only has `loading`, `ready`, and `error` states
- [x] `WalletGate` only renders loading spinner or error — no Welcome/Backup UI
- [x] StrictMode double-effect does not cause errors (promise dedup guard)
- [x] `storeMnemonic()` uses atomic readwrite transaction (TOCTOU fix)
- [x] All existing tests pass (updated for removed states)
- [x] `MnemonicWordGrid` component is preserved (used by Backup page)

## Success Metrics

- Zero onboarding screens rendered for new users
- Time from first load to Home screen reduced to wallet init time only (~1-2s)
- No regressions in existing wallet load flow

## Dependencies & Risks

- **Risk**: Users who don't proactively back up lose funds on storage clear. Mitigated by: this is signet/testnet, and backup is one tap away in Settings.
- **Dependency**: Import wallet in Settings is a follow-up plan. The "Recover Wallet" settings item should remain visible but disabled/hidden until that plan ships.
- **Risk**: The `storeMnemonic()` atomic transaction change touches fund-safety code. Requires careful review.

## MVP

### src/wallet/wallet-context.ts

Remove `new` and `backup` states:

```typescript
export type WalletContextValue =
  | { status: 'loading' }
  | { status: 'ready'; ldkSeed: Uint8Array; bdkDescriptors: { external: string; internal: string } }
  | { status: 'error'; error: Error }
```

### src/wallet/context.tsx

Replace the state machine with auto-create logic:

```typescript
let walletInitPromise: Promise<{
  ldkSeed: Uint8Array
  bdkDescriptors: { external: string; internal: string }
}> | null = null

async function doInitializeWallet() {
  let mnemonic = await getMnemonic()
  if (!mnemonic) {
    mnemonic = generateMnemonic()
    await storeMnemonic(mnemonic)
  }
  const ldkSeed = deriveLdkSeed(mnemonic)
  const bdkDescriptors = deriveBdkDescriptors(mnemonic)
  return { ldkSeed, bdkDescriptors }
}

function initializeWallet() {
  if (!walletInitPromise) {
    walletInitPromise = doInitializeWallet()
  }
  return walletInitPromise
}
```

### src/wallet/wallet-gate.tsx

Simplify to loading/error/passthrough:

```tsx
export function WalletGate({ children }: { children: React.ReactNode }) {
  const wallet = useWallet()

  if (wallet.status === 'loading') {
    return <LoadingSpinner />
  }

  if (wallet.status === 'error') {
    return <ErrorScreen error={wallet.error} />
  }

  return <>{children}</>
}
```

### src/wallet/mnemonic.ts

Atomic storeMnemonic:

```typescript
async function storeMnemonic(mnemonic: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('wallet_mnemonic', 'readwrite')
  const store = tx.objectStore('wallet_mnemonic')
  const existing = await store.get('primary')
  if (existing) throw new Error('Mnemonic already exists')
  await store.put(mnemonic, 'primary')
  await tx.done
}
```

## Sources

- Similar init pattern: `src/ldk/init.ts:115-121` (promise dedup guard)
- Mnemonic safety: `src/wallet/mnemonic.ts` (storeMnemonic guard)
- Institutional learning: `docs/solutions/logic-errors/bdk-address-reveal-not-persisted.md` (persistence is non-negotiable)
- Institutional learning: `docs/solutions/integration-issues/bdk-ldk-signer-provider-fund-routing.md` (fund safety during init)
