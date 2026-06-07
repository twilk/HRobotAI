import { AppShell } from '@/components/layout/app-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconRequests, IconPlus } from '@/components/icons'
import { requirePageSession } from '@/lib/session'

// Matches the nav tag count (NAV Wnioski tag: '3').
const WNIOSKI_COUNT = 3

export default async function WnioskiPage() {
  const { user, tenant, roles } = await requirePageSession()
  return (
    <AppShell activeHref="/wnioski" title="Wnioski" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-[22px] flex items-center gap-3">
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">
            Wnioski
          </h1>
          <span className="font-mono text-[11px] rounded-full bg-navy/10 px-2 py-0.5 text-navy">
            {WNIOSKI_COUNT}
          </span>
        </div>
        <EmptyState
          icon={IconRequests}
          title="Wnioski wkrótce"
          actions={
            <Button
              variant="ghost"
              aria-disabled
              className="opacity-50 cursor-not-allowed"
              title="Dostępne wkrótce"
            >
              <IconPlus className="w-[17px] h-[17px]" strokeWidth={2} />
              Złóż wniosek
              <Badge tone="muted" className="ml-1.5">
                wkrótce
              </Badge>
            </Button>
          }
        >
          Wnioski urlopowe i kadrowe z automatycznym obiegiem akceptacji pojawią się wkrótce.
        </EmptyState>
      </div>
    </AppShell>
  )
}
