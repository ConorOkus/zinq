# Payjoin Dev Kit build

Zinqq vendors the Payjoin Dev Kit (PDK) from [payjoin/rust-payjoin](https://github.com/payjoin/rust-payjoin) as a git submodule under `vendor/rust-payjoin/`. The JavaScript/WASM bindings are built locally — they are not consumed from npm. This keeps the source of truth upstream and avoids a stale npm tarball (`payjoin@0.1.0`, last published Nov 2025).

The submodule is pinned to release tag **`payjoin-1.0.0-rc.2`** (the most recent upstream RC marked as shippable). Pinning to a named tag rather than master HEAD is load-bearing supply-chain hygiene: a force-push or compromised commit between tags would otherwise flow into Zinqq's WASM bundle.

## Prerequisites

| Tool                                    | Version                                        | Install                                                           |
| --------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Rust                                    | stable                                         | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `wasm32-unknown-unknown` target         | —                                              | `rustup target add wasm32-unknown-unknown`                        |
| `wasm-bindgen-cli`                      | **0.2.108** (must match rust-payjoin lockfile) | `cargo install --locked wasm-bindgen-cli --version 0.2.108`       |
| LLVM (macOS only — for `secp256k1-sys`) | latest                                         | `brew install llvm`                                               |

The `wasm-bindgen-cli` version must match what the **WASM sub-build's** lockfile pins — that's `vendor/rust-payjoin/payjoin-ffi/javascript/rust_modules/wasm/Cargo.lock`, not the top-level `vendor/rust-payjoin/Cargo.lock`. Upstream maintains a separate workspace for the wasm crate, and the two lockfiles routinely disagree on `wasm-bindgen`. Version drift produces a cryptic schema-mismatch error at bind time. When bumping the submodule, re-check and update this pin against the **wasm** lockfile.

## One-time setup

```sh
git submodule update --init --recursive
pnpm install
pnpm payjoin:build
```

`pnpm payjoin:build` runs `scripts/build-payjoin-bindings.sh`. That script deliberately diverges from upstream's `generate_bindings.sh` by skipping `npm run build:test-utils` — upstream's test-utils runs `npm install` with lifecycle scripts enabled, which would bypass our `--ignore-scripts` supply-chain hardening. Zinqq does not consume the test-utils artefacts. The script produces `dist/` inside the submodule; Zinqq links to it via the `"payjoin": "link:./vendor/rust-payjoin/payjoin-ffi/javascript"` dependency.

## Bumping the submodule

```sh
cd vendor/rust-payjoin
git fetch origin
git checkout <new-commit-or-tag>
cd ../..
# Check whether wasm-bindgen pin changed (note: WASM sub-build lockfile,
# NOT the top-level Cargo.lock — they routinely diverge).
grep '^name = "wasm-bindgen"' -A 1 vendor/rust-payjoin/payjoin-ffi/javascript/rust_modules/wasm/Cargo.lock | grep version
# If version changed: reinstall wasm-bindgen-cli at matching version
pnpm payjoin:build
git add vendor/rust-payjoin
```

The submodule commit is part of Zinqq's git history; the built `dist/` is gitignored by upstream and is not committed.

## Troubleshooting

**`failed to find tool "/opt/homebrew/opt/llvm/bin/clang"`** — `brew install llvm` was never run, even though `brew --prefix llvm` prints a path. Brew prints the _expected_ install prefix whether or not the formula is installed.

**`rust Wasm file schema version: 0.2.X; this binary schema version: 0.2.Y`** — wasm-bindgen-cli version doesn't match the `wasm-bindgen` crate version in `vendor/rust-payjoin/payjoin-ffi/javascript/rust_modules/wasm/Cargo.lock` (the wasm sub-build lockfile, not the top-level one). Reinstall at the matching version.

**Vite can't resolve `payjoin` / empty `dist/`** — if you ran `pnpm install` before `pnpm payjoin:build`, pnpm's `file:` resolution would have honoured the submodule's `"files": ["dist/**/*"]` whitelist against an empty tree. We use `link:` specifically to avoid this — verify your `package.json` entry still reads `"payjoin": "link:./vendor/rust-payjoin/payjoin-ffi/javascript"`.
