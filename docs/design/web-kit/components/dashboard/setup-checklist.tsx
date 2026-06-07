'use client'

import { Card } from '@/components/ui/card'
import { IconCheck } from '@/components/icons'
import { cn } from '@/lib/cn'
import { useGuide } from '@/components/guide/guide-provider'

export interface ChecklistStep {
  label: string
  desc: string
  done?: boolean
}

export function SetupChecklist({ steps }: { steps: ChecklistStep[] }) {
  const { startJourney } = useGuide()
  const done = steps.filter((s) => s.done).length
  const pct = Math.round((done / steps.length) * 100)
  return (
    <Card className="p-5" data-guide="dashboard:setup-checklist">
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-base font-semibold tracking-tightish">Pierwsze kroki</h2>
        <span className="font-mono text-[11px] text-muted-2">
          {done} / {steps.length} ukończono
        </span>
      </div>
      <div className="h-[5px] rounded bg-line overflow-hidden my-3" role="progressbar" aria-valuenow={done} aria-valuemax={steps.length}>
        <div className="h-full rounded bg-gradient-to-r from-accent to-[#19A6BA]" style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-start gap-3 py-3 border-t border-line first:border-t-0">
            <span
              className={cn(
                'mt-px w-[19px] h-[19px] shrink-0 rounded-[5px] border grid place-items-center',
                s.done ? 'bg-verified/15 border-verified' : 'border-line-strong',
              )}
            >
              {s.done ? <IconCheck className="w-3 h-3 text-verified" strokeWidth={2.4} /> : null}
            </span>
            <div className="flex-1">
              <div className="text-sm font-medium">{s.label}</div>
              <div className="text-xs text-muted mt-0.5">{s.desc}</div>
            </div>
            <span className="font-mono text-[11px] text-muted-2">{String(i + 1).padStart(2, '0')}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 pt-4 border-t border-line">
        <p className="text-xs text-muted mb-2 font-medium">Przewodniki po procesach:</p>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => startJourney('onboarding-pracownika')}
            className="text-left text-xs text-accent-ink hover:underline"
          >
            Onboarding nowego pracownika
          </button>
          <button
            type="button"
            onClick={() => startJourney('konfiguracja-placowki')}
            className="text-left text-xs text-accent-ink hover:underline"
          >
            Konfiguracja nowej placówki
          </button>
          <button
            type="button"
            onClick={() => startJourney('zaproszenie-managera')}
            className="text-left text-xs text-accent-ink hover:underline"
          >
            Zaproszenie menadżera
          </button>
        </div>
      </div>
    </Card>
  )
}
