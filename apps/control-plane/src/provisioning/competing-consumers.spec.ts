import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Test } from '@nestjs/testing'
import { of } from 'rxjs'
import { ProvisioningStep } from '@hrobot/shared'

/**
 * N-1 — the `tenant.provision` queue must have exactly ONE kind of consumer implementation.
 *
 * RabbitMQ delivers at-least-once AND load-balances a queue round-robin across every connected
 * consumer. `ProvisioningService.process()` therefore defends the pipeline with a compare-and-set
 * step claim (G-1, CLAIM_LEASE_MS) so a duplicate delivery is a no-op. That defence is only worth
 * anything if EVERY consumer on the queue enforces it: one claim-less consumer and RabbitMQ will
 * happily hand it the duplicate, the claim is bypassed, and the invariant is gone.
 *
 * `provisioning.service.spec.ts` already pins the redelivery property for ONE service instance
 * talking to itself. It cannot see this bug, because the second consumer lives in a different app.
 * This spec closes that gap: it discovers which apps in the monorepo are actually wired as
 * consumers of the queue, and asserts the property across every ordered PAIR of them.
 *
 * The spec lives in control-plane because control-plane owns provisioning (the jobs table, the
 * steps, the outbox + retry relays); the queue is its contract to defend.
 */

const MONOREPO_ROOT = join(__dirname, '..', '..', '..', '..')
const QUEUE = 'tenant.provision'
const CANDIDATE_APPS = ['control-plane', 'tenant-runtime'] as const

const appSrc = (app: string, ...rest: string[]): string =>
  join(MONOREPO_ROOT, 'apps', app, 'src', ...rest)

/**
 * Read a source file with its comments stripped. Comments must not influence the verdict — the
 * note in tenant-runtime's `main.ts` explaining why it does NOT bind the queue names the queue
 * several times, and a prose mention is not a binding.
 */
const readCode = (path: string): string =>
  existsSync(path)
    ? readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    : ''

/**
 * Is this app a LIVE consumer of the queue? All three wiring facts must hold, and all three are
 * things a bootstrapped process does — there is no way to observe them without booting the app
 * against a real broker, so they are read from the wiring itself:
 *
 *  1. `main.ts` attaches an RMQ microservice to the queue (otherwise nothing is ever delivered),
 *  2. `app.module.ts` registers the app's `ProvisioningModule` (otherwise the handler is never
 *     instantiated), and
 *  3. that module's consumer declares `@EventPattern('tenant.provision')`.
 */
function isLiveConsumer(app: string): boolean {
  const main = readCode(appSrc(app, 'main.ts'))
  const appModule = readCode(appSrc(app, 'app.module.ts'))
  const consumer = readCode(appSrc(app, 'provisioning', 'provisioning.consumer.ts'))

  const queueBound = new RegExp(
    `connectMicroservice[\\s\\S]*?queue:\\s*['"]${QUEUE.replace('.', '\\.')}['"]`,
  ).test(main)
  // The entry in AppModule's `imports` array, not the `import ... from` statement.
  const moduleRegistered = /^\s*ProvisioningModule,\s*$/m.test(appModule)
  const handlerDeclared = new RegExp(
    `@EventPattern\\(\\s*['"]${QUEUE.replace('.', '\\.')}['"]\\s*\\)`,
  ).test(consumer)

  return queueBound && moduleRegistered && handlerDeclared
}

const LIVE_CONSUMERS = CANDIDATE_APPS.filter(isLiveConsumer)

interface JobRow {
  id: string
  tenantId: string
  step: string
  attemptCount: number
  lastError: string | null
  claimedAt: Date | null
  nextAttemptAt: Date | null
}

/**
 * The single shared `provisioning_jobs` row. Shared on purpose: docker-compose gives both apps the
 * same `CONTROL_PLANE_DATABASE_URL`, so both consumers read and write this exact row.
 *
 * `updateMany` models the one guarantee the claim rests on — a single `UPDATE ... WHERE <pred>`
 * evaluates its predicate and writes atomically. Faithful here because an async function body runs
 * synchronously up to its first `await`, and this body has none.
 */
function makeJobStore(initial: JobRow) {
  let row: JobRow = { ...initial }
  type ClaimWhere = { id: string; step: string; OR?: Array<{ claimedAt: null | { lt: Date } }> }

  return {
    current: (): JobRow => ({ ...row }),
    prisma: {
      provisioningJob: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === row.id ? { ...row } : null,
        update: async ({ where, data }: { where: { id: string }; data: Partial<JobRow> }) => {
          if (where.id !== row.id) throw new Error('no such job')
          row = { ...row, ...data }
          return { ...row }
        },
        updateMany: async ({ where, data }: { where: ClaimWhere; data: Partial<JobRow> }) => {
          const leaseFree =
            where.OR === undefined ||
            where.OR.some((clause) =>
              clause.claimedAt === null
                ? row.claimedAt === null
                : row.claimedAt !== null && row.claimedAt < clause.claimedAt.lt,
            )
          if (row.id !== where.id || row.step !== where.step || !leaseFree) return { count: 0 }
          row = { ...row, ...data }
          return { count: 1 }
        },
      },
    },
  }
}

interface ProvisioningLike {
  process(msg: { jobId: string; tenantId: string }): Promise<void>
}

type StepMock = { execute: (job: unknown) => Promise<void> }

/**
 * Build the given app's REAL ProvisioningService against the shared store. Each app declares its
 * own `ControlPlanePrismaService` class, so the provider token is resolved per app; the two
 * services also take their constructor arguments in a different order, which Nest's DI absorbs.
 */
async function buildService(
  app: string,
  prisma: unknown,
  steps: Record<string, StepMock>,
): Promise<ProvisioningLike> {
  // `require` on purpose: the app to load is decided at RUNTIME from the discovered consumer set.
  // A static `import` would have to name tenant-runtime unconditionally, which is precisely the
  // coupling this spec exists to forbid — and it would keep loading a copy that the fix unwires.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const serviceModule = require(appSrc(app, 'provisioning', 'provisioning.service.ts')) as {
    ProvisioningService: new (...args: never[]) => ProvisioningLike
  }
  const prismaModule = require(appSrc(app, 'common', 'prisma', 'control-plane-prisma.service.ts')) as {
    ControlPlanePrismaService: new (...args: never[]) => unknown
  }
  /* eslint-enable @typescript-eslint/no-require-imports */
  const { ProvisioningService } = serviceModule
  const { ControlPlanePrismaService } = prismaModule

  const moduleRef = await Test.createTestingModule({
    providers: [
      ProvisioningService,
      { provide: ControlPlanePrismaService, useValue: prisma },
      // Both services drive the pipeline by re-emitting; control-plane takes it @Optional().
      { provide: 'TENANT_PROVISION_CLIENT', useValue: { emit: () => of(undefined) } },
      { provide: 'CREATE_DB_STEP', useValue: steps['createDb'] },
      { provide: 'RUN_MIGRATIONS_STEP', useValue: steps['runMigrations'] },
      { provide: 'SEED_STEP', useValue: steps['seed'] },
      { provide: 'KEYCLOAK_SETUP_STEP', useValue: steps['keycloakSetup'] },
      { provide: 'DONE_STEP', useValue: steps['done'] },
    ],
  }).compile()

  return moduleRef.get<ProvisioningLike>(ProvisioningService)
}

const MSG = { jobId: 'job-1', tenantId: 'tenant-1' }
const ROOT_UNIT = 'Cała firma'

/** What the tenant is left with after the dust settles. */
interface Outcome {
  /** Root organizational units in the tenant DB. Exactly one is correct; two is the G-1 damage. */
  orgRoots: string[]
  step: string
}

/**
 * Deliver the SAME message once to each app in `deliverTo`, all copies in flight simultaneously —
 * which is what round-robin across N connected consumers does with a redelivery.
 */
async function deliverTo(apps: readonly string[]): Promise<Outcome> {
  const store = makeJobStore({
    id: 'job-1',
    tenantId: 'tenant-1',
    step: ProvisioningStep.SEED,
    attemptCount: 0,
    lastError: null,
    claimedAt: null,
    nextAttemptAt: null,
  })

  // The tenant DB's organizational_units table.
  const orgRoots: string[] = []

  const seed: StepMock = {
    execute: async () => {
      // Mirrors the real SeedStep: it is idempotent by a read-then-write guard ("create the root
      // only if none exists"). That guard covers a SEQUENTIAL re-run; it cannot cover a concurrent
      // one, because both runs read "absent" before either writes. Closing that window is exactly
      // what the step claim is for — and a claim-less consumer reopens it.
      const existingRoot = orgRoots.find((name) => name === ROOT_UNIT)
      await new Promise((resolve) => setTimeout(resolve, 10)) // the real step's I/O window
      if (!existingRoot) orgRoots.push(ROOT_UNIT)
      await store.prisma.provisioningJob.update({
        where: { id: 'job-1' },
        data: { step: ProvisioningStep.KEYCLOAK_SETUP },
      })
    },
  }
  const inert: StepMock = { execute: async () => undefined }
  const steps = { createDb: inert, runMigrations: inert, seed, keycloakSetup: inert, done: inert }

  const services = await Promise.all(apps.map((a) => buildService(a, store.prisma, steps)))
  await Promise.all(services.map((s) => s.process(MSG)))

  return { orgRoots, step: store.current().step }
}

describe('tenant.provision — competing consumers (N-1)', () => {
  it('has at least one live consumer wired (guards against a vacuous pass)', () => {
    expect(LIVE_CONSUMERS.length).toBeGreaterThan(0)
  })

  /**
   * THE PROPERTY: a duplicate delivery must leave the tenant in the same state as a single
   * delivery — whichever consumers the two copies land on. Not "the claim was called": the
   * observable end state.
   */
  it('leaves the same end state for a duplicate delivery, whichever consumers receive it', async () => {
    const single = await deliverTo([LIVE_CONSUMERS[0]!])
    expect(single).toEqual({ orgRoots: [ROOT_UNIT], step: ProvisioningStep.KEYCLOAK_SETUP })

    for (const first of LIVE_CONSUMERS) {
      for (const second of LIVE_CONSUMERS) {
        const duplicated = await deliverTo([first, second])
        expect({ pair: `${first} + ${second}`, ...duplicated }).toEqual({
          pair: `${first} + ${second}`,
          ...single,
        })
      }
    }
  })
})
