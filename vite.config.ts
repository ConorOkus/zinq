import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
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
      // LNURL CORS proxy — forwards /__lnurl_proxy/DOMAIN/PATH to https://DOMAIN/PATH.
      // Needed because many LNURL servers either don't set CORS headers or send
      // malformed ones (e.g., duplicate Access-Control-Allow-Origin).
      '/__lnurl_proxy': {
        target: 'https://localhost', // overridden by router below
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, req) => {
            // Extract real target from the URL: /__lnurl_proxy/domain.com/rest/of/path
            const match = req.url?.match(/^\/__lnurl_proxy\/([^/]+)(\/.*)$/)
            if (match) {
              const [, targetHost, targetPath] = match
              // Rewrite the proxy destination dynamically
              ;(req as { _lnurlTarget?: string })._lnurlTarget = `https://${targetHost}${targetPath}`
            }
          })
        },
        router: (req: { url?: string }) => {
          const match = req.url?.match(/^\/__lnurl_proxy\/([^/]+)/)
          if (match?.[1]) return `https://${match[1]}`
          return 'https://localhost'
        },
        rewrite: (path) => {
          // Strip /__lnurl_proxy/domain.com prefix, keep the rest
          return path.replace(/^\/__lnurl_proxy\/[^/]+/, '')
        },
      },
    },
  },
})
