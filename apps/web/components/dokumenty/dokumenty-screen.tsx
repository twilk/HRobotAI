'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, Th, Td } from '@/components/ui/table'
import { Field } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { employeeSelectClass } from '@/lib/employee-profile'
import { ustawieniaApi, indexUnits, type OrgUnit } from '@/lib/ustawienia'
import {
  dokumentyApi,
  documentTypeLabel,
  documentFormatLabel,
  documentStatusLabel,
  scopeLabel,
  formatDate,
  formatPeriodRange,
  formatOvertimeSummary,
  formatWorkedTotal,
  isApprovable,
  DOCUMENT_TYPES,
  DOCUMENT_FORMATS,
  DOC_SCOPE_TYPES,
  DokumentyError,
  type GeneratedDocument,
  type DocumentType,
  type DocumentFormat,
  type DocScopeType,
  type GenerujDokumentInput,
} from '@/lib/dokumenty'

interface EmployeeLite {
  id: string
  firstName: string
  lastName: string
}

/** `{ label, tone }` → the Badge component's own tone prop shape. */
function StatusBadge({ status }: { status: GeneratedDocument['status'] }) {
  const { label, tone } = documentStatusLabel(status)
  return <Badge tone={tone}>{label}</Badge>
}

function actionErrorMessage(err: unknown): string {
  if (err instanceof DokumentyError) return err.message || 'Coś poszło nie tak. Spróbuj ponownie.'
  return 'Brak połączenia z serwerem. Spróbuj ponownie.'
}

const EMPTY_FORM: GenerujFormState = {
  type: 'EWIDENCJA_CZASU_PRACY',
  format: 'PDF',
  scopeType: 'EMPLOYEE',
  periodStart: '',
  periodEnd: '',
  employeeId: '',
  unitId: '',
}

interface GenerujFormState {
  type: DocumentType
  format: DocumentFormat
  scopeType: DocScopeType
  periodStart: string
  periodEnd: string
  employeeId: string
  unitId: string
}

/** Pure validator/builder for `POST /api/dokumenty/generuj` — mirrors `buildIssueBody`
 *  (lib/dostepy.ts): returns `{ error }` with a Polish message for the first failure, or a
 *  ready-to-POST {@link GenerujDokumentInput}. Cross-field scope↔id consistency mirrors the
 *  backend's `ScopeConsistencyConstraint` (dto/generuj-dokument.dto.ts) so an obviously-invalid
 *  combination is caught before the round-trip. */
function buildGenerujBody(form: GenerujFormState): GenerujDokumentInput | { error: string } {
  if (!form.periodStart || !form.periodEnd) return { error: 'Podaj okres (od–do).' }
  if (new Date(form.periodStart).getTime() > new Date(form.periodEnd).getTime()) {
    return { error: 'Data „od” musi być wcześniejsza lub równa dacie „do”.' }
  }
  if (form.scopeType === 'EMPLOYEE' && !form.employeeId) return { error: 'Wybierz pracownika.' }
  if (form.scopeType === 'UNIT' && !form.unitId) return { error: 'Wybierz jednostkę.' }

  const body: GenerujDokumentInput = {
    type: form.type,
    format: form.format,
    scopeType: form.scopeType,
    periodStart: form.periodStart,
    periodEnd: form.periodEnd,
  }
  if (form.scopeType === 'EMPLOYEE') body.employeeId = form.employeeId
  if (form.scopeType === 'UNIT') body.unitId = form.unitId
  return body
}

/**
 * Full Dokumenty workspace — MANAGER/HR/ADMIN_KLIENTA (the page already gates who reaches this
 * component, mirroring components/dostepy/dostepy-screen.tsx). Three sections (SPEC §7):
 *
 *  A. Lista dokumentów — every document in the actor's scope: typ, okres, zakres (id→nazwa
 *     enrichment via `/api/employees` + `ustawieniaApi.listUnits`), status badge, format, data
 *     generacji, akcje (podgląd/pobierz always; zatwierdź for an approvable GENERATED row).
 *  B. Generuj — typ/format/zakres/okres form, POST `/api/dokumenty/generuj`, refreshes the list.
 *  C. Pobierz — a plain `<a href>` at the proxy's binary `pobierz` path (SPEC §7c note).
 *
 * The RODO banner (art. 22) is rendered ONCE by the server shell above this component.
 */
export function DokumentyScreen() {
  const [docs, setDocs] = useState<GeneratedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const [employees, setEmployees] = useState<EmployeeLite[]>([])
  const [units, setUnits] = useState<OrgUnit[]>([])

  const [form, setForm] = useState<GenerujFormState>(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const rows = await dokumentyApi.list()
      if (!cancelledRef.current) {
        setDocs(rows)
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
    fetch('/api/employees', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<EmployeeLite[]>) : Promise.resolve([])))
      .then((rows) => {
        if (!cancelledRef.current) setEmployees(rows)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    ustawieniaApi
      .listUnits()
      .then((rows) => {
        if (!cancelledRef.current) setUnits(rows)
      })
      .catch(() => undefined)
  }, [])

  const employeeName = useMemo(() => {
    const byId = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]))
    return (id: string | null) => (id ? (byId.get(id) ?? id) : null)
  }, [employees])

  const unitIndex = useMemo(() => indexUnits(units), [units])
  const unitName = useCallback((id: string | null) => (id ? (unitIndex.get(id)?.name ?? id) : null), [unitIndex])

  function zakresText(doc: GeneratedDocument): string {
    if (doc.scopeType === 'EMPLOYEE') return employeeName(doc.employeeId) ?? scopeLabel('EMPLOYEE')
    if (doc.scopeType === 'UNIT') return unitName(doc.unitId) ?? scopeLabel('UNIT')
    return scopeLabel('ALL')
  }

  const zatwierdz = useCallback(
    async (id: string) => {
      const key = `zatwierdz:${id}`
      setBusy((prev) => new Set(prev).add(key))
      setError(null)
      try {
        await dokumentyApi.zatwierdz(id)
        await refresh()
      } catch (e) {
        if (!cancelledRef.current) setError(actionErrorMessage(e))
      } finally {
        if (!cancelledRef.current) {
          setBusy((prev) => {
            const next = new Set(prev)
            next.delete(key)
            return next
          })
        }
      }
    },
    [refresh],
  )

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    const built = buildGenerujBody(form)
    if ('error' in built) {
      setCreateError(built.error)
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      await dokumentyApi.generuj(built)
      if (!cancelledRef.current) setForm((f) => ({ ...f, employeeId: '', unitId: '' }))
      await refresh()
    } catch (e) {
      if (!cancelledRef.current) setCreateError(actionErrorMessage(e))
    } finally {
      if (!cancelledRef.current) setCreating(false)
    }
  }

  function patch(next: Partial<GenerujFormState>) {
    setCreateError(null)
    setForm((f) => ({ ...f, ...next }))
  }

  if (loading) return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie…</div>

  return (
    <div className="max-w-[1120px] mx-auto">
      {error && (
        <div role="alert" className="mb-4 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}

      {/* Sekcja B: generuj */}
      <section className="mb-8">
        <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">Generuj dokument</h2>
        <Card className="p-4">
          <form onSubmit={handleGenerate} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Typ dokumentu" htmlFor="dokTyp" className="mb-0">
              <select
                id="dokTyp"
                value={form.type}
                onChange={(e) => patch({ type: e.target.value as DocumentType })}
                className={employeeSelectClass}
              >
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {documentTypeLabel(t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Format" htmlFor="dokFormat" className="mb-0">
              <select
                id="dokFormat"
                value={form.format}
                onChange={(e) => patch({ format: e.target.value as DocumentFormat })}
                className={employeeSelectClass}
              >
                {DOCUMENT_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {documentFormatLabel(f)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Zakres" htmlFor="dokZakres" className="mb-0">
              <select
                id="dokZakres"
                value={form.scopeType}
                onChange={(e) => patch({ scopeType: e.target.value as DocScopeType, employeeId: '', unitId: '' })}
                className={employeeSelectClass}
              >
                {DOC_SCOPE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {scopeLabel(s)}
                  </option>
                ))}
              </select>
            </Field>

            {form.scopeType === 'EMPLOYEE' && (
              <Field label="Pracownik" htmlFor="dokEmployee" className="mb-0">
                <select
                  id="dokEmployee"
                  value={form.employeeId}
                  onChange={(e) => patch({ employeeId: e.target.value })}
                  className={employeeSelectClass}
                >
                  <option value="">Wybierz…</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {form.scopeType === 'UNIT' && (
              <Field label="Jednostka" htmlFor="dokUnit" className="mb-0">
                <select
                  id="dokUnit"
                  value={form.unitId}
                  onChange={(e) => patch({ unitId: e.target.value })}
                  className={employeeSelectClass}
                >
                  <option value="">Wybierz…</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Okres od" htmlFor="dokOd" className="mb-0">
              <input
                id="dokOd"
                type="date"
                value={form.periodStart}
                onChange={(e) => patch({ periodStart: e.target.value })}
                className="w-full h-11 px-[13px] rounded-sm border border-line-strong bg-card text-[14.5px] text-ink focus:outline-none focus:border-accent"
              />
            </Field>
            <Field label="Okres do" htmlFor="dokDo" className="mb-0">
              <input
                id="dokDo"
                type="date"
                value={form.periodEnd}
                onChange={(e) => patch({ periodEnd: e.target.value })}
                className="w-full h-11 px-[13px] rounded-sm border border-line-strong bg-card text-[14.5px] text-ink focus:outline-none focus:border-accent"
              />
            </Field>

            <div className="md:col-span-3 flex justify-end">
              <Button type="submit" disabled={creating} className="h-11">
                {creating ? 'Generowanie…' : 'Generuj dokument'}
              </Button>
            </div>
          </form>
          {createError && (
            <div role="alert" className="mt-3 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
              {createError}
            </div>
          )}
        </Card>
      </section>

      {/* Sekcja A: lista dokumentów */}
      <section>
        <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">Lista dokumentów</h2>
        {docs.length === 0 ? (
          <Card className="px-4 py-6 text-sm text-muted text-center">Brak wygenerowanych dokumentów w Twoim zakresie.</Card>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Typ</Th>
                <Th>Okres</Th>
                <Th>Zakres</Th>
                <Th>Status</Th>
                <Th>Format</Th>
                <Th>Data generacji</Th>
                <Th className="text-right pr-4">Akcje</Th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <Td className="font-medium">
                    <div>{documentTypeLabel(doc.type)}</div>
                    <div className="text-[11.5px] text-muted-2">
                      {doc.type === 'NADGODZINY' ? formatOvertimeSummary(doc.computedFacts) : null}
                      {doc.type === 'EWIDENCJA_CZASU_PRACY' ? formatWorkedTotal(doc.computedFacts) : null}
                    </div>
                  </Td>
                  <Td>{formatPeriodRange(doc.periodStart, doc.periodEnd)}</Td>
                  <Td>{zakresText(doc)}</Td>
                  <Td>
                    <StatusBadge status={doc.status} />
                  </Td>
                  <Td>{documentFormatLabel(doc.format)}</Td>
                  <Td>{formatDate(doc.generatedAt)}</Td>
                  <Td className="text-right pr-4">
                    <div className="flex justify-end gap-2">
                      <a
                        href={dokumentyApi.pobierzUrl(doc.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center h-8 px-3 text-[13px] rounded-sm border border-line-strong hover:bg-card-2"
                      >
                        Podgląd / pobierz
                      </a>
                      {isApprovable(doc.type) && doc.status === 'GENERATED' ? (
                        <Button
                          variant="ghost"
                          className="h-8 px-3 text-[13px]"
                          onClick={() => void zatwierdz(doc.id)}
                          disabled={busy.has(`zatwierdz:${doc.id}`)}
                        >
                          Zatwierdź
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  )
}
