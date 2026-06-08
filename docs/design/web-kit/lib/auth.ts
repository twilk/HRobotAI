import NextAuth from 'next-auth'
import Keycloak from 'next-auth/providers/keycloak'
import { env } from '@/lib/env'
import type { JWT } from 'next-auth/jwt'
import type { Session, Account, Profile } from 'next-auth'
import type { Role } from '@/lib/nav'

type ProfileWithRoles = Profile & { hrobot_roles?: Role[] }

/** Pure function — no NextAuth coupling, fully unit-testable. */
export function transformJwt(
  token: JWT,
  account: Account | null,
  profile?: ProfileWithRoles
): JWT {
  if (account) {
    token.accessToken = account.access_token ?? ''
    token.roles = profile?.hrobot_roles ?? []
  }
  return token
}

/** Pure function — no NextAuth coupling, fully unit-testable. */
export function transformSession(session: Session, token: JWT): Session {
  session.user.roles = (token.roles as Role[]) ?? []
  session.accessToken = (token.accessToken as string) ?? ''
  return session
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Keycloak({
      clientId: env.KEYCLOAK_CLIENT_ID,
      clientSecret: env.KEYCLOAK_CLIENT_SECRET,
      issuer: env.KEYCLOAK_ISSUER,
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      return transformJwt(token, account ?? null, profile as ProfileWithRoles)
    },
    async session({ session, token }) {
      return transformSession(session, token)
    },
  },
})
