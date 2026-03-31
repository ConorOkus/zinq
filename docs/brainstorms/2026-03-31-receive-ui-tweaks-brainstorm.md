# Receive Flow UI Tweaks

**Date:** 2026-03-31
**Status:** Draft

## What We're Building

Two UI improvements to the receive screen (`Receive.tsx`), inspired by Cash App's bitcoin receive flow:

1. **Copy icon in header with bottom sheet** -- Replace the inline truncated-address pill + copy button with a copy icon in the top-right header. Tapping it opens a bottom sheet showing a single "Payment request" row with the full BIP 321 URI and a copy button.

2. **Share button** -- Add a "Share" button below the "Add amount" button. Uses the Web Share API to share the BIP 321 URI as plain text. Falls back gracefully if Web Share API is unavailable.

## Why This Approach

The current inline address pill takes up vertical space between the QR code and the action button, and combines display + copy in a way that crowds the main view. Moving copy to a header icon + bottom sheet:

- Cleans up the main QR display area
- Gives the user a clearer view of the full URI before copying
- Follows the established Cash App pattern users may already recognize

Adding Share is a natural complement -- users receiving bitcoin often need to send the payment request to someone via a messaging app rather than having them scan a QR code in person.

## Key Decisions

1. **Bottom sheet shows only the BIP 321 URI** -- Not split into separate on-chain address / lightning invoice rows. One "Payment request" row with the unified URI keeps it simple and avoids confusing users about which to share.

2. **Copy triggered from header icon** -- Like Cash App's top-right copy icon. Removes the truncated address pill entirely from the main view.

3. **Share sends URI text only** -- No QR image sharing. Uses `navigator.share({ text: bip321Uri })`. Simpler to implement, no canvas rendering needed.

4. **ScreenHeader needs a right-action slot** -- Currently supports `onClose` for the right side. We'll need to either add a generic `rightAction` prop or pass a copy-specific prop. A generic approach is cleaner since we may want other header actions in the future.

## Scope

### In scope

- Add copy icon to ScreenHeader right side (new `CopyIcon` in icons.tsx)
- Bottom sheet component showing "Payment request" label + URI + copy button
- Share button below "Add amount" using Web Share API
- Remove the inline truncated address pill + copy button

### Out of scope

- Swipeable QR codes for different payment types (BOLT 12, on-chain only, etc.) -- noted as a future possibility
- QR code visual restyling (yellow background, Bitcoin logo overlay)
- Sharing QR code as an image

## Open Questions

None -- requirements are clear.
