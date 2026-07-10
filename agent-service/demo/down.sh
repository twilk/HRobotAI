#!/usr/bin/env bash
# J4 live demo — tear DOWN the standalone agent-service container. Leaves the live stack untouched.
set -euo pipefail
NAME="${AGENT_CONTAINER:-agent-service-demo}"
echo "==> Stopping + removing ${NAME}"
docker.exe rm -f "${NAME}" >/dev/null 2>&1 && echo "    removed ${NAME}" || echo "    ${NAME} not running"
