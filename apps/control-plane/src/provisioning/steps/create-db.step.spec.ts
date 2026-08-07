import { Test, TestingModule } from '@nestjs/testing'
import type { Client as PgClient } from 'pg'
import { CreateDbStep } from './create-db.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  provisioningJob: { update: jest.fn() },
}

const mockPg = { query: jest.fn() }

const testKey = Buffer.from('a'.repeat(64), 'hex')
const encryption = new EncryptionService(testKey)

const job = {
  id: 'job-1',
  tenantId: 'tenant-1',
  step: ProvisioningStep.CREATE_DB,
  attemptCount: 0,
}

const tenant = {
  id: 'tenant-1',
  slug: 'acme',
  metadata: { adminEmail: 'admin@acme.com' },
}

describe('CreateDbStep', () => {
  let step: CreateDbStep

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateDbStep,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: 'SUPERUSER_PG_CLIENT', useValue: mockPg },
        { provide: EncryptionService, useValue: encryption },
        { provide: 'POSTGRES_HOST', useValue: 'localhost' },
        { provide: 'POSTGRES_PORT', useValue: '5433' },
      ],
    }).compile()
    step = module.get(CreateDbStep)
    jest.clearAllMocks()
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue(tenant)
    mockPg.query.mockResolvedValue({ rows: [] })
    mockPrisma.tenant.update.mockResolvedValue({})
    mockPrisma.provisioningJob.update.mockResolvedValue({})
  })

  it('creates the role and database when neither exists', async () => {
    await step.execute(job)
    const sql = mockPg.query.mock.calls.map((c) => String(c[0]))
    expect(sql.some((s) => /CREATE ROLE/.test(s))).toBe(true)
    expect(sql.some((s) => /CREATE DATABASE/.test(s))).toBe(true)
  })

  it('is idempotent on retry: ALTERs an existing role and skips an existing database', async () => {
    // pg_roles / pg_database existence checks return a row → resource already exists
    mockPg.query.mockImplementation((sql: string) =>
      /pg_roles|pg_database/.test(sql)
        ? Promise.resolve({ rows: [{ exists: 1 }] })
        : Promise.resolve({ rows: [] }),
    )
    await step.execute(job)
    const sql = mockPg.query.mock.calls.map((c) => String(c[0]))
    expect(sql.some((s) => /ALTER ROLE/.test(s))).toBe(true)
    expect(sql.some((s) => /CREATE DATABASE/.test(s))).toBe(false)
  })

  it('stores an encrypted db_url in tenants and advances step to RUN_MIGRATIONS', async () => {
    await step.execute(job)

    const tenantUpdateCall = mockPrisma.tenant.update.mock.calls[0]?.[0] as {
      data: { dbUrl: string }
    }
    const encryptedUrl = tenantUpdateCall.data.dbUrl
    // Must be base64 (encrypted), not plaintext
    expect(encryptedUrl).not.toMatch(/^postgresql:\/\//)
    // Must decrypt back to a valid URL
    const decrypted = encryption.decrypt(encryptedUrl)
    expect(decrypted).toMatch(/^postgresql:\/\//)

    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.RUN_MIGRATIONS },
    })
  })

  /**
   * W4 — dbUrl (control-plane row, via `this.prisma`) and the role's actual password (the
   * superuser cluster connection, `this.pg`) are two independent, non-transactional writes
   * (CREATE DATABASE cannot even run inside a transaction block). Two concurrent runs for the
   * SAME tenant — reachable whenever a slow-but-alive consumer's lease expires and a second
   * consumer legitimately takes over (W2 shows the claim alone does not forbid this) — can
   * otherwise interleave their password rotations so the recorded dbUrl and the actually-active
   * role password come from DIFFERENT runs.
   *
   * This models the race with a fake pg client that (a) tracks role state exactly like real
   * Postgres (last ALTER/CREATE ROLE wins) and (b) implements a REAL mutex for
   * `pg_advisory_lock`/`pg_advisory_unlock`, so the fix's own locking is exercised, not bypassed.
   * The FIRST ALTER/CREATE ROLE call in the whole test is gated so a second, concurrent run has a
   * real window to interleave if nothing is serializing them.
   *
   * THE PROPERTY: whatever the interleaving, the password embedded in the FINAL recorded dbUrl
   * must equal the password actually active on the role — the tenant must never be locked out of
   * its own database.
   */
  it('never records a dbUrl whose password does not match the actually-active role password, under concurrent runs', async () => {
    let locked = false
    const waiters: Array<() => void> = []
    const acquire = (): Promise<void> =>
      new Promise((resolve) => {
        if (!locked) {
          locked = true
          resolve()
          return
        }
        waiters.push(() => {
          locked = true
          resolve()
        })
      })
    const release = (): void => {
      const next = waiters.shift()
      if (next) next()
      else locked = false
    }

    let resolveDdlGate!: () => void
    const ddlGate = new Promise<void>((resolve) => {
      resolveDdlGate = resolve
    })
    let ddlCallCount = 0
    const roles = new Map<string, string>()
    const dbs = new Set<string>()

    const racePg = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (/pg_advisory_lock/.test(sql)) {
          await acquire()
          return { rows: [] }
        }
        if (/pg_advisory_unlock/.test(sql)) {
          release()
          return { rows: [] }
        }
        if (/SELECT 1 FROM pg_roles/.test(sql)) {
          return { rows: roles.has(String(params[0])) ? [{ x: 1 }] : [] }
        }
        const create = /CREATE ROLE "([^"]+)" LOGIN PASSWORD '([^']+)'/.exec(sql)
        const alter = /ALTER ROLE "([^"]+)" WITH PASSWORD '([^']+)'/.exec(sql)
        const ddl = create ?? alter
        if (ddl) {
          ddlCallCount += 1
          if (ddlCallCount === 1) await ddlGate
          roles.set(ddl[1]!, ddl[2]!)
          return { rows: [] }
        }
        if (/SELECT 1 FROM pg_database/.test(sql)) {
          return { rows: dbs.has(String(params[0])) ? [{ x: 1 }] : [] }
        }
        const createDb = /CREATE DATABASE "([^"]+)"/.exec(sql)
        if (createDb) {
          dbs.add(createDb[1]!)
          return { rows: [] }
        }
        return { rows: [] }
      }),
    }

    let storedDbUrl: string | null = null
    const racePrisma = {
      tenant: {
        findUniqueOrThrow: jest.fn(async () => tenant),
        update: jest.fn(async ({ data }: { data: { dbUrl: string } }) => {
          storedDbUrl = data.dbUrl
          return {}
        }),
      },
      provisioningJob: { update: jest.fn(async () => ({})) },
    }

    const stepA = new CreateDbStep(
      racePrisma as unknown as ControlPlanePrismaService,
      racePg as unknown as PgClient,
      encryption,
      'localhost',
      '5433',
    )
    const stepB = new CreateDbStep(
      racePrisma as unknown as ControlPlanePrismaService,
      racePg as unknown as PgClient,
      encryption,
      'localhost',
      '5433',
    )

    const runA = stepA.execute(job)
    const runB = stepB.execute(job)

    // Let everything that CAN proceed without the gated DDL call settle (either B racing ahead
    // under the buggy code, or B blocking on the lock under the fix) before releasing it.
    await new Promise((resolve) => setTimeout(resolve, 30))
    resolveDdlGate()

    await Promise.all([runA, runB])

    const dbUser = `hu_${tenant.id.replace(/-/g, '')}`
    const actualPassword = roles.get(dbUser)
    const decryptedUrl = encryption.decrypt(storedDbUrl!)
    const storedPassword = /:([^:@]+)@/.exec(decryptedUrl)?.[1]

    expect(storedPassword).toBe(actualPassword)
  })
})
