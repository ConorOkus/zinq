---
title: 'feat: Expose Seed Phrase via Wallet Backup in Settings'
type: feat
status: completed
date: 2026-03-15
---

# feat: Expose Seed Phrase via Wallet Backup in Settings

## Overview

Wire up the existing "Wallet Backup" item in Settings to navigate to a new backup page where users can reveal and view their 12-word BIP39 mnemonic seed phrase. The flow uses a tap-to-reveal pattern: users first see a warning screen, then tap to reveal the words in a numbered grid.

## Problem Statement / Motivation

After initial wallet creation, users have no way to re-view their seed phrase. If they didn't write it down during onboarding, or lost their backup, they cannot recover their wallet if the browser storage is cleared. The Settings page already has a "Wallet Backup" placeholder item (`route: null`) — this feature activates it.

## Proposed Solution

### UX Flow

1. User taps **Wallet Backup** in Settings (`/settings`)
2. Navigates to `/settings/backup`
3. Sees a warning screen with security guidance
4. Taps **"Reveal Seed Phrase"** button
5. 12 words displayed in a numbered grid (reusable component)
6. User taps back to return to Settings

### Architecture Decision: Mnemonic Retrieval

The `ready` state in `WalletContextValue` exposes `ldkSeed` and `bdkDescriptors` but **not** the mnemonic string. Two options:

- **(A) Call `getMnemonic()` on demand from IndexedDB** — keeps mnemonic out of long-lived React state; requires async loading + error handling on the page.
- **(B) Add `mnemonic` to the `ready` context state** — simpler page code, but plaintext mnemonic sits in memory for the entire session.

**Decision: Option A.** The backup page calls `getMnemonic()` directly when the user taps reveal. This minimizes the time the mnemonic is held in component state and avoids expanding the context surface area. The mnemonic is cleared from local state on unmount.

### Page States (Discriminated Union)

The backup page has four internal states:

| State      | Trigger                                        | UI                                                       |
| ---------- | ---------------------------------------------- | -------------------------------------------------------- |
| `warning`  | Initial render                                 | Warning copy + "Reveal Seed Phrase" button               |
| `loading`  | User taps reveal                               | Spinner/loading indicator while `getMnemonic()` resolves |
| `revealed` | Mnemonic fetched                               | Numbered 12-word grid                                    |
| `error`    | `getMnemonic()` rejects or returns `undefined` | Error message + back button                              |

Navigating away and returning always resets to `warning` state.

### Shared Component Extraction

Extract a `<MnemonicWordGrid words={string[]} />` component from the existing inline grid in `wallet-gate.tsx` (lines 49-54). Both the onboarding backup flow and this settings backup page will use it.

### Warning Screen Copy

> **Your recovery phrase is the master key to your wallet.**
>
> Anyone who has these 12 words can access and steal your funds. Never share them with anyone.
>
> - Write them down on paper and store securely
> - Do not take a screenshot
> - Do not copy to clipboard or save digitally

## Technical Considerations

- **No authentication gate:** The app currently has no PIN/password. This is acceptable for signet but must be addressed before any mainnet release. The warning screen serves as a minimal speed bump.
- **IndexedDB error handling:** `getMnemonic()` can reject if the DB is corrupted or storage was cleared. The page handles this with an explicit error state.
- **Mnemonic lifetime in memory:** The mnemonic string is held only in the `Backup` component's local state while in `revealed` state. It is not stored in context. The component should clear state on unmount via a cleanup return in `useEffect` or by relying on React's unmount behavior.
- **No copy button:** Deliberately omitted to discourage digital storage of the seed phrase. Users should write it down.
- **No `user-select: none`:** Not applied — would hinder desktop usability. Warning copy is sufficient.
- **Single route, internal state:** The reveal is a state toggle within `/settings/backup`, not a separate route. Back button navigates to Settings, not to the warning.

## System-Wide Impact

- **Interaction graph:** Settings tap -> React Router navigation -> Backup page mounts -> (on reveal tap) `getMnemonic()` reads from IndexedDB `wallet_mnemonic` store -> state update renders grid. No callbacks, middleware, or observers involved.
- **Error propagation:** `getMnemonic()` throws -> caught in the component's async handler -> sets `error` state. No retry logic needed.
- **State lifecycle risks:** None. The page is read-only — no writes to IndexedDB. The mnemonic in component state is transient and cleared on unmount.
- **API surface parity:** The onboarding backup UI in `WalletGate` and this settings backup page will share the `MnemonicWordGrid` component but are otherwise independent flows.
- **Integration test scenarios:** (1) Full flow: Settings -> Backup -> Reveal -> verify 12 words displayed. (2) Direct navigation to `/settings/backup` after page refresh — should show warning, then reveal successfully.

## Acceptance Criteria

- [x] Tapping "Wallet Backup" in Settings navigates to `/settings/backup`
- [x] Backup page shows warning screen with security guidance on initial render
- [x] Tapping "Reveal Seed Phrase" fetches mnemonic from IndexedDB and displays 12 words in a numbered grid
- [x] Navigating away and returning resets to warning state (words are not persistently visible)
- [x] If `getMnemonic()` fails or returns undefined, an error message is shown with a back button
- [x] A shared `MnemonicWordGrid` component is extracted and used by both the backup page and the onboarding flow in `WalletGate`
- [x] Back button on backup page navigates to `/settings`
- [x] Page follows existing design tokens (dark theme, Inter/Space Grotesk fonts, accent color, `max-w-[430px]`)

## Success Metrics

- Users can retrieve their seed phrase after initial wallet creation
- No new security vulnerabilities introduced (mnemonic not persisted in context, no clipboard exposure)
- Shared component reduces duplication between onboarding and settings backup flows

## Dependencies & Risks

| Dependency/Risk                                             | Mitigation                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| No auth gate — anyone with browser access can view seed     | Acceptable for signet; warning screen as speed bump; auth gate is a separate future feature |
| `getMnemonic()` returns undefined (storage cleared)         | Explicit error state with user-friendly message                                             |
| Mnemonic in component memory while revealed                 | Cleared on unmount; minimal exposure window                                                 |
| Shared component extraction may require WalletGate refactor | WalletGate grid is simple (6 lines) — extraction is low-risk                                |

## Implementation Checklist

### 1. Extract `MnemonicWordGrid` component

**New file:** `src/components/MnemonicWordGrid.tsx`

```tsx
// Numbered 12-word grid, 2 columns x 6 rows
// Props: words: string[]
// Reuses design tokens: bg-dark-elevated, rounded-xl, font-mono
```

### 2. Update `WalletGate` to use shared component

**File:** `src/wallet/wallet-gate.tsx`

Replace inline word grid (lines 49-54) with `<MnemonicWordGrid words={mnemonic.split(' ')} />`.

### 3. Create Backup page

**New file:** `src/pages/Backup.tsx`

- Uses `ScreenHeader` with `backTo="/settings"`
- Internal state machine: `warning` | `loading` | `revealed` | `error`
- Calls `getMnemonic()` on reveal tap
- Renders `<MnemonicWordGrid>` in revealed state
- Follows existing page patterns: `min-h-dvh`, `bg-dark text-on-dark`, `flex flex-col`

### 4. Add route

**File:** `src/routes/router.tsx`

Add `{ path: '/settings/backup', element: <Backup /> }` alongside existing settings routes.

### 5. Wire Settings item

**File:** `src/pages/Settings.tsx`

Change "Wallet Backup" item's `route` from `null` to `'/settings/backup'`.

### 6. Tests

- Unit test for `MnemonicWordGrid` — renders correct number of words with numbering
- Unit test for `Backup` page — warning state, reveal flow, error state
- E2E test (Playwright) — full Settings -> Backup -> Reveal flow

## Sources & References

- Similar component: `src/wallet/wallet-gate.tsx:49-54` (existing word grid)
- Mnemonic storage: `src/wallet/mnemonic.ts` (`getMnemonic`, `storeMnemonic`)
- Settings page pattern: `src/pages/Settings.tsx` (list-item config array)
- Route definitions: `src/routes/router.tsx`
- Wallet context types: `src/wallet/wallet-context.ts` (ready state does not include mnemonic)
- Institutional learnings: `docs/solutions/integration-issues/bdk-wasm-onchain-wallet-integration-patterns.md` (seed validation, mnemonic normalization)
