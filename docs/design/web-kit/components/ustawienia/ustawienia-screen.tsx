'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { IconPlus } from '@/components/icons'
import { employeeSelectClass } from '@/lib/employee-profile'
import {
  ustawieniaApi,
  buildUnitTree,
  wouldCreateCycle,
  UstawieniaApiError,
  type CompanySettings,
  type OrgUnit,
  type OrgUnitNode,
} from '@/lib/ustawienia'

/** Surface the backend's already-humanized `message` (400 validation/cycle, 403, 409). */
function errorMessage(err: unknown): string {
  if (err instanceof UstawieniaApiError) {
    if (err.status === 403) return 'Brak uprawnień do tej operacji.'
    return err.message || 'Coś poszło nie tak. Spróbuj ponownie.'
  }
  return 'Brak połączenia z serwerem. Spróbuj ponownie.'
}

interface CompanyForm {
  companyName: string
  timezone: string
  region: string
  locale: string
}

/** Editable per-unit fields, keyed by unit id — only the row currently being edited has an entry. */
interface UnitEditState {
  name: string
  parentId: string // '' means "brak" (root)
  managerUserId: string // free-text User.id; '' means unchanged/none
}

function toCompanyForm(c: CompanySettings): CompanyForm {
  return { companyName: c.companyName, timezone: c.timezone, region: c.region, locale: c.locale }
}

/** The subset of unit fields the edit form needs — shared by {@link OrgUnit} and {@link OrgUnitNode}
 *  (whose `children` shapes differ) so `startEdit` can take either without a type mismatch. */
type UnitLike = Pick<OrgUnit, 'id' | 'name' | 'parentId' | 'managerUserId'>

function toUnitEdit(u: UnitLike): UnitEditState {
  return { name: u.name, parentId: u.parentId ?? '', managerUserId: u.managerUserId ?? '' }
}

/**
 * Ustawienia (company settings + org units) — ADMIN_KLIENTA-only editing surface. The page already
 * gates the whole screen to ADMIN_KLIENTA (mirrors ai-grafik-manager's EmptyState pattern), so every
 * mutation here is expected to succeed RBAC-wise; a backend 403 would only happen on a race (role
 * revoked mid-session) and still surfaces as a friendly banner via {@link errorMessage}.
 *
 * Two independent sections sharing one load/error lifecycle:
 *   1. Company settings — a flat PATCH form (companyName/timezone/region/locale).
 *   2. Org-unit tree — add-unit form + per-unit inline edit (rename/reparent/set-manager). The parent
 *      <select> for a unit being edited excludes itself and its descendants via
 *      {@link wouldCreateCycle} so the UI can never even OFFER an invalid reparent — the backend still
 *      has the final say (transactional cycle guard) and a rejection surfaces as the same banner.
 *      `managerUserId` has no directory to pick from (tenant-runtime exposes no `/users` listing), so
 *      it's a raw UUID text field; a bad id trips the backend's FK check (400).
 */
export function UstawieniaScreen() {
  const [company, setCompany] = useState<CompanyForm | null>(null)
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [companySaving, setCompanySaving] = useState(false)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [companySaved, setCompanySaved] = useState(false)

  const [newUnitName, setNewUnitName] = useState('')
  const [newUnitParentId, setNewUnitParentId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [edit, setEdit] = useState<UnitEditState | null>(null)
  const [savingUnit, setSavingUnit] = useState(false)
  const [unitError, setUnitError] = useState<string | null>(null)

  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [companyRow, unitRows] = await Promise.all([ustawieniaApi.getCompany(), ustawieniaApi.listUnits()])
      if (cancelledRef.current) return
      setCompany(toCompanyForm(companyRow))
      setUnits(unitRows)
    } catch (err) {
      if (!cancelledRef.current) setLoadError(errorMessage(err))
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleCompanySubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!company) return
    setCompanyError(null)
    setCompanySaved(false)
    if (company.companyName.trim() === '') {
      setCompanyError('Nazwa firmy nie może być pusta.')
      return
    }
    setCompanySaving(true)
    try {
      const saved = await ustawieniaApi.updateCompany(company)
      if (!cancelledRef.current) {
        setCompany(toCompanyForm(saved))
        setCompanySaved(true)
      }
    } catch (err) {
      if (!cancelledRef.current) setCompanyError(errorMessage(err))
    } finally {
      if (!cancelledRef.current) setCompanySaving(false)
    }
  }

  async function handleCreateUnit(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    const name = newUnitName.trim()
    if (name === '') {
      setCreateError('Nazwa jednostki nie może być pusta.')
      return
    }
    setCreating(true)
    try {
      const created = await ustawieniaApi.createUnit({ name, parentId: newUnitParentId || undefined })
      if (!cancelledRef.current) {
        setUnits((prev) => [...prev, created])
        setNewUnitName('')
        setNewUnitParentId('')
      }
    } catch (err) {
      if (!cancelledRef.current) setCreateError(errorMessage(err))
    } finally {
      if (!cancelledRef.current) setCreating(false)
    }
  }

  function startEdit(unit: UnitLike) {
    setEditingId(unit.id)
    setEdit(toUnitEdit(unit))
    setUnitError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEdit(null)
    setUnitError(null)
  }

  async function handleSaveUnit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingId || !edit) return
    const original = units.find((u) => u.id === editingId)
    if (!original) return

    setUnitError(null)
    const name = edit.name.trim()
    if (name === '') {
      setUnitError('Nazwa jednostki nie może być pusta.')
      return
    }
    const nextParentId = edit.parentId === '' ? null : edit.parentId
    if (wouldCreateCycle(units, editingId, nextParentId)) {
      setUnitError('Nie można ustawić tej jednostki nadrzędnej — utworzyłoby to cykl w hierarchii.')
      return
    }

    setSavingUnit(true)
    try {
      const updated = await ustawieniaApi.updateUnit(editingId, {
        name,
        parentId: nextParentId ?? undefined,
        managerUserId: edit.managerUserId.trim() || undefined,
      })
      if (!cancelledRef.current) {
        setUnits((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
        setEditingId(null)
        setEdit(null)
      }
    } catch (err) {
      if (!cancelledRef.current) setUnitError(errorMessage(err))
    } finally {
      if (!cancelledRef.current) setSavingUnit(false)
    }
  }

  if (loading) return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie ustawień…</div>

  if (loadError)
    return (
      <div className="max-w-[720px] mx-auto rounded-lg border border-error/30 bg-error/[0.05] px-4 py-3 text-[13.5px] text-ink" role="alert">
        {loadError}{' '}
        <button type="button" onClick={load} className="underline hover:no-underline">
          Spróbuj ponownie
        </button>
      </div>
    )

  if (!company) return null

  const tree = buildUnitTree(units)

  return (
    <div className="max-w-[860px] mx-auto space-y-10">
      <section>
        <div className="mb-[22px]">
          <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">Ustawienia</h1>
          <p className="text-muted text-sm mt-1.5">Dane firmy oraz struktura jednostek organizacyjnych.</p>
        </div>

        <form onSubmit={handleCompanySubmit} className="rounded-lg border border-line-strong bg-card p-5">
          <h2 className="font-display font-bold text-[17px] text-navy mb-4">Dane firmy</h2>

          <Field label="Nazwa firmy" htmlFor="companyName">
            <Input
              id="companyName"
              value={company.companyName}
              onChange={(e) => {
                setCompanySaved(false)
                setCompany((prev) => (prev ? { ...prev, companyName: e.target.value } : prev))
              }}
            />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Strefa czasowa" htmlFor="timezone" hint="np. Europe/Warsaw">
              <Input
                id="timezone"
                value={company.timezone}
                onChange={(e) => {
                  setCompanySaved(false)
                  setCompany((prev) => (prev ? { ...prev, timezone: e.target.value } : prev))
                }}
              />
            </Field>
            <Field label="Region" htmlFor="region" hint="np. EU-Central">
              <Input
                id="region"
                value={company.region}
                onChange={(e) => {
                  setCompanySaved(false)
                  setCompany((prev) => (prev ? { ...prev, region: e.target.value } : prev))
                }}
              />
            </Field>
            <Field label="Lokalizacja (locale)" htmlFor="locale" hint="np. pl-PL">
              <Input
                id="locale"
                value={company.locale}
                onChange={(e) => {
                  setCompanySaved(false)
                  setCompany((prev) => (prev ? { ...prev, locale: e.target.value } : prev))
                }}
              />
            </Field>
          </div>

          {companyError ? (
            <div className="mb-4 rounded-lg border border-error/30 bg-error/[0.05] px-4 py-3 text-[13.5px] text-ink" role="alert">
              {companyError}
            </div>
          ) : null}
          {companySaved ? (
            <div className="mb-4 rounded-lg border border-verified/30 bg-verified/[0.06] px-4 py-3 text-[13.5px] text-ink" role="status">
              Zapisano dane firmy.
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={companySaving}>
              {companySaving ? 'Zapisywanie…' : 'Zapisz dane firmy'}
            </Button>
          </div>
        </form>
      </section>

      <section>
        <div className="mb-[22px]">
          <h2 className="font-display font-bold text-[17px] text-navy">Jednostki organizacyjne</h2>
          <p className="text-muted text-sm mt-1">Hierarchia oddziałów i zespołów.</p>
        </div>

        <Card className="p-5 mb-5">
          {units.length === 0 ? (
            <p className="text-muted text-sm py-6 text-center">Brak jednostek organizacyjnych. Dodaj pierwszą poniżej.</p>
          ) : (
            <ul className="space-y-1.5">
              {tree.map((node) => (
                <UnitRow
                  key={node.id}
                  node={node}
                  depth={0}
                  units={units}
                  editingId={editingId}
                  edit={edit}
                  savingUnit={savingUnit}
                  unitError={unitError}
                  onStartEdit={startEdit}
                  onCancelEdit={cancelEdit}
                  onSave={handleSaveUnit}
                  onEditChange={(next) => setEdit(next)}
                />
              ))}
            </ul>
          )}
        </Card>

        <form onSubmit={handleCreateUnit} className="rounded-lg border border-line-strong bg-card p-5">
          <h3 className="font-display font-bold text-[15px] text-navy mb-4">Nowa jednostka</h3>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <Field label="Nazwa" htmlFor="newUnitName" className="mb-0">
              <Input
                id="newUnitName"
                value={newUnitName}
                onChange={(e) => setNewUnitName(e.target.value)}
                placeholder="np. Oddział Warszawa"
              />
            </Field>
            <Field label="Jednostka nadrzędna" htmlFor="newUnitParentId" className="mb-0">
              <select
                id="newUnitParentId"
                value={newUnitParentId}
                onChange={(e) => setNewUnitParentId(e.target.value)}
                className={employeeSelectClass}
              >
                <option value="">Brak (jednostka główna)</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" disabled={creating}>
              <IconPlus className="w-4 h-4" />
              {creating ? 'Dodawanie…' : 'Dodaj'}
            </Button>
          </div>
          {createError ? (
            <div className="mt-4 rounded-lg border border-error/30 bg-error/[0.05] px-4 py-3 text-[13.5px] text-ink" role="alert">
              {createError}
            </div>
          ) : null}
        </form>
      </section>
    </div>
  )
}

interface UnitRowProps {
  node: OrgUnitNode
  depth: number
  units: OrgUnit[]
  editingId: string | null
  edit: UnitEditState | null
  savingUnit: boolean
  unitError: string | null
  onStartEdit: (unit: UnitLike) => void
  onCancelEdit: () => void
  onSave: (e: React.FormEvent) => void
  onEditChange: (next: UnitEditState) => void
}

/** One org-unit row, recursively rendering its children indented — plain nesting, no virtualization
 *  (tenant org trees are small: dozens of units, not thousands). */
function UnitRow({
  node,
  depth,
  units,
  editingId,
  edit,
  savingUnit,
  unitError,
  onStartEdit,
  onCancelEdit,
  onSave,
  onEditChange,
}: UnitRowProps) {
  const isEditing = editingId === node.id && edit != null

  // Exclude the unit itself and any unit reparenting-under-it would cycle, so the <select> never even
  // offers an invalid choice (defense-in-depth on top of the backend's own guard).
  const parentOptions = units.filter((u) => u.id !== node.id && !wouldCreateCycle(units, node.id, u.id))

  return (
    <li>
      <div className="flex items-center gap-3 py-2 px-2.5 rounded-sm hover:bg-card-2" style={{ paddingLeft: `${depth * 22 + 10}px` }}>
        {isEditing ? (
          <form onSubmit={onSave} className="flex flex-1 flex-wrap items-end gap-3">
            <Field label="Nazwa" htmlFor={`name-${node.id}`} className="mb-0">
              <Input id={`name-${node.id}`} value={edit!.name} onChange={(e) => onEditChange({ ...edit!, name: e.target.value })} />
            </Field>
            <Field label="Jednostka nadrzędna" htmlFor={`parent-${node.id}`} className="mb-0">
              <select
                id={`parent-${node.id}`}
                value={edit!.parentId}
                onChange={(e) => onEditChange({ ...edit!, parentId: e.target.value })}
                className={employeeSelectClass}
              >
                <option value="">Brak (jednostka główna)</option>
                {parentOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Manager (User ID)" htmlFor={`manager-${node.id}`} className="mb-0">
              <Input
                id={`manager-${node.id}`}
                value={edit!.managerUserId}
                onChange={(e) => onEditChange({ ...edit!, managerUserId: e.target.value })}
                placeholder="UUID użytkownika"
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={savingUnit}>
                {savingUnit ? 'Zapisywanie…' : 'Zapisz'}
              </Button>
              <Button type="button" variant="ghost" onClick={onCancelEdit} disabled={savingUnit}>
                Anuluj
              </Button>
            </div>
          </form>
        ) : (
          <>
            <span className="flex-1 text-[14.5px] text-ink font-medium">{node.name}</span>
            {node.managerUserId ? (
              <span className="text-xs text-muted">manager: {node.managerUserId.slice(0, 8)}…</span>
            ) : (
              <span className="text-xs text-muted-2">brak managera</span>
            )}
            <Button type="button" variant="ghost" onClick={() => onStartEdit(node)}>
              Edytuj
            </Button>
          </>
        )}
      </div>

      {isEditing && unitError ? (
        <div
          className="ml-2.5 mb-2 rounded-lg border border-error/30 bg-error/[0.05] px-4 py-3 text-[13.5px] text-ink"
          style={{ marginLeft: `${depth * 22 + 10}px` }}
          role="alert"
        >
          {unitError}
        </div>
      ) : null}

      {node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <UnitRow
              key={child.id}
              node={child}
              depth={depth + 1}
              units={units}
              editingId={editingId}
              edit={edit}
              savingUnit={savingUnit}
              unitError={unitError}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onSave={onSave}
              onEditChange={onEditChange}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
