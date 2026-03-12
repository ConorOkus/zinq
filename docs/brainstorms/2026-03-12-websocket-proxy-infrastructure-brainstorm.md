# Brainstorm: WebSocket-to-TCP Proxy Infrastructure

**Date:** 2026-03-12
**Status:** Draft

## What We're Building

A self-hosted WebSocket-to-TCP proxy that allows the browser-based LDK Lightning node to connect to Lightning peers. The browser cannot open raw TCP sockets, so the proxy bridges WebSocket connections from the wallet to TCP connections to Lightning nodes on the network.

The proxy will be a lightweight TypeScript Cloudflare Worker (~50 lines of core logic) deployed to Cloudflare's global edge network. It will support both Signet (Mutinynet) and Mainnet connections, with origin-based access restrictions.

### Key Properties

- **Zero-trust relay**: All Lightning traffic is end-to-end encrypted via BOLT 8 Noise protocol. The proxy sees only opaque ciphertext and cannot read, modify, or forge messages. Even a compromised proxy cannot steal funds.
- **Stateless byte forwarder**: No application state, no database, no sessions. Each connection is an independent WS-to-TCP pipe.
- **Global edge deployment**: Cloudflare Workers run at 300+ edge locations, minimizing WebSocket latency to users worldwide.

## Why This Approach

### Why self-hosted (not public proxy)

The wallet currently depends on `wss://p.mutinynet.com`, a community-run proxy. For production use:
- No SLA or uptime guarantees from a public proxy
- Cannot control access, rate limiting, or security policies
- Single point of failure outside our control
- Public proxy may be discontinued at any time

### Why Cloudflare Workers (not VPS/Docker)

- **Minimal ops**: No servers to manage, patch, or monitor
- **Cost**: $5/month Workers Paid plan covers millions of connections
- **Global distribution**: Edge deployment provides low-latency WebSocket connections worldwide
- **Scaling**: Automatic, no capacity planning needed
- **Proven**: MutinyWallet validated this exact pattern with their `websocket-proxy` on Workers

### Why custom TypeScript (not MutinyWallet's Rust/WASM proxy)

- The proxy logic is ~50 lines of TypeScript — trivial to own and maintain
- Stays in the same language/toolchain as the wallet itself
- No Rust build toolchain required
- Easy to add origin validation, rate limiting, and logging
- Cloudflare's native `connect()` API is simpler than compiling Rust to WASM

### Why NOT other approaches

- **AWS Lambda**: No raw TCP socket support, 10-minute idle timeout — dealbreaker
- **WebRTC**: No Lightning implementation supports WebRTC transport
- **WebTransport**: No Lightning implementation supports QUIC/WebTransport yet
- **TURN servers**: Adds complexity over a simple WS proxy with no advantage

## Key Decisions

1. **Platform**: Cloudflare Workers with the `connect()` TCP API
2. **Language**: TypeScript (same stack as the wallet)
3. **URL format**: Compatible with MutinyWallet's `/v1/{host_underscored}/{port}` pattern — no changes needed to `peer-connection.ts`
4. **Repo location**: `proxy/` subdirectory in the browser-wallet monorepo, deployed independently via Wrangler
5. **Network support**: Both Signet and Mainnet — the proxy is network-agnostic (it forwards bytes, not Lightning messages)
6. **Access control**: Origin header validation restricting usage to the wallet's domain(s)
7. **Security hardening**:
   - Restrict destination port to 9735 (or configurable allowlist)
   - Block connections to private IP ranges (SSRF protection)
   - Per-IP connection rate limiting
   - Message size limits (~64KB, generous for Lightning)
   - WSS only (TLS between browser and proxy)

## Architecture

```
Browser (LDK/WASM)                 Cloudflare Worker              Lightning Node
     |                                    |                            |
     |--- WSS handshake (/v1/host/port) ->|                            |
     |                                    |--- TCP connect(host:port) ->|
     |                                    |                            |
     |<======= BOLT 8 Noise encrypted traffic (opaque to proxy) ======>|
     |                                    |                            |
```

### Wallet Integration

- `src/ldk/config.ts`: Update `wsProxyUrl` to point to the self-hosted Worker URL
- `index.html`: Update CSP `connect-src` to allow the new `wss://` domain
- `src/ldk/peers/peer-connection.ts`: No changes needed (URL format is compatible)
- Add reconnection logic to handle Cloudflare runtime restarts (~weekly)

### Deployment

- Deploy via `wrangler deploy` from the `proxy/` directory
- Custom domain via Cloudflare DNS (e.g., `wss://proxy.yourdomain.com`)
- Environment-based config for allowed origins

## Resolved Questions

- **Trust model**: The proxy is zero-trust by design (BOLT 8 encryption). Origin validation prevents abuse, not eavesdropping.
- **Connection durability**: Cloudflare runtime restarts will occasionally drop connections. The client must implement reconnection logic. This is acceptable — Lightning peer connections are already ephemeral in the current implementation.
- **Custom domain**: Start with the default `*.workers.dev` subdomain. Add a custom domain later when needed.
- **Rate limiting**: Simple in-Worker logic using Workers KV or in-memory per-IP counters. No need for Cloudflare's managed rate limiting product at this stage.
- **Multiple environments**: Two deployments — dev (allows `localhost` origins) and production (locked to wallet domain). Configured via `wrangler.toml` environments (`[env.dev]`, `[env.production]`).

- **Monitoring**: Use Cloudflare Workers built-in analytics dashboard (request counts, error rates, latency). No external logging needed initially.
