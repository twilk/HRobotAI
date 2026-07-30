'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  agentGlosowyApi,
  AgentGlosowyError,
  intentLabel,
  confidenceTone,
  formatConfidence,
  shouldShowConfirm,
  canAutoExecute,
  fallbackLink,
  FALLBACK_MESSAGE,
  type InterpretResult,
  type ExecuteResult,
  type AgentEntities,
  type AgentIntent,
} from '@/lib/agent-glosowy'

const EXAMPLE = 'chcę wziąć urlop od piątku do poniedziałku'

function actionErrorMessage(err: unknown): string {
  if (err instanceof AgentGlosowyError) return err.message || 'Coś poszło nie tak. Spróbuj ponownie.'
  return 'Brak połączenia z serwerem. Spróbuj ponownie.'
}

/** Small inline mic glyph — kept local rather than added to components/icons.tsx since this is the
 *  ONLY place it's used and it renders permanently disabled (see the button below). */
function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" strokeLinecap="round" />
      <path d="M12 18v3" strokeLinecap="round" />
      <path d="M8 21h8" strokeLinecap="round" />
    </svg>
  )
}

type TurnStatus = 'interpreting' | 'awaiting-confirm' | 'executing' | 'done' | 'fallback' | 'error'

interface Turn {
  id: string
  text: string
  status: TurnStatus
  interpretResult?: InterpretResult
  executeResult?: ExecuteResult
  error?: string
}

/**
 * Full command-assistant workspace (M3 module 3, Agent Głosowy — the T3b web-kit UI). TEXT is the
 * PRIMARY surface (R10 fallback): a user types a Polish command, the module `interpret`s it (never a
 * side effect), then either:
 *  - auto-`execute`s a recognized READ (MOJ_GRAFIK) immediately — safe, nothing irreversible;
 *  - shows an explicit "Potwierdź i wykonaj" button for a recognized WRITE (URLOP/L4) and only
 *    `execute`s with `confirm: true` after the human clicks it (EU AI Act / art. 22 RODO —
 *    {@link shouldShowConfirm}/{@link canAutoExecute} are the pure decision the backend's
 *    `requiresConfirmation`/`fallbackToForm` flags drive);
 *  - or falls back to "Nie zrozumiałem — użyj formularza" with a link to the closest manual form for
 *    NIEZNANE / sub-threshold-confidence parses — the module NEVER guesses and executes.
 *
 * The mic button is present but permanently disabled (STT isn't wired in this env) — the module is
 * fully usable via the text field alone, which is the only input path exercised here.
 *
 * Each turn keeps its own request in flight (a stale response can't clobber a newer turn) — mirrors
 * the busy-set / cancelledRef pattern in components/dokumenty/dokumenty-screen.tsx.
 */
export function AsystentScreen() {
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [submitting, setSubmitting] = useState(false)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const updateTurn = useCallback((id: string, patch: Partial<Turn>) => {
    if (cancelledRef.current) return
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const runExecute = useCallback(
    async (id: string, intent: AgentIntent, entities: AgentEntities, confirm: boolean) => {
      updateTurn(id, { status: 'executing' })
      try {
        const executeResult = await agentGlosowyApi.execute({ intent, entities, confirm })
        updateTurn(id, { status: 'done', executeResult })
      } catch (e) {
        updateTurn(id, { status: 'error', error: actionErrorMessage(e) })
      }
    },
    [updateTurn],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || submitting) return

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setTurns((prev) => [...prev, { id, text, status: 'interpreting' }])
    setInput('')
    setSubmitting(true)
    try {
      const interpretResult = await agentGlosowyApi.interpret(text)
      updateTurn(id, { interpretResult })
      if (interpretResult.fallbackToForm) {
        updateTurn(id, { status: 'fallback' })
      } else if (canAutoExecute(interpretResult)) {
        // A read (MOJ_GRAFIK) is safe to run immediately — nothing irreversible.
        await runExecute(id, interpretResult.intent, interpretResult.entities, false)
      } else {
        // A write (URLOP/L4) waits for the human's explicit confirm click.
        updateTurn(id, { status: 'awaiting-confirm' })
      }
    } catch (e) {
      updateTurn(id, { status: 'error', error: actionErrorMessage(e) })
    } finally {
      if (!cancelledRef.current) setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-[760px]">
      <Card className="mb-6 p-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label htmlFor="asystentInput" className="text-[13px] font-medium text-ink">
            Wpisz polecenie
          </label>
          <div className="flex items-start gap-2">
            <textarea
              id="asystentInput"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`np. „${EXAMPLE}"`}
              rows={2}
              className="flex-1 resize-none rounded-sm border border-line-strong bg-card px-[13px] py-2.5 text-[14.5px] text-ink placeholder:text-muted-2 focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled
              title="Rozpoznawanie mowy — wkrótce; użyj pola tekstowego"
              aria-label="Rozpoznawanie mowy — wkrótce; użyj pola tekstowego"
              className="inline-flex h-11 w-11 shrink-0 cursor-not-allowed items-center justify-center rounded-sm border border-line-strong text-muted-2 opacity-50"
            >
              <MicIcon className="h-[18px] w-[18px]" />
            </button>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || !input.trim()} className="h-10 px-5">
              {submitting ? 'Wysyłanie…' : 'Wyślij'}
            </Button>
          </div>
        </form>
      </Card>

      <div className="space-y-4">
        {turns.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-muted">Napisz polecenie, np. „{EXAMPLE}".</Card>
        ) : (
          [...turns].reverse().map((turn) => (
            <TurnCard
              key={turn.id}
              turn={turn}
              onConfirm={() => {
                if (!turn.interpretResult) return
                void runExecute(turn.id, turn.interpretResult.intent, turn.interpretResult.entities, true)
              }}
            />
          ))
        )}
      </div>
    </div>
  )
}

function TurnCard({ turn, onConfirm }: { turn: Turn; onConfirm: () => void }) {
  const ir = turn.interpretResult
  const er = turn.executeResult

  return (
    <Card className="p-4">
      <p className="text-[13px] text-muted">Ty:</p>
      <p className="mb-3 text-[14.5px] font-medium text-ink">„{turn.text}"</p>

      {turn.status === 'interpreting' && <p className="text-sm text-muted">Analizuję…</p>}

      {turn.status === 'error' && (
        <div role="alert" className="rounded-lg border border-warn/30 bg-warn/[0.08] px-3.5 py-2.5 text-sm text-warn">
          {turn.error}
        </div>
      )}

      {turn.status === 'fallback' && ir && (
        <div className="space-y-2">
          <p className="text-sm text-ink">{FALLBACK_MESSAGE}</p>
          <a
            href={fallbackLink(ir.intent).href}
            className="inline-flex items-center text-[13px] font-medium text-accent-ink underline underline-offset-2"
          >
            {fallbackLink(ir.intent).label}
          </a>
          <p className="text-[12px] text-muted-2">{ir.aiNotice}</p>
        </div>
      )}

      {(turn.status === 'awaiting-confirm' || turn.status === 'executing') && ir && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="role">{intentLabel(ir.intent)}</Badge>
            <Badge tone={confidenceTone(ir.confidence)}>Pewność: {formatConfidence(ir.confidence)}</Badge>
          </div>
          <p className="text-[14.5px] text-ink">{ir.humanReadable}</p>
          <p className="text-[12px] text-muted-2">{ir.aiNotice}</p>
          {turn.status === 'awaiting-confirm' ? (
            <Button onClick={onConfirm} className="h-10 px-5">
              Potwierdź i wykonaj
            </Button>
          ) : (
            <p className="text-sm text-muted">Wykonuję…</p>
          )}
        </div>
      )}

      {turn.status === 'done' && er && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="role">{intentLabel(er.intent)}</Badge>
            {er.confirmedByHuman ? <Badge tone="ok">Potwierdzone przez człowieka</Badge> : null}
          </div>
          <p className="text-[14.5px] text-ink">{er.humanReadable}</p>
          <p className="text-[12px] text-muted-2">{er.aiNotice}</p>
        </div>
      )}
    </Card>
  )
}
