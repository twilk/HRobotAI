import { z } from 'zod'

/** A z.string().url() narrowed to a specific scheme, so a misconfigured value (e.g.
 * REDIS_URL set to a postgres:// URL) fails loudly at boot instead of deep inside a client. */
const urlWithScheme = (name: string, schemeRe: RegExp, hint: string) =>
  z
    .string()
    .url()
    .refine((v) => schemeRe.test(v), `${name} ${hint}`)

export const envSchema = z.object({
  CONTROL_PLANE_DATABASE_URL: urlWithScheme(
    'CONTROL_PLANE_DATABASE_URL',
    /^postgres(ql)?:\/\//,
    'must be a postgresql:// connection string',
  ),
  // 32-byte AES-256 key, hex-encoded → 64 hex chars
  TENANT_DB_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TENANT_DB_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1),
  REDIS_URL: urlWithScheme('REDIS_URL', /^rediss?:\/\//, 'must be a redis:// or rediss:// URL'),
  RABBITMQ_URL: urlWithScheme('RABBITMQ_URL', /^amqps?:\/\//, 'must be an amqp:// or amqps:// URL'),
  NEXTAUTH_SECRET: z.string().min(1),
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
    throw new Error(
      `Invalid environment configuration: ${issues}. Check your .env against .env.example.`,
    )
  }
  return result.data
}
