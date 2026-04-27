import type * as PdkModule from 'payjoin'

export type Pdk = typeof PdkModule.payjoin

let pdkPromise: Promise<Pdk> | null = null

/**
 * Lazy-load the Payjoin Dev Kit. The PDK is dynamically imported so its
 * ~1MB wasm bundle stays out of the main chunk and only fetches when an
 * on-chain send actually needs it. Memoised: repeat callers share a
 * single init.
 *
 * Build prerequisite: `scripts/build-payjoin-bindings.sh` patches
 * `ubrn.config.yaml` to use wasm-bindgen `--target web` so the loader
 * is browser-compatible. Without that patch, the upstream default
 * (`--target nodejs`) emits a loader that uses `require('fs')` and
 * crashes in the browser.
 */
export function loadPdk(): Promise<Pdk> {
  if (pdkPromise) return pdkPromise
  pdkPromise = (async () => {
    const mod = await import('payjoin')
    await mod.uniffiInitAsync()
    return mod.payjoin
  })()
  return pdkPromise
}
