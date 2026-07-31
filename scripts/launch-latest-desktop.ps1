[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [string]$TargetDir
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo ".codex-dev-logs"
$logFile = Join-Path $logDir "launch-latest-desktop.log"
$targetDir = if ($TargetDir) {
  $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($TargetDir)
} else {
  Join-Path $logDir "desktop-launch-target"
}
$exe = Join-Path $targetDir "release\esco-automation-studio-desktop.exe"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-LaunchLog {
  param([string]$Message)

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $logFile -Value "[$timestamp] $Message"
}

try {
  Write-LaunchLog "Starting ESCO Automation Studio launcher."
  Set-Location $repo

  if (-not $SkipBuild) {
    Write-LaunchLog "Running corepack pnpm build:desktop with CARGO_TARGET_DIR=$targetDir."
    $previousCargoTargetDir = $env:CARGO_TARGET_DIR
    $env:CARGO_TARGET_DIR = $targetDir
    try {
      & corepack pnpm build:desktop 2>> $logFile | Tee-Object -FilePath $logFile -Append
    }
    finally {
      $env:CARGO_TARGET_DIR = $previousCargoTargetDir
    }
    if ($LASTEXITCODE -ne 0) {
      throw "Desktop build failed with exit code $LASTEXITCODE. See $logFile."
    }
  }

  if (-not (Test-Path -LiteralPath $exe)) {
    throw "Desktop executable was not found at $exe."
  }

  Write-LaunchLog "Launching $exe."
  Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
}
catch {
  Write-LaunchLog "ERROR: $($_.Exception.Message)"
  $shell = New-Object -ComObject WScript.Shell
  $shell.Popup("ESCO Automation Studio could not launch.`n`n$($_.Exception.Message)`n`nLog: $logFile", 30, "ESCO Automation Studio", 16) | Out-Null
  exit 1
}
