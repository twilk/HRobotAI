#!/usr/bin/env node
// Golden-path synthetic probe: does the product actually work right now?
//
// WHY. There is one Prometheus counter in tenant-runtime and it measures a Redis fallback. There is
// no SLO, no error budget, and no end-to-end suite. "Is it working" was answerable only by a human
// running curl — which means on the morning of a demo nobody knows until the demo. This walks the
// path the product is judged on and turns that question into a number.
//
// The path, in order, because each step depends on the previous one:
//   1. health/ready   the service is up AND its dependencies (DB, Redis) answer
//   2. token          Keycloak issues a token for the demo account (auth is wired)
//   3. units          an authenticated read reaches the tenant database (RBAC + tenant routing)
//   4. shifts         the week's roster reads back (the screen's primary query)
//   5. solve          CP-SAT returns a schedule for that week — OPT-IN, see below
//
// THE SOLVE STEP WRITES AND IS THEREFORE OFF BY DEFAULT. `POST /grafik/solve` persists its result as
// `Shift(source=AUTO)` (grafik.controller.ts). A probe on a 5-minute loop with that step enabled
// would rewrite the live roster 288 times a day and quietly destroy the demo data it is supposed to
// be guarding. Enable it with --include-solve only against a throwaway tenant. The four default
// steps already prove the things that actually break: the service, auth, tenant routing, and data.
//
// Usage:
//   node scripts/golden-path-probe.mjs                       # one pass, exit 0/1
//   node scripts/golden-path-probe.mjs --loop 300            # every 5 min until killed
//   node scripts/golden-path-probe.mjs --json >> probe.jsonl # one JSON line per pass
//   node scripts/golden-path-probe.mjs --include-solve       # adds the WRITING solver step
//
// Env: TENANT_RUNTIME_URL (must include /api), KEYCLOAK_TOKEN_URL, KEYCLOAK_CLIENT_ID,
//      KEYCLOAK_USERNAME, KEYCLOAK_PASSWORD. No password is ever printed or logged.
//
// Deliberately dependency-free (node: builtins + fetch) so it runs from any host, a container, or a
// CI step without an install.

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)

const JSON_OUT = flag('--json')
/** Off by default: POST /grafik/solve persists Shift(source=AUTO). See the header. */
const INCLUDE_SOLVE = flag('--include-solve')
const LOOP_SECONDS = args.includes('--loop') ? Number(value('--loop', '300')) : null
const TIMEOUT_MS = Number(value('--timeout', '20000'))

const BASE = (process.env.TENANT_RUNTIME_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '')
const TOKEN_URL = process.env.KEYCLOAK_TOKEN_URL ?? ''
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'hrobot-web'
const USERNAME = process.env.KEYCLOAK_USERNAME ?? ''
const PASSWORD = process.env.KEYCLOAK_PASSWORD ?? ''

/** fetch with a hard timeout — a hung dependency must read as a failure, not as a stuck probe. */
async function timed(label, fn) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const detail = await fn(controller.signal)
    return { step: label, ok: true, ms: Date.now() - started, ...detail }
  } catch (err) {
    return {
      step: label,
      ok: false,
      ms: Date.now() - started,
      error: err?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : String(err?.message ?? err),
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Monday of the current ISO week, as YYYY-MM-DD. The solver works a week at a time. */
function weekStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

async function runOnce() {
  const startedAt = new Date().toISOString()
  const steps = []
  let token = null

  steps.push(
    await timed('health/ready', async (signal) => {
      const res = await fetch(`${BASE}/health/ready`, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: res.status }
    }),
  )

  if (steps.at(-1).ok) {
    steps.push(
      await timed('token', async (signal) => {
        if (!TOKEN_URL || !USERNAME || !PASSWORD) {
          throw new Error('KEYCLOAK_TOKEN_URL / KEYCLOAK_USERNAME / KEYCLOAK_PASSWORD not set')
        }
        const body = new URLSearchParams({
          grant_type: 'password',
          client_id: CLIENT_ID,
          username: USERNAME,
          password: PASSWORD,
        })
        const res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!json.access_token) throw new Error('no access_token in response')
        token = json.access_token
        return { status: res.status }
      }),
    )
  }

  const auth = () => ({ authorization: `Bearer ${token}` })

  if (token) {
    steps.push(
      await timed('units', async (signal) => {
        const res = await fetch(`${BASE}/grafik/units`, { headers: auth(), signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const rows = await res.json()
        // An authenticated read that returns nothing means the tenant routed to an empty database —
        // a green 200 that hides a broken deployment. This is the blackout the QA pass caught.
        if (!Array.isArray(rows) || rows.length === 0) throw new Error('200 but zero units (empty tenant?)')
        return { status: res.status, count: rows.length }
      }),
    )

    const from = weekStart()
    steps.push(
      await timed('shifts', async (signal) => {
        const res = await fetch(`${BASE}/grafik/shifts?from=${from}&days=7`, { headers: auth(), signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const rows = await res.json()
        return { status: res.status, count: Array.isArray(rows) ? rows.length : undefined }
      }),
    )

    if (INCLUDE_SOLVE) {
      steps.push(
        await timed('solve', async (signal) => {
          // SolveGrafikDto wants `weekStart`, and validates it is a real Monday — the horizon is the
          // 7 days starting there. `from` is already that Monday.
          const res = await fetch(`${BASE}/grafik/solve`, {
            method: 'POST',
            headers: { ...auth(), 'content-type': 'application/json' },
            body: JSON.stringify({ weekStart: from }),
            signal,
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const json = await res.json()
          const status = json?.status ?? json?.result?.status
          // INFEASIBLE is a legitimate answer (the solver reporting it cannot cover the week); a
          // MISSING status means we did not reach the solver at all.
          if (!status) throw new Error('solver returned no status field')
          return { status: res.status, solverStatus: status }
        }),
      )
    }
  }

  const ok = steps.every((s) => s.ok)
  return { probe: 'golden_path', ts: startedAt, ok, totalMs: steps.reduce((a, s) => a + s.ms, 0), steps }
}

function report(result) {
  if (JSON_OUT) {
    console.log(JSON.stringify(result))
    return
  }
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  golden path  ${result.totalMs}ms  ${result.ts}`)
  for (const s of result.steps) {
    const mark = s.ok ? 'ok  ' : 'FAIL'
    const extra = s.error ? `  ${s.error}` : s.solverStatus ? `  solver=${s.solverStatus}` : s.count !== undefined ? `  n=${s.count}` : ''
    console.log(`  ${mark} ${String(s.ms).padStart(6)}ms  ${s.step}${extra}`)
  }
}

if (LOOP_SECONDS) {
  console.error(`golden-path probe: every ${LOOP_SECONDS}s against ${BASE} (ctrl-c to stop)`)
  // Sequential, not setInterval: a slow pass must not overlap the next one.
  for (;;) {
    report(await runOnce())
    await new Promise((r) => setTimeout(r, LOOP_SECONDS * 1000))
  }
} else {
  const result = await runOnce()
  report(result)
  process.exit(result.ok ? 0 : 1)
}
