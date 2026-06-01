import { IconCheck, IconLock } from '@/components/icons'
import { cn } from '@/lib/cn'

interface ProvStep {
  id: 'CREATE_DB' | 'RUN_MIGRATIONS' | 'SEED' | 'KEYCLOAK_SETUP' | 'DONE'
  label: string
  title: string
  copy: string
}

export const PROV_STEPS: ProvStep[] = [
  { id: 'CREATE_DB', label: 'Izolowana baza danych', title: 'Tworzymy bazę danych', copy: 'Tworzymy izolowaną bazę danych. Twoje dane nigdy nie dotykają systemów innych firm.' },
  { id: 'RUN_MIGRATIONS', label: 'Struktura przestrzeni', title: 'Budujemy strukturę', copy: 'Konfigurujemy strukturę Twojej przestrzeni roboczej.' },
  { id: 'SEED', label: 'Ustawienia początkowe', title: 'Przygotowujemy ustawienia', copy: 'Dodajemy domyślne ustawienia i pierwszą jednostkę organizacyjną Twojej firmy.' },
  { id: 'KEYCLOAK_SETUP', label: 'Bezpieczne logowanie', title: 'Zabezpieczamy logowanie', copy: 'Konfigurujemy bezpieczne logowanie zgodne z RODO.' },
  { id: 'DONE', label: 'Gotowe', title: 'Gotowe!', copy: 'Twoja przestrzeń robocza HRobot jest gotowa.' },
]

export type StepId = ProvStep['id']

/** Presentational 5-step mono pipeline + active-step benefit panel. */
export function ProvisioningPipeline({ current }: { current: StepId }) {
  const idx = Math.max(
    0,
    PROV_STEPS.findIndex((s) => s.id === current),
  )
  const active = PROV_STEPS[idx]

  return (
    <div className="grid sm:grid-cols-[1fr_0.92fr]">
      <div className="p-6">
        {PROV_STEPS.map((s, i) => {
          const state = i < idx ? 'done' : i === idx ? 'active' : 'pending'
          const isLast = i === PROV_STEPS.length - 1
          return (
            <div key={s.id} className={cn('relative pl-[44px]', isLast ? '' : 'pb-[22px]')}>
              {!isLast ? (
                <span className={cn('absolute left-[14px] top-[30px] bottom-0 w-0.5', state === 'done' ? 'bg-accent' : 'bg-line')} />
              ) : null}
              <span
                className={cn(
                  'absolute left-0 top-0 grid place-items-center w-[30px] h-[30px] rounded-full',
                  state === 'done'
                    ? 'bg-accent'
                    : state === 'active'
                      ? 'bg-card border-2 border-accent animate-node-pulse'
                      : 'bg-card border-2 border-line-strong',
                )}
              >
                {state === 'done' ? (
                  <IconCheck className="w-[15px] h-[15px] text-white" strokeWidth={2.4} />
                ) : (
                  <span className={cn('rounded-full', state === 'active' ? 'w-[9px] h-[9px] bg-accent' : 'w-[7px] h-[7px] bg-line-strong')} />
                )}
              </span>
              <div className={cn('text-[14.5px] font-semibold tracking-tightish', state === 'pending' ? 'text-muted-2' : '')}>{s.label}</div>
              <div className="font-mono text-[11px] text-muted-2 mt-0.5">{s.id}</div>
              <div
                className={cn(
                  'font-mono text-[10px] tracking-[.06em] uppercase mt-[3px]',
                  state === 'done' ? 'text-verified' : state === 'active' ? 'text-accent-ink' : 'text-muted-2',
                )}
              >
                {state === 'done' ? 'Ukończono' : state === 'active' ? 'W toku' : 'Oczekuje'}
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-card-2 border-l border-line p-6">
        <div className="font-mono text-[11px] tracking-[.06em] text-accent-ink">
          Krok {idx + 1} z {PROV_STEPS.length}
        </div>
        <h3 className="font-display font-bold text-[18px] tracking-tightish text-navy mt-3 mb-2 leading-tight">{active.title}</h3>
        <p className="text-muted text-[13.5px] leading-relaxed">{active.copy}</p>
        <span className="inline-flex items-center gap-[7px] mt-[18px] rounded-full border px-[11px] py-1.5 font-mono text-[11px] font-medium bg-verified/[0.08] border-verified/25 text-[#247F56]">
          <IconLock className="w-[13px] h-[13px]" strokeWidth={1.8} />
          Szyfrowane · RODO
        </span>
      </div>
    </div>
  )
}
