# Brainstorm: Camera QR Code Scanner

**Date:** 2026-03-18
**Status:** Draft

## What We're Building

A camera-based QR code scanner that lets users scan BIP 321 URIs (and other payment formats) to initiate a send payment. The scanner is accessed via the existing scan button in the tab bar and opens as a full-screen camera view on a dedicated `/scan` route.

On successful scan, the decoded string is parsed by `classifyPaymentInput()` and the user is navigated into the send flow with data pre-filled. If the URI includes an amount, the flow skips to the review step. If not, it starts at the amount step. Non-payment QR codes show an error message.

## Why This Approach

- **Tab bar entry point**: The scan button already exists (disabled) in the tab bar with a `ScanIcon`. This is the most discoverable location and matches standard wallet UX patterns.
- **Full-screen camera**: Provides a focused, uncluttered scanning experience. Easier to aim the camera. Standard pattern in mobile wallet apps.
- **Smart navigation**: Skipping to review when amount is embedded in the URI reduces friction. The existing `classifyPaymentInput()` parser already extracts amounts from BIP 321 URIs.
- **Payment formats only**: Rejecting non-payment QR codes avoids confusing behavior and keeps the scanner purpose-driven.

## Key Decisions

1. **Entry point**: Tab bar scan button only (not on the recipient input screen)
2. **UI presentation**: Full-screen dedicated `/scan` route with camera viewfinder
3. **Post-scan behavior**: Parse via `classifyPaymentInput()`, navigate to send flow with pre-filled data. Amount in URI = skip to review; no amount = start at amount step
4. **Accepted formats**: Only formats `classifyPaymentInput()` handles (BIP 321, plain addresses, BOLT 11, BOLT 12). Error toast for anything else
5. **Security headers**: Must update `Permissions-Policy` in both `vite.config.ts` (dev) and `vercel.json` (prod) to allow camera access. CSP in `index.html` may need `blob:` or `mediastream:` source

## Technical Notes

- **QR scanning library needed**: No scanning dependency exists yet. A web-based library like `html5-qrcode` or `@aspect-ts/barcode` would work. Should support `getUserMedia` API
- **Existing infrastructure**: `ScanIcon` component exists in `icons.tsx`, disabled button in `TabBar.tsx` ready to activate
- **Parser reuse**: `classifyPaymentInput()` in `src/ldk/payment-input.ts` handles all payment format classification — no parser changes needed
- **Camera permissions**: Browser will prompt for camera access on first use. Need graceful handling of permission denied state

## Open Questions

None — all key decisions resolved.
