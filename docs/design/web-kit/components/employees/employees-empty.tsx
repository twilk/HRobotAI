import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconUserPlus, IconPlus } from '@/components/icons'

export interface EmployeesEmptyProps {
  /** HR/ADMIN_KLIENTA session — gates the "Dodaj pracownika" action (Task 4b), mirroring
   *  employees-screen.tsx's header button. A MANAGER/PRACOWNIK landing on an empty roster must not
   *  see this affordance either. */
  canManage?: boolean
  /** Opens the add-employee panel; only wired when canManage is true. */
  onAdd?: () => void
}

export function EmployeesEmpty({ canManage, onAdd }: EmployeesEmptyProps) {
  return (
    <EmptyState
      icon={IconUserPlus}
      title="Brak pracowników"
      actions={
        <>
          {canManage ? (
            <Button onClick={onAdd}>
              <IconPlus className="w-[17px] h-[17px]" strokeWidth={2} />
              Dodaj pracownika
            </Button>
          ) : null}
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
