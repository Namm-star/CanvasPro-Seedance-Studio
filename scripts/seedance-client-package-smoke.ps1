[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PackageFolder)
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
$taskStore = Join-Path $taskRepo ('.codex/rehearsals/seedance-client-package/launcher-smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskStore | Out-Null
$launcher = Join-Path ([IO.Path]::GetFullPath($PackageFolder)) 'CanvasPro 视频工作室.exe'
$manifest = Get-Content -LiteralPath (Join-Path ([IO.Path]::GetFullPath($PackageFolder)) 'manifest.json') -Raw -Encoding utf8 | ConvertFrom-Json
$catalogPath = Join-Path ([IO.Path]::GetFullPath($PackageFolder)) 'app/data/catalog.json'
$catalog = Get-Content -LiteralPath $catalogPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($manifest.catalogSHA256 -and (Get-FileHash -LiteralPath $catalogPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.catalogSHA256) { throw 'Bundled catalog checksum is wrong.' }
foreach ($file in $manifest.files) {
    $target = Join-Path ([IO.Path]::GetFullPath($PackageFolder)) $file.path
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'A packaged file has changed.' }
}
function Launch-Smoke {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $launcher
    $startInfo.Arguments = '--smoke'
    $startInfo.WorkingDirectory = Split-Path -Parent $launcher
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.EnvironmentVariables['LOCALAPPDATA'] = $taskStore
    $process = [Diagnostics.Process]::Start($startInfo)
    if (-not $process.WaitForExit(25000)) { throw 'Launcher did not finish within 25 seconds.' }
    if ($process.ExitCode -ne 0) { throw 'Launcher returned a failure.' }
}
Launch-Smoke
$instanceFile = Join-Path $taskStore 'CanvasProSeedanceStudio/instance.json'
$instance = Get-Content -LiteralPath $instanceFile -Raw -Encoding utf8 | ConvertFrom-Json
$base = 'http://127.0.0.1:' + $instance.port
$headers = @{ Origin = $base; 'X-Studio-Token' = $instance.token }
try {
    $health = Invoke-RestMethod -Uri ($base + '/health') -Headers $headers
    $boot = Invoke-RestMethod -Uri ($base + '/api/bootstrap') -Headers $headers -Method Post -ContentType 'application/json' -Body '{}'
    if ($health.version -ne $manifest.version -or $boot.version -ne $manifest.version -or $boot.preview.models.Count -ne $catalog.models.Count -or $boot.preview.catalogVersion -ne $catalog.catalogVersion) { throw 'Bundled app or directory is wrong.' }
    if (($boot.preview.models.model -join '|') -ne ($catalog.models.model -join '|')) { throw 'Bundled model identities do not match.' }
    Launch-Smoke
    $second = Get-Content -LiteralPath $instanceFile -Raw -Encoding utf8 | ConvertFrom-Json
    if ($instance.pid -ne $second.pid -or $instance.port -ne $second.port) { throw 'Repeated launch did not reuse the local instance.' }
    [ordered]@{version=$health.version;bundledModels=$boot.preview.models.Count;launcherExitCode=0;singleInstance=$true;runtimeStarted=$true;manifestFilesVerified=$manifest.files.Count;realSiteRequests=0;paidRequests=0;keyRead=$false} | ConvertTo-Json -Compress
} finally {
    Invoke-RestMethod -Uri ($base + '/api/exit') -Headers $headers -Method Post | Out-Null
}
