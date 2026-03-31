---
title: "feat: Add copy bottom sheet and share button to receive flow"
type: feat
status: completed
date: 2026-03-31
origin: docs/brainstorms/2026-03-31-receive-ui-tweaks-brainstorm.md
---

# feat: Add copy bottom sheet and share button to receive flow

## Overview

Two UI improvements to the receive screen, inspired by Cash App's bitcoin receive flow:

1. **Copy icon in header → bottom sheet** -- Replace the inline truncated-address pill with a copy icon in the top-right header. Tapping it opens a bottom sheet showing a "Payment request" row with the full BIP 321 URI and a copy button.
2. **Share button** -- Add a "Share" button below "Add amount" using the Web Share API to share the BIP 321 URI as text.

(see brainstorm: `docs/brainstorms/2026-03-31-receive-ui-tweaks-brainstorm.md`)

## Proposed Solution

### 1. ScreenHeader: add `rightAction` prop

Add an optional `rightAction?: ReactNode` prop to `ScreenHeader`. When provided, it renders in the same `absolute right-4 top-1/2 -translate-y-1/2` position as the existing `onClose` button, with the same 44px touch target styling. `rightAction` takes precedence over `onClose` if both are provided (in practice they won't conflict -- Receive uses `backTo`, not `onClose`).

**File:** `src/components/ScreenHeader.tsx`

### 2. New icons: CopyIcon and ShareIcon

Add `CopyIcon` and `ShareIcon` to `src/components/icons.tsx` following the established pattern: `IconProps` interface, 24x24 viewBox, stroke-based SVG, `fill="none"`, `stroke="currentColor"`.

**File:** `src/components/icons.tsx`

### 3. New component: BottomSheet

A minimal, reusable bottom sheet component.

**File:** `src/components/BottomSheet.tsx`

**Props:**
```tsx
interface BottomSheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}
```

**Behavior:**
- Renders a semi-transparent backdrop (`bg-black/50`) covering the viewport
- Content panel slides up from bottom with `rounded-t-2xl bg-dark-elevated` (matching Numpad visual language)
- Safe-area bottom padding: `pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]`
- **Dismissal:** tap backdrop or press Escape -- no swipe gesture for v1
- **Accessibility:** `role="dialog"`, `aria-modal="true"`, focus moves into sheet on open, Escape key closes
- **Rendering:** inline (child of the Receive overlay div), not a portal -- avoids conflict with the existing focus trap
- Animation: CSS transition (`translate-y-full` → `translate-y-0`) with `transition-transform duration-200`

### 4. Receive page changes

**File:** `src/pages/Receive.tsx`

**Remove:**
- The truncated address pill + inline copy button (lines 411-421)
- The `truncated` variable (lines 327-331)

**Add:**
- `showSheet` boolean state for bottom sheet open/close
- Copy icon button in the header via `rightAction` prop on `ScreenHeader` -- only rendered when address is loaded and QR is visible (not during loading, error, success, or JIT negotiation states)
- `<BottomSheet>` with a "Payment request" row: label, full BIP 321 URI (monospace, `break-all`, selectable text), and a copy button with "Copied!" feedback (2s timeout, same existing pattern)
- "Share" button below "Add amount" in the bottom action area -- conditionally rendered only when `typeof navigator.share === 'function'`
- Share handler: `navigator.share({ text: bip321Uri })`, silently catch `AbortError` (user cancel), ignore other errors

**Button layout in bottom action area:**
```
┌──────────────────────────┐
│       Add amount         │  ← existing, bg-dark-elevated text-accent
├──────────────────────────┤
│         Share            │  ← new, same style as Add amount
└──────────────────────────┘
```

Both buttons use `h-14 w-full rounded-xl bg-dark-elevated text-sm font-semibold text-accent`. Gap between them: `gap-3` in a flex column container.

### 5. Edge cases resolved

| Scenario | Behavior |
|---|---|
| URI is empty (loading, error) | Copy icon hidden, Share button hidden |
| Success screen | Copy icon hidden, Share button hidden |
| JIT negotiation spinner | Copy icon hidden (spinner replaces content) |
| Numpad editing active | Copy icon remains visible (URI reflects last confirmed amount) |
| `navigator.share` unavailable | Share button not rendered |
| Share cancelled by user | `AbortError` silently caught, no feedback |
| Clipboard write fails | URI is visible and selectable in the bottom sheet as fallback |
| Bottom sheet open + payment received | Bottom sheet stays open; success screen renders when sheet is closed or underneath |

## Acceptance Criteria

- [x] Copy icon appears in header top-right when QR code is visible
- [x] Tapping copy icon opens bottom sheet with "Payment request" label and full BIP 321 URI
- [x] Copy button in bottom sheet copies URI to clipboard with "Copied!" feedback (2s)
- [x] Bottom sheet dismisses on backdrop tap or Escape key
- [x] Bottom sheet has proper accessibility (`role="dialog"`, `aria-modal`, focus management)
- [x] Share button appears below "Add amount" when Web Share API is available
- [x] Share button invokes `navigator.share({ text: bip321Uri })`
- [x] Inline truncated address pill is removed from main QR view
- [x] Copy icon and Share button are hidden during loading, error, success, and JIT negotiation states
- [x] Existing tests updated to reflect removed pill and new copy/share UI
- [x] URI text in bottom sheet is selectable and uses monospace font with word-breaking

## Files to modify

| File | Change |
|---|---|
| `src/components/ScreenHeader.tsx` | Add `rightAction?: ReactNode` prop |
| `src/components/icons.tsx` | Add `CopyIcon` and `ShareIcon` |
| `src/components/BottomSheet.tsx` | **New file** -- reusable bottom sheet |
| `src/pages/Receive.tsx` | Wire up copy icon, bottom sheet, share button; remove address pill |
| `src/pages/Receive.test.tsx` | Update tests for new UI |

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-31-receive-ui-tweaks-brainstorm.md](docs/brainstorms/2026-03-31-receive-ui-tweaks-brainstorm.md) -- key decisions: single "Payment request" row (not split), copy icon in header, share URI text only
- **Existing pattern:** Clipboard usage in `Receive.tsx:214-228`, `Bolt12Offer.tsx:13`
- **Existing pattern:** Bottom action area container `px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-4` used across Send, Receive, OpenChannel, CloseChannel
- **Existing pattern:** Numpad's `rounded-t-2xl bg-dark-elevated` as visual precedent for bottom sheet
- **Learning:** BIP 321 URI generation in `docs/solutions/integration-issues/bip321-unified-uri-bolt11-invoice-generation.md` -- uppercase for QR display, original case for clipboard
