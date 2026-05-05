/**
 * LQwD Germany LSP discovery.
 *
 * Fetches `https://germany.lqwd.tech/api/v1/get_info` once per page
 * lifetime and parses `uris[0]` into an LspContact. Resolved value is
 * memoised; rejection clears the memo so a subsequent call can retry.
 *
 * The HTTP fetch is best-effort: callers MUST treat rejection as
 * "primary unavailable, use fallback" rather than a fatal error.
 */

import type { LspContact } from './contacts'

const LQWD_GET_INFO_URL = 'https://germany.lqwd.tech/api/v1/get_info'

const FETCH_TIMEOUT_MS = 3_000

// Validates `<66hex>@<host>:<port>`. Host is permissive (any non-colon
// chars) so IPv4 dotted, hostnames, and IPv6 in brackets all match —
// LDK's PeerManager.connect handles host parsing downstream.
const URI_RE = /^([0-9a-f]{66})@([^:]+):(\d+)$/

let inflight: Promise<LspContact> | null = null

export function fetchLqwdContact(): Promise<LspContact> {
  if (inflight) return inflight
  const promise = (async (): Promise<LspContact> => {
    const res = await fetch(LQWD_GET_INFO_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      throw new Error(`LQwD /get_info responded ${res.status}`)
    }
    const json = (await res.json()) as { uris?: unknown }
    if (!Array.isArray(json.uris) || json.uris.length === 0) {
      throw new Error('LQwD /get_info missing or empty uris')
    }
    const first: unknown = json.uris[0]
    if (typeof first !== 'string') {
      throw new Error('LQwD /get_info uris[0] is not a string')
    }
    const match = URI_RE.exec(first)
    if (!match) {
      throw new Error(`LQwD /get_info uris[0] shape unexpected: ${first}`)
    }
    const port = Number(match[3])
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error(`LQwD /get_info port out of range: ${match[3]}`)
    }
    return {
      nodeId: match[1],
      host: match[2],
      port,
      token: null,
      label: 'lqwd',
    }
  })()
  // Reset memo on rejection so transient failures can be retried by
  // a later caller within the same session.
  promise.catch(() => {
    if (inflight === promise) inflight = null
  })
  inflight = promise
  return promise
}

/** Test-only: clear the memoised promise. Not exported to barrel. */
export function __resetForTests(): void {
  inflight = null
}
