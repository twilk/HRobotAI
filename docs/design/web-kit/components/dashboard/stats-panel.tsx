import type { HRSummary } from '@/lib/raporty'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Props {
  summary: HRSummary
}

/**
 * Dashboard StatsPanel — 2×2 grid of live KPI cards derived from HRSummary.
 * Server component; receives pre-computed summary as a prop.
 */
export function StatsPanel({ summary }: Props) {
  const { employees, leave, schedule, access } = summary

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" data-guide="dashboard:stats-panel">
      {/* Card 1: Pracownicy */}
      <Card className="p-5">
        <h3 className="font-semibold text-xs text-muted uppercase tracking-wide mb-3">Pracownicy</h3>
        <p
          className="font-display font-extrabold text-4xl text-navy"
          data-testid="stat-employees-total"
        >
          {employees.total}
        </p>
        <p className="text-xs text-muted mt-2">{employees.active} aktywnych</p>
      </Card>

      {/* Card 2: Wnioski */}
      <Card className="p-5">
        <h3 className="font-semibold text-xs text-muted uppercase tracking-wide mb-3">Wnioski</h3>
        <p
          className="font-display font-extrabold text-4xl text-navy"
          data-testid="stat-leave-pending"
        >
          {leave.pending}
        </p>
        <div className="mt-2">
          <Badge tone="warn">oczekujące</Badge>
        </div>
      </Card>

      {/* Card 3: Grafik */}
      <Card className="p-5">
        <h3 className="font-semibold text-xs text-muted uppercase tracking-wide mb-3">Grafik</h3>
        <p
          className="font-display font-extrabold text-4xl text-navy"
          data-testid="stat-shifts-week"
        >
          {schedule.totalShiftsThisWeek}
        </p>
        <p className="text-xs text-muted mt-2">zmian w tygodniu</p>
      </Card>

      {/* Card 4: Dostępy admin */}
      <Card className="p-5">
        <h3 className="font-semibold text-xs text-muted uppercase tracking-wide mb-3">Dostępy admin</h3>
        <p
          className="font-display font-extrabold text-4xl text-navy"
          data-testid="stat-admin-access"
        >
          {access.employeesWithAdminAccess}
        </p>
        <p className="text-xs text-muted mt-2">pracowników z dostępem admin</p>
      </Card>
    </div>
  )
}
