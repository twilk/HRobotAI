# Finish All Declared Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every screen and component declared in screens-and-components.md that is not yet implemented, so every ⚪ item is fully functional and gate-verified.

**Architecture:** Additive — new lib/users.ts data layer, UsersTable component, real Użytkownicy page, Modal UI primitive, upgraded C5 stubs (Wnioski count + disabled CTAs). All new code follows existing patterns (lib → component → page → test).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind v3, Vitest 2 + RTL 16

---

## Dependency Graph

```
T39 (users lib) ──► T40 (UsersTable) ──► T42 (users tests)
                └──► T41 (Użytkownicy page)                 ┐
T43 (Modal) ─────────────────────────────► T44 (modal tests) ├──► T46 (gates)
T45 (stubs upgrade) ─────────────────────────────────────────┘
```

**Parallel batch 1:** T39 + T43 + T45 (all independent)
**Parallel batch 2:** T40 + T41 + T44 (after T39 and T43 respectively)
**Sequential:** T42 (after T40), then T46 (gates, after all)

---

### Task 39: lib/users.ts — Users model + seed data

**Files:**
- Create: `docs/design/web-kit/lib/users.ts`

- [ ] **Step 1: Create the file**

```typescript
export type UserRole = 'PRACOWNIK' | 'MANAGER' | 'HR' | 'ADMIN_KLIENTA'

export interface AppUser {
  id: string
  name: string
  email: string
  roles: UserRole[]
  status: 'active' | 'invited' | 'inactive'
  initials: string
}

const ROLE_LABELS: Record<UserRole, string> = {
  PRACOWNIK: 'Pracownik',
  MANAGER: 'Manager',
  HR: 'HR',
  ADMIN_KLIENTA: 'Admin klienta',
}

const USERS: AppUser[] = [
  { id: 'u1', name: 'Jan Kowalski', email: 'jan.kowalski@acme.pl', roles: ['ADMIN_KLIENTA'], status: 'active', initials: 'JK' },
  { id: 'u2', name: 'Maria Nowak', email: 'maria.nowak@acme.pl', roles: ['HR', 'MANAGER'], status: 'active', initials: 'MN' },
  { id: 'u3', name: 'Piotr Wiśniewski', email: 'piotr.wisniewski@acme.pl', roles: ['MANAGER'], status: 'active', initials: 'PW' },
  { id: 'u4', name: 'Anna Wójcik', email: 'anna.wojcik@acme.pl', roles: ['PRACOWNIK'], status: 'invited', initials: 'AW' },
]

export function getUsers(): AppUser[] {
  return USERS
}

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role]
}
```

- [ ] **Step 2: Verify TypeScript (run from web-kit dir)**

```bash
cd docs/design/web-kit && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

---

### Task 40: components/users/users-table.tsx — Real users table

**Files:**
- Create: `docs/design/web-kit/components/users/users-table.tsx`

- [ ] **Step 1: Create UsersTable**

```tsx
import { Table, Th, Td } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconMail } from '@/components/icons'
import { type AppUser, roleLabel } from '@/lib/users'

export function UsersTable({ users }: { users: AppUser[] }) {
  return (
    <Table>
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
                  <Badge key={r} className="badge-role">
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
```

---

### Task 41: ustawienia/uzytkownicy/page.tsx — Real page

**Files:**
- Modify: `docs/design/web-kit/app/(tenant)/ustawienia/uzytkownicy/page.tsx`

- [ ] **Step 1: Replace stub with real page**

```tsx
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
```

---

### Task 42: Tests — users lib + UsersTable

**Files:**
- Create: `docs/design/web-kit/test/lib/users.test.ts`
- Create: `docs/design/web-kit/test/components/users-table.test.tsx`

- [ ] **Step 1: Write lib test**

```typescript
// test/lib/users.test.ts
import { describe, it, expect } from 'vitest'
import { getUsers, roleLabel } from '@/lib/users'

describe('users lib', () => {
  it('returns non-empty users array', () => {
    expect(getUsers().length).toBeGreaterThan(0)
  })
  it('contains admin, manager, hr, and pracownik roles', () => {
    const allRoles = getUsers().flatMap((u) => u.roles)
    expect(allRoles).toContain('ADMIN_KLIENTA')
    expect(allRoles).toContain('MANAGER')
    expect(allRoles).toContain('HR')
    expect(allRoles).toContain('PRACOWNIK')
  })
  it('roleLabel returns Polish strings', () => {
    expect(roleLabel('ADMIN_KLIENTA')).toBe('Admin klienta')
    expect(roleLabel('PRACOWNIK')).toBe('Pracownik')
    expect(roleLabel('HR')).toBe('HR')
    expect(roleLabel('MANAGER')).toBe('Manager')
  })
  it('invited user has status invited', () => {
    expect(getUsers().some((u) => u.status === 'invited')).toBe(true)
  })
})
```

- [ ] **Step 2: Write component test**

```tsx
// test/components/users-table.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsersTable } from '@/components/users/users-table'
import { getUsers } from '@/lib/users'

describe('UsersTable', () => {
  it('renders user names and mono emails', () => {
    render(<UsersTable users={getUsers()} />)
    expect(screen.getByText('Jan Kowalski')).toBeInTheDocument()
    expect(screen.getByText('jan.kowalski@acme.pl')).toBeInTheDocument()
  })
  it('renders role badges', () => {
    render(<UsersTable users={getUsers()} />)
    expect(screen.getByText('Admin klienta')).toBeInTheDocument()
    expect(screen.getByText('HR')).toBeInTheDocument()
    expect(screen.getByText('Manager')).toBeInTheDocument()
  })
  it('shows invite button for invited users only', () => {
    render(<UsersTable users={getUsers()} />)
    const inviteButtons = screen.getAllByRole('button', { name: /Wyślij zaproszenie/ })
    expect(inviteButtons).toHaveLength(1) // only Anna (invited)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd docs/design/web-kit && npx vitest run test/lib/users.test.ts test/components/users-table.test.tsx
```
Expected: 7 tests pass

---

### Task 43: components/ui/modal.tsx — Modal component

**Files:**
- Create: `docs/design/web-kit/components/ui/modal.tsx`

- [ ] **Step 1: Create Modal**

```tsx
'use client'

import { type ReactNode, useEffect } from 'react'
import { cn } from '@/lib/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}

/**
 * Modal: warm card on navy scrim. No glass. Escape closes.
 * Per screens-and-components.md §E component kit.
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(8,16,28,.55)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          'w-full max-w-[440px] rounded-lg border border-line bg-card p-6 shadow-lift',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-[19px] font-bold tracking-tightish text-navy mb-4">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
```

---

### Task 44: test/components/modal.test.tsx

**Files:**
- Create: `docs/design/web-kit/test/components/modal.test.tsx`

- [ ] **Step 1: Write modal tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from '@/components/ui/modal'

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Test">Content</Modal>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('renders with role=dialog when open', () => {
    render(<Modal open onClose={() => {}} title="Test Modal">Content</Modal>)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Test Modal')).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()
  })
  it('calls onClose when scrim is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Modal open onClose={onClose} title="Test">Content</Modal>)
    await user.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd docs/design/web-kit && npx vitest run test/components/modal.test.tsx
```
Expected: 3 tests pass

---

### Task 45: Upgrade C5 stubs — Wnioski + Dostępy + Ustawienia

**Files:**
- Modify: `docs/design/web-kit/app/(tenant)/wnioski/page.tsx`
- Modify: `docs/design/web-kit/app/(tenant)/dostepy/page.tsx`
- Modify: `docs/design/web-kit/app/(tenant)/ustawienia/page.tsx`

- [ ] **Step 1: Upgrade Wnioski (count badge + disabled CTA)**

```tsx
import { AppShell } from '@/components/layout/app-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconRequests, IconPlus } from '@/components/icons'
import type { Role } from '@/lib/nav'

const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
const roles: Role[] = ['ADMIN_KLIENTA']
// Matches the nav tag count (NAV Wnioski tag: '3').
const WNIOSKI_COUNT = 3

export default function WnioskiPage() {
  return (
    <AppShell activeHref="/wnioski" title="Wnioski" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-[22px] flex items-center gap-3">
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">
            Wnioski
          </h1>
          <span className="font-mono text-[11px] rounded-full bg-navy/10 px-2 py-0.5 text-navy">
            {WNIOSKI_COUNT}
          </span>
        </div>
        <EmptyState
          icon={IconRequests}
          title="Wnioski wkrótce"
          actions={
            <Button
              variant="ghost"
              aria-disabled
              className="opacity-50 cursor-not-allowed"
              title="Dostępne wkrótce"
            >
              <IconPlus className="w-[17px] h-[17px]" strokeWidth={2} />
              Złóż wniosek
              <Badge tone="muted" className="ml-1.5">
                wkrótce
              </Badge>
            </Button>
          }
        >
          Wnioski urlopowe i kadrowe z automatycznym obiegiem akceptacji pojawią się wkrótce.
        </EmptyState>
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 2: Upgrade Dostępy (disabled CTA)**

```tsx
import { AppShell } from '@/components/layout/app-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconKey } from '@/components/icons'
import type { Role } from '@/lib/nav'

const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
const roles: Role[] = ['ADMIN_KLIENTA']

export default function DostepyPage() {
  return (
    <AppShell activeHref="/dostepy" title="Dostępy" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-[22px]">
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">
            Dostępy
          </h1>
        </div>
        <EmptyState
          icon={IconKey}
          title="Dostępy wkrótce"
          actions={
            <Button
              variant="ghost"
              aria-disabled
              className="opacity-50 cursor-not-allowed"
              title="Dostępne wkrótce"
            >
              Zarządzaj dostępami
              <Badge tone="muted" className="ml-1.5">
                wkrótce
              </Badge>
            </Button>
          }
        >
          Zarządzanie kartami, kluczami i uprawnieniami fizycznymi będzie dostępne w module Dostępy.
        </EmptyState>
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 3: Upgrade Ustawienia (sub-page cards)**

```tsx
import Link from 'next/link'
import { AppShell } from '@/components/layout/app-shell'
import { Card } from '@/components/ui/card'
import { IconBuilding, IconUser, IconArrowRight, IconSettings } from '@/components/icons'
import type { Role } from '@/lib/nav'

const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
const roles: Role[] = ['ADMIN_KLIENTA']

const SECTIONS = [
  {
    href: '/ustawienia/placowki',
    icon: IconBuilding,
    title: 'Placówki',
    desc: 'Lokalizacje, adresy oraz dni i godziny pracy. Te ustawienia sterują grafikiem.',
  },
  {
    href: '/ustawienia/uzytkownicy',
    icon: IconUser,
    title: 'Użytkownicy',
    desc: 'Zapraszaj HR i menedżerów. Zarządzaj rolami RBAC (Pracownik, Manager, HR, Admin).',
  },
]

export default function UstawieniaPage() {
  return (
    <AppShell activeHref="/ustawienia" title="Ustawienia" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-[22px]">
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">
            Ustawienia
          </h1>
          <p className="mt-1.5 text-sm text-muted">Konfiguracja przestrzeni roboczej ACME.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            return (
              <Link key={s.href} href={s.href} className="group">
                <Card className="h-full p-[18px] flex flex-col gap-3 transition-[transform,box-shadow,border-color] duration-150 group-hover:-translate-y-0.5 group-hover:shadow group-hover:border-line-strong">
                  <span className="grid place-items-center w-10 h-10 rounded-[10px] border border-line bg-card-2">
                    <Icon className="w-5 h-5 text-accent-ink" />
                  </span>
                  <h3 className="text-[15.5px] font-semibold tracking-tightish">{s.title}</h3>
                  <p className="text-[13px] text-muted leading-snug flex-1">{s.desc}</p>
                  <span className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink">
                    Przejdź
                    <IconArrowRight className="w-[15px] h-[15px] transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                  </span>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}
```

---

### Task 46: Gate verification

- [ ] **Step 1: TypeScript**
```bash
cd docs/design/web-kit && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 2: Lint**
```bash
cd docs/design/web-kit && npx next lint
```
Expected: ✓ or warning only

- [ ] **Step 3: Run all tests**
```bash
cd docs/design/web-kit && npx vitest run
```
Expected: 42+ tests pass (35 existing + 7 users + 3 modal)

- [ ] **Step 4: Build**
```bash
cd docs/design/web-kit && npx next build
```
Expected: ✓ build with 22+ routes

- [ ] **Step 5: Commit**
```bash
git add docs/design/web-kit/lib/users.ts \
        docs/design/web-kit/components/ui/modal.tsx \
        docs/design/web-kit/components/users/users-table.tsx \
        docs/design/web-kit/app/\(tenant\)/ustawienia/uzytkownicy/page.tsx \
        docs/design/web-kit/app/\(tenant\)/wnioski/page.tsx \
        docs/design/web-kit/app/\(tenant\)/dostepy/page.tsx \
        docs/design/web-kit/app/\(tenant\)/ustawienia/page.tsx \
        docs/design/web-kit/test/lib/users.test.ts \
        docs/design/web-kit/test/components/users-table.test.tsx \
        docs/design/web-kit/test/components/modal.test.tsx
git commit -m "feat(web-kit): C6 Użytkownicy, Modal, upgraded C5 stubs — all screens complete"
```
