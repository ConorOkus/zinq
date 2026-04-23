---
date: 2026-04-23
topic: payjoin-send
---

# Payjoin Send Support

## What We're Building

Zinqq will support **sending** Payjoin transactions — both BIP 78 (v1, synchronous) and BIP 77 (v2, async via relay/directory). When a user scans or pastes a BIP 321 URI that includes a `pj=` parameter, Zinqq will automatically run the Payjoin exchange with the receiver, validate the modified PSBT, and broadcast the result. If anything goes wrong, it falls back to a normal on-chain broadcast so the payment still succeeds.

Receiving Payjoin is **out of scope** for this effort.

## Why This Approach

The user's goals are **privacy by default** and **opportunistic compatibility** — two motivations that both point to: don't silently ignore `pj=` anymore, and don't make Payjoin a user-facing feature they have to think about. That drove the following combination:

- **v1 + v2 together**: Payjoin libraries bundle both; splitting adds work without reward. v2 reaches mobile-wallet receivers; v1 reaches BTCPay Server and static merchant endpoints. Supporting only one leaves meaningful recipients unreachable.
- **Fully silent UX**: no badge, no toggle, no first-use modal. The user sends; Payjoin either happens or it doesn't, transparently.
- **Auto-fallback on failure**: unreachable endpoints, timeouts, malformed responses, and receivers proposing unreasonable fees all degrade to a normal on-chain broadcast. Privacy benefit lost for that send; payment still lands.
- **Fee cap on receiver proposals**: prevents a malicious or misconfigured receiver from inflating fees arbitrarily. If the modified PSBT's fee exceeds the cap, treat it as Payjoin failure and fall back.

## Key Decisions

- **Scope**: Sender only. No receive support. On-chain only (no Lightning variants).
- **Protocol**: BIP 78 + BIP 77, single shipment (one PR/plan).
- **URI handling**: Extend `parseBip321()` in `src/ldk/payment-input.ts` to recognize `pj=` and `pjos=`. Currently these are silently dropped.
- **Trigger**: Automatic when `pj=` is present on an on-chain BIP 321 URI. No user toggle.
- **Review screen**: Unchanged — no Payjoin indicator. The existing review screen shows the pre-Payjoin fee; final fee may be slightly higher after the receiver's modification (bounded by the fee cap).
- **Failure policy**: Auto-fallback to broadcasting the original non-Payjoin transaction. `pjos=0` (strict Payjoin) is out of scope for the first cut — treated the same as `pjos=1`.
- **Fee safety**: Reject receiver-proposed PSBT if its fee exceeds a cap above the original. Exact cap (percentage and/or absolute) TBD in the plan.
- **Target platform**: PWA, BDK 0.3 WASM, existing Vercel proxy for cross-origin HTTP (already proven for LNURL).

## Out of Scope (Explicit)

- Receiving Payjoin (reviewer role).
- Enforcing `pjos=0` strict mode.
- User-facing Payjoin education, settings, or history indicators.
- Multi-party / batched Payjoin sends.
- Lightning Payjoin / PayJoin-over-LN variants.

## Resolved Questions

- **Fee cap shape**: Percentage cap on the receiver-proposed fee relative to the original. Concrete percentage tuned in the plan; the shape is fixed.
- **v2 session persistence**: Session-only for the first cut. If the app closes mid-negotiation, fall back to normal broadcast on reopen. No IndexedDB persistence, no pending-send indicator.

## Open Questions (deferred to `/ce:plan`)

- **Library choice**: Payjoin Dev Kit (Rust → WASM) vs. hand-rolled TS implementation. PDK handles PSBT validation rules correctly; hand-rolled is risky because receiver-added input validation is subtle.
- **Fee cap value**: the actual percentage (e.g. 1.5×) and whether there's also an absolute floor for very small txs.
- **v2 relay/directory default**: which relay to point at, and whether it's configurable.
- **CORS proxy**: `pj=` endpoints are arbitrary third-party URLs. Does the existing `/api/lnurl-proxy` generalize, or do we add a dedicated `/api/payjoin-proxy`?
- **Timeouts**: v1 synchronous request timeout; v2 polling cadence and total wait before fallback.
- **Test vectors**: which reference implementation to cross-test against (BTCPay Server v1, PDK v2 relay).

## Next Steps

→ `/ce:plan docs/brainstorms/2026-04-23-payjoin-send-brainstorm.md`
