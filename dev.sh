#!/usr/bin/env bash
# HRobot local dev stack — starts Docker Compose and auto-opens the Virtual Tour.
# Usage: ./dev.sh [--no-open] [--down]
set -euo pipefail

COMPOSE_FILE="$(dirname "$0")/infra/docker/docker-compose.yml"
NO_OPEN=false
DOWN=false

for arg in "$@"; do
  case $arg in
    --no-open) NO_OPEN=true ;;
    --down)    DOWN=true    ;;
  esac
done

if $DOWN; then
  echo "Stopping HRobot stack..."
  docker compose -f "$COMPOSE_FILE" down
  exit 0
fi

echo ""
echo -e "\033[36m  ██╗  ██╗██████╗  ██████╗ ██████╗  ██████╗ ████████╗"
echo -e "  ██║  ██║██╔══██╗██╔═══██╗██╔══██╗██╔═══██╗╚══██╔══╝"
echo -e "  ███████║██████╔╝██║   ██║██████╔╝██║   ██║   ██║   "
echo -e "  ██╔══██║██╔══██╗██║   ██║██╔══██╗██║   ██║   ██║   "
echo -e "  ██║  ██║██║  ██║╚██████╔╝██████╔╝╚██████╔╝   ██║   "
echo -e "  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝  ╚═════╝   ╚═╝   \033[0m"
echo ""
echo "  Starting HRobot.AI development stack..."
echo ""
echo -e "\033[90m  PORTS"
echo "  Postgres     :5433    Redis       :6380"
echo "  RabbitMQ     :5673    RabbitMQ UI :15673"
echo -e "  Keycloak     :8180    Virtual Tour:4321\033[0m"
echo ""

docker compose -f "$COMPOSE_FILE" up -d --build

echo ""
echo -e "  \033[32mStack is up!\033[0m"
echo -e "  Local tour:  \033[1mhttp://localhost:4321\033[0m"
echo ""

if ! $NO_OPEN; then
  # Wait up to 20s for Cloudflare tunnel URL
  echo -e "  \033[90mWaiting for Cloudflare tunnel...\033[0m"
  TUNNEL_URL=""
  for i in $(seq 1 40); do
    TUNNEL_URL=$(docker compose -f "$COMPOSE_FILE" logs cloudflared 2>&1 \
      | grep -oP 'https://[^\s]+\.trycloudflare\.com' | tail -1 || true)
    [ -n "$TUNNEL_URL" ] && break
    sleep 0.5
  done

  if [ -n "$TUNNEL_URL" ]; then
    echo -e "  Tunnel:      \033[36m$TUNNEL_URL\033[0m"
    echo ""
    echo "  Opening Virtual Tour in browser..."
    # Cross-platform open
    if command -v xdg-open &>/dev/null; then
      xdg-open "$TUNNEL_URL"
    elif command -v open &>/dev/null; then
      open "$TUNNEL_URL"
    fi
  else
    echo -e "  \033[33mTunnel URL not ready yet — opening local tour.\033[0m"
    if command -v xdg-open &>/dev/null; then xdg-open "http://localhost:4321"; fi
    if command -v open &>/dev/null; then open "http://localhost:4321"; fi
  fi
fi

echo ""
echo -e "  \033[90mTo follow logs:  docker compose -f infra/docker/docker-compose.yml logs -f"
echo -e "  To stop:         ./dev.sh --down\033[0m"
echo ""
