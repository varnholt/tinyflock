$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$assets = @(@{
    Url = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloppenheim_06_2k.hdr'
    Path = 'web/public/assets/kloppenheim_landscape_2k.hdr'
    Hash = '620CF7FD4B31E602CCB57DA492EFD43A38CD4B0858206D2475CB1D83A0EFB08E'
}, @{
    Url = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/kloppenheim_06_4k.hdr'
    Path = 'web/public/assets/kloppenheim_landscape_4k.hdr'
    Hash = '0E668C7A13101343D8CFF37CDAB4B440BB3483A4C8F9E8435DF53E12EB843150'
})
foreach ($asset in $assets) {
    $destination = Join-Path $projectRoot $asset.Path
    New-Item -ItemType Directory -Force (Split-Path -Parent $destination) | Out-Null
    if (-not (Test-Path -LiteralPath $destination)) {
        Invoke-WebRequest -Uri $asset.Url -OutFile $destination
    }
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $asset.Hash) {
        throw "Asset content changed: $($asset.Path). Review the source before replacing it."
    }
    Write-Output "Verified $($asset.Path)"
}
