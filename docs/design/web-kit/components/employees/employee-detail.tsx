import Link from 'next/link'
import { cn } from '@/lib/cn'
import { IconChevronLeft, IconLock } from '@/components/icons'
import { SecuredChip } from '@/components/ui/secured-chip'
import { EmployeeRecord } from './employee-record'
import { type EmployeeDetail, employeeFullName, employeeInitials } from '@/lib/employees'

/**
 * Pracownik — szczegóły (screen C4). Sticky identity pane (left) + the
 * interactive record with the Dziennik audytu (right). The chosen direction
 * from /design-shotgun: variant B grafted with E's audit log.
 */
export function EmployeeDetailView({ employee, actor }: { employee: EmployeeDetail; actor: string }) {
  return (
    <div className="mx-auto max-w-[1120px]">
      <div className="mb-5 flex items-center gap-2.5">
        <Link
          href="/pracownicy"
          className="inline-flex items-center gap-[7px] rounded-sm text-[13px] text-muted hover:text-accent-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <IconChevronLeft className="h-[15px] w-[15px]" strokeWidth={1.7} />
          Pracownicy
        </Link>
        <span className="font-mono text-[11.5px] text-muted">/ {empId(employee.id)}</span>
      </div>

      <div className="grid items-start gap-[26px] lg:grid-cols-[300px_1fr]">
        <aside>
          <IdentityPane employee={employee} />
        </aside>
        <EmployeeRecord employee={employee} actor={actor} />
      </div>
    </div>
  )
}

function IdentityPane({ employee }: { employee: EmployeeDetail }) {
  return (
    <div className="rounded-lg border border-line bg-card p-[22px] text-center shadow-sm lg:sticky lg:top-[18px]">
      <div className="mx-auto mb-3.5 grid h-16 w-16 place-items-center rounded-[14px] bg-gradient-to-b from-navy-700 to-navy text-[22px] font-semibold text-white">
        {employeeInitials(employee)}
      </div>
      <h1 className="font-display text-xl font-extrabold tracking-tightish text-navy">{employeeFullName(employee)}</h1>
      <div className="mt-1 text-[13.5px] text-muted">{employee.position}</div>
      <div className="mt-3">
        <StatusPill status={employee.status} />
      </div>

      <div className="mt-4 flex flex-col gap-3.5 border-t border-line pt-4 text-left">
        <Meta label="Email" value={employee.email} mono />
        <Meta label="Telefon" value={employee.phone} mono />
        <Meta label="Jednostka" value={employee.unit} />
        <Meta label="Numer pracownika" value={empId(employee.id)} mono />
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[.1em] text-muted-2">PESEL</span>
          <span className="font-mono text-[13px] tracking-[.16em] text-ink">•••••••{employee.peselLast4}</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
          <IconLock className="h-3 w-3 text-verified" strokeWidth={1.7} />
          Ujawnij w sekcji Dane
        </div>
      </div>

      <SecuredChip className="mt-4 w-full justify-center">Dane szyfrowane · EU</SecuredChip>
    </div>
  )
}

function StatusPill({ status }: { status: 'active' | 'leave' }) {
  const ok = status === 'active'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-[11px] py-1 text-[12.5px] font-medium',
        ok ? 'border-verified/25 bg-verified/[0.08] text-verified' : 'border-warn/25 bg-warn/[0.08] text-warn',
      )}
    >
      <span className={cn('h-[7px] w-[7px] rounded-full', ok ? 'bg-verified' : 'bg-warn')} />
      {ok ? 'Aktywny' : 'Urlop'}
    </span>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('text-[14.5px] font-medium text-ink', mono && 'font-mono text-[12.5px] font-normal')}>{value}</div>
    </div>
  )
}

function empId(id: string): string {
  return `EMP-${id.padStart(4, '0')}`
}
