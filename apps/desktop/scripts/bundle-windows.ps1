$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $scriptDirectory "prepare-llama-runtime.ps1")

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    throw "Visual Studio 2022 Build Tools with the C++ workload is required to build the Windows installer."
}
$installationPath = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
if (-not $installationPath) {
    throw "Visual Studio 2022 Build Tools is installed, but the MSVC x64 toolchain is missing."
}
$developerCommand = Join-Path $installationPath "Common7\Tools\VsDevCmd.bat"
$environmentLines = & cmd.exe /d /s /c "`"$developerCommand`" -arch=x64 -host_arch=x64 >nul && set"
if ($LASTEXITCODE -ne 0) {
    throw "Unable to initialize the Visual Studio C++ build environment."
}
foreach ($line in $environmentLines) {
    $separator = $line.IndexOf("=")
    if ($separator -gt 0) {
        Set-Item -Path "Env:$($line.Substring(0, $separator))" -Value $line.Substring($separator + 1)
    }
}

$cargoDirectory = Join-Path $env:USERPROFILE ".cargo\bin"
$env:PATH = "$cargoDirectory;$env:PATH"
if (-not (Test-Path (Join-Path $cargoDirectory "cargo.exe"))) {
    throw "Rust is required to build the Windows installer. Install it from https://rustup.rs/."
}

Push-Location (Split-Path -Parent $scriptDirectory)
try {
    & npm.cmd run tauri -- build --bundles nsis
    if ($LASTEXITCODE -ne 0) {
        throw "The Tauri Windows installer build failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
