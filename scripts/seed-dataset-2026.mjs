#!/usr/bin/env node
// Generates AUTO shifts for the June–September 2026 dataset by running the REAL solver week-by-week
// (global scope), so every shift respects the hard constraints (H1 coverage, H2 no-overlap, H3 leave,
// H4 11h rest) — not hand-seeded rows. Run scripts/seed-dataset-2026.sql FIRST (demands + leave).
//
// Deliberately SKIPS the demo fortnight (Jul 13 & Jul 20 weeks): those shifts + the seeded J5 swap are
// demo anchors and a re-solve would regenerate/clear them. Prints a per-week feasibility map; the
// Sep 14 week is expected INFEASIBLE (all coordinators on leave — the showcase).
//
//   node scripts/seed-dataset-2026.mjs

const KC = process.env.KC_URL || 'http://localhost:8081'
const TR = process.env.TENANT_RUNTIME_URL || 'http://localhost:3001'

// Every Monday in Jun–Sep 2026 EXCEPT the demo fortnight (2026-07-13, 2026-07-20).
const WEEKS = [
  '2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29',
  '2026-07-06', '2026-07-27',
  '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31',
  '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28',
]

async function login() {
  const res = await fetch(`${KC}/realms/hrobot-staging/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: 'hrobot-web', username: 'demo', password: 'demo-staging-2026', grant_type: 'password' }),
  })
  if (!res.ok) throw new Error(`login ${res.status}: ${await res.text()}`)
  return (await res.json()).access_token
}

async function solve(token, weekStart) {
  const res = await fetch(`${TR}/api/grafik/solve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekStart }),
  })
  const body = await res.json().catch(() => ({}))
  return { http: res.status, status: body.status, created: body.assignmentsCreated, unmet: (body.unmet || []).length }
}

async function main() {
  const token = await login()
  console.log(`Solving ${WEEKS.length} weeks (Jun–Sep 2026, demo fortnight skipped)\n`)
  const rows = []
  for (const w of WEEKS) {
    let r
    try {
      r = await solve(token, w)
    } catch (e) {
      r = { http: 0, status: 'ERROR', created: 0, unmet: 0, err: e.message }
    }
    const tag = r.status === 'OPTIMAL' || r.status === 'FEASIBLE' ? '✓' : r.status === 'INFEASIBLE' ? '⚠' : '✗'
    console.log(`  ${tag} ${w}  ${String(r.status).padEnd(11)} created=${String(r.created ?? 0).padStart(3)}  unmet=${r.unmet ?? '-'}`)
    rows.push({ w, ...r })
  }
  const ok = rows.filter((r) => r.status === 'OPTIMAL' || r.status === 'FEASIBLE').length
  const infeasible = rows.filter((r) => r.status === 'INFEASIBLE')
  const created = rows.reduce((s, r) => s + (r.created || 0), 0)
  console.log(`\nSummary: ${ok}/${WEEKS.length} feasible, ${infeasible.length} infeasible, ${created} AUTO shifts created.`)
  if (infeasible.length) console.log(`Infeasible weeks (expected — showcase): ${infeasible.map((r) => r.w).join(', ')}`)
  console.log('Demo fortnight (Jul 13/20) left untouched: Anna\'s shifts + J5 swap preserved.')
}

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1) })
