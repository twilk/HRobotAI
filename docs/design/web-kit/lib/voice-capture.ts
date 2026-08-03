/**
 * Browser voice I/O for the Agent Głosowy screen (M3 module 3).
 *
 * CAPTURE (`MediaRecorder`, webm/opus) → our OWN `stt-service` (faster-whisper `small` PL, CPU),
 * NOT the browser's Web Speech API. That is a deliberate, recorded decision, not a preference: a
 * voice recording is personal data under GDPR and Chrome's `SpeechRecognition` ships the audio to
 * the vendor's servers, so it is disqualifying for this project. See
 * `docs/superpowers/specs/2026-07-21-agent-glosowy-poc.md` §3 and the header of
 * `apps/tenant-runtime/src/agent-glosowy/stt.port.ts` — this module is the browser half of exactly
 * that seam: audio → `{text, confidence}` → the SAME `POST /api/agent-glosowy/interpret` a keyboard
 * user hits.
 *
 * PLAYBACK (`speechSynthesis`, pl-PL) is fine and is used: synthesis renders locally from text, no
 * recording is transmitted anywhere, so none of the above applies to it.
 *
 * Pure helpers (mime choice, error copy, confidence maths) are exported separately and unit-tested
 * under vitest's `node` environment; the DOM/`navigator` paths are capability-guarded.
 */

// --- pure helpers (unit-tested) -----------------------------------------------------------------

/**
 * Preference order for the recording container. Opus in WebM is what the `SttPort` contract names
 * and what ffmpeg/PyAV decode without fuss; Safari only offers MP4/AAC, which the service also
 * decodes, so it is an acceptable last resort rather than a hard failure.
 */
export const PREFEROWANE_TYPY_MIME = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const

/**
 * First supported container, or null when the browser records none of them. `isSupported` is
 * injected so this stays a pure function testable without a DOM.
 */
export function wybierzTypMime(
  isSupported: (typ: string) => boolean,
  kandydaci: readonly string[] = PREFEROWANE_TYPY_MIME,
): string | null {
  for (const typ of kandydaci) if (isSupported(typ)) return typ
  return null
}

/** Polish copy for every `getUserMedia` rejection a user can realistically cause. */
export function komunikatBleduMikrofonu(err: unknown): string {
  const nazwa = err instanceof Error ? err.name : ''
  switch (nazwa) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Brak zgody na dostęp do mikrofonu. Zezwól na mikrofon w ustawieniach przeglądarki albo wpisz polecenie tekstem.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nie znaleziono mikrofonu. Podłącz urządzenie audio albo wpisz polecenie tekstem.'
    case 'NotReadableError':
      return 'Mikrofon jest zajęty przez inną aplikację. Zamknij ją albo wpisz polecenie tekstem.'
    default:
      return 'Nie udało się uruchomić nagrywania. Wpisz polecenie tekstem.'
  }
}

/** Polish copy for a failed `POST /api/voice/transcribe`, by upstream HTTP status. */
export function komunikatBleduTranskrypcji(status: number): string {
  if (status === 401 || status === 403) return 'Sesja wygasła — zaloguj się ponownie albo wpisz polecenie tekstem.'
  if (status === 413) return 'Nagranie jest za długie. Powiedz krócej albo wpisz polecenie tekstem.'
  if (status === 422 || status === 400) return 'Nie udało się odczytać nagrania. Spróbuj jeszcze raz albo wpisz polecenie tekstem.'
  if (status === 503) return 'Usługa rozpoznawania mowy jest niedostępna. Wpisz polecenie tekstem.'
  return 'Rozpoznawanie mowy nie odpowiedziało. Wpisz polecenie tekstem.'
}

/**
 * Combined trust in a voice turn: STT confidence AND intent confidence.
 *
 * The `SttPort` contract states the two are ANDed ("STT confidence 0..1 … — ANDed with intent
 * confidence"), and multiplication is the honest reading of that: a 0.9-confident parse of a
 * 0.5-confident transcript is a 0.45-confident turn, not a 0.9 one. A typed turn has no STT stage,
 * so passing `null` returns the intent confidence untouched — text must not be penalised.
 */
export function pewnoscLaczna(pewnoscStt: number | null, pewnoscIntencji: number): number {
  const intencja = Math.min(Math.max(pewnoscIntencji, 0), 1)
  if (pewnoscStt === null) return intencja
  const stt = Math.min(Math.max(pewnoscStt, 0), 1)
  return Math.round(stt * intencja * 10000) / 10000
}

/**
 * Whether a VOICE turn must fall back to the manual form despite the backend accepting the parse.
 *
 * The backend judges the TEXT it was given and knows nothing about how well that text was heard, so
 * a confidently-parsed mis-transcription would otherwise sail through. This is a narrowing gate
 * only — it can add a fallback, never remove one the backend asked for.
 */
export function glosWymagaFormularza(
  pewnoscStt: number | null,
  pewnoscIntencji: number,
  prog: number,
): boolean {
  return pewnoscLaczna(pewnoscStt, pewnoscIntencji) < prog
}

/** "87%" from a 0..1 confidence — same rounding as lib/agent-glosowy.ts's `formatConfidence`. */
export function formatujPewnoscStt(pewnosc: number): string {
  return `${Math.round(pewnosc * 100)}%`
}

// --- capability probes --------------------------------------------------------------------------

/** True when this browser can record audio at all (`MediaRecorder` + `getUserMedia`). */
export function nagrywanieDostepne(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    wybierzTypMime((t) => window.MediaRecorder.isTypeSupported(t)) !== null
  )
}

/** True when this browser can speak (`speechSynthesis`). Present nearly everywhere. */
export function syntezaDostepna(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// --- recording -----------------------------------------------------------------------------------

export interface Nagranie {
  /** The recorded audio, ready to POST as multipart. */
  blob: Blob
  /** Container actually used, e.g. `audio/webm;codecs=opus`. */
  typMime: string
}

export interface UchwytNagrywania {
  /** Stop recording and resolve with the audio. Also releases the microphone. */
  zatrzymaj(): Promise<Nagranie>
  /** Abandon the recording and release the microphone without producing audio. */
  porzuc(): void
}

/**
 * Start recording from the microphone. Throws (with a `getUserMedia` error) when the user denies
 * access or no device exists — call {@link komunikatBleduMikrofonu} on the rejection for Polish copy.
 *
 * The microphone track is stopped on both exits, so the browser's "recording" indicator always
 * clears — leaving a live mic behind would be both a privacy problem and an obvious UI bug.
 */
export async function rozpocznijNagrywanie(): Promise<UchwytNagrywania> {
  if (!nagrywanieDostepne()) {
    throw Object.assign(new Error('MediaRecorder unavailable'), { name: 'NotSupportedError' })
  }
  const strumien = await navigator.mediaDevices.getUserMedia({ audio: true })
  const typMime = wybierzTypMime((t) => window.MediaRecorder.isTypeSupported(t))
  const recorder = new MediaRecorder(strumien, typMime ? { mimeType: typMime } : undefined)
  const kawalki: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) kawalki.push(e.data)
  }
  recorder.start()

  const zwolnij = () => strumien.getTracks().forEach((t) => t.stop())

  return {
    zatrzymaj: () =>
      new Promise<Nagranie>((resolve) => {
        recorder.onstop = () => {
          zwolnij()
          const uzyty = typMime ?? recorder.mimeType ?? 'audio/webm'
          resolve({ blob: new Blob(kawalki, { type: uzyty }), typMime: uzyty })
        }
        recorder.stop()
      }),
    porzuc: () => {
      try {
        recorder.stop()
      } catch {
        /* already stopped */
      }
      zwolnij()
    },
  }
}

// --- transcription --------------------------------------------------------------------------------

/** Wire shape of `SttResult` — parity with stt.port.ts and stt-service's `TranscribeResponse`. */
export interface WynikTranskrypcji {
  text: string
  confidence: number
}

/** Carries the upstream status so the UI can pick the right Polish message. */
export class TranskrypcjaError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'TranskrypcjaError'
  }
}

/**
 * Send one recording to our own STT service through the same-origin proxy
 * (`app/api/voice/transcribe`), which attaches the caller's Keycloak bearer server-side — the same
 * pattern every other backend call in web-kit uses (lib/tenant-runtime.ts).
 */
export async function transkrybuj(nagranie: Nagranie): Promise<WynikTranskrypcji> {
  const form = new FormData()
  // The filename extension is cosmetic; the service sniffs the container with ffmpeg.
  form.append('audio', nagranie.blob, 'nagranie.webm')
  const res = await fetch('/api/voice/transcribe', { method: 'POST', body: form })
  if (!res.ok) throw new TranskrypcjaError(res.status, komunikatBleduTranskrypcji(res.status))
  return (await res.json()) as WynikTranskrypcji
}

// --- speech synthesis ------------------------------------------------------------------------------

/** Prefer a Polish voice; fall back to the engine default. */
function polskiGlos(): SpeechSynthesisVoice | null {
  if (!syntezaDostepna()) return null
  return window.speechSynthesis.getVoices().find((g) => g.lang?.toLowerCase().startsWith('pl')) ?? null
}

/**
 * Speak `tekst` in Polish. Local synthesis only — nothing is uploaded, which is why this half of the
 * voice loop carries none of the constraints that rule out browser speech RECOGNITION.
 * A no-op when muted or unsupported; the answer is always on screen too.
 */
export function powiedz(tekst: string, opcje: { wyciszony?: boolean } = {}): void {
  if (opcje.wyciszony || !syntezaDostepna() || !tekst.trim()) return
  try {
    window.speechSynthesis.cancel()
    const wypowiedz = new SpeechSynthesisUtterance(tekst)
    wypowiedz.lang = 'pl-PL'
    const glos = polskiGlos()
    if (glos) wypowiedz.voice = glos
    window.speechSynthesis.speak(wypowiedz)
  } catch {
    /* speaking is an enhancement, never a requirement */
  }
}

/** Cut off whatever is being spoken (new turn, mute, unmount). */
export function przerwijMowe(): void {
  if (!syntezaDostepna()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* nothing to cancel */
  }
}
