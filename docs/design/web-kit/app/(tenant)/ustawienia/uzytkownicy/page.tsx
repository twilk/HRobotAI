import { AppShell } from '@/components/layout/app-shell'
import { UsersClientView } from '@/components/users/users-client-view'
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
        <UsersClientView initialUsers={users} />
      </div>
    </AppShell>
  )
}
