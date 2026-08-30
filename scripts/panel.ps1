# AI Tools Panel launcher (APP-001). Starts the local agent and opens the browser.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/panel.ps1
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js not found. Install Node.js 22+ from https://nodejs.org and retry."
}
if (-not (Test-Path "$repoRoot\node_modules")) {
    Write-Host "Installing dependencies (first run)..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed." }
}
if (-not (Test-Path "$repoRoot\apps\local-agent\dist\main.js")) {
    Write-Host "Building packages (first run)..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Error "Build failed. Run 'npm run verify' for details." }
}

Write-Host "Starting AI Tools Panel..." -ForegroundColor Cyan
node "$repoRoot\apps\local-agent\dist\start.js" --open
