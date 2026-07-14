'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, Th, Td } from '@/components/ui/table'
import { Field, Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { employeeSelectClass } from '@/lib/employee-profile'
import { IconUserPlus, IconClose } from '@/components/icons'
import {
  uzytkownicyApi,
  roleLabel,
  canManageUser,
  buildInviteBody,
  UzytkownicyApiError,
  ROLES,
  EMPTY_INVITE_FORM,
  type TenantUser,
  type UserRoleGrant,
  type Role,
  type InviteFormState,
  type UnitLite,
} from '@/lib/uzytkownicy'

/** Surface the backend's already-humanized message (RBAC 403, duplicate-email / last-admin 409, …) —
 *  `lib/uzytkownicy.ts`'s `humanizeUsersError` has already translated the known ones to Polish. */
function actionErrorMessage(err: unknown): string {
  if (err instanceof UzytkownicyApiError) return err.message || 'Coś poszło nie tak. Spróbuj ponownie.'
  return 'Brak połączenia z serwerem. Spróbuj ponownie.'
}

/** "01.08.2026" from an ISO datetime string — matches dostepy-screen.tsx's dd.mm.yyyy formatting habit. */
function formatDate(iso: string): string {
  const d = iso.slice(0, 10)
  const [y, m, day] = d.split('-')
  if (!y || !m || !day) return d
  return `${day}.${m}.${y}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True for the exact grant the LAST-ADMIN guard protects — a GLOBAL ADMIN_KLIENTA row. */
function isGlobalAdminGrant(g: Pick<UserRoleGrant, 'role' | 'unitId'>): boolean {
  return g.role === 'ADMIN_KLIENTA' && g.unitId === null
}

/** Local (per-row) "grant a new role" mini-form state, keyed by userId. */
interface RoleFormState {
  role: Role
  unitId: string
}

const EMPTY_ROLE_FORM: RoleFormState = { role: 'PRACOWNIK', unitId: '' }

/**
 * Użytkownicy screen: ADMIN_KLIENTA only — the page (app/(tenant)/ustawienia/uzytkownicy/page.tsx)
 * already gates who reaches this component (EmptyState+IconLock for anyone else), so no internal role
 * check here, mirroring components/dostepy/dostepy-screen.tsx's page-gated shape.
 *
 * Two sections:
 *   A. "Zaproś użytkownika" — inline invite panel (email + initial role + optional unit UUID), toggled
 *      by the header button. There is no Dialog/Modal primitive in components/ui/ (see
 *      employee-add-dialog.tsx's doc), so this is the same in-place expand pattern every other
 *      "create" flow in web-kit already uses.
 *   B. "Lista użytkowników" — every tenant user: email, current role grants as removable badges (role
 *      label + unit id or "globalnie"), a compact per-row "grant a role" mini-form, active/inactive
 *      status, and a Deactivate button. The LAST-ADMIN UX guard ({@link canManageUser}) disables
 *      Deactivate + the ADMIN_KLIENTA-badge's revoke control for the tenant's sole remaining active
 *      global admin, with an explanatory title — the backend re-checks the exact same invariant
 *      server-side (`UsersService.guardedAdminMutation`) and has the final say regardless.
 *
 * RODO: `UsersService.list`'s `SAFE_USER_SELECT` never returns anything beyond id/email/active/
 * createdAt/roles — nothing PII beyond a login email is ever rendered here.
 */
export function UsersScreen() {
  const [users, setUsers] = useState<TenantUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState<InviteFormState>(EMPTY_INVITE_FORM)
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const [roleForms, setRoleForms] = useState<Record<string, RoleFormState>>({})

  // Unit picker for the per-row role-grant mini-form: falls back to the raw UUID text input if the
  // unit catalog fetch fails (empty selection is still valid — a global role).
  const [units, setUnits] = useState<UnitLite[]>([])
  const [unitsFailed, setUnitsFailed] = useState(false)

  // Tied to the component's lifetime: a fetch/action can resolve after unmount (mirrors
  // dostepy-screen.tsx's / ai-config-panel.tsx's cancelledRef guard).
  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const rows = await uzytkownicyApi.list()
      if (!cancelledRef.current) {
        setUsers(rows)
        setError(null)
      }
    } catch (e) {
      if (!cancelledRef.current) setError(actionErrorMessage(e))
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    uzytkownicyApi
      .listUnitsForSelect()
      .then((rows) => {
        if (!cancelledRef.current) setUnits(rows)
      })
      .catch(() => {
        if (!cancelledRef.current) setUnitsFailed(true)
      })
  }, [])

  /** Run a mutation under a busy-key lock, surfacing failures as the shared banner and refreshing the
   *  roster on both success and failure (a failed grant/revoke can still have partially landed on one
   *  side of the KC/DB dual-write — see UsersService's doc — so the roster may have changed either way). */
  const withBusy = useCallback(
    (key: string, fn: () => Promise<void>) => {
      setBusy((prev) => new Set(prev).add(key))
      setError(null)
      return fn()
        .catch((e: unknown) => {
          if (!cancelledRef.current) setError(actionErrorMessage(e))
        })
        .then(() => refresh())
        .finally(() => {
          if (!cancelledRef.current) {
            setBusy((prev) => {
              const next = new Set(prev)
              next.delete(key)
              return next
            })
          }
        })
    },
    [refresh],
  )

  async function handleInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const built = buildInviteBody(inviteForm)
    if ('error' in built) {
      setInviteError(built.error)
      return
    }
    setInviting(true)
    setInviteError(null)
    try {
      await uzytkownicyApi.invite(built)
      if (!cancelledRef.current) {
        setInviteForm(EMPTY_INVITE_FORM)
        setShowInvite(false)
      }
      await refresh()
    } catch (e) {
      if (!cancelledRef.current) setInviteError(actionErrorMessage(e))
    } finally {
      if (!cancelledRef.current) setInviting(false)
    }
  }

  function roleFormFor(userId: string): RoleFormState {
    return roleForms[userId] ?? EMPTY_ROLE_FORM
  }
  function patchRoleForm(userId: string, next: Partial<RoleFormState>) {
    setRoleForms((prev) => ({ ...prev, [userId]: { ...roleFormFor(userId), ...next } }))
  }

  function grantRole(userId: string) {
    const rf = roleFormFor(userId)
    const unitId = rf.unitId.trim()
    if (unitId && !UUID_RE.test(unitId)) {
      setError('Nieprawidłowy identyfikator jednostki (oczekiwano UUID).')
      return
    }
    void withBusy(`grant:${userId}:${rf.role}:${unitId}`, () =>
      uzytkownicyApi.assignRole(userId, unitId ? { role: rf.role, unitId } : { role: rf.role }),
    )
  }

  function revokeRole(userId: string, grant: UserRoleGrant) {
    void withBusy(`revoke:${userId}:${grant.role}:${grant.unitId ?? ''}`, () =>
      uzytkownicyApi.revokeRole(userId, grant.unitId ? { role: grant.role, unitId: grant.unitId } : { role: grant.role }),
    )
  }

  function deactivate(userId: string) {
    if (!window.confirm('Na pewno dezaktywować tego użytkownika? Straci dostęp do konta.')) return
    void withBusy(`deactivate:${userId}`, () => uzytkownicyApi.deactivate(userId))
  }

  if (loading) return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie…</div>

  return (
    <div className="max-w-[1120px] mx-auto">
      <div className="mb-[22px] flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">
            Użytkownicy
          </h1>
          <p className="text-muted text-sm mt-1.5">
            Zaproszenia i role RBAC (Pracownik, Menedżer, HR, Admin klienta) w Twojej organizacji.
          </p>
        </div>
        <Button onClick={() => setShowInvite((v) => !v)} className="h-11 shrink-0">
          <IconUserPlus className="w-4 h-4" strokeWidth={2} />
          Zaproś użytkownika
        </Button>
      </div>

      {error && (
        <div role="alert" className="mb-4 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}

      {showInvite && (
        <Card className="p-5 mb-[22px]">
          <h2 className="font-display font-bold text-[17px] tracking-tightish text-navy mb-4">
            Zaproś użytkownika
          </h2>
          <form onSubmit={handleInvite} noValidate>
            {inviteError && (
              <div
                role="alert"
                className="mb-4 rounded-sm border border-error/30 bg-error/[0.06] px-3 py-2.5 text-[13px] text-error"
              >
                {inviteError}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="E-mail" htmlFor="inv-email" className="mb-0">
                <Input
                  id="inv-email"
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="jan.kowalski@firma.pl"
                  required
                />
              </Field>
              <Field label="Rola początkowa" htmlFor="inv-role" className="mb-0">
                <select
                  id="inv-role"
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value as Role }))}
                  className={employeeSelectClass}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Jednostka"
                htmlFor="inv-unit"
                className="mb-0"
                hint="ID jednostki, UUID (opcjonalnie — puste = rola globalna)."
              >
                <Input
                  id="inv-unit"
                  value={inviteForm.unitId}
                  onChange={(e) => setInviteForm((f) => ({ ...f, unitId: e.target.value }))}
                  placeholder="uuid jednostki"
                />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-2.5 mt-1">
              <Button type="button" variant="ghost" onClick={() => setShowInvite(false)} disabled={inviting}>
                Anuluj
              </Button>
              <Button type="submit" disabled={inviting}>
                {inviting ? 'Wysyłanie…' : 'Wyślij zaproszenie'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {users.length === 0 ? (
        <Card className="px-4 py-6 text-sm text-muted text-center">Brak użytkowników.</Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>E-mail</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Utworzono</Th>
              <Th className="text-right pr-4">Akcja</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const manageable = canManageUser(u, users)
              const rf = roleFormFor(u.id)
              return (
                <tr key={u.id}>
                  <Td className="font-medium">{u.email}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {u.roles.length === 0 ? (
                        <span className="text-muted-2 text-xs">Brak ról</span>
                      ) : (
                        u.roles.map((g, i) => {
                          const lastAdminGrant = isGlobalAdminGrant(g) && !manageable
                          const busyKey = `revoke:${u.id}:${g.role}:${g.unitId ?? ''}`
                          return (
                            <Badge key={`${g.role}-${g.unitId ?? 'global'}-${i}`} tone="role" className="gap-1">
                              {roleLabel(g.role)}
                              {g.unitId ? ` · ${g.unitId.slice(0, 8)}` : ' · globalnie'}
                              <button
                                type="button"
                                aria-label={`Odbierz rolę ${roleLabel(g.role)}`}
                                title={lastAdminGrant ? 'Nie można odebrać roli ostatniemu adminowi klienta.' : undefined}
                                onClick={() => revokeRole(u.id, g)}
                                disabled={busy.has(busyKey) || lastAdminGrant}
                                className="ml-0.5 hover:text-error disabled:opacity-50 disabled:hover:text-inherit"
                              >
                                <IconClose className="w-2.5 h-2.5" strokeWidth={2.4} />
                              </button>
                            </Badge>
                          )
                        })
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <select
                        aria-label="Nowa rola"
                        value={rf.role}
                        onChange={(e) => patchRoleForm(u.id, { role: e.target.value as Role })}
                        className="h-8 px-2 rounded-sm border border-line-strong bg-card text-[12.5px] text-ink focus:outline-none focus:border-accent"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                      {unitsFailed ? (
                        <input
                          aria-label="Jednostka (opcjonalnie)"
                          value={rf.unitId}
                          onChange={(e) => patchRoleForm(u.id, { unitId: e.target.value })}
                          placeholder="uuid jednostki"
                          className="h-8 w-28 px-2 rounded-sm border border-line-strong bg-card text-[12.5px] text-ink placeholder:text-muted-2 focus:outline-none focus:border-accent"
                        />
                      ) : (
                        <select
                          aria-label="Jednostka (opcjonalnie)"
                          value={rf.unitId}
                          onChange={(e) => patchRoleForm(u.id, { unitId: e.target.value })}
                          className="h-8 px-2 rounded-sm border border-line-strong bg-card text-[12.5px] text-ink focus:outline-none focus:border-accent"
                        >
                          <option value="">— wybierz —</option>
                          {units.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 px-2.5 text-[12.5px]"
                        onClick={() => grantRole(u.id)}
                        disabled={busy.has(`grant:${u.id}:${rf.role}:${rf.unitId.trim()}`)}
                      >
                        Nadaj
                      </Button>
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={u.active ? 'ok' : 'muted'}>{u.active ? 'Aktywny' : 'Nieaktywny'}</Badge>
                  </Td>
                  <Td>{formatDate(u.createdAt)}</Td>
                  <Td className="text-right pr-4">
                    {u.active ? (
                      <Button
                        variant="ghost"
                        className="h-8 px-3 text-[13px]"
                        onClick={() => deactivate(u.id)}
                        disabled={!manageable || busy.has(`deactivate:${u.id}`)}
                        title={
                          !manageable
                            ? 'To ostatni aktywny admin klienta — najpierw nadaj rolę Admin klienta komuś innemu.'
                            : undefined
                        }
                      >
                        <IconClose className="w-4 h-4" strokeWidth={2} />
                        Deaktywuj
                      </Button>
                    ) : (
                      <span className="text-muted-2 text-xs">—</span>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}
