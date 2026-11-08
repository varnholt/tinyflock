$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    cargo build --locked --release -p tinyflock-web --target wasm32-unknown-unknown
    if ($LASTEXITCODE -ne 0) { throw 'Rust WASM build failed' }
    wasm-bindgen --target web --out-name tinyflock_web --out-dir web/public/wasm-rust target/wasm32-unknown-unknown/release/tinyflock_web.wasm
    if ($LASTEXITCODE -ne 0) { throw 'wasm-bindgen failed; use CLI 0.2.130' }
} finally { Pop-Location }
