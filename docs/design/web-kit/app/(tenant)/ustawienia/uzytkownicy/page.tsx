import { AppShell } from '@/components/layout/app-shell'
import { UsersClientView } from '@/components/users/users-client-view'
import { getUsers } from '@/lib/users'
import { requirePageSession } from '@/lib/session'

export default async function UzytkownicyPage() {
  const { user, tenant, roles } = await requirePageSession()
  const users = getUsers()

  return (
    <AppShell activeHref="/ustawienia/uzytkownicy" title="Użytkownicy" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <UsersClientView initialUsers={users} />
      </div>
    </AppShell>
  )
}
