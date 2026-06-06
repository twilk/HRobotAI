import { AppShell } from '@/components/layout/app-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconKey } from '@/components/icons'
import type { Role } from '@/lib/nav'

const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
const roles: Role[] = ['ADMIN_KLIENTA']

export default function DostepyPage() {
  return (
    <AppShell activeHref="/dostepy" title="Dostępy" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-[22px]">
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">
            Dostępy
          </h1>
        </div>
        <EmptyState
          icon={IconKey}
          title="Dostępy wkrótce"
          actions={
            <Button
              variant="ghost"
              aria-disabled
              className="opacity-50 cursor-not-allowed"
              title="Dostępne wkrótce"
            >
              Zarządzaj dostępami
              <Badge tone="muted" className="ml-1.5">
                wkrótce
              </Badge>
            </Button>
          }
        >
          Zarządzanie kartami, kluczami i uprawnieniami fizycznymi będzie dostępne w module Dostępy.
        </EmptyState>
      </div>
    </AppShell>
  )
}
