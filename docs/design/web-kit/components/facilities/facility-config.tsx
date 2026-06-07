'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { IconBuilding } from '@/components/icons'
import {
  type Facility,
  type DayHours,
  DAY_LABELS_LONG,
  weeklyOpenHours,
  updateFacilityHours,
} from '@/lib/facilities'

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))

/**
 * Placówki config: address + the dni i godziny pracy editor. Toggling a day
 * open/closed or changing its hours updates client state and the weekly total
 * live. These hours drive the Grafik (default shift hours + closed days).
 */
export function FacilityConfig({ facilities }: { facilities: Facility[] }) {
  const [list, setList] = useState(facilities)

  function setDay(facilityId: string, dayIndex: number, hours: DayHours) {
    setList((prev) => prev.map((f) => (f.id === facilityId ? updateFacilityHours(f, dayIndex, hours) : f)))
  }

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-5" data-guide="placowki:list">
      {list.map((f) => (
        <Card key={f.id} className="p-[22px]">
          <div className="flex items-start gap-3.5">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-lg border border-line bg-card-2 text-accent-ink">
              <IconBuilding className="h-5 w-5" strokeWidth={1.6} />
            </span>
            <div className="flex-1">
              <h2 className="font-display text-[17px] font-bold tracking-tightish text-navy">{f.name}</h2>
              <div className="text-[13px] text-muted">{f.location}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[10px] uppercase tracking-[.08em] text-muted-2">Tyg. godziny</div>
              <div className="font-display text-[17px] font-semibold text-navy">{fmt(weeklyOpenHours(f))} h</div>
            </div>
          </div>

          <div className="mt-4 grid gap-5 lg:grid-cols-[280px_1fr]">
            <div data-guide="placowki:address">
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[.1em] text-muted-2">Adres</div>
              <div className="rounded-md border border-line bg-card-2 p-3.5 text-[13.5px] leading-relaxed text-ink">
                <div>{f.address.street}</div>
                <div className="font-mono text-[12.5px]">
                  {f.address.postalCode} {f.address.city}
                </div>
                <div className="text-muted">{f.address.country}</div>
              </div>
            </div>

            <div data-guide="placowki:hours">
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[.1em] text-muted-2">Dni i godziny pracy</div>
              <div className="rounded-md border border-line">
                {DAY_LABELS_LONG.map((label, i) => {
                  const dh = f.hours[i]
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_104px_auto] items-center gap-2 border-b border-line px-3 py-2 last:border-0"
                    >
                      <div className="text-[13px] font-medium text-ink">{label}</div>
                      <label className="flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-muted">
                        <input
                          type="checkbox"
                          checked={!!dh}
                          onChange={(e) => setDay(f.id, i, e.target.checked ? { open: '08:00', close: '16:00' } : null)}
                          className="h-3.5 w-3.5 accent-[#0C8FA3]"
                        />
                        {dh ? 'Otwarte' : 'Zamknięte'}
                      </label>
                      {dh ? (
                        <div className="flex items-center gap-2 justify-self-end">
                          <input
                            type="time"
                            aria-label={`${label} — początek`}
                            value={dh.open}
                            onChange={(e) => setDay(f.id, i, { open: e.target.value, close: dh.close })}
                            className="h-8 rounded-sm border border-line-strong bg-card px-2 font-mono text-[12px] text-ink focus:border-accent focus:outline-none"
                          />
                          <span className="text-muted-2">–</span>
                          <input
                            type="time"
                            aria-label={`${label} — koniec`}
                            value={dh.close}
                            onChange={(e) => setDay(f.id, i, { open: dh.open, close: e.target.value })}
                            className="h-8 rounded-sm border border-line-strong bg-card px-2 font-mono text-[12px] text-ink focus:border-accent focus:outline-none"
                          />
                        </div>
                      ) : (
                        <div className="justify-self-end font-mono text-[11.5px] text-muted-2">—</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </Card>
      ))}
      <p className="font-mono text-[11px] text-muted-2">
        Zmiany zapisują się lokalnie w tej sesji (aplikacja referencyjna). W docelowym systemie trafiają do tenant
        runtime i sterują grafikiem.
      </p>
    </div>
  )
}
