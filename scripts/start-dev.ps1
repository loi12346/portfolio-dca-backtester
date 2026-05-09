param(
    [switch]$Check
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"
$FrontendNodeModules = Join-Path $Frontend "node_modules"

function Assert-Exists($Path, $Message) {
    if (-not (Test-Path $Path)) {
        throw $Message
    }
}

Assert-Exists $Python "Backend virtual environment not found. Run: cd backend; python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
Assert-Exists $FrontendNodeModules "Frontend dependencies not found. Run: cd frontend; npm.cmd install"

if ($Check) {
    Write-Host "Dev prerequisites look ready."
    exit 0
}

Write-Host "Starting FastAPI backend on http://127.0.0.1:8000"
$BackendProcess = Start-Process `
    -FilePath $Python `
    -ArgumentList @("-m", "uvicorn", "main:app", "--reload", "--host", "127.0.0.1", "--port", "8000") `
    -WorkingDirectory $Backend `
    -PassThru `
    -WindowStyle Hidden

try {
    Write-Host "Starting Next.js frontend on http://localhost:3000"
    Push-Location $Frontend
    npm.cmd run dev
}
finally {
    Pop-Location
    if ($BackendProcess -and -not $BackendProcess.HasExited) {
        Write-Host "Stopping FastAPI backend."
        Stop-Process -Id $BackendProcess.Id -Force
    }
}
