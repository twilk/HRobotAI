'use client'

import { useEffect, useRef, useState } from 'react'
import { EmployeeCard } from '@/components/strategic-brain/employee-card'
import { strategicBrainApi, StrategicBrainError, type EmployeeCard as EmployeeCardData } from '@/lib/strategic-brain'

/**
 * A plain PRACOWNIK's OWN card and nothing else (spec §8, matrix row 3: "self, read-only; nie widzi
 * cudzych"). Fetches ONLY `/employee/me` — never the overview or another id, so a worker can never
 * reach a colleague's data from this screen. RODO transparency: the employee sees the same
 * explainable score/trajectory the model uses.
 */
export function SelfCard({ name }: { name?: string }) {
  const [card, setCard] = useState<EmployeeCardData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading')
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      try {
        const c = await strategicBrainApi.getMyEmployeeCard()
        if (cancelledRef.current) return
        setCard(c)
        setState('ok')
      } catch (e) {
        if (cancelledRef.current) return
        // 404 = the caller's Keycloak subject isn't linked to an employee yet — a benign empty state.
        if (e instanceof StrategicBrainError && e.status === 404) setState('empty')
        else setState('error')
      }
    })()
    return () => {
      cancelledRef.current = true
    }
  }, [])

  if (state === 'loading') return <p className="text-sm text-muted">Ładowanie Twojej karty…</p>
  if (state === 'empty')
    return (
      <p className="max-w-md rounded-md border border-line bg-card-2 px-4 py-3 text-[13px] text-muted">
        Twoja analiza rozwoju pojawi się, gdy zbierzemy wystarczająco danych o pracy.
      </p>
    )
  if (state === 'error' || !card) return <p className="text-sm text-error">Nie udało się wczytać Twojej karty.</p>

  return (
    <div className="max-w-md">
      <EmployeeCard card={card} name={name} />
    </div>
  )
}
