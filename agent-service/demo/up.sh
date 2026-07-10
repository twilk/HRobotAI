#!/usr/bin/env bash
# J4 live demo — bring the agent-service UP standalone, joined to the LIVE stack network so it
# reaches the real CP-SAT optimizer. This is the "standalone, NOT via compose" wiring: we do NOT
# touch docker-compose.yml (owned by another team). The reserved compose `agent` slot is the
# alternative in-stack wiring and is a documented follow-up (needs an sm-grafik-core PR) — see
# agent-service/README.md § "J4 live demo".
#
# Uses docker.exe (Windows Docker Desktop daemon) per the repo's WSL convention — NOT `docker`.
set -euo pipefail

NAME="${AGENT_CONTAINER:-agent-service-demo}"
IMAGE="${AGENT_IMAGE:-agent-service:demo}"
NET="${STACK_NETWORK:-hrobot_default}"          # the live stack network the optimizer is on
HOST_PORT="${AGENT_HOST_PORT:-8010}"            # fixed free host port for the agent
OPTIMIZER_URL="${OPTIMIZER_URL:-http://optimizer:8000}"  # optimizer's in-network alias

# Resolve the build context (the agent-service dir) relative to this script, so the script works
# from any CWD.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT="$(dirname "$HERE")"

echo "==> Building ${IMAGE} (context: ${CONTEXT})"
docker.exe build -t "${IMAGE}" "${CONTEXT}"

echo "==> Removing any previous ${NAME}"
docker.exe rm -f "${NAME}" >/dev/null 2>&1 || true

echo "==> Running ${NAME} on host port ${HOST_PORT}, network ${NET}, OPTIMIZER_URL=${OPTIMIZER_URL}"
# --restart unless-stopped: durable keep-alive so the UAT demo survives a Docker daemon / host
# restart (it comes back up automatically unless we explicitly `docker stop`/down.sh it).
docker.exe run -d --name "${NAME}" --network "${NET}" -p "${HOST_PORT}:8000" \
  --restart unless-stopped \
  -e OPTIMIZER_URL="${OPTIMIZER_URL}" "${IMAGE}" >/dev/null

echo "==> Waiting for GET http://localhost:${HOST_PORT}/health"
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:${HOST_PORT}/health" >/dev/null 2>&1; then
    echo "    health OK: $(curl -fsS "http://localhost:${HOST_PORT}/health")"
    echo ""
    echo "agent-service-demo is UP."
    echo "  health:  http://localhost:${HOST_PORT}/health"
    echo "  demo UI: http://localhost:${HOST_PORT}/agent/demo"
    echo "  next:    python3 agent-service/demo/j4_live_demo.py --base http://localhost:${HOST_PORT}"
    exit 0
  fi
  sleep 1
done

echo "!! health check did not pass in time; recent logs:" >&2
docker.exe logs --tail 40 "${NAME}" >&2 || true
exit 1
