import Link from 'next/link'
import { Table, Th, Td } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { IconEdit } from '@/components/icons'
import { type Employee, employeeInitials } from '@/lib/employees'

function statusBadge(status: Employee['status']) {
  switch (status) {
    case 'active':
      return <Badge tone="ok" data-guide="pracownicy:status-badge">Aktywny</Badge>
    case 'inactive':
      return <Badge tone="danger" data-guide="pracownicy:status-badge">Nieaktywny</Badge>
    case 'on-leave':
    case 'leave':
      return <Badge tone="warn" data-guide="pracownicy:status-badge">Urlop</Badge>
    case 'suspended':
      return <Badge tone="warn" data-guide="pracownicy:status-badge">Zawieszony</Badge>
    default:
      return <Badge data-guide="pracownicy:status-badge">{status}</Badge>
  }
}

export function EmployeesTable({
  employees,
  onEdit,
}: {
  employees: Employee[]
  onEdit?: (employee: Employee) => void
}) {
  return (
    <Table data-guide="pracownicy:table">
      <thead>
        <tr>
          <Th>Pracownik</Th>
          <Th>Stanowisko</Th>
          <Th>Jednostka</Th>
          <Th>Typ</Th>
          <Th>PESEL</Th>
          <Th>Status</Th>
          {onEdit && <Th><span className="sr-only">Akcje</span></Th>}
        </tr>
      </thead>
      <tbody>
        {employees.map((e) => (
          <tr key={e.id} className="hover:bg-card-2">
            <Td>
              <Link
                href={`/pracownicy/${e.id}`}
                className="group -mx-1 flex items-center gap-[11px] rounded-sm px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <span className="grid place-items-center w-[30px] h-[30px] rounded-lg bg-gradient-to-b from-navy-700 to-navy text-white text-[11px] font-semibold">
                  {employeeInitials(e)}
                </span>
                <div>
                  <div className="font-medium group-hover:text-accent-ink">
                    {e.firstName} {e.lastName}
                  </div>
                  <div className="text-[11.5px] text-muted-2">{e.email}</div>
                </div>
              </Link>
            </Td>
            <Td>{e.position}</Td>
            <Td>{e.unit}</Td>
            <Td>
              <Badge>{e.contract}</Badge>
            </Td>
            <Td>
              <span className="font-mono text-[12.5px] tabular-nums text-muted">•••••••{e.peselLast4}</span>
            </Td>
            <Td>{statusBadge(e.status)}</Td>
            {onEdit && (
              <Td>
                <button
                  aria-label={`Edytuj ${e.firstName} ${e.lastName}`}
                  onClick={() => onEdit(e)}
                  className="grid h-7 w-7 place-items-center rounded-sm text-muted hover:bg-card-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <IconEdit className="w-[15px] h-[15px]" strokeWidth={1.7} />
                </button>
              </Td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
