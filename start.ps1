# Start backend-erp when npm is not installed in this folder yet.
# Uses Node from PATH and shared deps from ../node_modules (parent backend folder).
# Prefer: npm install && npm run dev (after installing Node.js LTS).

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$parentModules = Join-Path (Split-Path -Parent $here) "node_modules"

Set-Location $here
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "Created .env from .env.example — edit ERP_BASE_URL and tokens before real Frappe calls."
}

if (-not (Test-Path $parentModules)) {
  Write-Host "Missing $parentModules — run: cd ..\backend-erp; npm install"
  exit 1
}

$env:NODE_PATH = $parentModules
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js is not on PATH. Install Node.js LTS from https://nodejs.org/ then run npm install in this folder."
  exit 1
}

Write-Host "Starting backend-erp (NODE_PATH -> parent backend node_modules)..."
& node.exe server.js
