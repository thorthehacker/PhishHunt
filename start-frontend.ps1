# Start Frontend
# Run this from the project root: .\start-frontend.ps1

$frontendPath = "$PSScriptRoot\frontend"

Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
npm install --prefix $frontendPath

Write-Host ""
Write-Host "Starting frontend on http://localhost:3000" -ForegroundColor Green
Write-Host ""

Set-Location $frontendPath
npm run dev
