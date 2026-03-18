---
title: "feat: Add Camera QR Code Scanner"
type: feat
status: completed
date: 2026-03-18
origin: docs/brainstorms/2026-03-18-qr-code-scanner-brainstorm.md
---

# feat: Add Camera QR Code Scanner

## Overview

Add a camera-based QR code scanner that lets users scan BIP 321 URIs and other payment formats to initiate a send payment. The scanner is accessed via the existing tab bar scan button, opens as a full-screen camera view on a dedicated `/scan` route, and navigates into the send flow with scanned data pre-filled.

## Problem Statement / Motivation

Currently the only way to enter a payment destination is typing or pasting into the recipient text input on the send screen. QR code scanning is a fundamental wallet UX pattern — most real-world Bitcoin payment requests are presented as QR codes. Without scanning, the app is impractical for in-person payments.

## Proposed Solution

### Library: `qr-scanner` (nimiq/qr-scanner)

- ~16 kB gzipped (5.6 kB when native BarcodeDetector available)
- Built-in camera management (getUserMedia lifecycle, camera selection)
- Web Worker-based decoding (keeps UI thread free on mobile)
- Native TypeScript, Safari workarounds baked in
- Uses native BarcodeDetector API on Chrome Android, JS fallback elsewhere

### Architecture

```
TabBar scan button → navigate('/scan')
  → /scan route renders <Scan /> page
    → qr-scanner manages camera + decoding
    → on decode: classifyPaymentInput(rawString)
      → if error type: show inline error, continue scanning
      → if valid payment: navigate('/send', { state: { scannedInput: rawString } })

Send.tsx reads location.state on mount:
  → re-parses scannedInput via classifyPaymentInput()
  → if has amount: run fee estimation, skip to review step
  → if no amount: start at amount step (skip recipient step on Next since recipient is known)
```

## Technical Considerations

### Location State Contract (see brainstorm: docs/brainstorms/2026-03-18-qr-code-scanner-brainstorm.md)

LDK class instances (`Bolt11Invoice`, `Offer`) cannot survive `structuredClone` serialization through the History API. `bigint` values also don't serialize. The solution is to pass only the raw string and re-parse on the Send side:

```typescript
// State passed from /scan to /send
interface ScanNavigationState {
  scannedInput: string; // raw QR content — re-parsed by Send.tsx
}
```

Send.tsx reads this on mount, calls `classifyPaymentInput(state.scannedInput)`, and routes into the appropriate step.

### Send.tsx State Machine Modifications

The current flow is: `amount → recipient → review`. When a scanned recipient is provided via location.state:

- **With amount** (BIP 321 `?amount=`, BOLT 11 with amount): Parse → estimate fee (on-chain) or validate capacity (Lightning) → start at review step. Show a brief loading state while fee estimation runs.
- **Without amount** (plain address, zero-amount BOLT 11, BOLT 12 offer): Start at amount step. On "Next", skip the recipient step entirely and go directly to review (recipient is already known from scan state). Store the scanned raw string in component state so `processRecipientInput()` can consume it after amount entry.

### Security Headers

**Permissions-Policy** — change in both locations:

| File | Current | Required |
|---|---|---|
| `vite.config.ts:18` | `camera=()` | `camera=(self)` |
| `vercel.json:14` | `camera=()` | `camera=(self)` |

**CSP in `index.html`** — add `worker-src` directive for qr-scanner's blob-based Web Worker:

```
worker-src 'self' blob:;
```

`getUserMedia` itself does not require CSP changes — it's governed by Permissions-Policy and the browser permission prompt, not CSP fetch directives.

### Camera Cleanup

The qr-scanner library's `scanner.stop()` method stops all media tracks. Must be called on:
- Successful scan (before navigation)
- Component unmount (useEffect cleanup)
- Handle the async race: if component unmounts before `scanner.start()` resolves, stop the returned stream

### Scan Behavior

- **Single-shot on success**: After a valid payment QR is decoded, lock scanning and navigate. A boolean ref (`hasNavigated`) prevents double-decode race conditions.
- **Continuous on error**: Non-payment QR codes show an inline error message that auto-clears after 3 seconds. Scanner continues running in background.

## Acceptance Criteria

- [x] Tab bar scan button is enabled and navigates to `/scan`
- [x] `/scan` route renders full-screen camera viewfinder
- [x] Camera permission prompt is shown on first use; permission denied shows clear explanation
- [x] Scanning a BIP 321 URI with amount navigates to send review step with data pre-filled
- [x] Scanning a plain address navigates to send amount step; after entering amount, skips recipient step
- [x] Scanning a BOLT 11 invoice navigates to appropriate send step based on whether amount is embedded
- [x] Scanning a BOLT 12 offer navigates to appropriate send step
- [x] Non-payment QR codes show an inline error; scanner continues
- [x] Camera stops when leaving the scanner (back button, successful scan, browser navigation)
- [x] Close/back button on scanner screen returns to previous page
- [x] Permissions-Policy updated in both dev and prod configs
- [x] CSP updated with `worker-src 'self' blob:`

## Implementation Phases

### Phase 1: Infrastructure & Scanner Page

**Files to create/modify:**

1. **Install dependency**
   ```
   pnpm add qr-scanner
   ```

2. **`src/pages/Scan.tsx`** (new) — Full-screen scanner page:
   - `ScreenHeader` with title "Scan" and `onClose={() => navigate(-1)}`
   - Video element with `ref`, `autoPlay`, `playsInline`, `muted` attributes
   - Viewfinder overlay: semi-transparent dark background with a transparent center cutout (CSS only, no images)
   - Instructional text: "Point your camera at a QR code"
   - Error states:
     - Permission denied: "Camera access is required to scan QR codes. Please enable it in your browser settings."
     - Camera not found: "No camera found on this device."
     - Camera in use: "Camera is being used by another app."
     - Non-payment QR: "Not a valid payment code" (auto-clears after 3s)
   - `useEffect` initializes `QrScanner`, starts scanning, returns cleanup that calls `scanner.stop()`
   - On successful decode: call `classifyPaymentInput()`, check result type, navigate or show error
   - `hasNavigated` ref to prevent double-decode

3. **`src/routes/router.tsx`** — Add scan route:
   ```typescript
   { path: 'scan', element: <Scan /> }
   ```

4. **`src/components/TabBar.tsx`** — Enable scan button:
   - Remove `disabled` attribute and `opacity-40` class
   - Add `onClick={() => void navigate('/scan')}`
   - Update aria-label to `"Scan QR code"`

5. **Security headers:**
   - `vite.config.ts`: Change `camera=()` to `camera=(self)` in Permissions-Policy
   - `vercel.json`: Change `camera=()` to `camera=(self)` in Permissions-Policy
   - `index.html`: Add `worker-src 'self' blob:;` to CSP meta tag

### Phase 2: Send Flow Integration

**Files to modify:**

1. **`src/pages/Send.tsx`** — Read scanned input from location.state:
   - Import `useLocation` from react-router
   - On mount, check for `location.state?.scannedInput`
   - If present, call `classifyPaymentInput()` on it
   - If parsed result has amount: run fee estimation (on-chain) or capacity check (Lightning), then set initial step to review
   - If parsed result has no amount: store parsed recipient in state, set initial step to `amount`
   - Modify `handleAmountNext()`: when a scanned recipient exists in state, call `processRecipientInput()` with it instead of transitioning to the `recipient` step. This skips the recipient input screen.
   - Handle loading state between scan arrival and fee estimation completion (brief spinner or skeleton)
   - Clear `location.state` after consuming it to prevent re-processing on browser back/forward (use `navigate('/send', { replace: true, state: null })` after reading)

### Phase 3: Testing

**Files to create:**

1. **`src/pages/Scan.test.tsx`** — Unit tests:
   - Renders camera viewfinder
   - Shows permission denied state
   - Navigates to /send with scanned input on valid QR
   - Shows error on non-payment QR
   - Does not double-navigate on rapid successive decodes

2. **`src/pages/Send.test.tsx`** — Additional test cases:
   - Send flow initializes at review step when location.state contains BIP 321 URI with amount
   - Send flow initializes at amount step when location.state contains plain address
   - Amount step skips to review (not recipient) when scanned recipient exists

## Success Metrics

- Users can scan a QR code and complete a payment without typing
- Camera indicator turns off immediately when leaving the scanner
- Scanner works on iOS Safari and Chrome Android

## Dependencies & Risks

- **qr-scanner library stability**: Mature but last release was v1.4.2 (~2023). Low risk — the API is stable and the codebase is feature-complete.
- **iOS Safari camera quirks**: The library has Safari workarounds built in, but PWA standalone mode has known WebKit bugs around permission persistence. Accept this limitation.
- **Send.tsx complexity**: Adding location.state reading and a modified state machine path increases component complexity. Keep changes minimal — only add the "scanned recipient" path, don't restructure the existing flow.

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-18-qr-code-scanner-brainstorm.md](docs/brainstorms/2026-03-18-qr-code-scanner-brainstorm.md) — Key decisions: tab bar entry point, full-screen camera, smart navigation based on amount presence, payment formats only

### Internal References

- `src/ldk/payment-input.ts` — `classifyPaymentInput()` and `ParsedPaymentInput` type
- `src/pages/Send.tsx` — Send flow state machine
- `src/components/TabBar.tsx:22-27` — Disabled scan button placeholder
- `src/components/icons.tsx:168` — `ScanIcon` component
- `src/components/ScreenHeader.tsx` — Reusable page header

### External References

- [nimiq/qr-scanner](https://github.com/nimiq/qr-scanner) — QR scanning library
- [MDN: Permissions-Policy camera](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/camera)
- [MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
