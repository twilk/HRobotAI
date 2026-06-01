import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconUserPlus, IconPlus } from '@/components/icons'

export function EmployeesEmpty() {
  return (
    <EmptyState
      icon={IconUserPlus}
      title="Brak pracowników"
      actions={
        <>
          <Button>
            <IconPlus className="w-[17px] h-[17px]" strokeWidth={2} />
            Dodaj pracownika
          </Button>
          {/* aria-disabled (not native disabled) so the tooltip still shows on hover */}
          <Button variant="ghost" aria-disabled className="opacity-50 cursor-not-allowed" title="Dostępne wkrótce">
            Importuj z CSV
            <Badge tone="muted" className="ml-1.5">
              wkrótce
            </Badge>
          </Button>
        </>
      }
    >
      Dodaj pracowników, aby zacząć planować grafiki i obsługiwać wnioski urlopowe. PESEL jest szyfrowany automatycznie.
    </EmptyState>
  )
}
