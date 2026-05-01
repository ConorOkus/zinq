---
title: "feat: payjoin fork smoke test"
type: feat
status: completed
date: 2026-04-30
origin: docs/brainstorms/2026-04-30-payjoin-fork-smoke-test-brainstorm.md
---

# feat: Payjoin Fork Smoke Test (`@xstoicunicornx/payjoin`)

## Overview

Drop in `@xstoicunicornx/payjoin@0.0.4`, wire a dev-only route that
lazy-imports the package's `/web-vite` entry, calls
`uniffiInitAsync()`, then exercises one synchronous PDK call. Verify
in Vite dev, Vite production preview, Vercel preview, and iOS Safari.
Land on a feature branch with a Vercel preview link sent back to the
fork author. **No PR. No merge to main.**

(see brainstorm: `docs/brainstorms/2026-04-30-payjoin-fork-smoke-test-brainstorm.md`)

## Problem Statement / Motivation

Commit `91f9b75` removed the entire payjoin integration pending
upstream fixes to PDK's wasm-bindgen build (vendored submodule, two
sed patches on the build output, custom Vercel `installCommand`,
wasm-bindgen-cli pin, brew/llvm install — ~80 files of glue).

The fork at `xstoicunicornx/rust-payjoin#js-web-bindings` claims those
fixes are landed and pre-built. Tarball inspection confirms:

- `dist/web/vite.index.js` already appends `?url` to the wasm import
  (matches our first sed patch).
- `--target web` is the default for the `/web` and `/web-vite`
  exports (matches our second sed patch).
- `index_bg.wasm` ships in the npm tarball (no local Rust toolchain
  or `wasm-bindgen-cli` pin required at install).

A targeted smoke test produces a yes/no signal back to the fork
author so they can move their upstream PR forward — **without**
re-litigating the full BIP 77 v2 sender flow that was deleted in
`91f9b75`.

## Proposed Solution

1. Add `@xstoicunicornx/payjoin@0.0.4` (exact pin, no caret) as a
   dependency via `pnpm add -E`.
2. Create `src/pages/PayjoinSmoke.tsx` that:
   - Lazy-imports `@xstoicunicornx/payjoin/web-vite` inside `useEffect`.
   - Calls `await uniffiInitAsync()`.
   - Invokes one synchronous, no-network PDK symbol (recommend
     `Uri.parse(<fixture BIP 21 with pj=>)` — see "Real PDK call"
     below for rationale).
   - Renders three states: pending / ok / error (with full error stack
     in a `<pre>`).
3. Register `{ path: '/__payjoin_smoke', element: <PayjoinSmoke /> }`
   as a **sibling root route** (outside `<Layout />`) in
   `src/routes/router.tsx` so the smoke is decoupled from wallet/LDK
   boot.
4. Push the branch (`payjoin-fork-smoke`) to GitHub; rely on Vercel's
   automatic preview deployment for that branch.
5. Manually verify the route in 4 environments. Fill in the report
   template (below) and send it + the Vercel preview URL to the fork
   author.
6. **Do NOT** open a PR. **Do NOT** merge to main.

## Technical Considerations

### Why `/web-vite` (not `/web`)
Both exports target the browser; the only difference is `/web-vite`
appends `?url` to the wasm import for Vite's native asset URL
pipeline. Our build IS Vite — using `/web` would force
`vite-plugin-wasm` to intercept the bare `.wasm` import, which is
exactly the failure mode the previous integration's sed patch fixed.
Use `/web-vite`.

### Vite plugin compatibility
`vite-plugin-wasm` and `vite-plugin-top-level-await` are still
registered at `vite.config.ts:59-60`. Neither intercepts a
`?url`-suffixed wasm import — `?url` resolves through Vite's static
asset pipeline before either plugin sees it. **No `vite.config.ts`
changes required.**

### CSP
Both `vercel.json:31` and `index.html:13` already include
`script-src 'self' 'wasm-unsafe-eval'`. The smoke makes no outbound
network calls; the wasm loads from same-origin via Vite's asset
pipeline. **No CSP changes required.**

### Service worker / Workbox interaction
`vite.config.ts:85-102` excludes `**/*.wasm` from precaching and
applies a `NetworkFirst` runtime cache rule. On Vercel preview the SW
may cache the fetched wasm. If the fork republishes mid-test,
hard-reload to invalidate. Not a smoke-test blocker, but call it out
in the report if iteration is needed.

### Lazy loading
The PDK wasm is ~1–2 MB. `import()` MUST be inside the component
effect, not at module top level — so unrelated routes' bundles aren't
inflated, and a fork-side breakage doesn't prevent the rest of the
app from booting.

### Route placement: sibling vs child of Layout
Adding the route under `<Layout />` would render the smoke inside the
wallet shell (LDK boot, balance bar, nav). A top-level sibling route
isolates the test to the PDK loader specifically and makes failures
unambiguous. **Recommendation: sibling route.**

### Real PDK call — what to invoke
Pick one synchronous, no-network PDK symbol. **Recommend
`Uri.parse(<fixture BIP 21 with pj=>)`**:

- Smallest fixture surface (a string literal — no PSBT shape to get
  wrong).
- Exercises the binding checksum table and one type construction —
  enough to flush wasm/binding mismatches.
- Throws on parse failure → unambiguous fail signal.
- Returns a `Uri` object on success → unambiguous ok signal.

`SenderBuilder.fromPsbtAndUri` is meatier but requires a valid PSBT
fixture, which is hard to produce statically and easy to get wrong —
a fixture-shape failure would mask a real loader failure. Skip it
for the smoke; restoration plan can wire it via real send flow.

**Confirm exact symbol path** at impl time by reading
`node_modules/@xstoicunicornx/payjoin/dist/web/bindings/payjoin.d.ts`
— likely `mod.default.payjoin.uri.Uri.parse(...)` or
`mod.payjoin.uri.Uri.parse(...)`.

## System-Wide Impact

### Interaction graph
React Router → Smoke route element → `useEffect` → dynamic `import()`
→ wasm fetch (possibly intercepted by SW) → `WebAssembly.instantiate`
→ uniffi binding init → `Uri.parse(fixture)` → render. **No
interaction with LDK, channel manager, persistence, sync, or any
other repo subsystem** — sibling-of-Layout placement enforces this.

### Error propagation
Three failure surfaces, all caught locally:
1. Module `import()` rejects → `{ kind: 'error', stage: 'import' }`.
2. `uniffiInitAsync()` rejects → `{ kind: 'error', stage: 'init' }`.
3. `Uri.parse` throws → `{ kind: 'error', stage: 'pdk-call' }`.

All three caught with `try/catch` in the component effect. None
propagate further. The `<pre>` block renders the full stack so the
operator can copy/paste back to the fork author verbatim.

### State lifecycle risks
None. Component holds local state only. No persistence, no side
effects beyond the dynamic import. `cancelled` flag in the effect
guards against state-after-unmount.

### API surface parity
N/A — single throwaway page.

### Integration test scenarios
None automated. Manual verification only across 4 environments (see
Acceptance Criteria).

## Acceptance Criteria

### Code
- [ ] `package.json` has `"@xstoicunicornx/payjoin": "0.0.4"` (exact,
      no caret) under `dependencies`. `pnpm-lock.yaml` updated.
- [ ] `src/pages/PayjoinSmoke.tsx` exists. Lazy-imports
      `@xstoicunicornx/payjoin/web-vite` inside `useEffect`. Calls
      `uniffiInitAsync()`. Calls one synchronous PDK constructor
      (recommend `Uri.parse`). Renders pending / ok / error states
      with full error stack on failure.
- [ ] `src/routes/router.tsx` registers
      `{ path: '/__payjoin_smoke', element: <PayjoinSmoke /> }` as a
      **sibling root route** alongside the existing `{ path: '/',
      element: <Layout />, ... }` entry — NOT as a child of Layout.
- [ ] BIP 321 fixture URI defined inline in the smoke component (or
      in `src/pages/__fixtures__/payjoin-smoke.ts`). Comment cites
      its source (e.g. "from
      `vendor/rust-payjoin/.../tests/fixtures/...` at the
      previously-vendored revision" or a known PDK test vector).
- [ ] **No restoration** of any code from commits `67e2220` /
      `2f846d4`: no proxy, no validator, no `transformPsbt` hook, no
      `Send.tsx` changes, no CSP `connect-src` additions, no env
      vars.
- [ ] **No changes** to `vite.config.ts`, `vercel.json`, or
      `index.html`.

### Process
- [ ] Branch name: `payjoin-fork-smoke`. Pushed to `origin`.
- [ ] Vercel preview URL captured.
- [ ] **No PR opened.** **No merge to main.**

### Manual verification (all four required)
- [ ] Vite dev (`pnpm dev`) — Chrome desktop. Navigate to
      `/__payjoin_smoke`, observe `ok` state, no console errors.
- [ ] Vite production preview (`pnpm build && pnpm preview`) — Chrome
      desktop. Same checks.
- [ ] Vercel preview deployment — Chrome desktop. Same checks.
- [ ] Vercel preview deployment — **iOS Safari on a real device**
      (not the simulator; sim Safari has different WASM JIT
      behavior). Capture iOS version in the report.

### Report
- [ ] Markdown report block (template below) filled in and sent to
      the fork author along with the Vercel preview URL.

## Success Metrics

- All four environments render `ok` without operator intervention.
- Zero console errors during init or PDK call.
- Round-trip from "branch pushed" to "report sent to fork author" is
  under 30 minutes.
- Fork author can act on the report (yes/no signal + any error
  stacks) without follow-up clarification.

## Dependencies & Risks

### Dependencies
- Vercel project must auto-deploy preview branches (current setup
  does — confirmed via recent PR commits showing preview links).
- An iOS device on iOS 16.4+ with Safari for the mobile leg. Sim is
  not a substitute.

### Risks

1. **Personal-fork supply chain**. We're depending on
   `@xstoicunicornx/payjoin@0.0.4`, a personal-fork pre-1.0 package.
   Mitigated by:
   - Pinning exact version (no auto-updates).
   - Branch never merges to main.
   - Plan to swap back to upstream `payjoin` once the fork's PR is
     accepted upstream.

2. **`name: "payjoin"` inside the published tarball**. The fork's
   `package.json` declares `"name": "payjoin"` (not the scoped name).
   The npm registry uses the scoped name `@xstoicunicornx/payjoin`,
   so install resolves correctly. Verified via direct tarball
   inspection. Low risk; called out in case a lockfile resolver
   surprises us.

3. **Workbox cache poisoning**. If the fork republishes mid-test,
   the SW may serve a stale wasm on Vercel preview. Mitigation:
   hard-refresh (Cmd-Shift-R) between iterations, or use an
   incognito window.

4. **iOS Safari WASM quirks**. iOS 16.4+ supports streaming
   instantiation; older versions may fall back. Capture the iOS
   version in the report block. Reference:
   `docs/solutions/integration-issues/pwa-workbox-vercel-csp-integration.md`.

5. **PDK API drift**. If the fork rev'd the binding namespace shape
   between 0.0.4 and the README, our chosen symbol path may not
   exist. **Mitigation: confirm symbol against
   `node_modules/@xstoicunicornx/payjoin/dist/web/bindings/payjoin.d.ts`
   before writing the call.**

6. **Layout coupling**. If the smoke route is accidentally placed
   inside `<Layout />`, wallet/LDK boot failures would mask PDK
   failures. **Mitigation: explicit acceptance criterion (sibling
   root route, not child).**

### Out of scope (deferred to follow-up plan if smoke passes)

- BIP 77 v2 sender restoration (`tryPayjoinSend`)
- OHTTP relay proxy (`api/payjoin-proxy.ts`) and Vite dev proxy
- Defense-in-depth proposal validator (7 checks)
- `transformPsbt` hook wiring in `buildSignBroadcast`
- `Send.tsx` integration + abort signal composition + telemetry
- CSP `connect-src` additions for OHTTP relays
- `PAYJOIN_PROXY_ENABLED` server-side kill switch
- Removal of `@xstoicunicornx/payjoin` and re-pointing at upstream
  `payjoin` once the fork's PR merges upstream

If smoke passes, the follow-up plan can largely be `git revert
91f9b75` + swap import paths from `payjoin` →
`@xstoicunicornx/payjoin/web-vite` + delete the
`scripts/build-payjoin-bindings.sh`/`scripts/vercel-install.sh` and
submodule restoration parts of the revert.

## Implementation Sketch

### `src/pages/PayjoinSmoke.tsx`
```tsx
import { useEffect, useState } from 'react'

const FIXTURE_BIP21_WITH_PJ =
  'bitcoin:bc1q...?amount=0.0001&pj=https://example.com/payjoin'

type Status =
  | { kind: 'pending' }
  | { kind: 'ok'; detail: string }
  | { kind: 'error'; stage: 'import' | 'init' | 'pdk-call'; detail: string }

export default function PayjoinSmoke() {
  const [status, setStatus] = useState<Status>({ kind: 'pending' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let mod: typeof import('@xstoicunicornx/payjoin/web-vite')
      try {
        mod = await import('@xstoicunicornx/payjoin/web-vite')
      } catch (e) {
        if (!cancelled) setStatus({ kind: 'error', stage: 'import', detail: stackOf(e) })
        return
      }
      try {
        await mod.uniffiInitAsync()
      } catch (e) {
        if (!cancelled) setStatus({ kind: 'error', stage: 'init', detail: stackOf(e) })
        return
      }
      try {
        // Confirm exact path from .d.ts at impl time.
        const uri = mod.default.payjoin.uri.Uri.parse(FIXTURE_BIP21_WITH_PJ)
        if (!cancelled) setStatus({ kind: 'ok', detail: String(uri) })
      } catch (e) {
        if (!cancelled) setStatus({ kind: 'error', stage: 'pdk-call', detail: stackOf(e) })
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <main style={{ padding: 16, fontFamily: 'monospace' }}>
      <h1>Payjoin Fork Smoke Test</h1>
      <p>Package: @xstoicunicornx/payjoin@0.0.4</p>
      <p>Entry: /web-vite</p>
      <pre>{JSON.stringify(status, null, 2)}</pre>
    </main>
  )
}

function stackOf(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e)
}
```

### `src/routes/router.tsx` (diff)
```diff
 export const router = createBrowserRouter([
   {
     path: '/',
     element: <Layout />,
     children: [
       // ... existing children unchanged
     ],
   },
+  { path: '/__payjoin_smoke', element: <PayjoinSmoke /> },
 ])
```

### Report template (paste into comment to fork author)

```
## @xstoicunicornx/payjoin@0.0.4 smoke test results — Zinqq

| Environment                    | uniffiInitAsync | Uri.parse fixture | Notes |
|--------------------------------|-----------------|-------------------|-------|
| Vite dev (Chrome)              |                 |                   |       |
| Vite production preview (Chrome) |               |                   |       |
| Vercel preview (Chrome)        |                 |                   |       |
| Vercel preview (iOS Safari)    |                 |                   | iOS X.Y |

Vercel preview URL: <link>

Confirmed no build hacks needed:
- ✅ No sed on `ubrn.config.yaml` target (default `--target web` works)
- ✅ No sed on `dist/index.web.js` (`?url` already baked into `/web-vite`)
- ✅ No vendored submodule
- ✅ No custom Vercel `installCommand`
- ✅ No `wasm-bindgen-cli` pin or LLVM/brew install

Vite plugins present and compatible:
- `vite-plugin-wasm` (no conflict with `?url` imports)
- `vite-plugin-top-level-await`

CSP unchanged — already includes `script-src 'self' 'wasm-unsafe-eval'`.

<error stacks pasted here if any environment failed>
```

## Sources & References

### Origin
- **Brainstorm:** [`docs/brainstorms/2026-04-30-payjoin-fork-smoke-test-brainstorm.md`](../brainstorms/2026-04-30-payjoin-fork-smoke-test-brainstorm.md). Carried forward: (1) smoke-test scope only, no full restoration; (2) `@xstoicunicornx/payjoin@0.0.4` exact pin via `/web-vite` entry; (3) feature branch + Vercel preview, no merge; (4) loader + real PDK call; (5) 4-environment manual matrix.

### Internal references
- Routing: `src/routes/router.tsx:19-41`
- Vite plugins / Workbox WASM rules: `vite.config.ts:4-5,59-60,85-102,112`
- CSP (server): `vercel.json:30-31`
- CSP (HTML meta): `index.html:13`
- Package manager pin: `package.json:6` (`pnpm@10.32.1`)
- Past payjoin integration removed: commit `91f9b75` (Apr 30 2026)
- Past PDK loader (deleted): `src/onchain/payjoin/pdk.ts` at commit `2f846d4`
- Past sed hacks (deleted): `scripts/build-payjoin-bindings.sh` at commit `2f846d4`

### Institutional learnings
- [`docs/solutions/integration-issues/pwa-workbox-vercel-csp-integration.md`](../solutions/integration-issues/pwa-workbox-vercel-csp-integration.md) — CSP + WASM instantiation requirements (still applies).
- [`docs/solutions/integration-issues/qr-scanner-camera-send-flow-integration.md`](../solutions/integration-issues/qr-scanner-camera-send-flow-integration.md) — WASM-wrapped objects don't survive `structuredClone`. Guardrail: keep PDK objects local to the smoke component, never put them in router state or history.

### External references
- Fork branch: `https://github.com/xstoicunicornx/rust-payjoin/tree/js-web-bindings`
- Fork JS bindings README:
  `https://github.com/xstoicunicornx/rust-payjoin/blob/js-web-bindings/payjoin-ffi/javascript/README.md`
- Published package:
  `https://www.npmjs.com/package/@xstoicunicornx/payjoin`
- Tarball inspection confirms `dist/web/vite.index.js` bakes in the
  `?url` fix (lines 8–13 of vite.index.js).

### Related work
- Issue #269 (original PDK browser loader design — resolved by
  `2f846d4`, then deleted in `91f9b75`).
- Brainstorm: [`docs/brainstorms/2026-04-23-payjoin-send-brainstorm.md`](../brainstorms/2026-04-23-payjoin-send-brainstorm.md) (earlier scope, full sender flow).
- Plan: [`docs/plans/2026-04-23-001-feat-payjoin-send-support-plan.md`](2026-04-23-001-feat-payjoin-send-support-plan.md) (parent integration plan, currently paused).
