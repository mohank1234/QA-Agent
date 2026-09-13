$ErrorActionPreference = "Continue"
Set-Location -Path "D:\qa-agent"

$logDir = "D:\qa-agent\logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}
$logFile = Join-Path $logDir "dev-server.log"

while ($true) {
    Add-Content -Path $logFile -Value "$(Get-Date -Format o) - Starting npm run dev"
    npm run dev *>> $logFile
    Add-Content -Path $logFile -Value "$(Get-Date -Format o) - npm run dev exited (code $LASTEXITCODE), restarting in 5s"
    Start-Sleep -Seconds 5
}
