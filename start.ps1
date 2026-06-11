# Start backend-erp from this folder.
# Prefer: npm install && npm run dev (after installing Node.js LTS).

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$localModules = Join-Path $here "node_modules"

Set-Location $here
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "Created .env from .env.example - edit ERP_BASE_URL and tokens before real Frappe calls."
}

if (-not (Test-Path $localModules)) {
  Write-Host "Missing $localModules - run: npm install"
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js is not on PATH. Install Node.js LTS from https://nodejs.org/ then run npm install in this folder."
  exit 1
}

Write-Host "Starting backend-erp..."
& node.exe server.js
