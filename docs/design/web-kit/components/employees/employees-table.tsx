import { Table, Th, Td } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export interface Employee {
  id: string
  firstName: string
  lastName: string
  email: string
  position: string
  unit: string
  contract: 'UoP' | 'Zlecenie' | 'B2B'
  /** Last 4 of PESEL only — plaintext PESEL never reaches the client. */
  peselLast4: string
  status: 'active' | 'leave'
}

export function EmployeesTable({ employees }: { employees: Employee[] }) {
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
        {employees.map((e) => (
          <tr key={e.id}>
            <Td>
              <div className="flex items-center gap-[11px]">
                <span className="grid place-items-center w-[30px] h-[30px] rounded-lg bg-gradient-to-b from-navy-700 to-navy text-white text-[11px] font-semibold">
                  {initials(e)}
                </span>
                <div>
                  <div className="font-medium">
                    {e.firstName} {e.lastName}
                  </div>
                  <div className="text-[11.5px] text-muted-2">{e.email}</div>
                </div>
              </div>
            </Td>
            <Td>{e.position}</Td>
            <Td>{e.unit}</Td>
            <Td>
              <Badge>{e.contract}</Badge>
            </Td>
            <Td>
              <span className="font-mono text-[12.5px] tabular-nums text-muted">•••••••{e.peselLast4}</span>
            </Td>
            <Td>{e.status === 'active' ? <Badge tone="ok">Aktywny</Badge> : <Badge tone="warn">Urlop</Badge>}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function initials(e: Employee): string {
  return (e.firstName.charAt(0) + e.lastName.charAt(0)).toUpperCase()
}
