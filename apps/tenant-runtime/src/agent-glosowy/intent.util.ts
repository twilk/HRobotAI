/**
 * `agent-glosowy` intent core — PURE functions only. No Prisma, no I/O, no LLM, no `Date.now()`.
 *
 * This is the deterministic, auditable brain of the Voice/Text Agent (M3 module 3, spec
 * `docs/superpowers/specs/2026-07-21-agent-glosowy-poc.md`). It maps a Polish utterance onto the
 * CLOSED command set of three (§6 of the spec) — nothing open-ended:
 *
 *   K1  URLOP       → leave request      (write; POST /api/wnioski, type URLOP_WYPOCZYNKOWY)
 *   K2  L4          → sick leave         (write; POST /api/wnioski, type ZWOLNIENIE_LEKARSKIE)
 *   K3  MOJ_GRAFIK  → my schedule        (read;  GET  /api/grafik/shifts)
 *   —   NIEZNANE    → out of set → the caller MUST fall back to a manual form, never guess-execute.
 *
 * Determinism is load-bearing (R10 mitigation + "bez per-token" narracja grantu): a relative date
 * ("dziś"/"jutro"/"piątek") is resolved against a `today` REFERENCE PASSED IN — the function never
 * reads the wall clock — so a given (text, today) pair always yields the identical ParsedIntent.
 */

export type AgentIntent =
  | 'URLOP'
  | 'L4'
  | 'MOJ_GRAFIK'
  | 'SALDO_URLOPU'
  | 'STATUS_WNIOSKU'
  | 'POMOC'
  | 'NIEZNANE'

/** One catalog row per registered (non-`NIEZNANE`) intent — the SINGLE source of truth for POMOC's
 * help text (see `VoiceCommandService`) and for the `ExecuteDto` `@IsIn` allowlist. Adding an intent
 * means adding ONE row here; nothing else needs to be told about it by hand. */
export interface IntentCatalogEntry {
  intent: Exclude<AgentIntent, 'NIEZNANE'>
  /** Polish, human-facing: what the command does. */
  opis: string
  /** A representative utterance a user might actually say. */
  przyklad: string
}

export const INTENT_CATALOG: readonly IntentCatalogEntry[] = [
  { intent: 'URLOP', opis: 'złożenie wniosku urlopowego', przyklad: 'chcę urlop od piątku do poniedziałku' },
  { intent: 'L4', opis: 'zgłoszenie zwolnienia lekarskiego', przyklad: 'zgłoś L4 na dziś' },
  { intent: 'MOJ_GRAFIK', opis: 'sprawdzenie mojego grafiku', przyklad: 'jaki mam grafik jutro' },
  { intent: 'SALDO_URLOPU', opis: 'sprawdzenie salda urlopu wypoczynkowego', przyklad: 'ile mam dni urlopu' },
  { intent: 'STATUS_WNIOSKU', opis: 'sprawdzenie statusu ostatniego wniosku', przyklad: 'co z moim wnioskiem' },
  { intent: 'POMOC', opis: 'wyświetlenie listy dostępnych poleceń', przyklad: 'pomoc' },
]

/** Slots extracted from an utterance. Dates are ISO `YYYY-MM-DD`; `type` is the leave kind. */
export interface ParsedEntities {
  dateFrom?: string
  dateTo?: string
  /** Leave kind for a write intent — mirrors the schema column consumed by CreateLeaveDto. */
  type?: string
}

export interface ParsedIntent {
  intent: AgentIntent
  entities: ParsedEntities
  /** 0..1. `< CONFIDENCE_THRESHOLD` ⇒ the caller falls back to a manual form (never executes). */
  confidence: number
}

/** Below this the caller MUST fall back to a manual form rather than act on the parse. */
export const CONFIDENCE_THRESHOLD = 0.7

const HIGH_CONFIDENCE = 0.9
/** Recognized write intent but no date could be parsed — not safe to prefill/execute. */
const LOW_CONFIDENCE = 0.5

/** Leave kinds mapped from intent — mirror the tenant schema (`dokumenty.config.ts`). */
const LEAVE_TYPE = { URLOP: 'URLOP_WYPOCZYNKOWY', L4: 'ZWOLNIENIE_LEKARSKIE' } as const

// --- date vocabulary --------------------------------------------------------------------------

/** getUTCDay() index: Sun=0 … Sat=6, keyed by inflected PL weekday forms (longest first when scanned). */
const WEEKDAYS: Record<string, number> = {
  poniedziałek: 1, poniedziałku: 1,
  wtorek: 2, wtorku: 2,
  środa: 3, środę: 3, środy: 3, sroda: 3, srode: 3, srody: 3,
  czwartek: 4, czwartku: 4,
  piątek: 5, piątku: 5, piatek: 5, piatku: 5,
  sobota: 6, sobotę: 6, soboty: 6, sobote: 6,
  niedziela: 0, niedzielę: 0, niedzieli: 0, niedziele: 0,
}

/** Day offset from `today`, keyed by PL relative-day words (incl. genitive "od jutra" forms). */
const RELATIVE_DAYS: Record<string, number> = {
  dzisiaj: 0, dziś: 0, dzis: 0,
  jutro: 1, jutra: 1,
  pojutrze: 2, pojutrza: 2,
  wczoraj: -1,
}

/** 0-based month index keyed by PL month names (genitive — the form used in dates). */
const MONTHS: Record<string, number> = {
  stycznia: 0, lutego: 1, marca: 2, kwietnia: 3, maja: 4, czerwca: 5,
  lipca: 6, sierpnia: 7, września: 8, wrzesnia: 8, października: 9, pazdziernika: 9,
  listopada: 10, grudnia: 11,
}

// --- date helpers (all UTC — inputs are UTC-midnight, so no host-timezone drift) --------------

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000)
}

/** Smallest date on/after `ref` whose weekday is `dow` (returns `ref` itself when it already matches). */
function onOrAfterWeekday(ref: Date, dow: number): Date {
  const diff = (dow - ref.getUTCDay() + 7) % 7
  return addDays(ref, diff)
}

/** Build a `day`/`month` date in `today`'s year, rolling to next year if it would already be past. */
function monthDate(today: Date, month: number, day: number): Date {
  const year = today.getUTCFullYear()
  let d = new Date(Date.UTC(year, month, day))
  if (d.getTime() < today.getTime()) d = new Date(Date.UTC(year + 1, month, day))
  return d
}

// --- date extraction --------------------------------------------------------------------------

const MONTH_ALT = Object.keys(MONTHS).join('|')
const DAY_TOKEN_ALT = [...Object.keys(RELATIVE_DAYS), ...Object.keys(WEEKDAYS)]
  // longest-first so "poniedziałku" is tried before "poniedziałek" etc. (avoids partial captures)
  .sort((a, b) => b.length - a.length)
  .join('|')

/** PL lowercase letter class — used for word boundaries because ASCII `\b` mis-fires on diacritics
 * (e.g. `dziś\b` never matches, since "ś" is a non-word char to `\b`). */
const PL_LETTER = 'a-ząćęłńóśźż'

const ISO_RE = /\d{4}-\d{2}-\d{2}/g
const MONTH_RANGE_RE = new RegExp(`(\\d{1,2})\\s*(?:do|-|–|—)\\s*(\\d{1,2})\\s+(${MONTH_ALT})`)
const MONTH_SINGLE_RE = new RegExp(`(\\d{1,2})\\s+(${MONTH_ALT})`)
const DAY_TOKEN_RE = new RegExp(`(?<![${PL_LETTER}])(${DAY_TOKEN_ALT})(?![${PL_LETTER}])`, 'g')

/** Resolve one PL day token to a Date. Relative words anchor on `today`; weekdays on `ref`. */
function resolveDayToken(token: string, today: Date, ref: Date): Date {
  const rel = RELATIVE_DAYS[token]
  if (rel !== undefined) return addDays(today, rel)
  return onOrAfterWeekday(ref, WEEKDAYS[token] ?? 0)
}

/**
 * Extract a `{dateFrom, dateTo}` range from the text, trying the most specific pattern first:
 * ISO → month numeric range → single month date → relative/weekday tokens (one or two for "od…do…").
 * Returns `{}` when nothing date-like is present.
 */
function extractDates(text: string, today: Date): { dateFrom?: string; dateTo?: string } {
  // 1. Explicit ISO dates.
  const iso = text.match(ISO_RE)
  if (iso && iso.length > 0) {
    return { dateFrom: iso[0], dateTo: iso[iso.length - 1] }
  }

  // 2. "1 do 5 sierpnia" / "od 1 do 5 sierpnia".
  const mr = text.match(MONTH_RANGE_RE)
  if (mr) {
    const month = MONTHS[mr[3] ?? ''] ?? 0
    return {
      dateFrom: toISO(monthDate(today, month, Number(mr[1]))),
      dateTo: toISO(monthDate(today, month, Number(mr[2]))),
    }
  }

  // 3. Single "1 sierpnia".
  const ms = text.match(MONTH_SINGLE_RE)
  if (ms) {
    const iso1 = toISO(monthDate(today, MONTHS[ms[2] ?? ''] ?? 0, Number(ms[1])))
    return { dateFrom: iso1, dateTo: iso1 }
  }

  // 4. Relative words / weekdays, in order of appearance ("od piątku do poniedziałku").
  const tokens = [...text.matchAll(DAY_TOKEN_RE)].map((m) => m[1] ?? '')
  const first = tokens[0]
  if (first == null || first === '') return {}
  const from = resolveDayToken(first, today, today)
  const second = tokens[1]
  if (second != null && second !== '') {
    const to = resolveDayToken(second, today, from)
    return { dateFrom: toISO(from), dateTo: toISO(to) }
  }
  return { dateFrom: toISO(from), dateTo: toISO(from) }
}

// --- intent classification --------------------------------------------------------------------

/** Sick-leave (L4) markers — checked BEFORE urlop so "zwolnienie lekarskie" never reads as URLOP. */
const L4_RE = /\bl4\b|zwolnieni|chorob|choruj|jestem chor/
/** Leave (urlop) markers. */
const URLOP_RE = /urlop|wolne\b|wolnego\b/
/** Leave-balance (saldo urlopu) markers — checked BEFORE plain URLOP so "ile ... urlopu" / "saldo
 * urlopowe" never reads as a request to file a new leave. */
const SALDO_URLOPU_RE = /ile.{0,20}(dni )?urlopu|saldo urlop|urlop.{0,10}saldo|ile.{0,10}urlopu.{0,10}zostało|pozostał.{0,10}urlop/
/** Schedule (grafik) markers. */
const GRAFIK_RE = /grafik|zmian[ayę]\b|kiedy pracuj|moje zmiany/
/** Leave-request status markers ("co z moim wnioskiem" / "status wniosku"). */
const STATUS_WNIOSKU_RE = /status.{0,15}wniosk|co z (moim )?wniosk|wniosek.{0,15}status/
/** Help markers ("pomoc" / "jakie masz polecenia" / "co potrafisz"). Checked first — it never
 * overlaps the domain vocabulary above, but keeping it first keeps the ordering obviously safe as
 * more intents are added below it. */
const POMOC_RE = /\bpomoc\b|jakie (polecenia|komendy|masz polecenia)|co (potrafisz|umiesz)|lista (poleceń|polecen|komend)/

/**
 * Parse a Polish utterance into `{intent, entities, confidence}` against the CLOSED command set.
 * PURE + deterministic: relative dates resolve against the `today` argument, never the wall clock.
 *
 * Confidence policy (drives the caller's fallback decision — see {@link CONFIDENCE_THRESHOLD}):
 *  - NIEZNANE                              → 0        (out of set → manual form)
 *  - MOJ_GRAFIK (read; dateless → today)   → HIGH     (safe to run a read)
 *  - URLOP/L4 with a parseable date        → HIGH     (safe to PROPOSE, still needs confirm)
 *  - URLOP/L4 with NO parseable date       → LOW      (< threshold → manual form)
 */
export function parseIntent(text: string, today: Date): ParsedIntent {
  const normalized = text.toLowerCase().trim()

  // POMOC first — meta-command, never collides with domain vocabulary, dateless.
  if (POMOC_RE.test(normalized)) {
    return { intent: 'POMOC', entities: {}, confidence: HIGH_CONFIDENCE }
  }

  const dates = extractDates(normalized, today)

  // L4 first (sick) — "zwolnienie" must not be swallowed by any urlop phrasing.
  if (L4_RE.test(normalized)) {
    return {
      intent: 'L4',
      entities: { ...dates, type: LEAVE_TYPE.L4 },
      confidence: dates.dateFrom != null ? HIGH_CONFIDENCE : LOW_CONFIDENCE,
    }
  }

  // SALDO_URLOPU (read) before plain URLOP — "ile mam dni urlopu" must not file a request.
  if (SALDO_URLOPU_RE.test(normalized)) {
    return { intent: 'SALDO_URLOPU', entities: {}, confidence: HIGH_CONFIDENCE }
  }

  if (URLOP_RE.test(normalized)) {
    return {
      intent: 'URLOP',
      entities: { ...dates, type: LEAVE_TYPE.URLOP },
      confidence: dates.dateFrom != null ? HIGH_CONFIDENCE : LOW_CONFIDENCE,
    }
  }

  if (STATUS_WNIOSKU_RE.test(normalized)) {
    return { intent: 'STATUS_WNIOSKU', entities: {}, confidence: HIGH_CONFIDENCE }
  }

  if (GRAFIK_RE.test(normalized)) {
    // Read is safe to default to today when no date is spoken.
    const dateFrom = dates.dateFrom ?? toISO(today)
    return {
      intent: 'MOJ_GRAFIK',
      entities: { dateFrom, dateTo: dates.dateTo ?? dateFrom },
      confidence: HIGH_CONFIDENCE,
    }
  }

  return { intent: 'NIEZNANE', entities: {}, confidence: 0 }
}
