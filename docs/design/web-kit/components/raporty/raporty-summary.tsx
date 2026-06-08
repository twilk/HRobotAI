import type { HRSummary } from '@/lib/raporty'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Props {
  summary: HRSummary
}

export function RaportySummary({ summary }: Props) {
  const { employees, leave, schedule, access } = summary

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {/* Card 1: Pracownicy */}
      <Card className="p-5">
        <h2 className="font-semibold text-sm text-muted uppercase tracking-wide mb-3">Pracownicy</h2>
        <p className="font-display font-extrabold text-4xl text-navy">{employees.total}</p>
        <div className="flex gap-2 mt-3 flex-wrap">
          <Badge tone="ok">{employees.active} aktywni</Badge>
          <Badge tone="warn">{employees.onLeave} na urlopie</Badge>
        </div>
      </Card>

      {/* Card 2: Wnioski urlopowe */}
      <Card className="p-5">
        <h2 className="font-semibold text-sm text-muted uppercase tracking-wide mb-3">Wnioski urlopowe</h2>
        <div className="flex gap-4 mb-3">
          <div>
            <p className="font-display font-extrabold text-3xl text-navy">{leave.pending}</p>
            <p className="text-xs text-muted mt-0.5">oczekujące</p>
          </div>
          <div>
            <p className="font-display font-extrabold text-3xl text-navy">{leave.approved}</p>
            <p className="text-xs text-muted mt-0.5">zatwierdzone</p>
          </div>
          <div>
            <p className="font-display font-extrabold text-3xl text-navy">{leave.rejected}</p>
            <p className="text-xs text-muted mt-0.5">odrzucone</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge tone="warn">{leave.pending} oczekujące</Badge>
          <Badge tone="ok">{leave.approved} zatwierdzone</Badge>
          <Badge tone="muted">{leave.rejected} odrzucone</Badge>
        </div>
        <p className="text-xs text-muted mt-2">W tym miesiącu: {leave.thisMonth} wniosków</p>
      </Card>

      {/* Card 3: Grafik tygodnia */}
      <Card className="p-5">
        <h2 className="font-semibold text-sm text-muted uppercase tracking-wide mb-3">Grafik tygodnia</h2>
        <div className="flex gap-4 mb-3">
          <div>
            <p className="font-display font-extrabold text-3xl text-navy">{schedule.totalShiftsThisWeek}</p>
            <p className="text-xs text-muted mt-0.5">zmian</p>
          </div>
          <div>
            <p className="font-display font-extrabold text-3xl text-navy">{schedule.totalHoursThisWeek}</p>
            <p className="text-xs text-muted mt-0.5">godzin</p>
          </div>
        </div>
        <ul className="space-y-1 mt-2">
          {schedule.coverageByFacility.map((f) => (
            <li key={f.facilityId} className="flex justify-between text-xs text-muted">
              <span>{f.facilityName}</span>
              <Badge tone="default">{f.shiftsCount} zm.</Badge>
            </li>
          ))}
        </ul>
      </Card>

      {/* Card 4: Dostępy */}
      <Card className="p-5">
        <h2 className="font-semibold text-sm text-muted uppercase tracking-wide mb-3">Dostępy</h2>
        <div className="mb-3">
          <p className="font-display font-extrabold text-3xl text-navy">{access.employeesWithAdminAccess}</p>
          <p className="text-xs text-muted mt-0.5">pracowników z uprawnieniami admin</p>
        </div>
        <ul className="space-y-1">
          {access.moduleAdoption.map((m) => (
            <li key={m.module} className="flex justify-between text-xs text-muted">
              <span className="capitalize">{m.module}</span>
              <Badge tone="role">{m.activeCount} aktywnych</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
