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

const DEV_BYPASS =
  process.env.NODE_ENV === 'development' &&
  process.env.HROBOT_DEV_AUTH_BYPASS === '1'

const DEV_SESSION: PageSession = {
  user: { name: 'Jan Kowalski', email: 'admin@acme.hrobot.ai', initials: 'JK', role: 'Admin klienta' },
  tenant: { slug: 'acme.hrobot.ai', name: 'ACME Sp. z o.o.' },
  roles: ['ADMIN_KLIENTA'],
}

/**
 * Shared server helper for all (tenant) pages.
 * Reads auth session + x-tenant-slug header from middleware.
 * Calls redirect('/login') if unauthenticated.
 * Dev: set HROBOT_DEV_AUTH_BYPASS=1 to skip auth entirely.
 */
export async function requirePageSession(): Promise<PageSession> {
  if (DEV_BYPASS) return DEV_SESSION

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
