import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { EmployeesTable } from '@/components/employees/employees-table'
import { EmployeesEmpty } from '@/components/employees/employees-empty'
import { IconPlus, IconSearch } from '@/components/icons'
import { getEmployees } from '@/lib/employees'
import type { Role } from '@/lib/nav'

export default async function PracownicyPage() {
  const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
  const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
  const roles: Role[] = ['ADMIN_KLIENTA']
  // Proof-of-stack: in the real app this is `await fetch('/api/employees')` through
  // the authenticated tenant runtime (returns last-4 of PESEL only, never plaintext).
  const employees = getEmployees()

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
