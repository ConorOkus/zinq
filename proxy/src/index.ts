import { connect } from 'cloudflare:sockets'
import { parseProxyPath, validateOrigin, validateTarget } from './validation'

interface Env {
  ALLOWED_ORIGINS: string
  ALLOWED_PORTS: string
}

export default {
  fetch(request: Request, env: Env): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }

    // Validate env configuration
    const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (allowedOrigins.length === 0) {
      return new Response('Proxy misconfigured', { status: 500 })
    }

    const origin = request.headers.get('Origin')
    if (!validateOrigin(origin, allowedOrigins)) {
      return new Response('Forbidden', { status: 403 })
    }

    const url = new URL(request.url)
    const target = parseProxyPath(url.pathname)
    if (!target) {
      return new Response('Bad request', { status: 400 })
    }

    const allowedPorts = (env.ALLOWED_PORTS ?? '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n))
    if (allowedPorts.length === 0) {
      return new Response('Proxy misconfigured', { status: 500 })
    }

    const targetError = validateTarget(target.host, target.port, allowedPorts)
    if (targetError) {
      return new Response(targetError, { status: 400 })
    }

    // Open TCP connection to Lightning node
    const tcp = connect({ hostname: target.host, port: target.port })

    // Create WebSocket pair
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()

    // Hold writer for the connection lifetime — the WritableStream
    // queues writes internally, avoiding lock contention on concurrent messages
    const writer = tcp.writable.getWriter()

    // Pipe: WebSocket -> TCP (binary frames only — Lightning is binary)
    server.addEventListener('message', (event: MessageEvent) => {
      const data: unknown = event.data
      if (!(data instanceof ArrayBuffer)) {
        server.close(1003, 'Text frames not supported')
        void writer.close()
        return
      }
      void writer.write(new Uint8Array(data)).catch(() => {
        if (server.readyState === WebSocket.OPEN) {
          server.close(1011, 'TCP write error')
        }
      })
    })

    server.addEventListener('close', () => {
      void writer.close()
    })

    server.addEventListener('error', () => {
      void writer.abort()
    })

    // Pipe: TCP -> WebSocket
    void tcp.readable
      .pipeTo(
        new WritableStream({
          write(chunk: Uint8Array) {
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
        }),
      )
      .catch(() => {
        if (server.readyState === WebSocket.OPEN) {
          server.close(1011, 'TCP connection error')
        }
      })

    return new Response(null, { status: 101, webSocket: client })
  },
} satisfies ExportedHandler<Env>
