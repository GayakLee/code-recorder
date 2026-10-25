param([switch]$Headless)
$ErrorActionPreference = 'Stop'
$movieRoot = $PSScriptRoot
$movieConfig = Get-Content -Raw -LiteralPath (Join-Path $movieRoot 'runtime.json') | ConvertFrom-Json
$movieExecutable = Join-Path $movieConfig.runtime 'VSCodium.exe'
if ($Headless) {
    & $movieConfig.node (Join-Path $movieRoot 'src/headless.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Headless launch failed' }
    exit 0
}
if (Get-Process VSCodium -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $movieExecutable }) { exit 0 }
$env:CODE_RECORDER_ROOT = $movieRoot
$env:VSCODE_RECORD_ROOT = $movieRoot
$env:FFMPEG_PATH = $movieConfig.ffmpeg
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& $movieConfig.node (Join-Path $movieRoot 'prepare.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Movie preparation failed' }
$movieSession = Join-Path $movieConfig.data 'standard-profile'
Start-Process -FilePath $movieExecutable -ArgumentList @('--user-data-dir', $movieSession, '--extensions-dir', $movieConfig.extensions, '--skip-release-notes')
