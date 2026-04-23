import { defineConfig, loadEnv, type PluginOption, type Plugin } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { VitePWA } from 'vite-plugin-pwa'
import { parseTarget } from './api/payjoin-proxy'

/**
 * Vite plugin that proxies LNURL requests to bypass CORS issues.
 * Routes /__lnurl_proxy/DOMAIN/PATH to https://DOMAIN/PATH server-side.
 * Needed because some LNURL servers send malformed CORS headers
 * (e.g., duplicate Access-Control-Allow-Origin: *, *).
 */
function lnurlCorsProxy(): Plugin {
  return {
    name: 'lnurl-cors-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const prefix = '/__lnurl_proxy/'
        if (!req.url?.startsWith(prefix)) return next()

        const rest = req.url.slice(prefix.length)
        const slashIdx = rest.indexOf('/')
        if (slashIdx === -1) {
          res.statusCode = 400
          res.end('Bad proxy URL')
          return
        }

        const targetHost = rest.slice(0, slashIdx)
        const targetPath = rest.slice(slashIdx)
        const targetUrl = `https://${targetHost}${targetPath}`

        fetch(targetUrl)
          .then(async (upstream) => {
            res.statusCode = upstream.status
            res.setHeader(
              'Content-Type',
              upstream.headers.get('Content-Type') ?? 'application/json'
            )
            res.end(await upstream.text())
          })
          .catch((err: unknown) => {
            res.statusCode = 502
            res.end(err instanceof Error ? err.message : 'Proxy error')
          })
      })
    },
  }
}

/**
 * Vite plugin that proxies Payjoin (BIP 78 v1 + BIP 77 v2) sender traffic in
 * dev. Routes POST /__payjoin_proxy/DOMAIN/PATH to https://DOMAIN/PATH with
 * body forwarding. Mirrors the production proxy at api/payjoin-proxy.ts by
 * sharing parseTarget (scheme + private-IP + hostname normalization). Without
 * this, a dev binding Vite to 0.0.0.0 for mobile LAN testing would expose an
 * SSRF pivot on the local network.
 */
function payjoinCorsProxy(): Plugin {
  return {
    name: 'payjoin-cors-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const prefix = '/__payjoin_proxy/'
        if (!req.url?.startsWith(prefix)) return next()
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }

        const pathParam = req.url.slice(prefix.length)
        const target = parseTarget(pathParam)
        if (!target) {
          res.statusCode = 400
          res.end('Bad proxy URL')
          return
        }

        const contentType = req.headers['content-type'] ?? ''
        if (
          typeof contentType !== 'string' ||
          (!contentType.startsWith('text/plain') && !contentType.startsWith('message/ohttp-req'))
        ) {
          res.statusCode = 415
          res.end('unsupported content-type')
          return
        }

        const chunks: Buffer[] = []
        let total = 0
        req.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > 100 * 1024) {
            res.statusCode = 413
            res.end('body too large')
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        req.on('end', () => {
          const body = Buffer.concat(chunks)
          fetch(target.toString(), {
            method: 'POST',
            headers: {
              'content-type': contentType,
              'user-agent': 'payjoin-client/1.0',
            },
            body,
            redirect: 'manual',
            signal: AbortSignal.timeout(20_000),
          })
            .then(async (upstream) => {
              res.statusCode = upstream.status
              const upstreamCt = upstream.headers.get('content-type')
              if (upstreamCt) res.setHeader('Content-Type', upstreamCt)
              res.setHeader('Cache-Control', 'no-store')
              const buf = Buffer.from(await upstream.arrayBuffer())
              res.end(buf)
            })
            .catch((err: unknown) => {
              console.error('[payjoin-proxy] upstream error', err)
              res.statusCode = 502
              res.end(err instanceof Error ? err.message : 'Proxy error')
            })
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isProd = mode === 'production'
  return {
    plugins: [
      react(),
      tailwindcss(),
      wasm(),
      topLevelAwait(),
      lnurlCorsProxy(),
      payjoinCorsProxy(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        manifest: {
          name: 'Zinqq',
          short_name: 'Zinqq',
          description: 'Lightning wallet powered by LDK',
          theme_color: '#7c3aed',
          background_color: '#0a0a0a',
          display: 'standalone',
          scope: '/',
          start_url: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          globIgnores: ['**/*.wasm'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /\.wasm$/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'wasm-cache',
                expiration: { maxEntries: 1 },
                cacheableResponse: { statuses: [200] },
              },
            },
            // Payjoin endpoints must never be cached — responses are
            // session-specific PSBTs / OHTTP payloads.
            {
              urlPattern: ({ url }) =>
                url.pathname.startsWith('/api/payjoin-proxy') ||
                url.hostname === 'payjo.in' ||
                url.hostname === 'pj.benalleng.com' ||
                url.hostname === 'pj.bobspacebkk.com' ||
                url.hostname === 'ohttp.achow101.com',
              handler: 'NetworkOnly',
            },
          ],
        },
      }),
    ],
    esbuild: {
      drop: isProd ? ['debugger'] : [],
      pure: isProd ? ['console.debug'] : [],
    },
    worker: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      plugins: (): PluginOption[] => [wasm(), topLevelAwait()],
    },
    server: {
      headers: {
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      },
      proxy: {
        '/__vss_proxy': {
          target: env.VSS_PROXY_TARGET ?? 'http://localhost:8080',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/__vss_proxy/, ''),
        },
      },
    },
  }
})
