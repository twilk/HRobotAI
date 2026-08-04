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
  canAutoExecute,
  fallbackLink,
  CONFIDENCE_THRESHOLD,
  FALLBACK_MESSAGE,
  type InterpretResult,
  type ExecuteResult,
  type AgentEntities,
  type AgentIntent,
} from '@/lib/agent-glosowy'
import {
  formatujPewnoscStt,
  glosWymagaFormularza,
  komunikatBleduMikrofonu,
  nagrywanieDostepne,
  pewnoscLaczna,
  powiedz,
  przerwijMowe,
  rozpocznijNagrywanie,
  syntezaDostepna,
  transkrybuj,
  TranskrypcjaError,
  type UchwytNagrywania,
} from '@/lib/voice-capture'

const EXAMPLE = 'chcę wziąć urlop od piątku do poniedziałku'

function actionErrorMessage(err: unknown): string {
  if (err instanceof AgentGlosowyError) return err.message || 'Coś poszło nie tak. Spróbuj ponownie.'
  return 'Brak połączenia z serwerem. Spróbuj ponownie.'
}

/** Small inline glyphs — kept local (only used here), matching components/icons.tsx's 24×24 stroke style. */
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

function StopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

function SpeakerIcon({ className, muted }: { className?: string; muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <path d="M5 9.5h3l4-3.5v12l-4-3.5H5z" strokeLinejoin="round" />
      {muted ? (
        <>
          <path d="M16 10l4 4" strokeLinecap="round" />
          <path d="M20 10l-4 4" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M16 9.2a4 4 0 0 1 0 5.6" strokeLinecap="round" />
          <path d="M18.6 6.8a7.5 7.5 0 0 1 0 10.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

type TurnStatus = 'interpreting' | 'awaiting-confirm' | 'executing' | 'done' | 'fallback' | 'error'

/** Ceiling on silence during any in-flight operation (product requirement — see ADR/track V2). */
const PROG_DELAY_MS = 1500

/**
 * Speak (and flag) a progress message if — and only if — `aktywny` stays true past
 * {@link PROG_DELAY_MS}. A fast interpret/execute/transcribe never triggers this (no spoken
 * "chwila" for something that finished instantly); anything slower gets BOTH a spoken Polish
 * status line and a visible working indicator, so the assistant is never silent for longer than
 * the product's ~1.5 s ceiling regardless of input mode (voice or text share this hook).
 */
function useOpoznionaAnonsacjaPostepu(
  aktywny: boolean,
  komunikat: string,
  mow: (tekst: string) => void,
): boolean {
  const [trwaDlugo, setTrwaDlugo] = useState(false)
  const mowRef = useRef(mow)
  mowRef.current = mow

  useEffect(() => {
    if (!aktywny) {
      setTrwaDlugo(false)
      return
    }
    const timer = setTimeout(() => {
      setTrwaDlugo(true)
      mowRef.current(komunikat)
    }, PROG_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktywny, komunikat])

  return trwaDlugo
}

/** Polish progress line per execute-stage intent — spoken only past {@link PROG_DELAY_MS}. */
function komunikatWykonania(intent: AgentIntent | undefined): string {
  switch (intent) {
    case 'MOJ_GRAFIK':
      return 'Sprawdzam grafik, chwila…'
    case 'URLOP':
    case 'L4':
      return 'Zapisuję wniosek, chwila…'
    default:
      return 'Pracuję nad tym, chwila…'
  }
}

interface Turn {
  id: string
  text: string
  status: TurnStatus
  interpretResult?: InterpretResult
  executeResult?: ExecuteResult
  error?: string
  /** STT confidence for a SPOKEN turn; undefined for a typed one (no STT stage to discount). */
  sttConfidence?: number
}

/**
 * Full command-assistant workspace (M3 module 3, Agent Głosowy — the T3b web-kit UI). Two input
 * paths, one pipeline:
 *
 *  - VOICE: `MediaRecorder` captures webm/opus → `POST /api/voice/transcribe` → our OWN local
 *    `stt-service` (faster-whisper `small` PL, CPU) → the transcript feeds the SAME
 *    `interpret`/`execute` calls a typed command uses. Speech recognition is deliberately NOT the
 *    browser's Web Speech API: a voice recording is personal data and Chrome ships that audio to the
 *    vendor's servers (see `docs/superpowers/specs/2026-07-21-agent-glosowy-poc.md` §3 and the
 *    header of `apps/tenant-runtime/src/agent-glosowy/stt.port.ts`).
 *  - TEXT: unchanged, and still the primary/hard-fallback surface (R10) — everything works with the
 *    microphone denied, missing, or unsupported.
 *
 * Answers are SPOKEN back via `speechSynthesis` (pl-PL, mutable). Synthesis renders locally from
 * text and uploads nothing, so it carries none of the constraints that rule out speech recognition.
 *
 * The decision flow is otherwise untouched: `interpret` never has a side effect; a recognized READ
 * (MOJ_GRAFIK) auto-executes; a WRITE (URLOP/L4) waits for an explicit human "Potwierdź i wykonaj"
 * click (EU AI Act / art. 22 RODO) — voice included, no exception; NIEZNANE / low confidence falls
 * back to the manual form.
 *
 * ONE ADDITION, mandated by the `SttPort` contract: for a SPOKEN turn the STT confidence is ANDed
 * with the intent confidence ({@link pewnoscLaczna}). The backend judges only the text it was handed
 * and knows nothing about how well it was heard, so a confidently-parsed mis-transcription would
 * otherwise sail through. The gate only ever ADDS a fallback — it can never remove one the backend
 * asked for, and it can never bypass the confirmation gate.
 *
 * Each turn keeps its own request in flight (a stale response can't clobber a newer turn) — mirrors
 * the busy-set / cancelledRef pattern in components/dokumenty/dokumenty-screen.tsx.
 */
export function AsystentScreen() {
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [nagrywa, setNagrywa] = useState(false)
  const [transkrybuje, setTranskrybuje] = useState(false)
  const [wyciszony, setWyciszony] = useState(false)
  const [bladGlosu, setBladGlosu] = useState<string | null>(null)
  // Capability probes run in an effect, never during render — the server has no `window`, and a
  // render-time probe would produce a hydration mismatch.
  const [mikrofonDostepny, setMikrofonDostepny] = useState(false)
  const [glosDostepny, setGlosDostepny] = useState(false)

  const cancelledRef = useRef(false)
  const nagranieRef = useRef<UchwytNagrywania | null>(null)
  const wyciszonyRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
      // Never leave the microphone live on unmount — that is both a privacy problem and a visible
      // browser-indicator bug.
      nagranieRef.current?.porzuc()
      nagranieRef.current = null
      przerwijMowe()
    }
  }, [])

  useEffect(() => {
    setMikrofonDostepny(nagrywanieDostepne())
    setGlosDostepny(syntezaDostepna())
  }, [])

  useEffect(() => {
    wyciszonyRef.current = wyciszony
  }, [wyciszony])

  /** Speak an answer unless muted. Always paired with the same text rendered on screen. */
  const wypowiedz = useCallback((tekst: string) => {
    powiedz(tekst, { wyciszony: wyciszonyRef.current })
  }, [])

  // Product requirement: no silence longer than ~1.5 s during any in-flight operation. STT
  // transcription runs both for a voice AND a fallback text turn (the latter has no transcription
  // stage at all — text just skips straight to `interpreting`), so this only ever fires for voice.
  const transkrypcjaTrwaDlugo = useOpoznionaAnonsacjaPostepu(
    transkrybuje,
    'Rozpoznaję mowę, chwila…',
    wypowiedz,
  )

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
        wypowiedz(executeResult.humanReadable)
      } catch (e) {
        updateTurn(id, { status: 'error', error: actionErrorMessage(e) })
      }
    },
    [updateTurn, wypowiedz],
  )

  /**
   * One turn of the conversation — identical for typed and spoken input except for `sttConfidence`,
   * which is present only for speech and only ever narrows what may run.
   */
  const przetworzPolecenie = useCallback(
    async (text: string, sttConfidence?: number) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setTurns((prev) => [...prev, { id, text, status: 'interpreting', sttConfidence }])
      setSubmitting(true)
      try {
        const interpretResult = await agentGlosowyApi.interpret(text)
        updateTurn(id, { interpretResult })

        // SttPort contract: STT confidence AND intent confidence. Narrowing only.
        const slabyGlos = glosWymagaFormularza(
          sttConfidence ?? null,
          interpretResult.confidence,
          CONFIDENCE_THRESHOLD,
        )

        if (interpretResult.fallbackToForm || slabyGlos) {
          updateTurn(id, { status: 'fallback' })
          wypowiedz(FALLBACK_MESSAGE)
        } else if (canAutoExecute(interpretResult)) {
          // A read (MOJ_GRAFIK) is safe to run immediately — nothing irreversible.
          await runExecute(id, interpretResult.intent, interpretResult.entities, false)
        } else {
          // A write (URLOP/L4) waits for the human's explicit confirm click — voice included.
          updateTurn(id, { status: 'awaiting-confirm' })
          wypowiedz(interpretResult.humanReadable)
        }
      } catch (e) {
        updateTurn(id, { status: 'error', error: actionErrorMessage(e) })
      } finally {
        if (!cancelledRef.current) setSubmitting(false)
      }
    },
    [runExecute, updateTurn, wypowiedz],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || submitting) return
    setInput('')
    setBladGlosu(null)
    await przetworzPolecenie(text)
  }

  /** Start capturing. Any getUserMedia rejection becomes Polish copy pointing at the text field. */
  const zacznijNagrywanie = useCallback(async () => {
    setBladGlosu(null)
    przerwijMowe()
    try {
      nagranieRef.current = await rozpocznijNagrywanie()
      setNagrywa(true)
    } catch (err) {
      setBladGlosu(komunikatBleduMikrofonu(err))
    }
  }, [])

  /** Stop capturing, transcribe on our own service, then run the normal turn with the transcript. */
  const zakonczNagrywanie = useCallback(async () => {
    const uchwyt = nagranieRef.current
    nagranieRef.current = null
    setNagrywa(false)
    if (!uchwyt) return
    setTranskrybuje(true)
    try {
      const nagranie = await uchwyt.zatrzymaj()
      const { text, confidence } = await transkrybuj(nagranie)
      if (cancelledRef.current) return
      if (!text.trim()) {
        setBladGlosu('Nie usłyszałem nic. Spróbuj jeszcze raz albo wpisz polecenie tekstem.')
        return
      }
      await przetworzPolecenie(text.trim(), confidence)
    } catch (err) {
      if (cancelledRef.current) return
      setBladGlosu(
        err instanceof TranskrypcjaError
          ? err.message
          : 'Nie udało się przetworzyć nagrania. Wpisz polecenie tekstem.',
      )
    } finally {
      if (!cancelledRef.current) setTranskrybuje(false)
    }
  }, [przetworzPolecenie])

  const przelaczMikrofon = () => {
    if (nagrywa) void zakonczNagrywanie()
    else void zacznijNagrywanie()
  }

  const przelaczWyciszenie = () => {
    setWyciszony((poprzedni) => {
      if (!poprzedni) przerwijMowe()
      return !poprzedni
    })
  }

  const zajety = submitting || transkrybuje

  return (
    <div className="mx-auto max-w-[760px]">
      <Card className="mb-6 p-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="asystentInput" className="text-[13px] font-medium text-ink">
              Powiedz albo wpisz polecenie
            </label>
            <button
              type="button"
              onClick={przelaczWyciszenie}
              aria-pressed={wyciszony}
              aria-label={wyciszony ? 'Włącz czytanie odpowiedzi na głos' : 'Wycisz czytanie odpowiedzi'}
              title={wyciszony ? 'Włącz głos' : 'Wycisz głos'}
              disabled={!glosDostepny}
              data-voice="wyciszenie"
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-strong px-2.5 text-[12px] text-muted disabled:opacity-40"
            >
              <SpeakerIcon className="h-4 w-4" muted={wyciszony} />
              {wyciszony ? 'Głos wyłączony' : 'Głos włączony'}
            </button>
          </div>
          <div className="flex items-start gap-2">
            <textarea
              id="asystentInput"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`np. „${EXAMPLE}"`}
              rows={2}
              data-voice="pole"
              className="flex-1 resize-none rounded-sm border border-line-strong bg-card px-[13px] py-2.5 text-[14.5px] text-ink placeholder:text-muted-2 focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={przelaczMikrofon}
              disabled={!mikrofonDostepny || zajety}
              aria-pressed={nagrywa}
              data-voice="mikrofon"
              title={
                mikrofonDostepny
                  ? nagrywa
                    ? 'Zakończ nagrywanie i wyślij'
                    : 'Mów do asystenta'
                  : 'Ta przeglądarka nie obsługuje nagrywania — użyj pola tekstowego'
              }
              aria-label={nagrywa ? 'Zakończ nagrywanie i wyślij' : 'Nagraj polecenie głosem'}
              className={
                nagrywa
                  ? 'inline-flex h-11 w-11 shrink-0 animate-node-pulse items-center justify-center rounded-sm border border-transparent bg-error text-white'
                  : 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-line-strong text-muted hover:border-accent/40 hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-50'
              }
            >
              {nagrywa ? <StopIcon className="h-[18px] w-[18px]" /> : <MicIcon className="h-[18px] w-[18px]" />}
            </button>
          </div>

          {nagrywa ? (
            <p role="status" data-voice="wskaznik" className="flex items-center gap-2 text-[13px] font-medium text-error">
              <span className="inline-block h-2.5 w-2.5 animate-node-pulse rounded-full bg-error" />
              Nagrywam… mów po polsku, potem naciśnij stop.
            </p>
          ) : null}

          {transkrybuje ? (
            <p
              role="status"
              data-voice="pracuje"
              className="flex items-center gap-2 text-[13px] text-muted"
            >
              {transkrypcjaTrwaDlugo ? (
                <span className="inline-block h-2 w-2 shrink-0 animate-node-pulse rounded-full bg-accent" aria-hidden="true" />
              ) : null}
              {transkrypcjaTrwaDlugo
                ? 'Rozpoznaję mowę, chwila… — nagranie nie opuszcza naszej infrastruktury.'
                : 'Rozpoznaję mowę lokalnie — nagranie nie opuszcza naszej infrastruktury…'}
            </p>
          ) : null}

          {bladGlosu ? (
            <p role="alert" data-voice="blad" className="rounded-lg border border-warn/30 bg-warn/[0.08] px-3 py-2 text-[13px] text-warn">
              {bladGlosu}
            </p>
          ) : null}

          {!mikrofonDostepny ? (
            <p className="text-[12px] text-muted-2">
              Ta przeglądarka nie obsługuje nagrywania dźwięku — asystent działa w trybie tekstowym.
              Odpowiedzi nadal są czytane na głos.
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={zajety || !input.trim()} className="h-10 px-5">
              {submitting ? 'Wysyłanie…' : 'Wyślij'}
            </Button>
          </div>
        </form>
      </Card>

      <div className="space-y-4">
        {turns.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-muted">
            Powiedz albo napisz polecenie, np. „{EXAMPLE}".
          </Card>
        ) : (
          [...turns].reverse().map((turn) => (
            <TurnCard
              key={turn.id}
              turn={turn}
              wypowiedz={wypowiedz}
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

function TurnCard({
  turn,
  onConfirm,
  wypowiedz,
}: {
  turn: Turn
  onConfirm: () => void
  wypowiedz: (tekst: string) => void
}) {
  const ir = turn.interpretResult
  const er = turn.executeResult
  const zGlosu = turn.sttConfidence !== undefined

  // Same "no silence past 1.5 s" rule as transcription, for the two other stages that can run
  // long: interpreting (backend NLU call) and executing (write to grafik/wnioski). Text and voice
  // turns share this exact code path — the only difference upstream is how `turn.text` was
  // produced.
  const interpretujeDlugo = useOpoznionaAnonsacjaPostepu(
    turn.status === 'interpreting',
    'Sprawdzam polecenie, chwila…',
    wypowiedz,
  )
  const wykonujeDlugo = useOpoznionaAnonsacjaPostepu(
    turn.status === 'executing',
    komunikatWykonania(ir?.intent),
    wypowiedz,
  )

  return (
    <Card className="p-4">
      <p className="text-[13px] text-muted">{zGlosu ? 'Ty (głosem):' : 'Ty:'}</p>
      <p className="mb-3 text-[14.5px] font-medium text-ink">„{turn.text}"</p>

      {zGlosu ? (
        <p className="mb-3 text-[12px] text-muted-2" data-voice="pewnosc">
          Rozpoznanie mowy: {formatujPewnoscStt(turn.sttConfidence ?? 0)}
          {ir
            ? ` · łącznie z intencją: ${formatConfidence(pewnoscLaczna(turn.sttConfidence ?? 0, ir.confidence))}`
            : ''}
        </p>
      ) : null}

      {turn.status === 'interpreting' && (
        <p role="status" data-voice="pracuje" className="flex items-center gap-2 text-sm text-muted">
          {interpretujeDlugo ? (
            <span className="inline-block h-2 w-2 shrink-0 animate-node-pulse rounded-full bg-accent" aria-hidden="true" />
          ) : null}
          {interpretujeDlugo ? 'Sprawdzam polecenie, chwila…' : 'Analizuję…'}
        </p>
      )}

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
            <Button onClick={onConfirm} data-voice="potwierdz" className="h-10 px-5">
              Potwierdź i wykonaj
            </Button>
          ) : (
            <p role="status" data-voice="pracuje" className="flex items-center gap-2 text-sm text-muted">
              {wykonujeDlugo ? (
                <span className="inline-block h-2 w-2 shrink-0 animate-node-pulse rounded-full bg-accent" aria-hidden="true" />
              ) : null}
              {wykonujeDlugo ? komunikatWykonania(ir?.intent) : 'Wykonuję…'}
            </p>
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
