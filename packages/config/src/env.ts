import { z } from 'zod'

export const envSchema = z.object({
  CONTROL_PLANE_DATABASE_URL: z.string().url(),
  // 32-byte AES-256 key, hex-encoded → 64 hex chars
  TENANT_DB_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TENANT_DB_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1),
  REDIS_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(1),
  // Plan 2 additions
  POSTGRES_SUPERUSER_URL: z.string().url(),
  GLOBAL_ADMIN_JWT_SECRET: z
    .string()
    .min(32, 'GLOBAL_ADMIN_JWT_SECRET must be at least 32 characters'),
})

export type Env = z.infer<typeof envSchema>

/**
 * Validate an environment source. Pure (takes the source as an argument) so it
 * is unit-testable without mutating process.env. App entrypoints call
 * `parseEnv(process.env)` once at boot and crash on failure — no silent fallbacks.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`Invalid environment configuration: ${issues}`)
  }
  return result.data
}
