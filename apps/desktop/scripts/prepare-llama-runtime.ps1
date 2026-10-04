$ErrorActionPreference = "Stop"

$release = "b11398"
$archiveName = "llama-b11398-bin-win-cpu-x64.zip"
$archiveSha256 = "a5b932cb28b2f17da93bf7111c7cbd1324cffa3a6f474aa10b616908868037a2"
$archiveUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$release/$archiveName"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDirectory = Split-Path -Parent $scriptDirectory
$runtimeDirectory = Join-Path $desktopDirectory "src-tauri\resources\llama"
$cacheDirectory = Join-Path $desktopDirectory ".bundle-cache"
$archivePath = Join-Path $cacheDirectory $archiveName
$stampPath = Join-Path $runtimeDirectory ".runtime-version"

New-Item -ItemType Directory -Force -Path $cacheDirectory, $runtimeDirectory | Out-Null

$prepared = Test-Path (Join-Path $runtimeDirectory "llama-server.exe")
if ($prepared -and (Test-Path $stampPath)) {
    $stamp = (Get-Content -Raw $stampPath).Trim()
    if ($stamp -eq "$release`:$archiveSha256") {
        Write-Host "llama.cpp $release is already prepared."
        exit 0
    }
}

if (-not (Test-Path $archivePath) -or (Get-FileHash -Algorithm SHA256 $archivePath).Hash.ToLowerInvariant() -ne $archiveSha256) {
    Write-Host "Downloading pinned llama.cpp runtime $release..."
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath
}

$actualSha256 = (Get-FileHash -Algorithm SHA256 $archivePath).Hash.ToLowerInvariant()
if ($actualSha256 -ne $archiveSha256) {
    throw "llama.cpp archive checksum mismatch. Expected $archiveSha256, got $actualSha256."
}

Get-ChildItem -LiteralPath $runtimeDirectory -Force | Where-Object Name -ne ".gitkeep" | Remove-Item -Recurse -Force
Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimeDirectory -Force

$serverPath = Join-Path $runtimeDirectory "llama-server.exe"
if (-not (Test-Path $serverPath)) {
    throw "The pinned llama.cpp archive did not contain llama-server.exe."
}

Set-Content -NoNewline -Path $stampPath -Value "$release`:$archiveSha256"
Write-Host "Prepared llama.cpp $release in $runtimeDirectory."
