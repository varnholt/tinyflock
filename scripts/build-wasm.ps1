$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    if (-not (Get-Command emcc -ErrorAction SilentlyContinue)) {
        $localEnvironment = Join-Path $projectRoot '.tools/emsdk/emsdk_env.ps1'
        if (-not (Test-Path -LiteralPath $localEnvironment)) {
            throw 'Activate Emscripten 7.0.0 in this shell, then run this script again.'
        }
        $env:EMSDK_QUIET = '1'
        . $localEnvironment
    }
    New-Item -ItemType Directory -Force build/tmp | Out-Null
    $env:EMCC_TEMP_DIR = (Resolve-Path build/tmp).Path
    $configure = @('-S', '.', '-B', 'build/wasm', '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_TESTING=OFF')
    if (Test-Path build/wasm/CMakeCache.txt) {
        $cachedGenerator = (Select-String -Path build/wasm/CMakeCache.txt -Pattern '^CMAKE_GENERATOR:INTERNAL=(.+)$').Matches.Groups[1].Value
        $configure += @('-G', $cachedGenerator)
    } else {
        if (Get-Command ninja -ErrorAction SilentlyContinue) {
            $configure += @('-G', 'Ninja')
        } else {
            $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
            if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Ninja or Visual Studio C++ build tools.' }
            $nmake = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'VC/Tools/MSVC/**/bin/Hostx64/x64/nmake.exe' | Select-Object -First 1
            if (-not $nmake) { throw 'Install Ninja or Visual Studio C++ build tools.' }
            $configure += @('-G', 'NMake Makefiles', "-DCMAKE_MAKE_PROGRAM=$nmake")
        }
    }
    & emcmake cmake @configure
    if ($LASTEXITCODE -ne 0) { throw 'WebAssembly configuration failed.' }
    & cmake --build build/wasm
    if ($LASTEXITCODE -ne 0) { throw 'WebAssembly build failed.' }
} finally {
    Pop-Location
}
