import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promisify } from 'node:util'
import { Client as PgClient } from 'pg'
import { ControlPlaneClient, TenantClient, TenantPrismaManager } from '@hrobot/db'
import { DecryptionError, EncryptionService } from '@hrobot/shared'
import { TenantConnectionResolverService } from './tenant-connection-resolver.service.js'

/**
 * CI-4 — tenant isolation on a REAL Postgres with two separate tenant databases.
 *
 * Until now isolation was only asserted against a mocked Prisma client, which proves the code calls
 * the manager but NOT that two tenants actually land in different databases. This spec exercises the
 * production path end to end:
 *
 *   Tenant row (control-plane, dbUrl encrypted at rest)
 *     → TenantConnectionResolverService.resolveDbUrl (real AES-256-GCM decrypt)
 *       → TenantPrismaManager.getClient (real LRU + $connect)
 *         → TenantClient bound to that tenant's own database
 *
 * WHY THIS TEST CAN GO RED: the last block ("negative control") wires two tenants to the SAME
 * database and asserts the leak IS observed. If someone collapses tenants onto one datasource, the
 * positive assertions above fail; if someone weakens the assertions so a leak stops being visible,
 * the negative control fails. Both directions are covered — a green run means the detector works.
 *
 * REQUIRES: POSTGRES_SUPERUSER_URL (a superuser able to CREATE/DROP DATABASE and CREATE ROLE).
 * Skips itself when unset so `pnpm turbo run test:integration` stays green on a laptop with no
 * services up; CI supplies it from the Postgres service container.
 */

const execFileAsync = promisify(execFile)

const SUPERUSER_URL = process.env.POSTGRES_SUPERUSER_URL
// A throwaway key is fine — these databases exist for the duration of one test run.
const ENCRYPTION_KEY_HEX = process.env.TENANT_DB_ENCRYPTION_KEY ?? 'a'.repeat(64)

const monorepoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..')
const TENANT_SCHEMA = path.join(monorepoRoot, 'packages/db/prisma/tenant/schema.prisma')
const CONTROL_PLANE_SCHEMA = path.join(monorepoRoot, 'packages/db/prisma/control-plane/schema.prisma')

/**
 * Resolve the Prisma CLI's JS entrypoint and run it with the CURRENT node binary. Spawning
 * `pnpm prisma` hangs on Windows (the shell shim never returns under execFile) — same reasoning and
 * same technique as apps/control-plane/src/provisioning/steps/run-migrations.step.ts.
 */
function resolvePrismaCli(): string {
  const dbEntry = require.resolve('@hrobot/db')
  const pkgJson = require.resolve('prisma/package.json', { paths: [dbEntry] })
  return pkgJson.replace(/package\.json$/, 'build/index.js')
}

async function migrateDeploy(databaseUrl: string, schemaPath: string): Promise<void> {
  await execFileAsync(process.execPath, [resolvePrismaCli(), 'migrate', 'deploy', `--schema=${schemaPath}`], {
    // The two schemas read DIFFERENT datasource vars — tenant uses DATABASE_URL, control-plane uses
    // CONTROL_PLANE_DATABASE_URL. Set both to the target so one helper serves either schema and a
    // stray value from a developer's .env can never redirect the migration at another database.
    env: { ...process.env, DATABASE_URL: databaseUrl, CONTROL_PLANE_DATABASE_URL: databaseUrl },
    timeout: 120_000,
  })
}

/** Parse the superuser URL so we can rebuild it pointing at a different database. */
function urlForDatabase(base: string, dbName: string): string {
  const u = new URL(base)
  u.pathname = `/${dbName}`
  return u.toString()
}

// On a laptop with no services up this suite skips so `pnpm turbo run test:integration` stays green.
// In CI a skip would be a FALSE GREEN — the gate would report success while proving nothing — so
// there the missing variable is a hard failure instead. (turbo only forwards env vars it is told
// about; `env: ["CI","POSTGRES_SUPERUSER_URL",…]` on the test:integration task in turbo.json is what
// makes both of these reachable through the task runner.)
if (!SUPERUSER_URL && process.env.CI) {
  throw new Error(
    'POSTGRES_SUPERUSER_URL is required in CI: the tenant-isolation gate must never silently skip. ' +
      'Check the postgres service container and the `env:` allowlist for test:integration in turbo.json.',
  )
}

// `describe.skip` (not a silent pass) so a skipped run is visible in the local log too.
const describeIntegration = SUPERUSER_URL ? describe : describe.skip

describeIntegration('tenant isolation (real Postgres, 2 databases)', () => {
  // Suffix every object with one run id — concurrent runs against a shared cluster never collide.
  const runId = randomUUID().replace(/-/g, '').slice(0, 12)
  const controlDb = `hrobot_it_control_${runId}`
  const tenantA = { id: randomUUID(), slug: `it-a-${runId}`, db: `hrobot_it_a_${runId}` }
  const tenantB = { id: randomUUID(), slug: `it-b-${runId}`, db: `hrobot_it_b_${runId}` }

  const encryption = EncryptionService.fromHexKey(ENCRYPTION_KEY_HEX)

  let admin: PgClient
  let controlPlane: ControlPlaneClient
  let manager: TenantPrismaManager
  let urlA: string
  let urlB: string

  beforeAll(async () => {
    admin = new PgClient({ connectionString: SUPERUSER_URL })
    await admin.connect()

    for (const db of [controlDb, tenantA.db, tenantB.db]) {
      await admin.query(`CREATE DATABASE "${db}"`)
    }

    urlA = urlForDatabase(SUPERUSER_URL!, tenantA.db)
    urlB = urlForDatabase(SUPERUSER_URL!, tenantB.db)

    await migrateDeploy(urlForDatabase(SUPERUSER_URL!, controlDb), CONTROL_PLANE_SCHEMA)
    await migrateDeploy(urlA, TENANT_SCHEMA)
    await migrateDeploy(urlB, TENANT_SCHEMA)

    controlPlane = new ControlPlaneClient({
      datasourceUrl: urlForDatabase(SUPERUSER_URL!, controlDb),
    })
    await controlPlane.$connect()

    // The control-plane row is the ONLY place the tenant→database mapping lives, and dbUrl is
    // stored encrypted — exactly as CreateDbStep writes it in production.
    for (const t of [tenantA, tenantB]) {
      await controlPlane.tenant.create({
        data: {
          id: t.id,
          slug: t.slug,
          name: `IT ${t.slug}`,
          status: 'ACTIVE',
          dbUrl: encryption.encrypt(urlForDatabase(SUPERUSER_URL!, t.db)),
        },
      })
    }

    // The real production wiring, mirroring TenantPrismaModule's factory.
    const resolver = new TenantConnectionResolverService(controlPlane as never, encryption)
    manager = new TenantPrismaManager(resolver, (datasourceUrl) => new TenantClient({ datasourceUrl }))
  })

  afterAll(async () => {
    await manager?.disconnectAll()
    await controlPlane?.$disconnect()
    if (admin) {
      // DROP the whole database rather than deleting rows: audit_log carries triggers that block
      // UPDATE/DELETE/TRUNCATE by design.
      for (const db of [controlDb, tenantA.db, tenantB.db]) {
        await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`).catch(() => undefined)
      }
      await admin.end()
    }
  })

  it('stores each tenant db_url encrypted at rest and decrypts to a distinct database', async () => {
    const rows = await controlPlane.tenant.findMany({
      where: { id: { in: [tenantA.id, tenantB.id] } },
    })
    expect(rows).toHaveLength(2)

    for (const row of rows) {
      // Ciphertext, not the plain connection string — a control-plane dump must not leak credentials.
      expect(row.dbUrl).not.toContain('postgresql://')
      expect(encryption.decrypt(row.dbUrl!)).toContain('postgresql://')
    }

    const resolver = new TenantConnectionResolverService(controlPlane as never, encryption)
    const resolvedA = await resolver.resolveDbUrl(tenantA.id)
    const resolvedB = await resolver.resolveDbUrl(tenantB.id)

    expect(resolvedA).not.toBe(resolvedB)
    expect(resolvedA).toContain(tenantA.db)
    expect(resolvedB).toContain(tenantB.db)
  })

  it('hands each tenant a client bound to its own physical database', async () => {
    const currentDb = async (tenantId: string): Promise<string> => {
      const rows = await manager.withClient(tenantId, (c) =>
        c.$queryRaw<{ current_database: string }[]>`SELECT current_database()`,
      )
      return rows[0]!.current_database
    }

    const dbA = await currentDb(tenantA.id)
    const dbB = await currentDb(tenantB.id)

    expect(dbA).toBe(tenantA.db)
    expect(dbB).toBe(tenantB.db)
    expect(dbA).not.toBe(dbB)
  })

  it('does not leak tenant A rows into tenant B (and vice versa)', async () => {
    const markerA = `A-only-${runId}`
    const markerB = `B-only-${runId}`

    const createdA = await manager.withClient(tenantA.id, (c) =>
      c.lokalizacja.create({ data: { name: markerA, typ: 'BIURO' } }),
    )
    const createdB = await manager.withClient(tenantB.id, (c) =>
      c.lokalizacja.create({ data: { name: markerB, typ: 'BIURO' } }),
    )

    const seenByA = await manager.withClient(tenantA.id, (c) => c.lokalizacja.findMany())
    const seenByB = await manager.withClient(tenantB.id, (c) => c.lokalizacja.findMany())

    // Each side sees exactly its own row — this is the cross-tenant leak assertion.
    expect(seenByA.map((r) => r.name)).toEqual([markerA])
    expect(seenByB.map((r) => r.name)).toEqual([markerB])

    // And A's primary key is simply not addressable from B's client.
    const aRowFromB = await manager.withClient(tenantB.id, (c) =>
      c.lokalizacja.findUnique({ where: { id: createdA.id } }),
    )
    const bRowFromA = await manager.withClient(tenantA.id, (c) =>
      c.lokalizacja.findUnique({ where: { id: createdB.id } }),
    )
    expect(aRowFromB).toBeNull()
    expect(bRowFromA).toBeNull()
  })

  it('keeps a write inside the tenant that made it, even under an interleaved workload', async () => {
    // Interleave so a shared/cached client would surface as a wrong-database row.
    await Promise.all([
      manager.withClient(tenantA.id, (c) =>
        c.organizationalUnit.create({ data: { name: `unit-A-${runId}` } }),
      ),
      manager.withClient(tenantB.id, (c) =>
        c.organizationalUnit.create({ data: { name: `unit-B-${runId}` } }),
      ),
      manager.withClient(tenantA.id, (c) =>
        c.organizationalUnit.create({ data: { name: `unit-A2-${runId}` } }),
      ),
    ])

    const unitsA = await manager.withClient(tenantA.id, (c) => c.organizationalUnit.findMany())
    const unitsB = await manager.withClient(tenantB.id, (c) => c.organizationalUnit.findMany())

    expect(unitsA.map((u) => u.name).sort()).toEqual([`unit-A-${runId}`, `unit-A2-${runId}`])
    expect(unitsB.map((u) => u.name)).toEqual([`unit-B-${runId}`])
  })

  it('refuses to resolve an unknown tenant instead of falling back to some default database', async () => {
    const resolver = new TenantConnectionResolverService(controlPlane as never, encryption)
    await expect(resolver.resolveDbUrl(randomUUID())).rejects.toBeDefined()
    await expect(manager.getClient(randomUUID())).rejects.toBeDefined()
  })

  it('cannot decrypt one tenant db_url with a different key', async () => {
    const row = await controlPlane.tenant.findUniqueOrThrow({ where: { id: tenantA.id } })
    const wrongKey = EncryptionService.fromHexKey('b'.repeat(64))

    expect(() => wrongKey.decrypt(row.dbUrl!)).toThrow(DecryptionError)
  })

  // --- negative control: prove the assertions above can actually fail --------------------------
  describe('negative control — isolation deliberately broken', () => {
    it('DETECTS the leak when two tenants are pointed at one shared database', async () => {
      // Same shape as the real manager, but the resolver maps BOTH tenants to tenant A's database —
      // i.e. the exact misconfiguration CI-4 exists to catch.
      const brokenResolver = { resolveDbUrl: async () => urlA }
      const broken = new TenantPrismaManager(
        brokenResolver,
        (datasourceUrl) => new TenantClient({ datasourceUrl }),
      )

      try {
        const marker = `leak-${runId}`
        await broken.withClient(tenantA.id, (c) =>
          c.lokalizacja.create({ data: { name: marker, typ: 'MAGAZYN' } }),
        )

        // Tenant B's client now sees tenant A's row. The isolation assertion from the test above,
        // replayed here, MUST fail — that is what proves it has teeth.
        const seenByB = await broken.withClient(tenantB.id, (c) => c.lokalizacja.findMany())
        const names = seenByB.map((r) => r.name)

        expect(names).toContain(marker)
        // The positive test asserts `toEqual([markerB])`; under a broken setup that is false.
        expect(names).not.toEqual([`B-only-${runId}`])

        // Clean up the injected row so the shared-DB probe leaves tenant A as the other tests left it.
        await broken.withClient(tenantA.id, (c) => c.lokalizacja.deleteMany({ where: { name: marker } }))
      } finally {
        await broken.disconnectAll()
      }
    })
  })
})
