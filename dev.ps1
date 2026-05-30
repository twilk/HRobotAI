# HRobot local dev stack — starts Docker Compose and auto-opens the Virtual Tour.
# Usage: .\dev.ps1 [-NoOpen] [-Down]
param(
    [switch]$NoOpen,
    [switch]$Down
)

$ComposeDir = "$PSScriptRoot\infra\docker"

if ($Down) {
    Write-Host "Stopping HRobot stack..." -ForegroundColor Cyan
    docker compose -f "$ComposeDir\docker-compose.yml" down
    exit 0
}

Write-Host ""
Write-Host "  ██╗  ██╗██████╗  ██████╗ ██████╗  ██████╗ ████████╗" -ForegroundColor Cyan
Write-Host "  ██║  ██║██╔══██╗██╔═══██╗██╔══██╗██╔═══██╗╚══██╔══╝" -ForegroundColor Cyan
Write-Host "  ███████║██████╔╝██║   ██║██████╔╝██║   ██║   ██║   " -ForegroundColor Cyan
Write-Host "  ██╔══██║██╔══██╗██║   ██║██╔══██╗██║   ██║   ██║   " -ForegroundColor Cyan
Write-Host "  ██║  ██║██║  ██║╚██████╔╝██████╔╝╚██████╔╝   ██║   " -ForegroundColor Cyan
Write-Host "  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝  ╚═════╝   ╚═╝   " -ForegroundColor Cyan
Write-Host ""
Write-Host "  Starting HRobot.AI development stack..." -ForegroundColor White
Write-Host ""

# Ports summary
Write-Host "  PORTS" -ForegroundColor DarkGray
Write-Host "  Postgres     :5433    Redis       :6380" -ForegroundColor DarkGray
Write-Host "  RabbitMQ     :5673    RabbitMQ UI :15673" -ForegroundColor DarkGray
Write-Host "  Keycloak     :8180    Virtual Tour:4321" -ForegroundColor DarkGray
Write-Host ""

# Build and start
docker compose -f "$ComposeDir\docker-compose.yml" up -d --build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker compose failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Stack is up!" -ForegroundColor Green
Write-Host "  Local tour:  http://localhost:4321" -ForegroundColor White
Write-Host ""

if (-not $NoOpen) {
    # Try to get Cloudflare tunnel URL (wait up to 20s)
    $tunnelUrl = $null
    Write-Host "  Waiting for Cloudflare tunnel..." -ForegroundColor DarkGray
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline -and -not $tunnelUrl) {
        $logs = docker compose -f "$ComposeDir\docker-compose.yml" logs cloudflared 2>&1
        $match = $logs | Select-String "trycloudflare\.com" -SimpleMatch | Select-Object -Last 1
        if ($match) {
            $tunnelUrl = ($match.Line | Select-String "https://[^\s]+" -AllMatches).Matches[0].Value
        }
        if (-not $tunnelUrl) { Start-Sleep -Milliseconds 500 }
    }

    if ($tunnelUrl) {
        Write-Host "  Tunnel:      $tunnelUrl" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Opening Virtual Tour in browser..." -ForegroundColor White
        Start-Process $tunnelUrl
    } else {
        Write-Host "  Tunnel URL not ready yet — opening local tour." -ForegroundColor Yellow
        Start-Process "http://localhost:4321"
    }
}

Write-Host ""
Write-Host "  To follow logs:  docker compose -f infra\docker\docker-compose.yml logs -f" -ForegroundColor DarkGray
Write-Host "  To stop:         .\dev.ps1 -Down" -ForegroundColor DarkGray
Write-Host ""
