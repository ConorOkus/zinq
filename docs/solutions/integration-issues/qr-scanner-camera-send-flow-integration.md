---
title: 'QR Scanner: Camera Integration & Send Flow Data Passing'
category: integration-issues
date: 2026-03-18
severity: LOW
module: src/pages/Scan.tsx, src/pages/Send.tsx
tags: [qr-scanner, camera, getUserMedia, location-state, send-flow, bip321, csp, permissions-policy]
---

# QR Scanner: Camera Integration & Send Flow Data Passing

## Problem

Adding a camera-based QR code scanner that feeds scanned payment data into the existing Send flow state machine. Key challenges: (1) passing parsed payment data between routes when LDK WASM class instances (`Bolt11Invoice`, `Offer`) cannot survive `structuredClone` serialization, (2) integrating with the amount-first Send flow when QR codes may or may not contain amounts, (3) security headers blocking camera access.

## Root Cause

Three distinct integration hurdles:

1. **Serialization**: React Router's `location.state` uses the History API's `structuredClone`, which strips methods and prototype chains from WASM class instances. `bigint` values also don't serialize.
2. **State machine mismatch**: The Send flow is amount-first (`amount → recipient → review`), but QR codes provide the recipient first, optionally with an amount.
3. **Security headers**: Both `Permissions-Policy: camera=()` and missing `worker-src` in CSP blocked camera access and the qr-scanner Web Worker.

## Solution

### 1. Pass raw string, re-parse on the other side

Instead of passing the parsed `ParsedPaymentInput` object, pass only the raw QR string via `location.state` and re-parse with `classifyPaymentInput()` in Send.tsx:

```typescript
// Scan.tsx — navigate with raw string only
void navigate('/send', { state: { scannedInput: result.data } })

// Send.tsx — re-parse from raw string
const state = location.state as Record<string, unknown> | null
const raw = typeof state?.scannedInput === 'string' ? state.scannedInput : null
if (!raw) return
const parsed = classifyPaymentInput(raw)
```

This avoids serialization issues entirely. The double-parse also provides defense-in-depth validation.

### 2. Fork the state machine based on amount presence

```typescript
const hasAmount =
  (parsed.type === 'onchain' && parsed.amountSats !== null) ||
  ((parsed.type === 'bolt11' || parsed.type === 'bolt12') && parsed.amountMsat !== null)

if (hasAmount) {
  // processRecipientInput derives amounts from the parsed input directly
  void processRecipientInput(raw)
} else {
  // Store recipient, start at amount step, skip recipient step on Next
  setScannedInput(raw)
}
```

**Key insight**: `processRecipientInput` already extracts `parsed.amountSats` / `parsed.amountMsat` from the input — no need to pre-fill `amountDigits` state. Calling it directly avoids stale closure bugs.

For no-amount inputs, store the raw string in `scannedInput` state. In `handleAmountNext`, check for it and skip the recipient step:

```typescript
if (scannedInput) {
  const input = scannedInput
  setScannedInput(null) // Clear after use to prevent stale re-use
  void processRecipientInput(input)
  return
}
```

### 3. Security headers

```
// Permissions-Policy (vite.config.ts + vercel.json)
camera=(self)    // was camera=()

// CSP (index.html) — add worker-src for qr-scanner's blob-based Web Worker
worker-src 'self' blob:;
```

`getUserMedia` does NOT require CSP changes — it's governed by Permissions-Policy only. The `worker-src blob:` is specifically for the qr-scanner library's Web Worker architecture.

### 4. Library choice: qr-scanner (nimiq/qr-scanner)

- ~16 kB gzipped (5.6 kB with native BarcodeDetector)
- Built-in camera management — no manual `getUserMedia` code needed
- Web Worker decoding keeps mobile UI smooth
- Safari workarounds baked in
- Camera cleanup via `scanner.stop()` + `scanner.destroy()` in useEffect cleanup

## Prevention / Best Practices

- **Never pass WASM class instances through `location.state`** — they lose their prototype chain. Pass raw strings and re-parse.
- **Never use `setTimeout` to "wait for state to settle"** in React — it doesn't actually wait for a re-render. If a callback needs fresh state, either pass data as arguments or use a separate effect that watches the state.
- **Always clear `location.state` after consuming it** — `navigate(path, { replace: true, state: null })` prevents re-processing on browser back/forward.
- **Always validate `location.state` at runtime** — use `typeof` checks, not `as` casts, since state comes from an untrusted boundary.
- **Use a ref guard (`hasNavigatedRef`) for camera callbacks** — QR decoders fire rapidly and can trigger duplicate navigations.
- **Clear one-shot state after consumption** — `scannedInput` should be nulled after `handleAmountNext` uses it, or it persists on retry.

## Related

- [BIP 321 Unified URI Generation](bip321-unified-uri-bolt11-invoice-generation.md) — receive-side QR code generation
- [Send Flow Amount-First State Machine](../design-patterns/react-send-flow-amount-first-state-machine.md) — Send.tsx state machine design
- PR #33: feat: Add camera QR code scanner
