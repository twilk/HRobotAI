import { Table, Th, Td } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconMail } from '@/components/icons'
import { type AppUser, roleLabel } from '@/lib/users'

export function UsersTable({ users }: { users: AppUser[] }) {
  return (
    <Table data-guide="uzytkownicy:table">
      <thead>
        <tr>
          <Th>Użytkownik</Th>
          <Th>Email</Th>
          <Th>Role</Th>
          <Th>Status</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id} className="hover:bg-card-2">
            <Td>
              <div className="flex items-center gap-[11px]">
                <span className="grid place-items-center w-[30px] h-[30px] rounded-lg bg-gradient-to-b from-navy-700 to-navy text-white text-[11px] font-semibold shrink-0">
                  {u.initials}
                </span>
                <span className="font-medium">{u.name}</span>
              </div>
            </Td>
            <Td>
              <span className="font-mono text-[12.5px] text-muted">{u.email}</span>
            </Td>
            <Td>
              <div className="flex gap-1.5 flex-wrap">
                {u.roles.map((r) => (
                  <Badge key={r} className="badge-role" data-guide="uzytkownicy:role-badge">
                    {roleLabel(r)}
                  </Badge>
                ))}
              </div>
            </Td>
            <Td>
              {u.status === 'active' ? (
                <Badge tone="ok">Aktywny</Badge>
              ) : u.status === 'invited' ? (
                <Badge tone="warn">Zaproszony</Badge>
              ) : (
                <Badge>Nieaktywny</Badge>
              )}
            </Td>
            <Td>
              {u.status !== 'active' && (
                <Button variant="ghost" className="h-8 px-2.5 text-xs gap-1.5">
                  <IconMail className="w-[14px] h-[14px]" />
                  Wyślij zaproszenie
                </Button>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
