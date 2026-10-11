[CmdletBinding()]
param([string]$OutputRoot = '.codex/releases', [string]$NodePath = 'C:/Program Files/nodejs/node.exe')
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRepo
$runtimeVersion = (& $NodePath --version).Trim()
if ($runtimeVersion -ne 'v24.14.1') { throw 'Only the pinned Node.js 24.14.1 runtime has been reviewed for this release.' }
$nodeExpected = '58e74bf02fc5bbacc41dcb8bef089961cd5bddd37830b87784e4fc624d145d1f'
if ((Get-FileHash -LiteralPath $NodePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $nodeExpected) { throw 'Node runtime does not match the official release checksum.' }
$taskOutput = [System.IO.Path]::GetFullPath((Join-Path $taskRepo $OutputRoot))
$sourceText = Get-Content -LiteralPath 'clients/seedance-studio/server.mjs' -Raw -Encoding utf8
if ($sourceText -notmatch "export const VERSION='(\d+\.\d+\.\d+)';") { throw 'Client version is missing or invalid.' }
$clientVersion = $Matches[1]
$catalogPath = 'clients/seedance-studio/data/catalog.json'
$catalog = Get-Content -LiteralPath $catalogPath -Raw -Encoding utf8 | ConvertFrom-Json
$catalogHash = (Get-FileHash -LiteralPath $catalogPath -Algorithm SHA256).Hash.ToLowerInvariant()
$packageName = 'CanvasPro-Seedance-Studio-' + $clientVersion + '-windows-x64'
$stage = Join-Path $taskOutput $packageName
$zipPath = Join-Path $taskOutput ($packageName + '.zip')
if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $zipPath)) { throw 'Package output already exists; use a fresh output folder instead of overwriting a delivery.' }
New-Item -ItemType Directory -Path $stage, (Join-Path $stage 'runtime'), (Join-Path $stage 'app/lib'), (Join-Path $stage 'app/public'), (Join-Path $stage 'app/data') | Out-Null
$sources = @('server.mjs','lib/contracts.mjs','public/index.html','public/app.js','public/style.css','data/catalog.json')
foreach ($file in $sources) { Copy-Item -LiteralPath (Join-Path 'clients/seedance-studio' $file) -Destination (Join-Path $stage ('app/' + $file)) }
Copy-Item -LiteralPath 'clients/seedance-studio/README.md' -Destination (Join-Path $stage '使用说明.md')
Copy-Item -LiteralPath 'clients/seedance-studio/CHANGELOG.md' -Destination (Join-Path $stage '版本记录.md')
Copy-Item -LiteralPath 'clients/seedance-studio/launcher.cs' -Destination (Join-Path $stage 'launcher.cs')
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $stage 'runtime/node.exe')
# Complete third-party attribution belongs with the runtime, not a partial quote.
$licenseUri = 'https://raw.githubusercontent.com/nodejs/node/v24.14.1/LICENSE'
Invoke-WebRequest -Uri $licenseUri -OutFile (Join-Path $stage 'runtime/LICENSE')
if ((Get-Item -LiteralPath (Join-Path $stage 'runtime/LICENSE')).Length -lt 5000) { throw 'Node license download is incomplete.' }
$compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /utf8output /codepage:65001 /target:winexe /platform:x64 /reference:System.Windows.Forms.dll ('/out:' + (Join-Path $stage 'CanvasPro 视频工作室.exe')) (Join-Path $taskRepo 'clients\seedance-studio\launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
$files = Get-ChildItem -LiteralPath $stage -File -Recurse | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($stage.Length + 1).Replace('\','/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$manifest = [ordered]@{ application = 'canvaspro-seedance-studio'; version = $clientVersion; platform = 'windows-x64'; models = $catalog.models.Count; catalogVersion = $catalog.catalogVersion; catalogSHA256 = $catalogHash; runtimeVersion = $runtimeVersion; runtimeSource = 'https://nodejs.org/download/release/v24.14.1/SHASUMS256.txt'; licenseSource = $licenseUri; createdAt = [DateTime]::UtcNow.ToString('o'); files = @($files) }
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding utf8
Compress-Archive -LiteralPath $stage -DestinationPath $zipPath -CompressionLevel Optimal
$receipt = [ordered]@{ package = $zipPath; stage = $stage; version = $clientVersion; models = $catalog.models.Count; catalogVersion = $catalog.catalogVersion; catalogSHA256 = $catalogHash; bytes = (Get-Item -LiteralPath $zipPath).Length; sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant(); files = $files.Count; runtimeVerified = $true; launcherSigned = $false; secretsBundled = $false }
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskOutput ($packageName + '.receipt.json')) -Encoding utf8
$receipt | ConvertTo-Json -Compress
