import { EncryptionService } from '@hrobot/shared'
import { TenantClient, TenantPrisma } from '../src/clients.js'
import {
  buildCanonicalSeed,
  assertCanonicalInvariants,
  CANONICAL_WEEKS,
  weekCoverage,
  type SeedEmployee,
} from '../src/seed/index.js'
import {
  DEFAULT_SEED_TENANT_ID,
  deriveBlindIndexKey,
  encryptEmployeePii,
} from '../src/seed/persist.js'

/**
 * FROZEN canonical synthetic seed runner (M2 #4, spec §6/§9).
 *
 * Writes the pure dataset from `src/seed` into a single tenant database and encrypts PII on the way
 * in. DETERMINISTIC + IDEMPOTENT: every row is upserted by a stable UUIDv5 id, so re-running is a
 * no-op reset of the known synthetic set — never a blind duplicate insert.
 *
 * ENV / ARGS (see PR body):
 *  - DATABASE_URL           — tenant DB connection (the tenant schema's datasource; required).
 *  - TENANT_DB_ENCRYPTION_KEY — 64 hex chars (32-byte AES-256 key). The SAME key already used by the
 *                             apps' EncryptionService; the PESEL blind-index key is HKDF-derived from
 *                             it (domain-separated) so NO new key env var is invented.
 *  - argv[2] (optional)     — tenantId bound into the PII ciphertext AAD. Defaults to
 *                             {@link DEFAULT_SEED_TENANT_ID}; pass the real tenant UUID when seeding a
 *                             tenant whose runtime will later decrypt these values.
 *
 * RODO: PESELs are asserted synthetic (branded) before encryption; home addresses are encrypted with
 * a parallel AAD; only fictional data is written.
 */

function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required (tenant DB to seed)')
  const encryptionKeyHex = process.env.TENANT_DB_ENCRYPTION_KEY
  if (!encryptionKeyHex || !/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) {
    throw new Error('TENANT_DB_ENCRYPTION_KEY is required and must be 64 hex chars (32 bytes)')
  }
  const tenantId = process.argv[2] ?? DEFAULT_SEED_TENANT_ID

  const enc = EncryptionService.fromHexKey(encryptionKeyHex)
  const biKey = deriveBlindIndexKey(encryptionKeyHex)

  const seed = buildCanonicalSeed()
  // Fail loud before touching the DB if a future edit broke the frozen guarantees.
  assertCanonicalInvariants(seed)

  const client = new TenantClient({ datasources: { db: { url: databaseUrl } } })
  try {
    await client.$transaction(
      async (tx) => {
        // Units: parents before children (root then regions) for the self-FK.
        for (const u of seed.units) {
          await tx.organizationalUnit.upsert({
            where: { id: u.id },
            create: { id: u.id, name: u.name, parentId: u.parentId },
            update: { name: u.name, parentId: u.parentId },
          })
        }

        for (const l of seed.locations) {
          await tx.lokalizacja.upsert({
            where: { id: l.id },
            create: { id: l.id, name: l.name, typ: l.typ, lat: l.lat, lng: l.lng },
            update: { name: l.name, typ: l.typ, lat: l.lat, lng: l.lng },
          })
        }

        for (const e of seed.employees) {
          const data = employeeWriteData(e, enc, biKey, tenantId)
          await tx.employee.upsert({
            where: { id: e.id },
            create: { id: e.id, ...data },
            update: data,
          })
        }

        for (const t of seed.templates) {
          const okna = t.okna as unknown as TenantPrisma.InputJsonValue
          await tx.shiftTemplate.upsert({
            where: { id: t.id },
            create: { id: t.id, lokalizacjaTyp: t.lokalizacjaTyp, nazwa: t.nazwa, dni: t.dni, okna },
            update: { lokalizacjaTyp: t.lokalizacjaTyp, nazwa: t.nazwa, dni: t.dni, okna },
          })
        }

        for (const d of seed.demands) {
          const common = {
            lokalizacjaId: d.lokalizacjaId,
            date: isoToDate(d.date),
            start: d.start,
            end: d.end,
            requiredRole: d.requiredRole,
            requiredCount: d.requiredCount,
            source: d.source,
          }
          await tx.shiftDemand.upsert({
            where: { id: d.id },
            create: { id: d.id, ...common },
            update: common,
          })
        }

        for (const lv of seed.leaves) {
          const common = {
            employeeId: lv.employeeId,
            startDate: isoToDate(lv.startDate),
            endDate: isoToDate(lv.endDate),
            status: lv.status,
            type: lv.type,
          }
          await tx.leaveRequest.upsert({
            where: { id: lv.id },
            create: { id: lv.id, ...common },
            update: common,
          })
        }
      },
      { timeout: 120_000 },
    )

    const feasible = weekCoverage(seed, CANONICAL_WEEKS.feasible.weekStart)
    const infeasible = weekCoverage(seed, CANONICAL_WEEKS.infeasible.weekStart)
    console.log('Canonical synthetic seed written (idempotent upsert of the frozen set):')
    console.log(`  units:        ${seed.units.length}`)
    console.log(`  locations:    ${seed.locations.length}`)
    console.log(`  employees:    ${seed.employees.length} (PESEL + homeAddress encrypted)`)
    console.log(`  templates:    ${seed.templates.length}`)
    console.log(`  demands:      ${seed.demands.length}`)
    console.log(`  leaves:       ${seed.leaves.length}`)
    console.log(`  tenantId (PII AAD): ${tenantId}`)
    console.log(
      `  week ${CANONICAL_WEEKS.feasible.weekStart}: FEASIBLE=${feasible.feasible} (shortfalls: ${feasible.shortfalls.length})`,
    )
    console.log(
      `  week ${CANONICAL_WEEKS.infeasible.weekStart}: FEASIBLE=${infeasible.feasible} ` +
        `(shortfalls: ${JSON.stringify(infeasible.shortfalls)})`,
    )
  } finally {
    await client.$disconnect()
  }
}

/** Build the encrypted-at-rest write payload for one employee (PII never leaves plaintext). */
function employeeWriteData(
  e: SeedEmployee,
  enc: EncryptionService,
  biKey: Buffer,
  tenantId: string,
) {
  // RODO §9 hard refusal happens inside encryptEmployeePii: only a branded synthetic PESEL survives.
  const pii = encryptEmployeePii(enc, biKey, tenantId, e)
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    pesel: pii.pesel,
    peselHash: pii.peselHash,
    position: e.position,
    employmentType: e.employmentType,
    hiredAt: isoToDate(e.hiredAt),
    unitId: e.unitId,
    homeAddress: pii.homeAddress,
    homeLat: e.homeLat,
    homeLng: e.homeLng,
    etat: e.etat,
    qualifications: e.qualifications,
    // SOFT synthetic preferences (md5(id)-derived; see canonicalData.derivePreferences). Idempotent:
    // the same rows re-write the same arrays on every seed run.
    preferredDaysOff: e.preferredDaysOff,
    preferredShiftStart: e.preferredShiftStart,
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
