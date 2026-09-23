# Start Backend
# Run this from the project root: .\start-backend.ps1

$backendPath = "$PSScriptRoot\backend"

# Activate virtual environment
$venvActivate = "$backendPath\venv\Scripts\Activate.ps1"

if (-Not (Test-Path $venvActivate)) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv "$backendPath\venv"
}

Write-Host "Activating virtual environment..." -ForegroundColor Cyan
& $venvActivate

Write-Host "Installing dependencies..." -ForegroundColor Cyan
pip install -r "$backendPath\requirements.txt" --quiet

Write-Host ""
Write-Host "Starting backend on http://localhost:8000" -ForegroundColor Green
Write-Host "API docs at http://localhost:8000/docs" -ForegroundColor Green
Write-Host ""

Set-Location $backendPath
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
