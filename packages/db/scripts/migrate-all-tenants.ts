import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { EncryptionService } from '@hrobot/shared'
import { ControlPlaneClient } from '../src/clients.js'
import { runWithConcurrency } from '../src/concurrency.js'
import { migrateTenant } from '../src/migrateTenant.js'

const CONCURRENCY_LIMIT = 10

async function main(): Promise<void> {
  const encryptionKey = process.env.TENANT_DB_ENCRYPTION_KEY
  if (!encryptionKey) {
    throw new Error('TENANT_DB_ENCRYPTION_KEY is required to decrypt tenant db urls')
  }
  const encryption = new EncryptionService(Buffer.from(encryptionKey, 'hex'))

  const here = dirname(fileURLToPath(import.meta.url))
  const tenantSchemaPath = resolve(here, '../prisma/tenant/schema.prisma')

  const control = new ControlPlaneClient()
  try {
    const tenants = await control.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true, dbUrl: true },
    })

    const migratable = tenants.filter(
      (t): t is { id: string; slug: string; dbUrl: string } => t.dbUrl !== null,
    )

    const failures = await runWithConcurrency(migratable, CONCURRENCY_LIMIT, async (t) => {
      const decrypted = encryption.decrypt(t.dbUrl)
      await migrateTenant(decrypted, tenantSchemaPath)
    })

    if (failures.length > 0) {
      for (const f of failures) {
        console.error(`Migration failed for tenant ${f.item.slug} (${f.item.id}): ${f.error.message}`)
      }
      process.exitCode = 1
    } else {
      console.log(`Migration fan-out complete: ${migratable.length} tenant(s) migrated.`)
    }
  } finally {
    await control.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
