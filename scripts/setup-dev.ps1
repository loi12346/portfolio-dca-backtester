$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
    Write-Host "Creating backend virtual environment."
    Push-Location $Backend
    python -m venv .venv
    Pop-Location
}

Write-Host "Installing backend dependencies."
Push-Location $Backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Pop-Location

Write-Host "Installing frontend dependencies."
Push-Location $Frontend
npm.cmd install
Pop-Location

Write-Host "Setup complete. Run npm.cmd run dev from the project root."
