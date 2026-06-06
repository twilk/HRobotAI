import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { IconPlus } from '@/components/icons'
import { UsersTable } from '@/components/users/users-table'
import { getUsers } from '@/lib/users'
import type { Role } from '@/lib/nav'

export default async function UzytkownicyPage() {
  const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
  const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
  const roles: Role[] = ['ADMIN_KLIENTA']
  const users = getUsers()

  return (
    <AppShell activeHref="/ustawienia/uzytkownicy" title="Użytkownicy" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-[22px] flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">
              Użytkownicy
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              {users.length} użytkowników · zarządzaj rolami RBAC
            </p>
          </div>
          <Button className="h-10 px-3.5 text-sm">
            <IconPlus className="w-[17px] h-[17px]" strokeWidth={2} />
            Zaproś użytkownika
          </Button>
        </div>
        <UsersTable users={users} />
      </div>
    </AppShell>
  )
}
