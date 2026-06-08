import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { GuideProvider } from '@/components/guide/guide-provider'
import { GuideFab } from '@/components/guide/guide-fab'

/**
 * Defence-in-depth auth guard for all (tenant) routes.
 * Middleware is the primary gate; this layout catches edge cases.
 *
 * CRITICAL: NEVER add generateStaticParams to any file inside app/(tenant)/.
 * Doing so pre-renders PII (employee names, emails, audit logs) as public CDN
 * files without any authentication check, violating RODO/GDPR.
 */
export default async function TenantLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const devAuthBypass =
    process.env.NODE_ENV === 'development' &&
    process.env.HROBOT_DEV_AUTH_BYPASS === '1'

  if (!devAuthBypass) {
    const session = await auth()
    if (!session) redirect('/login')
  }
  return (
    <GuideProvider>
      {children}
      <GuideFab />
    </GuideProvider>
  )
}
