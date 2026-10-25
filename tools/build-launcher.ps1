$ErrorActionPreference = 'Stop'
$movieRoot = Split-Path -Parent $PSScriptRoot
$movieCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$movieName = (Get-Content -Raw -LiteralPath (Join-Path $movieRoot 'package.json') | ConvertFrom-Json).name
$movieTarget = if ($movieName -eq 'code-recorder') { 'winexe' } else { 'exe' }
$movieArguments = @('/nologo', '/optimize+', '/debug-', ('/target:' + $movieTarget), ('/out:' + (Join-Path $movieRoot ($movieName + '.exe'))))
if ($movieName -eq 'code-recorder') {
    $movieArguments += '/reference:System.Windows.Forms.dll'
    $movieArguments += '/win32icon:' + (Join-Path $movieRoot 'assets/code-recorder.ico')
}
& $movieCompiler @movieArguments (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
