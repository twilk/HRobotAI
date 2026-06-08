import type { DefaultSession, DefaultJWT } from 'next-auth'
import type { Role } from '@/lib/nav'

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: DefaultSession['user'] & { roles: Role[] }
    accessToken: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    roles?: Role[]
    accessToken?: string
  }
}
