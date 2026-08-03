import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promisify } from 'node:util'
import { Client as PgClient } from 'pg'
import { TenantClient } from '@hrobot/db'
import { LeaveStatus } from '@hrobot/shared'
import { AnalitykService } from './analityk.service.js'
import { buildRange } from './analityk.range.js'

/**
 * C2-6 — Analityk HR against a REAL Postgres, over TWO DISJOINT TIME WINDOWS.
 *
 * WHY THIS FILE EXISTS. The module ships 162 green unit tests and not one of them could have caught
 * the bugs this spec covers. `analityk.service.spec.ts` drives a mocked Prisma client that IGNORES
 * the `where` clause and hands back the same rows for every query — the spec admits it in a comment:
 * "The mock returns the same rows for both windows, so every delta is 0". That blindness hides an
 * entire class of defect: A HISTORICAL EVENT READ THROUGH THE CURRENT STATE. Concretely, before the
 * C2-1/C2-2 fixes:
 *
 *   - `stanNaKoniec` filtered `hiredAt < toExcl` and then read the CURRENT `User.active` flag, so
 *     the previous window's employee set was always a SUBSET of the current one and the headcount
 *     delta could never be negative. `SPADEK_ZATRUDNIENIA` (needs a drop of >= 2) was unreachable.
 *   - `wToku` filtered `status = PENDING` — "undecided RIGHT NOW" — so a backlog the team had since
 *     cleared could only look flat or worse, never better.
 *   - `odejscia` came out as a hard `0` (not `null`) for a tenant whose employees carry no `userId`,
 *     which is exactly the shape the canonical seed produces.
 *
 * Real rows in a real database, two windows that do not overlap, and the arithmetic has nowhere to
 * hide. THE ASSERTIONS ARE DIRECTIONAL (`toBeLessThan(0)`), not just "some number came back" — a
 * regression to the old implementation makes them fail rather than merely change a value.
 *
 * REQUIRES: POSTGRES_SUPERUSER_URL — a superuser that can CREATE/DROP DATABASE. The suite skips
 * itself when unset so a laptop with no services up keeps `pnpm turbo run test:integration` green;
 * in CI a skip would be a FALSE GREEN, so there the missing variable is a hard failure.
 *
 *   docker run -d --name hrobot-c2-pg -p 55437:5432 -e POSTGRES_PASSWORD=c2pass postgres:16-alpine
 *   POSTGRES_SUPERUSER_URL=postgresql://postgres:c2pass@127.0.0.1:55437/postgres \
 *     pnpm -C apps/tenant-runtime test:integration
 *   docker rm -f hrobot-c2-pg
 */

const execFileAsync = promisify(execFile)

const SUPERUSER_URL = process.env.POSTGRES_SUPERUSER_URL

const monorepoRoot = path.resolve(__dirname, '..', '..', '..', '..')
const TENANT_SCHEMA = path.join(monorepoRoot, 'packages/db/prisma/tenant/schema.prisma')

/**
 * Resolve the Prisma CLI's JS entrypoint and run it with the CURRENT node binary. Spawning
 * `pnpm prisma` hangs on Windows (the shell shim never returns under execFile) — same reasoning and
 * same technique as tenant-isolation.integration.spec.ts and run-migrations.step.ts.
 */
function resolvePrismaCli(): string {
  const dbEntry = require.resolve('@hrobot/db')
  const pkgJson = require.resolve('prisma/package.json', { paths: [dbEntry] })
  return pkgJson.replace(/package\.json$/, 'build/index.js')
}

async function migrateDeploy(databaseUrl: string): Promise<void> {
  await execFileAsync(process.execPath, [resolvePrismaCli(), 'migrate', 'deploy', `--schema=${TENANT_SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    timeout: 120_000,
  })
}

function urlForDatabase(base: string, dbName: string): string {
  const u = new URL(base)
  u.pathname = `/${dbName}`
  return u.toString()
}

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`)
const at = (iso: string): Date => new Date(iso)

if (!SUPERUSER_URL && process.env.CI) {
  throw new Error(
    'POSTGRES_SUPERUSER_URL is required in CI: the analityk gate must never silently skip. ' +
      'Check the postgres service container and the `env:` allowlist for test:integration in turbo.json.',
  )
}

// `describe.skip` (not a silent pass) so a skipped run is visible in the local log too.
const describeIntegration = SUPERUSER_URL ? describe : describe.skip

describeIntegration('analityk over two DISJOINT windows (real Postgres)', () => {
  const runId = randomUUID().replace(/-/g, '').slice(0, 12)
  const dbName = `hrobot_it_analityk_${runId}`

  /**
   * TWO WINDOWS THAT DO NOT OVERLAP. `porownanie()` derives the previous window itself as the
   * immediately preceding one of equal length, so asking for POPRZEDNIE alone is enough to make the
   * service query both.
   *
   *   poprzednie: 2026-03-02 (Mon) .. 2026-03-15 (Sun)   14 days, 10 working days
   *   biezace:    2026-03-16 (Mon) .. 2026-03-29 (Sun)   14 days, 10 working days
   */
  const POPRZEDNIE = buildRange('2026-03-02', '2026-03-15')
  const BIEZACE = buildRange('2026-03-16', '2026-03-29')

  const service = new AnalitykService()

  let client: TenantClient
  let admin: PgClient
  let unitId: string
  const employeeIds: string[] = []

  /** Six employees, all hired well before both windows, each with their own user account. */
  const EMPLOYEE_COUNT = 6

  beforeAll(async () => {
    admin = new PgClient({ connectionString: SUPERUSER_URL })
    await admin.connect()
    await admin.query(`CREATE DATABASE "${dbName}"`)

    const url = urlForDatabase(SUPERUSER_URL as string, dbName)
    await migrateDeploy(url)

    client = new TenantClient({ datasourceUrl: url })
    await client.$connect()

    unitId = randomUUID()
    const lokalizacjaId = randomUUID()

    await client.organizationalUnit.create({ data: { id: unitId, name: 'Serwis', managerUserId: null } })
    await client.lokalizacja.create({ data: { id: lokalizacjaId, name: 'Warszawa', typ: 'SERWIS' } })

    for (let i = 0; i < EMPLOYEE_COUNT; i += 1) {
      const userId = randomUUID()
      const employeeId = randomUUID()
      employeeIds.push(employeeId)

      await client.user.create({
        data: {
          id: userId,
          email: `it-${runId}-${i}@example.test`,
          keycloakSub: `kc-${runId}-${i}`,
          // e3..e5 are switched off TODAY — the audit rows below say WHEN, and that is the whole point.
          active: i < 3,
        },
      })
      await client.employee.create({
        data: {
          id: employeeId,
          userId,
          firstName: `Imie${i}`,
          lastName: `Nazwisko${i}`,
          // Synthetic, non-PII placeholders: this spec never exercises the PESEL encryption path.
          pesel: `ciphertext-${runId}-${i}`,
          peselHash: `hash-${runId}-${i}`,
          position: 'Operator',
          employmentType: 'UMOWA_O_PRACE',
          hiredAt: d('2024-01-08'),
          unitId,
          etat: 1.0,
        },
      })
    }

    /**
     * THREE ACCOUNTS SWITCHED OFF INSIDE THE CURRENT WINDOW ONLY. At the end of the previous window
     * all six are on the books; at the end of the current one, three are left. Reading the CURRENT
     * `User.active` flag for both (the old implementation) would report 3 for BOTH windows and a
     * delta of exactly 0.
     */
    for (let i = 3; i < EMPLOYEE_COUNT; i += 1) {
      const employee = await client.employee.findUnique({ where: { id: employeeIds[i] as string }, select: { userId: true } })
      await client.auditLog.create({
        data: {
          actorUserId: 'kc-admin',
          action: 'user.deactivated',
          entityType: 'User',
          entityId: employee?.userId as string,
          payload: {},
          ipAddress: '10.0.0.1',
          createdAt: at(`2026-03-2${i}T10:00:00.000Z`), // 2026-03-23 / -24 / -25, all inside BIEZACE
        },
      })
    }

    /**
     * SEVEN REQUESTS FILED BEFORE THE PREVIOUS WINDOW CLOSED, SIX OF THEM DECIDED INSIDE THE CURRENT
     * ONE. Backlog at the end of the previous window: 7. At the end of the current one: 1.
     * The old `status = PENDING` filter sees today's status for both windows — 1 and 1, delta 0 —
     * so a queue that was actually drained looked perfectly flat.
     */
    for (let i = 0; i < 7; i += 1) {
      const decided = i < 6
      await client.leaveRequest.create({
        data: {
          employeeId: employeeIds[i % EMPLOYEE_COUNT] as string,
          startDate: d('2026-04-06'),
          endDate: d('2026-04-10'),
          status: decided ? LeaveStatus.APPROVED : LeaveStatus.PENDING,
          type: 'URLOP_WYPOCZYNKOWY',
          createdAt: at('2026-03-10T09:00:00.000Z'), // inside POPRZEDNIE
          decidedAt: decided ? at('2026-03-18T09:00:00.000Z') : null, // inside BIEZACE
          decidedByUserId: null,
        },
      })
    }

    /**
     * ROSTERED HOURS ONLY IN THE PREVIOUS WINDOW. If the `where` clause were ignored (as the unit
     * mock ignores it), both windows would report the same hours.
     */
    for (const day of ['2026-03-02', '2026-03-03', '2026-03-04']) {
      await client.shift.create({
        data: {
          employeeId: employeeIds[0] as string,
          lokalizacjaId,
          date: d(day),
          start: '08:00',
          end: '16:00',
          role: 'OPERATOR',
        },
      })
    }
  })

  afterAll(async () => {
    await client?.$disconnect()
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
      await admin.end()
    }
  })

  // --- the class of bug the mocked lane cannot see -------------------------------------------------

  it('returns DIFFERENT hours for the two windows — the where clause is actually applied', async () => {
    const poprzednie = await service.czasPracy(client, null, POPRZEDNIE)
    const biezace = await service.czasPracy(client, null, BIEZACE)

    expect(poprzednie.sumaGodzin).toBe(24) // 3 × 8h
    expect(biezace.sumaGodzin).toBe(0)
    expect(poprzednie.sumaGodzin).not.toBe(biezace.sumaGodzin)
  })

  it('sees headcount FALL between the windows — the drop is measurable at all', async () => {
    const poprzednie = await service.zatrudnienie(client, null, POPRZEDNIE)
    const biezace = await service.zatrudnienie(client, null, BIEZACE)

    // All six were on the books when the previous window closed; three accounts were switched off
    // inside the current one. Reading the current `active` flag would give 3 and 3.
    expect(poprzednie.stanNaKoniec).toBe(EMPLOYEE_COUNT)
    expect(biezace.stanNaKoniec).toBe(3)
    expect(biezace.stanNaKoniec - poprzednie.stanNaKoniec).toBeLessThan(0)
  })

  it('attributes the three departures to the window they happened in, not to both', async () => {
    const poprzednie = await service.zatrudnienie(client, null, POPRZEDNIE)
    const biezace = await service.zatrudnienie(client, null, BIEZACE)

    expect(poprzednie.odejscia).toBe(0)
    expect(biezace.odejscia).toBe(3)
    // 3 departures over an average headcount of (6+3)/2 = 4.5 → 0.6667 FOR THIS 14-DAY PERIOD.
    expect(biezace.rotacjaWOkresie).toBe(0.6667)
  })

  it('reports a NEGATIVE headcount delta from porownanie() — structurally impossible before', async () => {
    const { biezacy, poprzedni, zmiana } = await service.porownanie(client, null, BIEZACE)

    expect(poprzedni.od).toBe('2026-03-02') // the service derived the previous window itself
    expect(poprzedni.do).toBe('2026-03-15')
    expect(biezacy.stanZatrudnienia).toBe(3)
    expect(poprzedni.stanZatrudnienia).toBe(EMPLOYEE_COUNT)
    expect(zmiana.stanZatrudnienia).toBe(-3)
    expect(zmiana.stanZatrudnienia).toBeLessThan(0)
  })

  it('fires SPADEK_ZATRUDNIENIA end to end — the rule is no longer dead code in production', async () => {
    const { anomalie } = await service.anomalie(client, null, BIEZACE)

    const spadek = anomalie.find((a) => a.kod === 'SPADEK_ZATRUDNIENIA')
    expect(spadek).toBeDefined()
    expect(spadek?.waga).toBe('wysoka')
    expect(spadek?.wartoscPoprzednia).toBe(EMPLOYEE_COUNT)
    expect(spadek?.wartoscBiezaca).toBe(3)
    expect(spadek?.zmiana).toBe(-3)
  })

  it('shows the approval queue being DRAINED — a cleared backlog reads as an improvement', async () => {
    const { biezacy, poprzedni, zmiana } = await service.porownanie(client, null, BIEZACE)

    expect(poprzedni.wnioskiWToku).toBe(7) // all seven were still open on 2026-03-15
    expect(biezacy.wnioskiWToku).toBe(1) // six were decided on 2026-03-18
    expect(zmiana.wnioskiWToku).toBe(-6)
    expect(zmiana.wnioskiWToku).toBeLessThan(0)
  })

  it('ages the remaining backlog against the END of the range, not wall-clock now', async () => {
    const wnioski = await service.wnioski(client, null, BIEZACE)

    expect(wnioski.wToku).toBe(1)
    const kolejka = wnioski.waskieGardla.find((w) => w.unitId === unitId)
    // Filed 2026-03-10T09:00Z, window ends 2026-03-29T00:00Z → 18 whole days, whatever today is.
    expect(kolejka?.najstarszyWiekDni).toBe(18)
  })

  // --- the null-not-zero convention on real rows ---------------------------------------------------

  it('reports odejscia/rotacja as UNKNOWN when kartoteki carry no user account (the seed shape)', async () => {
    // The canonical seed's `SeedEmployee` has no `userId`, so the audit trail cannot be joined to
    // anybody. Detach every account and the answer must become NIEZNANE, never a reassuring 0%.
    await client.employee.updateMany({ data: { userId: null } })
    try {
      const r = await service.zatrudnienie(client, null, BIEZACE)
      expect(r.odejscia).toBeNull()
      expect(r.rotacjaWOkresie).toBeNull()
      expect(r.zmiana).toBeNull()
      expect(r.meta.uwagi.join(' ')).toMatch(/NIEZNANE/)
    } finally {
      // Re-link so the suite leaves the fixture as it found it (order-independent specs).
      const users = await client.user.findMany({ select: { id: true, keycloakSub: true } })
      for (const [i, employeeId] of employeeIds.entries()) {
        const user = users.find((u) => u.keycloakSub === `kc-${runId}-${i}`)
        await client.employee.update({ where: { id: employeeId }, data: { userId: user?.id as string } })
      }
    }
  })
})
