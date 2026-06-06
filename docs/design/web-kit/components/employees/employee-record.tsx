'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconEdit, IconEye, IconLock, IconCheck } from '@/components/icons'
import type { EmployeeDetail, AuditEntry } from '@/lib/employees'

const SECTIONS = ['Dane', 'Umowa', 'Grafik', 'Wnioski', 'Dziennik'] as const

function nowStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Interactive right column of the employee detail. Client island: holds the
 * audit-log state and the PESEL reveal. Revealing is an audited action — it
 * prepends an entry to the Dziennik so the trust loop (reveal → logged →
 * visible) is observable. Plaintext PESEL is never rendered client-side.
 */
export function EmployeeRecord({ employee, actor }: { employee: EmployeeDetail; actor: string }) {
  const [audit, setAudit] = useState<AuditEntry[]>(employee.audit)
  const [pesel, setPesel] = useState<'masked' | 'confirm' | 'revealed'>('masked')

  function confirmReveal() {
    setPesel('revealed')
    setAudit((a) => [{ ts: nowStamp(), action: 'Ujawniono PESEL', actor, ip: '10.4.2.11' }, ...a])
  }

  return (
    <div>
      <nav aria-label="Sekcje rekordu" className="mb-5 flex flex-wrap gap-1">
        {SECTIONS.map((s, i) => (
          <a
            key={s}
            href={`#sek-${s.toLowerCase()}`}
            aria-current={i === 0 ? 'true' : undefined}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              i === 0 ? 'border-accent/20 bg-accent/[0.06] text-accent-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {s}
          </a>
        ))}
      </nav>

      {/* Dane podstawowe */}
      <Card id="sek-dane" className="mb-[18px] p-[22px] scroll-mt-[18px]">
        <SecHead title="Dane podstawowe" slug="dane" action={<EditButton />} />
        <div className="grid grid-cols-1 gap-[18px_28px] sm:grid-cols-2">
          <Field label="Imię i nazwisko" value={`${employee.firstName} ${employee.lastName}`} />
          <Field label="Data urodzenia" value={employee.birthYear} mono />
          <Field label="Email" value={employee.email} mono />
          <Field label="Telefon" value={employee.phone} mono />
          <Field label="Adres" value={employee.address} />
          <Field label="Numer pracownika" value={empId(employee.id)} mono />
        </div>

        <div className="my-[18px] h-px bg-line" />

        <div>
          <div className="mb-1.5 text-xs text-muted">PESEL · dane wrażliwe</div>
          {pesel === 'masked' && (
            <div className="flex items-center gap-3">
              <span className="font-mono text-[15px] tracking-[.18em] text-ink">•••••••{employee.peselLast4}</span>
              <Button
                variant="ghost"
                onClick={() => setPesel('confirm')}
                className="h-[30px] gap-1.5 px-[11px] font-mono text-[11px] font-medium text-accent-ink"
              >
                <IconEye className="h-[13px] w-[13px]" strokeWidth={1.7} />
                Ujawnij i zapisz wpis
              </Button>
            </div>
          )}

          {pesel === 'confirm' && (
            <div className="rounded-md border border-line-strong bg-card-2 p-3.5" role="alertdialog" aria-label="Potwierdź ujawnienie PESEL">
              <p className="text-[13px] text-ink">
                Ujawnienie zapisze wpis w dzienniku audytu z Twoim imieniem, czasem i adresem IP.
              </p>
              <div className="mt-3 flex gap-2.5">
                <Button variant="ghost" onClick={() => setPesel('masked')} className="h-[34px] px-3.5 text-[13px]">
                  Anuluj
                </Button>
                <Button onClick={confirmReveal} className="h-[34px] gap-1.5 px-3.5 text-[13px]">
                  <IconEye className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  Ujawnij i zapisz wpis
                </Button>
              </div>
            </div>
          )}

          {pesel === 'revealed' && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[15px] tracking-[.18em] text-ink">•••••••{employee.peselLast4}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-verified/25 bg-verified/[0.08] px-[11px] py-1 font-mono text-[11px] text-[#247F56]">
                <IconCheck className="h-[13px] w-[13px]" strokeWidth={2} />
                Zapisano wpis w dzienniku audytu
              </span>
              <button
                onClick={() => setPesel('masked')}
                className="font-mono text-[11px] text-muted underline-offset-2 hover:text-accent-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
              >
                Ukryj
              </button>
            </div>
          )}

          <p className="mt-2.5 flex items-center gap-1.5 font-mono text-[11px] text-muted">
            <IconLock className="h-3 w-3 text-verified" strokeWidth={1.7} />
            {pesel === 'revealed'
              ? 'Pełny numer dostępny tylko po stronie serwera (dostęp audytowany).'
              : 'Ujawnienie zapisze wpis w dzienniku audytu: imię, czas i adres IP.'}
          </p>
        </div>
      </Card>

      {/* Umowa */}
      <Card id="sek-umowa" className="mb-[18px] p-[22px] scroll-mt-[18px]">
        <SecHead title="Umowa" slug="umowa" />
        <div className="grid grid-cols-1 gap-[18px_28px] sm:grid-cols-2">
          <Field label="Typ umowy" value={employee.contract === 'UoP' ? 'Umowa o pracę' : employee.contractType} />
          <Field label="Czas trwania" value={employee.contractType} />
          <Field label="Data rozpoczęcia" value={employee.hireDate} mono />
          <Field label="Wymiar etatu" value={employee.fte} />
          <Field label="Wynagrodzenie" value={employee.salaryMasked} mono />
          <Field label="Przełożony" value={employee.manager} />
        </div>
      </Card>

      {/* Grafik */}
      <Card id="sek-grafik" className="mb-[18px] p-[22px] scroll-mt-[18px]">
        <SecHead title="Grafik" slug="grafik · bieżący okres" />
        <div className="grid grid-cols-1 gap-[18px_28px] sm:grid-cols-2">
          <Field label="Wzorzec pracy" value="Pon–Pt · 8:00–16:00" />
          <Field label="Wymiar" value={employee.fte} />
          <Field label="Okres rozliczeniowy" value="1 miesiąc" />
          <Field label="Przełożony" value={employee.manager} />
        </div>
      </Card>

      {/* Wnioski */}
      <Card id="sek-wnioski" className="mb-[18px] p-[22px] scroll-mt-[18px]">
        <SecHead title="Wnioski" slug="wnioski · 2 aktywne" />
        <Req title="Urlop wypoczynkowy" meta="2026-07-01 — 2026-07-12 · 10 dni" tone="warn" status="Oczekuje" />
        <Req title="Praca zdalna" meta="2026-06-10 · 1 dzień" tone="ok" status="Zatwierdzono" />
      </Card>

      {/* Dziennik audytu */}
      <Card id="sek-dziennik" className="p-[22px] scroll-mt-[18px]">
        <SecHead
          title="Dziennik audytu"
          slug="audyt"
          action={
            <a href="#sek-dziennik" className="font-mono text-[11px] text-accent-ink hover:underline">
              Pełny dziennik →
            </a>
          }
        />
        <ol
          aria-label="Dziennik audytu pracownika"
          className="relative m-0 list-none pl-[22px] before:absolute before:left-[5px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-line-strong"
        >
          {audit.map((e, i) => {
            const hot = e.action.startsWith('Ujawniono')
            return (
              <li key={`${e.ts}-${i}`} className="relative pb-[18px] last:pb-0">
                <span
                  className={cn(
                    'absolute -left-[22px] top-[3px] h-[11px] w-[11px] rounded-full border-2 bg-card',
                    hot ? 'border-accent bg-accent/[0.18]' : 'border-line-strong',
                  )}
                  aria-hidden="true"
                />
                <div className="font-mono text-[11px] text-muted">{e.ts}</div>
                <div className="mt-0.5 text-[13.5px] font-medium text-ink">{e.action}</div>
                <div className="mt-px text-[12.5px] text-muted">
                  {e.actor}
                  {e.ip ? ` · IP ${e.ip}` : ''}
                </div>
              </li>
            )
          })}
        </ol>
      </Card>
    </div>
  )
}

function empId(id: string): string {
  return `EMP-${id.padStart(4, '0')}`
}

function SecHead({ title, slug, action }: { title: string; slug: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-baseline gap-2.5 font-display text-[16px] font-bold tracking-tightish text-navy">
        {title}
        <span className="font-mono text-[10px] font-normal uppercase tracking-[.1em] text-muted-2">/ {slug}</span>
      </h2>
      {action}
    </div>
  )
}

function EditButton() {
  return (
    <Button variant="ghost" className="h-[34px] gap-1.5 px-3 text-[13px]">
      <IconEdit className="h-[15px] w-[15px]" strokeWidth={1.7} />
      Edytuj
    </Button>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 text-xs text-muted">{label}</div>
      <div className={cn('text-[14.5px] font-medium text-ink', mono && 'font-mono text-[13.5px] font-normal tracking-[.02em]')}>{value}</div>
    </div>
  )
}

function Req({ title, meta, tone, status }: { title: string; meta: string; tone: 'ok' | 'warn'; status: string }) {
  return (
    <div className="flex items-center gap-[11px] border-b border-line py-3 last:border-0">
      <div className="flex-1">
        <div className="text-[13.5px] font-medium text-ink">{title}</div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-2">{meta}</div>
      </div>
      <Badge tone={tone}>{status}</Badge>
    </div>
  )
}
