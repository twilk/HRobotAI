import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Role } from '@/lib/nav'

export interface PageSession {
  user: {
    name: string
    email: string
    initials: string
    role: string
  }
  tenant: {
    name: string
    slug: string
  }
  roles: Role[]
}

/**
 * Shared server helper for all (tenant) pages.
 * Reads auth session + x-tenant-slug header from middleware.
 * Calls redirect('/login') if unauthenticated.
 */
export async function requirePageSession(): Promise<PageSession> {
  const session = await auth()
  if (!session) redirect('/login')

  const headersList = await headers()
  const tenantSlug = headersList.get('x-tenant-slug') ?? 'dev'

  const name = session.user?.name ?? 'Użytkownik'
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((n) => n.charAt(0))
    .join('')
    .toUpperCase()

  return {
    user: {
      name,
      email: session.user?.email ?? '',
      initials,
      role: 'Admin klienta',
    },
    tenant: {
      slug: tenantSlug.includes('.') ? tenantSlug : `${tenantSlug}.hrobot.ai`,
      name: 'ACME Sp. z o.o.',
    },
    roles: (session.user?.roles as Role[]) ?? ['ADMIN_KLIENTA'],
  }
}
