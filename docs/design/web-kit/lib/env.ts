import { z } from 'zod'

export const envSchema = z.object({
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32, 'Must be at least 32 characters'),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  KEYCLOAK_ISSUER: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
})

export type Env = z.infer<typeof envSchema>

/** Validated env — module-level parse so mis-config fails at startup. */
export const env: Env = envSchema.parse(process.env)
