import type { LeaveBalance } from '@/lib/leave-balance'

export interface LeaveSummaryWidgetProps {
  pendingCount: number
  approvedThisMonthCount: number
  dangerZoneEmployees: LeaveBalance[]
}

export function LeaveSummaryWidget({
  pendingCount,
  approvedThisMonthCount,
  dangerZoneEmployees,
}: LeaveSummaryWidgetProps) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <h2 className="font-semibold text-[14px] mb-3">Urlopy — podsumowanie</h2>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-center">
          <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
          <p className="text-xs text-amber-700 mt-0.5">Oczekujące</p>
          <a
            href="/wnioski"
            className="text-[11px] text-accent-ink underline mt-1 block"
            aria-label="Wnioski oczekujące"
          >
            Wnioski
          </a>
        </div>
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{approvedThisMonthCount}</p>
          <p className="text-xs text-green-700 mt-0.5">Zatwierdzone (miesiąc)</p>
        </div>
      </div>

      <div>
        <p className="text-[12px] font-medium text-muted mb-2">Strefa zagrożenia (&lt;5 dni pozostałych)</p>
        {dangerZoneEmployees.length === 0 ? (
          <p className="text-xs text-muted-2 italic">Wszyscy pracownicy mają wystarczający urlop.</p>
        ) : (
          <ul className="space-y-1">
            {dangerZoneEmployees.map((bal) => (
              <li key={bal.id} className="flex items-center justify-between text-xs">
                <span className="font-medium">{bal.employeeName}</span>
                <span className="text-red-500 font-semibold">
                  {bal.urlop_wypoczynkowy.remaining} dni
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
