'use client'

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Table, Th, Td } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  dokumentyApi,
  documentStatusLabel,
  formatDate,
  formatPeriodRange,
  formatWorkedTotal,
  DokumentyError,
  type GeneratedDocument,
} from '@/lib/dokumenty'

function actionErrorMessage(err: unknown): string {
  if (err instanceof DokumentyError) return err.message || 'Coś poszło nie tak. Spróbuj ponownie.'
  return 'Brak połączenia z serwerem. Spróbuj ponownie.'
}

/**
 * PRACOWNIK's own ewidencja (SPEC §5/§7, DECYZJA-4M #6 — self, read-only, EWIDENCJA only). Reads
 * `GET /api/dokumenty/mine`, which the backend already scopes to the caller's OWN
 * `EWIDENCJA_CZASU_PRACY` rows (`DokumentyService.mine`) — no client-side filtering needed, no
 * generuj form, no zatwierdz action (a plain employee neither generates nor approves).
 */
export function MojaEwidencjaScreen() {
  const [docs, setDocs] = useState<GeneratedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  useEffect(() => {
    dokumentyApi
      .mine()
      .then((rows) => {
        if (!cancelledRef.current) setDocs(rows)
      })
      .catch((e) => {
        if (!cancelledRef.current) setError(actionErrorMessage(e))
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false)
      })
  }, [])

  if (loading) return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie…</div>

  return (
    <div className="max-w-[1120px] mx-auto">
      <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">Moja ewidencja czasu pracy</h2>

      {error && (
        <div role="alert" className="mb-4 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}

      {docs.length === 0 ? (
        <Card className="px-4 py-6 text-sm text-muted text-center">
          Nie masz jeszcze wygenerowanej ewidencji czasu pracy — poproś managera lub HR o jej wygenerowanie.
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Okres</Th>
              <Th>Suma godzin</Th>
              <Th>Status</Th>
              <Th>Data generacji</Th>
              <Th className="text-right pr-4">Podgląd</Th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => {
              const { label, tone } = documentStatusLabel(doc.status)
              return (
                <tr key={doc.id}>
                  <Td className="font-medium">{formatPeriodRange(doc.periodStart, doc.periodEnd)}</Td>
                  <Td>{formatWorkedTotal(doc.computedFacts)}</Td>
                  <Td>
                    <Badge tone={tone}>{label}</Badge>
                  </Td>
                  <Td>{formatDate(doc.generatedAt)}</Td>
                  <Td className="text-right pr-4">
                    <a
                      href={dokumentyApi.pobierzUrl(doc.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center h-8 px-3 text-[13px] rounded-sm border border-line-strong hover:bg-card-2"
                    >
                      Pobierz
                    </a>
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
