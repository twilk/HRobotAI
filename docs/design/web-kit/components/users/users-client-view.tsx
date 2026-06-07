'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { IconPlus } from '@/components/icons'
import { UsersTable } from './users-table'
import { InviteUserModal } from './invite-user-modal'
import type { AppUser, UserRole } from '@/lib/users'

let _nextUserId = 200

export function UsersClientView({ initialUsers }: { initialUsers: AppUser[] }) {
  const [users, setUsers] = useState<AppUser[]>(initialUsers)
  const [showInvite, setShowInvite] = useState(false)

  function handleInvite(email: string, role: UserRole) {
    const id = String(++_nextUserId)
    const namePart = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    const initials = namePart.split(' ').map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase()
    setUsers((prev) => [
      ...prev,
      { id, name: namePart, email, roles: [role], status: 'invited', initials },
    ])
  }

  return (
    <>
      <div className="mb-[22px] flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">
            Użytkownicy
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {users.length} użytkowników · zarządzaj rolami RBAC
          </p>
        </div>
        <Button className="h-10 px-3.5 text-sm" onClick={() => setShowInvite(true)}>
          <IconPlus className="w-[17px] h-[17px]" strokeWidth={2} />
          Zaproś użytkownika
        </Button>
      </div>
      <UsersTable users={users} />
      <InviteUserModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onInvite={handleInvite}
      />
    </>
  )
}
