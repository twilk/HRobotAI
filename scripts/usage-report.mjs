#!/usr/bin/env node
// Aggregate the `app_usage` events the BFF gate writes to stdout (see apps/web/lib/usage-log.ts).
//
// The events answer one question: which of the tenant screens is actually opened, and by which role.
// Without this reader they would be write-only, which is how instrumentation quietly becomes
// decoration.
//
//   docker compose logs --no-log-prefix web | node scripts/usage-report.mjs
//   node scripts/usage-report.mjs < usage.log
//   docker compose logs --no-log-prefix web | node scripts/usage-report.mjs --surface screen
//
// Non-JSON lines are ignored, so piping a whole container log (Next's own startup output included)
// is fine. Exits 0 with a clear message when nothing matched, rather than printing an empty table.

const args = process.argv.slice(2)
const wantSurface = args.includes('--surface') ? args[args.indexOf('--surface') + 1] : null
const showRoles = args.includes('--by-role')

/** Read all of stdin. */
const input = await new Promise((resolve) => {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => (buf += c))
  process.stdin.on('end', () => resolve(buf))
})

const events = []
for (const line of input.split(/\r?\n/)) {
  const start = line.indexOf('{')
  if (start === -1) continue
  try {
    const parsed = JSON.parse(line.slice(start))
    if (parsed?.evt === 'app_usage') events.push(parsed)
  } catch {
    /* not one of ours */
  }
}

if (events.length === 0) {
  console.log('No app_usage events found on stdin.')
  console.log('Hint: docker compose logs --no-log-prefix web | node scripts/usage-report.mjs')
  process.exit(0)
}

const selected = wantSurface ? events.filter((e) => e.surface === wantSurface) : events

/** route -> { hits, roles: Map<role, count>, tenants: Set, denied } */
const byRoute = new Map()
for (const e of selected) {
  const row = byRoute.get(e.route) ?? { hits: 0, roles: new Map(), tenants: new Set(), denied: 0 }
  row.hits += 1
  // 401/307 mean the gate refused — worth seeing separately from real traffic.
  if (e.status === 401 || e.status === 307) row.denied += 1
  if (e.tenant) row.tenants.add(e.tenant)
  for (const role of e.roles?.length ? e.roles : ['(none)']) {
    row.roles.set(role, (row.roles.get(role) ?? 0) + 1)
  }
  byRoute.set(e.route, row)
}

const rows = [...byRoute.entries()].sort((a, b) => b[1].hits - a[1].hits)
const span = [selected.map((e) => e.ts).sort()].flat()

console.log(`app_usage — ${selected.length} events${wantSurface ? ` (surface=${wantSurface})` : ''}`)
console.log(`window: ${span[0]} .. ${span[span.length - 1]}`)
console.log('')
console.log('  hits  denied  tenants  route')
console.log('  ----  ------  -------  -----')
for (const [route, r] of rows) {
  console.log(
    `  ${String(r.hits).padStart(4)}  ${String(r.denied).padStart(6)}  ${String(r.tenants.size).padStart(7)}  ${route}`,
  )
  if (showRoles) {
    for (const [role, n] of [...r.roles].sort((a, b) => b[1] - a[1])) {
      console.log(`                             ${String(n).padStart(4)}  ${role}`)
    }
  }
}

// The actual point of the exercise: what nobody opened.
const screens = new Set(selected.filter((e) => e.surface === 'screen').map((e) => e.route))
if (screens.size > 0) {
  console.log('')
  console.log(`screens touched in this window: ${[...screens].sort().join(', ')}`)
}
