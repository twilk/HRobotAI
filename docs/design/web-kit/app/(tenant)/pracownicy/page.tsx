import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { EmployeesTable, type Employee } from '@/components/employees/employees-table'
import { EmployeesEmpty } from '@/components/employees/employees-empty'
import { IconPlus, IconSearch } from '@/components/icons'
import type { Role } from '@/lib/nav'

// Proof-of-stack: in the real app this is `await fetch('/api/employees')` through the
// authenticated tenant runtime (returns last-4 of PESEL only, never plaintext).
const EMPLOYEES: Employee[] = [
  { id: '1', firstName: 'Anna', lastName: 'Nowak', email: 'anna.nowak@4mobility.pl', position: 'Kierownik zmiany', unit: 'Produkcja', contract: 'UoP', peselLast4: '4821', status: 'active' },
  { id: '2', firstName: 'Piotr', lastName: 'Wiśniewski', email: 'piotr.wisniewski@4mobility.pl', position: 'Operator maszyn', unit: 'Produkcja', contract: 'UoP', peselLast4: '1093', status: 'active' },
  { id: '3', firstName: 'Katarzyna', lastName: 'Wójcik', email: 'k.wojcik@4mobility.pl', position: 'Specjalista HR', unit: 'Kadry', contract: 'UoP', peselLast4: '7754', status: 'active' },
  { id: '4', firstName: 'Tomasz', lastName: 'Kamiński', email: 't.kaminski@4mobility.pl', position: 'Magazynier', unit: 'Logistyka', contract: 'Zlecenie', peselLast4: '2310', status: 'active' },
  { id: '5', firstName: 'Magdalena', lastName: 'Lewandowska', email: 'm.lewandowska@4mobility.pl', position: 'Księgowa', unit: 'Finanse', contract: 'UoP', peselLast4: '6642', status: 'leave' },
  { id: '6', firstName: 'Marek', lastName: 'Zieliński', email: 'm.zielinski@4mobility.pl', position: 'Kierowca', unit: 'Logistyka', contract: 'B2B', peselLast4: '9087', status: 'active' },
]

export default async function PracownicyPage() {
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
  const roles: Role[] = ['ADMIN_KLIENTA']
  const employees = EMPLOYEES

  return (
    <AppShell activeHref="/pracownicy" title="Pracownicy" tenant={tenant} user={user} roles={roles}>
      {employees.length === 0 ? (
        <EmployeesEmpty />
      ) : (
        <div className="max-w-[1120px] mx-auto">
          <div className="flex items-end justify-between gap-4 mb-[22px]">
            <div>
              <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">Pracownicy</h1>
              <p className="text-muted text-sm mt-1.5 whitespace-nowrap">{employees.length} osób · 2 jednostki organizacyjne</p>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="relative hidden sm:block">
                <IconSearch className="absolute left-[11px] top-[11px] w-[17px] h-[17px] text-muted-2" strokeWidth={1.7} />
                <label htmlFor="emp-search" className="sr-only">
                  Szukaj pracownika
                </label>
                <input
                  id="emp-search"
                  placeholder="Szukaj pracownika"
                  className="h-10 w-[230px] pl-[35px] pr-3 rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent"
                />
              </div>
              <Button className="h-10 px-3.5 text-sm">
                <IconPlus className="w-[17px] h-[17px]" strokeWidth={2} />
                Dodaj pracownika
              </Button>
            </div>
          </div>
          <EmployeesTable employees={employees} />
        </div>
      )}
    </AppShell>
  )
}
