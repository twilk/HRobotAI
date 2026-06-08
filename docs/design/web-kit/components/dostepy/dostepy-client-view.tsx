'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Table, Th, Td } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { IconKey } from '@/components/icons'
import {
  updateAccess,
  MODULE_LABELS,
  ACCESS_LEVEL_LABELS,
  type AccessModule,
  type AccessLevel,
  type EmployeeAccessSummary,
} from '@/lib/dostepy'

const MODULES: AccessModule[] = ['grafik', 'wnioski', 'dostepy', 'raporty', 'ustawienia']
const LEVELS: AccessLevel[] = ['brak', 'podgląd', 'edycja', 'admin']

// Badge tone per access level
function levelTone(level: AccessLevel): 'muted' | 'role' | 'ok' | 'warn' {
  switch (level) {
    case 'brak':    return 'muted'
    case 'podgląd': return 'role'
    case 'edycja':  return 'ok'
    case 'admin':   return 'warn'
  }
}

interface ManageForm {
  access: Record<AccessModule, AccessLevel>
}

export function DostepyClientView({
  initialData,
}: {
  initialData: EmployeeAccessSummary[]
}) {
  const [summaries, setSummaries] = useState<EmployeeAccessSummary[]>(initialData)
  const [search, setSearch] = useState('')
  const [managing, setManaging] = useState<EmployeeAccessSummary | null>(null)
  const [form, setForm] = useState<ManageForm | null>(null)

  const filtered = summaries.filter((s) =>
    s.employeeName.toLowerCase().includes(search.toLowerCase()),
  )

  function openManage(summary: EmployeeAccessSummary) {
    setManaging(summary)
    setForm({ access: { ...summary.access } })
  }

  function handleSave() {
    if (!managing || !form) return

    // Apply all module changes
    for (const mod of MODULES) {
      updateAccess(managing.employeeId, mod, form.access[mod])
    }

    // Optimistic update in UI
    setSummaries((prev) =>
      prev.map((s) =>
        s.employeeId === managing.employeeId
          ? { ...s, access: { ...form.access } }
          : s,
      ),
    )

    setManaging(null)
    setForm(null)
  }

  return (
    <div className="max-w-[1120px] mx-auto">
      {/* Header */}
      <div className="mb-[22px] flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">
            Dostępy
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {filtered.length !== summaries.length
              ? `${filtered.length} z ${summaries.length} pracowników`
              : `${summaries.length} pracowników`}
          </p>
        </div>
        {/* Search */}
        <input
          type="search"
          placeholder="Szukaj pracownika…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-[220px] rounded-sm border border-line-strong bg-card px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent"
        />
      </div>

      {/* Table or empty state */}
      {filtered.length === 0 ? (
        <EmptyState icon={IconKey} title="Brak pracowników">
          Brak pracowników spełniających kryteria wyszukiwania.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Pracownik</Th>
              {MODULES.map((m) => (
                <Th key={m}>{MODULE_LABELS[m]}</Th>
              ))}
              <Th>Akcje</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((summary) => (
              <tr key={summary.employeeId}>
                <Td className="font-medium text-navy">{summary.employeeName}</Td>
                {MODULES.map((m) => (
                  <Td key={m}>
                    <Badge tone={levelTone(summary.access[m])}>
                      {ACCESS_LEVEL_LABELS[summary.access[m]]}
                    </Badge>
                  </Td>
                ))}
                <Td>
                  <Button
                    variant="ghost"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => openManage(summary)}
                  >
                    Zarządzaj
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* Manage access modal */}
      {managing && form && (
        <Modal
          open={managing !== null}
          onClose={() => { setManaging(null); setForm(null) }}
          title={`Dostępy — ${managing.employeeName}`}
          className="max-w-[540px]"
        >
          <div className="space-y-5">
            {MODULES.map((mod) => (
              <div key={mod}>
                <p className="mb-2 text-sm font-medium text-ink">{MODULE_LABELS[mod]}</p>
                <div className="flex flex-wrap gap-3">
                  {LEVELS.map((lvl) => (
                    <label
                      key={lvl}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-1.5 text-sm transition-colors select-none',
                        form.access[mod] === lvl
                          ? 'border-accent bg-accent/[0.07] text-accent-ink font-medium'
                          : 'border-line-strong text-muted hover:border-accent/40 hover:text-ink',
                      )}
                    >
                      <input
                        type="radio"
                        name={`dostepy-${managing.employeeId}-${mod}`}
                        value={lvl}
                        checked={form.access[mod] === lvl}
                        onChange={() =>
                          setForm((f) =>
                            f ? { access: { ...f.access, [mod]: lvl } } : f,
                          )
                        }
                        className="sr-only"
                      />
                      {ACCESS_LEVEL_LABELS[lvl]}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div className="flex justify-end gap-2.5 pt-1">
              <Button
                variant="ghost"
                className="h-9 px-4 text-sm"
                onClick={() => { setManaging(null); setForm(null) }}
              >
                Anuluj
              </Button>
              <Button className="h-9 px-4 text-sm" onClick={handleSave}>
                Zapisz
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
