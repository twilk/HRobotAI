'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Table, Th, Td } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { employeeInitials, maskPesel } from '@/lib/employee-profile'

export interface Employee {
  id: string
  firstName: string
  lastName: string
  /** Optional: the tenant-runtime /api/employees payload omits email (it lives on the linked User). */
  email?: string
  position: string
  unit: string
  contract: string
  /** Last 4 of PESEL, when available. The real API omits PESEL entirely (RODO) → masked placeholder. */
  peselLast4?: string
  status?: 'active' | 'leave'
}

export function EmployeesTable({ employees }: { employees: Employee[] }) {
  const router = useRouter()

  return (
    <Table>
      <thead>
        <tr>
          <Th>Pracownik</Th>
          <Th>Stanowisko</Th>
          <Th>Jednostka</Th>
          <Th>Typ</Th>
          <Th>PESEL</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {employees.map((e) => {
          const pesel = maskPesel(e.peselLast4)
          return (
            // Row keeps its native <tr> semantics for screen-reader table navigation; the accessible,
            // properly-named link lives in the name cell. The row-level onClick is a mouse-only
            // convenience (no role/tabIndex override), so keyboard users tab to the real <Link>.
            <tr
              key={e.id}
              onClick={() => router.push(`/pracownicy/${e.id}`)}
              className="cursor-pointer"
            >
              <Td>
                <div className="flex items-center gap-[11px]">
                  <span className="grid place-items-center w-[30px] h-[30px] rounded-lg bg-gradient-to-b from-navy-700 to-navy text-white text-[11px] font-semibold">
                    {employeeInitials(e)}
                  </span>
                  <div>
                    <Link
                      href={`/pracownicy/${e.id}`}
                      onClick={(ev) => ev.stopPropagation()}
                      className="font-medium rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {e.firstName} {e.lastName}
                    </Link>
                    {e.email ? <div className="text-[11.5px] text-muted-2">{e.email}</div> : null}
                  </div>
                </div>
              </Td>
              <Td>{e.position}</Td>
              <Td>{e.unit}</Td>
              <Td>
                <Badge>{e.contract}</Badge>
              </Td>
              <Td>
                {pesel ? (
                  <span className="font-mono text-[12.5px] tabular-nums text-muted">{pesel}</span>
                ) : (
                  <span className="font-mono text-[12.5px] text-muted-2" title="PESEL nie opuszcza serwera (RODO)">•••••••••</span>
                )}
              </Td>
              <Td>{e.status === 'leave' ? <Badge tone="warn">Urlop</Badge> : <Badge tone="ok">Aktywny</Badge>}</Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
