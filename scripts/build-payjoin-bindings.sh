#!/usr/bin/env bash
set -euo pipefail

# Build the Payjoin Dev Kit JS/WASM bindings from the vendored submodule.
# Shared recipe invoked by:
#   - .github/workflows/ci.yml (payjoin-build job)
#   - scripts/vercel-install.sh (Vercel install hook)
#   - pnpm payjoin:build (local dev)
#
# Deliberate divergence from upstream's scripts/generate_bindings.sh:
# we skip `npm run build:test-utils`. test-utils is a napi-rs native test
# helper Zinqq does not consume; its `cd test-utils && npm install` runs
# with lifecycle scripts enabled upstream and would re-introduce the
# unreviewed-upstream-code execution path we're hardening away from.

WASM_BINDGEN_VERSION="0.2.108"
BINDINGS_DIR="vendor/rust-payjoin/payjoin-ffi/javascript"

# Belt-and-suspenders: block upstream lifecycle scripts even if a transitive
# `npm install` sneaks past the outer `npm ci --ignore-scripts` below.
export NPM_CONFIG_IGNORE_SCRIPTS=true

# Pin wasm-bindgen-cli to the version resolved in rust-payjoin's Cargo.lock.
# Version drift surfaces at bind time as a cryptic schema mismatch.
if ! command -v wasm-bindgen >/dev/null \
  || [ "$(wasm-bindgen --version | awk '{print $2}')" != "$WASM_BINDGEN_VERSION" ]; then
  cargo install --locked wasm-bindgen-cli --version "$WASM_BINDGEN_VERSION"
fi

cd "$BINDINGS_DIR"

# IMPORTANT: `rustup target add` must run from inside the submodule.
# `vendor/rust-payjoin/rust-toolchain.toml` pins the nightly channel, and
# rustup only applies toolchain overrides based on cwd. Running this from
# the repo root would add wasm32 to stable and leave nightly (the active
# toolchain at build time) without the target, yielding E0463 later.
rustup target add wasm32-unknown-unknown

npm ci --ignore-scripts

# macOS: secp256k1-sys needs a wasm-capable C compiler; Apple's default
# clang can't target wasm32, so point at Homebrew's LLVM.
if [[ "$(uname -s)" == "Darwin" ]]; then
  LLVM_PREFIX=$(brew --prefix llvm)
  export AR="$LLVM_PREFIX/bin/llvm-ar"
  export CC="$LLVM_PREFIX/bin/clang"
fi

# MSRV hack: upstream pins a transitive that breaks under recent Rust.
# Replicated from generate_bindings.sh:18-20.
(cd node_modules/uniffi-bindgen-react-native \
  && cargo add home@=0.5.11 --package uniffi-bindgen-react-native)

# Patch ubrn's web target from `nodejs` to `web` so wasm-bindgen emits the
# browser-compatible loader (default `init({ module_or_path })` export +
# `WebAssembly.instantiateStreaming(fetch(...))`). Upstream's `web:` block
# defaulting to nodejs target is almost certainly an upstream bug — the
# resulting `index.js` uses `require('fs').readFileSync` and crashes in
# any browser. Idempotent: re-running the sed against an already-patched
# file is a no-op.
if grep -q '^[[:space:]]*target:[[:space:]]*nodejs' ubrn.config.yaml; then
  sed -i.bak 's/^\([[:space:]]*\)target:[[:space:]]*nodejs/\1target: web/' ubrn.config.yaml
  rm -f ubrn.config.yaml.bak
fi

npm run build

# Patch dist/index.web.js: force Vite to treat the wasm-bindgen wasm as a
# URL asset (`?url`) rather than letting vite-plugin-wasm instantiate it
# as a module. wasm-bindgen `--target web` emits an `init({module_or_path})`
# loader that wants a URL string; without `?url` Vite intercepts the
# default `.wasm` import and tries to bundle it via vite-plugin-wasm,
# which can't find the bundler-style `index_bg.js` companion that
# `--target web` doesn't emit. The sed is idempotent: `?url` already
# present is a no-op.
if [[ -f dist/index.web.js ]] && ! grep -q 'index_bg.wasm?url' dist/index.web.js; then
  sed -i.bak 's|index_bg\.wasm|index_bg.wasm?url|' dist/index.web.js
  rm -f dist/index.web.js.bak
fi
