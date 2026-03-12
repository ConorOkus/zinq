---
title: 'feat: WebSocket-to-TCP proxy on Cloudflare Workers'
type: feat
status: completed
date: 2026-03-12
origin: docs/brainstorms/2026-03-12-websocket-proxy-infrastructure-brainstorm.md
---

# feat: WebSocket-to-TCP Proxy on Cloudflare Workers

## Overview

Build and deploy a self-hosted WebSocket-to-TCP proxy as a Cloudflare Worker that enables the browser-based LDK wallet to connect to Lightning peers. The proxy is a stateless byte forwarder — all Lightning traffic is BOLT 8 Noise encrypted end-to-end, making the proxy zero-trust by design (see brainstorm: docs/brainstorms/2026-03-12-websocket-proxy-infrastructure-brainstorm.md).

## Problem Statement

The browser wallet currently depends on `wss://p.mutinynet.com`, a community-run MutinyWallet proxy with no SLA, no access control, and no guarantee of availability. For production use, the wallet needs its own proxy infrastructure with origin-based access restrictions, SSRF protection, and operational reliability.

Browsers cannot open raw TCP sockets, so a WebSocket-to-TCP bridge is the only viable approach for Lightning peer connectivity from the browser (see brainstorm: alternatives analysis ruled out WebRTC, WebTransport, TURN, and AWS Lambda).

## Proposed Solution

A lightweight TypeScript Cloudflare Worker (~50 lines of core logic) that:

1. Accepts WebSocket connections at `/v1/{host_underscored}/{port}`
2. Validates the `Origin` header against an allowlist
3. Validates the target (port restriction, SSRF protection)
4. Opens a TCP connection via Cloudflare's `connect()` API
5. Pipes bytes bidirectionally between WebSocket and TCP
6. Cleans up both sides on disconnect

The Worker lives in `proxy/` within this repo and deploys independently via Wrangler with two environments: dev (allows `localhost`) and production (locked to wallet domain).

## Technical Approach

### Architecture

```
Browser (LDK/WASM)                 Cloudflare Worker              Lightning Node
     |                                    |                            |
     |--- WSS upgrade (/v1/host/port) --->|                            |
     |                                    |-- validate origin -------->|
     |                                    |-- validate target -------->|
     |                                    |--- TCP connect(host:port) ->|
     |                                    |                            |
     |<======= BOLT 8 Noise encrypted traffic (opaque to proxy) ======>|
     |                                    |                            |
     |--- WS close ------------------>|                            |
     |                                    |--- TCP close ------------->|
```

### Implementation Phases

#### Phase 1: Core Proxy Worker

Create the `proxy/` directory with the Worker implementation.

**Files to create:**

- `proxy/package.json` — Worker dependencies (wrangler, TypeScript, vitest)
- `proxy/tsconfig.json` — TypeScript config targeting Cloudflare Workers runtime
- `proxy/wrangler.toml` — Worker configuration with dev and production environments
- `proxy/src/index.ts` — Main Worker entry point (request handler, WebSocket upgrade, TCP pipe)
- `proxy/src/validation.ts` — Origin validation, target validation (port, SSRF), URL parsing
- `proxy/src/constants.ts` — Blocked IP ranges, allowed ports, default config values
- `proxy/vitest.config.ts` — Test configuration

**`proxy/wrangler.toml` structure:**

```toml
name = "ln-ws-proxy"
main = "src/index.ts"
compatibility_date = "2026-03-01"

[vars]
ALLOWED_PORTS = "9735"
MAX_MESSAGE_SIZE = "65536"

[env.dev]
name = "ln-ws-proxy-dev"
[env.dev.vars]
ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"

[env.production]
name = "ln-ws-proxy-production"
[env.production.vars]
ALLOWED_ORIGINS = ""  # Set to wallet production domain when known
```

**`proxy/src/index.ts` — core logic:**

```typescript
// proxy/src/index.ts
import { validateOrigin, validateTarget, parseProxyPath } from './validation'

interface Env {
  ALLOWED_ORIGINS: string
  ALLOWED_PORTS: string
  MAX_MESSAGE_SIZE: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only handle WebSocket upgrade requests
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    // Validate origin before doing any work
    const origin = request.headers.get('Origin')
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    if (!validateOrigin(origin, allowedOrigins)) {
      return new Response('Forbidden', { status: 403 })
    }

    // Parse and validate target from URL path
    const url = new URL(request.url)
    const target = parseProxyPath(url.pathname)
    if (!target) {
      return new Response('Invalid path. Expected /v1/{host}/{port}', { status: 400 })
    }

    const allowedPorts = env.ALLOWED_PORTS.split(',').map(s => parseInt(s.trim(), 10))
    const maxMessageSize = parseInt(env.MAX_MESSAGE_SIZE, 10)

    const targetError = validateTarget(target.host, target.port, allowedPorts)
    if (targetError) {
      return new Response(targetError, { status: 400 })
    }

    // Open TCP connection to Lightning node
    let tcp: Socket
    try {
      tcp = connect({ hostname: target.host, port: target.port })
    } catch {
      return new Response('TCP connection failed', { status: 502 })
    }

    // Create WebSocket pair
    const [client, server] = Object.values(new WebSocketPair())
    server.accept()

    // Pipe: WebSocket -> TCP
    server.addEventListener('message', (event) => {
      const data = event.data
      if (data instanceof ArrayBuffer && data.byteLength > maxMessageSize) {
        server.close(1009, 'Message too large')
        tcp.close()
        return
      }
      const writer = tcp.writable.getWriter()
      writer.write(data instanceof ArrayBuffer ? new Uint8Array(data) : new TextEncoder().encode(data))
      writer.releaseLock()
    })

    server.addEventListener('close', () => {
      tcp.close()
    })

    server.addEventListener('error', () => {
      tcp.close()
    })

    // Pipe: TCP -> WebSocket
    tcp.readable.pipeTo(new WritableStream({
      write(chunk) {
        if (server.readyState === WebSocket.OPEN) {
          server.send(chunk)
        }
      },
      close() {
        if (server.readyState === WebSocket.OPEN) {
          server.close(1000, 'TCP connection closed')
        }
      },
      abort() {
        if (server.readyState === WebSocket.OPEN) {
          server.close(1011, 'TCP connection error')
        }
      },
    })).catch(() => {
      // TCP read error — close WebSocket if still open
      if (server.readyState === WebSocket.OPEN) {
        server.close(1011, 'TCP connection error')
      }
    })

    return new Response(null, { status: 101, webSocket: client })
  },
}
```

**`proxy/src/validation.ts` — security logic:**

```typescript
// proxy/src/validation.ts

// RFC 1918, RFC 6598 (CGNAT), loopback, link-local, broadcast
const BLOCKED_IPV4_RANGES = [
  { prefix: '10.', mask: null },         // 10.0.0.0/8
  { prefix: '172.', rangeStart: 16, rangeEnd: 31 }, // 172.16.0.0/12
  { prefix: '192.168.', mask: null },    // 192.168.0.0/16
  { prefix: '127.', mask: null },        // 127.0.0.0/8
  { prefix: '169.254.', mask: null },    // 169.254.0.0/16 link-local
  { prefix: '0.', mask: null },          // 0.0.0.0/8
  { prefix: '100.64.', mask: null },     // 100.64.0.0/10 (simplified)
  { prefix: '100.65.', mask: null },
  // ... remaining 100.64-100.127 ranges
]

export function validateOrigin(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false
  return allowed.includes(origin)
}

export interface ProxyTarget {
  host: string
  port: number
}

export function parseProxyPath(pathname: string): ProxyTarget | null {
  // Expected: /v1/{host_underscored}/{port}
  const match = pathname.match(/^\/v1\/([^/]+)\/(\d+)$/)
  if (!match) return null

  const host = match[1].replace(/_/g, '.')
  const port = parseInt(match[2], 10)

  if (isNaN(port) || port < 1 || port > 65535) return null

  return { host, port }
}

export function validateTarget(
  host: string,
  port: number,
  allowedPorts: number[]
): string | null {
  // Port restriction
  if (!allowedPorts.includes(port)) {
    return `Port ${port} not allowed. Allowed: ${allowedPorts.join(', ')}`
  }

  // Reject .onion addresses (Cloudflare cannot resolve Tor)
  if (host.endsWith('.onion')) {
    return 'Tor .onion addresses are not supported'
  }

  // SSRF: block private IPs if target looks like an IP address
  if (isPrivateIP(host)) {
    return 'Connection to private IP ranges is not allowed'
  }

  return null
}

function isPrivateIP(host: string): boolean {
  // Check if host is an IPv4 address
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!ipv4Match) return false // hostname — cannot validate until DNS resolves

  const octets = ipv4Match.slice(1).map(Number)
  const [a, b] = octets

  if (a === 10) return true                        // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true          // 192.168.0.0/16
  if (a === 127) return true                       // 127.0.0.0/8
  if (a === 169 && b === 254) return true          // 169.254.0.0/16
  if (a === 0) return true                         // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10
  if (a === 255) return true                       // broadcast

  return false
}
```

**Key design decisions for Phase 1:**

- **Error responses before WebSocket upgrade**: Return HTTP 400/403/502 status codes *before* completing the WebSocket upgrade. This means the browser fires `onerror` (not `onclose`), and the wallet's existing error handling in `peer-connection.ts` will surface these as connection failures.
- **Message size → close connection**: When a message exceeds 64KB, close the entire connection (code 1009). Dropping a single message would corrupt the BOLT 8 Noise cipher state.
- **SSRF validation on IP addresses only**: For hostname targets (e.g., `node.example.com`), SSRF validation cannot happen before DNS resolution. Cloudflare's `connect()` API does not expose the resolved IP. Accept this limitation — DNS rebinding attacks against a port-9735-restricted proxy are extremely low risk.
- **IPv6 out of scope**: The current URL encoding (`dots → underscores`) does not handle IPv6 colons. Defer IPv6 support — the vast majority of Lightning nodes are reachable via IPv4 or hostname.
- **Tor `.onion` rejected with clear error**: Cloudflare cannot resolve `.onion` addresses. Reject early with a descriptive message rather than letting `connect()` fail opaquely.

#### Phase 2: Tests

**Files to create:**

- `proxy/src/validation.test.ts` — Unit tests for origin, target, and URL parsing validation
- `proxy/src/index.test.ts` — Integration tests for the Worker using Miniflare

**Test cases for `validation.test.ts`:**

```
parseProxyPath:
  ✓ parses valid path /v1/1_2_3_4/9735 → { host: '1.2.3.4', port: 9735 }
  ✓ parses hostname /v1/node_example_com/9735 → { host: 'node.example.com', port: 9735 }
  ✓ rejects missing version prefix /1_2_3_4/9735 → null
  ✓ rejects missing port /v1/1_2_3_4 → null
  ✓ rejects non-numeric port /v1/1_2_3_4/abc → null
  ✓ rejects extra path segments /v1/1_2_3_4/9735/extra → null

validateOrigin:
  ✓ allows matching origin
  ✓ rejects non-matching origin
  ✓ rejects null origin
  ✓ rejects empty string origin
  ✓ does not allow substring match (http://localhost vs http://localhost.evil.com)

validateTarget:
  ✓ allows port 9735
  ✓ rejects port 80
  ✓ rejects port 22
  ✓ blocks 10.x.x.x
  ✓ blocks 172.16-31.x.x
  ✓ blocks 192.168.x.x
  ✓ blocks 127.x.x.x
  ✓ blocks 169.254.x.x (link-local)
  ✓ blocks 0.x.x.x
  ✓ blocks 100.64-127.x.x (CGNAT)
  ✓ allows public IP 8.8.8.8
  ✓ allows hostname (cannot validate DNS — passes through)
  ✓ rejects .onion addresses
```

**Test cases for `index.test.ts` (Miniflare integration):**

```
Worker:
  ✓ returns 426 for non-WebSocket requests
  ✓ returns 403 for unauthorized origin
  ✓ returns 400 for invalid path
  ✓ returns 400 for blocked port
  ✓ returns 400 for private IP target
  ✓ establishes WebSocket for valid request (mocked TCP)
  ✓ forwards data bidirectionally (mocked TCP)
  ✓ closes WebSocket when TCP closes
  ✓ closes TCP when WebSocket closes
  ✓ closes connection on oversized message (1009)
```

#### Phase 3: Wallet Integration

Update the wallet to support configurable proxy URLs.

**Files to modify:**

- `src/ldk/config.ts` — Make `wsProxyUrl` environment-aware
- `index.html` — Update CSP `connect-src`

**`src/ldk/config.ts` changes:**

```typescript
// Add self-hosted proxy URL alongside existing Mutiny proxy
export const SIGNET_CONFIG = {
  // ... existing fields ...
  wsProxyUrl: import.meta.env.VITE_WS_PROXY_URL || 'wss://p.mutinynet.com',
  // ...
} as const
```

This allows:
- Development: `VITE_WS_PROXY_URL=wss://ln-ws-proxy-dev.<account>.workers.dev` in `.env.development`
- Production: `VITE_WS_PROXY_URL=wss://ln-ws-proxy-production.<account>.workers.dev` in `.env.production`
- Fallback: Public Mutiny proxy if no env var set

**`index.html` CSP update:**

Replace the pinned `wss://p.mutinynet.com` with the self-hosted Worker domain. During development, use a more permissive CSP or set it via Vite's HTML transform.

**No changes needed to `src/ldk/peers/peer-connection.ts`** — the URL format `/v1/{host_underscored}/{port}` is compatible (see brainstorm: Key Decision #3).

#### Phase 4: Deployment

**Steps:**

1. `cd proxy && pnpm install`
2. `npx wrangler login` — authenticate with Cloudflare
3. `npx wrangler deploy --env dev` — deploy dev Worker
4. `npx wrangler deploy --env production` — deploy production Worker
5. Test by updating `VITE_WS_PROXY_URL` to the dev Worker URL and connecting to a peer
6. Verify origin validation by testing from an unauthorized origin (should get 403)

**Deployment notes:**
- Workers deploy to all 300+ edge locations automatically
- The `*.workers.dev` subdomain is available immediately
- Custom domain can be added later via Cloudflare DNS

## System-Wide Impact

### Interaction Graph

```
User clicks "Connect" → connectToPeer() → new WebSocket(proxyUrl/v1/host/port)
  → Cloudflare Worker receives upgrade request
    → validates origin header
    → validates target (port, SSRF)
    → connect() opens TCP to Lightning node
    → pipes bytes: WS ↔ TCP
  → browser receives WS upgrade response
  → LDK PeerManager.new_outbound_connection() → Noise handshake
  → PeerManager.read_event() on incoming data
  → peer appears in list_peers()
```

### Error Propagation

| Error Source | Worker Response | Wallet Behavior |
|---|---|---|
| Invalid origin | HTTP 403 (pre-upgrade) | `ws.onerror` → promise rejects → "Connection failed" |
| Invalid path/port | HTTP 400 (pre-upgrade) | `ws.onerror` → promise rejects → "Connection failed" |
| Private IP (SSRF) | HTTP 400 (pre-upgrade) | `ws.onerror` → promise rejects → "Connection failed" |
| TCP connect refused | HTTP 502 (pre-upgrade) | `ws.onerror` → promise rejects → "Connection failed" |
| TCP connect timeout | Cloudflare kills request | `ws.onerror` → promise rejects → "Connection failed" |
| Message too large | WS close 1009 | `ws.onclose` → `socket_disconnected()` |
| TCP disconnects | WS close 1000 | `ws.onclose` → `socket_disconnected()` |
| Worker restart | WS drops | `ws.onclose` → `socket_disconnected()` |

### State Lifecycle Risks

- **No persistent state**: The proxy is entirely stateless. No database, no KV, no sessions. Each connection is independent.
- **No orphaned state possible**: If the Worker crashes, both the WebSocket and TCP socket are cleaned up by the runtime.
- **Rate limiting counters are ephemeral**: In-memory counters reset on isolate eviction. This is by design — best-effort rate limiting only.

### API Surface Parity

The proxy exposes a single API surface: `wss://{worker}/v1/{host_underscored}/{port}`. This is identical to the MutinyWallet proxy format. No changes to the wallet's `peer-connection.ts` are required.

## Acceptance Criteria

### Functional Requirements

- [x] Worker accepts WebSocket upgrade at `/v1/{host_underscored}/{port}` and pipes bytes to TCP
- [x] Returns HTTP 403 for unauthorized origins (before WebSocket upgrade)
- [x] Returns HTTP 400 for invalid paths, blocked ports, private IPs, and .onion addresses
- [x] Returns HTTP 502 when TCP connection to target fails
- [x] Closes connection with code 1009 when message exceeds 64KB
- [x] Closes TCP when WebSocket closes, and vice versa
- [x] Dev environment allows `localhost` origins; production is locked to wallet domain

### Non-Functional Requirements

- [x] All validation happens before opening TCP connection (fail fast)
- [x] SSRF protection blocks RFC 1918, RFC 6598, loopback, link-local, and broadcast ranges
- [ ] Worker deploys to Cloudflare's global edge network (requires `wrangler deploy`)
- [ ] Wallet successfully connects to a Signet Lightning peer through the self-hosted proxy (requires deployment)

### Quality Gates

- [x] Unit tests pass for all validation logic (origin, target, URL parsing)
- [x] Integration tests pass with mocked TCP connections
- [ ] Manual test: connect to a real Signet peer through the deployed dev Worker (requires deployment)
- [ ] Manual test: verify 403 response from unauthorized origin (requires deployment)

## Dependencies & Risks

### Dependencies

- **Cloudflare Workers Paid plan** ($5/month) — required for the `connect()` TCP API
- **Wrangler CLI** — for deployment
- **Cloudflare account** — for Workers access

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cloudflare runtime restarts drop connections | Certain (~weekly) | Low | Client already handles disconnects; reconnection logic is future work |
| DNS rebinding SSRF for hostname targets | Very low | Medium | Port 9735 restriction limits blast radius; accept risk for now |
| Rate limiting bypassed across isolates | Medium | Low | Best-effort is sufficient; upgrade to Durable Objects if abused |
| `connect()` API behavior changes | Low | High | Pin `compatibility_date` in wrangler.toml |

## Scope Boundaries

### In scope

- Core proxy Worker (WS↔TCP byte forwarding)
- Origin validation, SSRF protection, port restriction
- Dev and production environment configuration
- Unit and integration tests
- Wallet config to support self-hosted proxy URL via env var

### Out of scope (future work)

- **Automatic reconnection logic** — the wallet currently treats peer connections as ephemeral
- **IPv6 support** — URL encoding convention undefined; defer until needed
- **Custom domain** — start with `*.workers.dev`; add custom domain when production domain is known
- **CI/CD pipeline** — manual `wrangler deploy` for now
- **Structured logging** — Cloudflare analytics is sufficient initially
- **Strict rate limiting** — in-memory counters are best-effort; upgrade to Durable Objects if needed

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-12-websocket-proxy-infrastructure-brainstorm.md](docs/brainstorms/2026-03-12-websocket-proxy-infrastructure-brainstorm.md) — Key decisions carried forward: Cloudflare Workers platform, TypeScript implementation, MutinyWallet-compatible URL format, `proxy/` monorepo location, origin-based access control

### Internal References

- Proxy URL config: `src/ldk/config.ts:11` (`wsProxyUrl`)
- CSP policy: `index.html:9` (`connect-src`)
- URL construction: `src/ldk/peers/peer-connection.ts:21-23`
- Socket wrapper: `src/ldk/peers/socket-descriptor.ts`
- Related todo (input validation): `todos/034-pending-p1-peer-address-input-validation.md`
- Related todo (WS cleanup): `todos/036-pending-p2-websocket-cleanup-on-timeout.md`

### External References

- [Cloudflare Workers TCP Sockets (`connect()`) docs](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Cloudflare Workers WebSocket docs](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- [MutinyWallet/websocket-proxy](https://github.com/MutinyWallet/websocket-proxy) — reference implementation (Rust/WASM on Workers)
- [MutinyWallet/ln-websocket-proxy](https://github.com/MutinyWallet/ln-websocket-proxy) — original Rust proxy
- [BOLT 8: Transport Protocol (Noise)](https://github.com/lightning/bolts/blob/master/08-transport.md)
- [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
