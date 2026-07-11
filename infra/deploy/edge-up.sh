#!/usr/bin/env bash
# (Re)start the staging "edge": the web front (apps/web) + the Cloudflare named tunnel.
#
# Neither is a docker-compose service (governance: docker-compose.yml is owned by sm-grafik-core and
# must not be edited). They run as detached RUNNER-SIDE processes instead:
#
#   - web front   : node apps/web/serve.mjs  — static SPA + same-origin reverse proxy to the
#                   control-plane (:3000) and tenant-runtime (:3001) published by compose. One origin
#                   → login and /grafik work through a single URL (ENV-3).
#   - cloudflared : `cloudflared tunnel run --token <TOKEN>` — a NAMED tunnel whose public hostname is
#                   configured once in the Cloudflare dashboard to point at http://localhost:${WEB_PORT}.
#                   The URL is STABLE across restarts because the tunnel is named (ENV-2).
#
# Idempotent: any previous instance (tracked by pidfile) is stopped, then a fresh one is started
# detached. The deploy workflow calls this each run; for reboot survival, register it as a logon task
# (see docs/infra/staging-runner.md).
#
# Runs under Git Bash on the Windows dev box (and plain bash on Linux). Requires: node, cloudflared.
#
# Env:
#   CLOUDFLARE_TUNNEL_TOKEN   (required) tunnel token from a runner secret — NEVER commit it.
#   WEB_PORT                  (default 5173) port the web front listens on / the tunnel targets.
#   CONTROL_PLANE_ORIGIN      (default http://localhost:3000)
#   TENANT_RUNTIME_ORIGIN     (default http://localhost:3001)
#   STAGING_STATE_DIR         (default <repo>/.staging-run) pid/log dir (git-ignored).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"

WEB_PORT="${WEB_PORT:-5173}"
STATE_DIR="${STAGING_STATE_DIR:-${REPO_ROOT}/.staging-run}"
mkdir -p "${STATE_DIR}"

export WEB_PORT
export CONTROL_PLANE_ORIGIN="${CONTROL_PLANE_ORIGIN:-http://localhost:3000}"
export TENANT_RUNTIME_ORIGIN="${TENANT_RUNTIME_ORIGIN:-http://localhost:3001}"

stop_by_pidfile() {
  local name="$1" pidfile="${STATE_DIR}/$1.pid"
  if [[ -f "${pidfile}" ]]; then
    local pid
    pid="$(cat "${pidfile}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "  stopping previous ${name} (pid ${pid})"
      kill "${pid}" 2>/dev/null || true
      sleep 1
      kill -9 "${pid}" 2>/dev/null || true
    fi
    rm -f "${pidfile}"
  fi
}

start_detached() {
  local name="$1"; shift
  local log="${STATE_DIR}/$name.log" pidfile="${STATE_DIR}/$name.pid"
  echo "  starting ${name} (log: ${log})"
  # nohup + background + disown so the process survives this script/step exiting.
  nohup "$@" >"${log}" 2>&1 &
  local pid=$!
  echo "${pid}" >"${pidfile}"
  # Detach the just-started background job from this shell so it survives the step exiting.
  disown 2>/dev/null || true
}

# ---- web front -------------------------------------------------------------
stop_by_pidfile web
start_detached web node "${REPO_ROOT}/apps/web/serve.mjs"

# ---- cloudflared named tunnel ---------------------------------------------
if [[ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_TUNNEL_TOKEN is not set — cannot start the Cloudflare tunnel." >&2
  echo "       Provide it from a runner secret; see docs/infra/staging-runner.md." >&2
  exit 1
fi
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "ERROR: cloudflared is not installed / not on PATH. See docs/infra/staging-runner.md." >&2
  exit 1
fi
stop_by_pidfile cloudflared
start_detached cloudflared cloudflared tunnel --no-autoupdate run --token "${CLOUDFLARE_TUNNEL_TOKEN}"

# Give both a moment to bind before the caller's health-check probes them.
sleep 3
echo "Edge up: web front on :${WEB_PORT}, Cloudflare named tunnel running."
echo "  (URL is the public hostname configured for the named tunnel in the Cloudflare dashboard.)"
