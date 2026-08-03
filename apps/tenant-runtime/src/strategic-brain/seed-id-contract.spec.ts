import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * [I-01] KONTRAKT IDENTYFIKATORÓW W DANYCH ZASIEWOWYCH.
 *
 * Defekt źródłowy: `scripts/seed-demo-strategic-brain.sql` wstawiał dwóch syntetycznych pracowników
 * z czytelnymi slugami `sb_emp_new1` / `sb_emp_new2` (Tomasz Nowacki, Ewa Lewandowska). Kontroler
 * `strategic-brain` waliduje parametr trasy `ParseUUIDPipe`, więc ekran `/analiza` dla tej dwójki
 * dostawał
 * `400 {"message":"Validation failed (uuid is expected)"}` przy KAŻDYM wejściu, a kolumna SYGNAŁ
 * w „Mapie wydajności" zostawała w stanie wiecznego ładowania. Wada nie leżała w logice modułu —
 * dane łamały kontrakt HTTP.
 *
 * Ten test jest statyczną analizą (bez DB, bez DI): parsuje KAŻDY plik `scripts/*.sql` i sprawdza,
 * że każda literalna wartość klucza głównego wstawiana do tabeli, której `:id` jest walidowane
 * `ParseUUIDPipe`, jest poprawnym UUID-em. Dzięki temu ta KLASA błędu nie wróci — nowy zasiew z
 * czytelnym slugiem w takiej kolumnie failuje testem, a nie dopiero na demo.
 *
 * Zakres celowo obejmuje wszystkie pliki zasiewowe, nie tylko strategic-brain: kontrakt należy do
 * warstwy HTTP, a nie do modułu, więc dowolny zasiew może go złamać tak samo.
 */

/** Repo root: src/strategic-brain -> src -> tenant-runtime -> apps -> root. */
const SEED_DIR = join(__dirname, '..', '..', '..', '..', 'scripts')

const CONTROLLER_PATH = join(__dirname, 'strategic-brain.controller.ts')

/**
 * Tabele, których klucz główny trafia do URL-a jako `:id` chroniony `ParseUUIDPipe`. Wartość =
 * trasa, która to wymusza (dokumentacja DLACZEGO, żeby nikt nie „poprawił" zasiewu z powrotem).
 * Rozszerz tę mapę, jeśli nowy kontroler zacznie przyjmować id kolejnej tabeli w ścieżce.
 */
const UUID_CONTRACT_TABLES: Record<string, string> = {
  employees: 'GET /strategic-brain/employee/:id  +  GET/PATCH /employees/:id',
  recruitment_recommendation: 'POST /strategic-brain/recruitment/:id/acknowledge',
  leave_requests: 'GET /wnioski/:id  +  POST /wnioski/:id/decision  +  POST /wnioski/:id/cancel',
  shift_demands: 'GET /grafik/demands/:id',
}

/**
 * [L-1] LISTA UZNANEGO DŁUGU ZOSTAŁA ZLIKWIDOWANA, NIE ROZSZERZONA.
 *
 * I-01 zostawił tu jawną listę `KNOWN_ID_DEBT` z trzema parami (plik, tabela): `ds26-…` liczone
 * `md5()` w `seed-dataset-2026.sql` (Grafik + Wnioski) oraz rodzina `lr-demo-*` w
 * `seed-demo-m2-modules.sql`. Tor L domknął oba wpisy — dane zostały przekluczone na UUID-y, więc
 * lista jest pusta i została USUNIĘTA razem ze wszystkimi ulgami. Od tej pory KAŻDY klucz w tabeli
 * z `UUID_CONTRACT_TABLES` musi być UUID-em, bez wyjątków.
 *
 * Skala zastanego długu (żywy najemca `hrobot_t_900d948b`, zmierzona przed naprawą): 608 z 686
 * `shift_demands` i 28 z 37 `leave_requests` — w tym OBA wnioski PENDING, na których stoi demo
 * akceptacji managera. `POST /wnioski/:id/decision` zwracał dla nich 400.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface SeedId {
  file: string
  table: string
  /** Literal value when the INSERT supplies a constant, else `null` (SQL expression). */
  literal: string | null
  /** Raw source text of the first value expression — used in failure messages. */
  expression: string
}

/**
 * Remove `-- line` and block comments, but NEVER inside a string literal (a `--` can legitimately
 * appear inside a Polish rationale). Comments are replaced by a space so token boundaries survive.
 */
function stripSqlComments(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'") {
      out += ch
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "''"
          i += 2
          continue
        }
        out += sql[i]
        if (sql[i] === "'") {
          i++
          break
        }
        i++
      }
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += ' '
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    out += ch
    i++
  }
  return out
}

/** Index just past the `)` closing the parenthesis that opens at `start`, quote-aware. */
function matchParen(sql: string, start: number): number {
  let depth = 0
  let i = start
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'") {
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2
          continue
        }
        if (sql[i] === "'") break
        i++
      }
      i++
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') {
      depth--
      if (depth === 0) return i + 1
    }
    i++
  }
  return -1
}

/** Split on commas at paren-depth 0, quote-aware. */
function splitTopLevel(sql: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'") {
      current += ch
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += "''"
          i += 2
          continue
        }
        current += sql[i]
        if (sql[i] === "'") {
          i++
          break
        }
        i++
      }
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }
  parts.push(current)
  return parts
}

/** `'abc'` -> `abc`; anything else (concat, subquery, function call, NULL) -> null. */
function asLiteral(expression: string): string | null {
  const trimmed = expression.trim()
  const match = /^'((?:[^']|'')*)'$/.exec(trimmed)
  return match?.[1] === undefined ? null : match[1].replace(/''/g, "'")
}

// -------------------------------------------------------------------------------------------------
// [L-1] STATYCZNY DOWÓD UUID-owości DLA KLUCZY GENEROWANYCH.
//
// Dlaczego w ogóle: `seed-dataset-2026.sql` nie może mieć literalnych id — wstawia 608 zapotrzebowań
// jako iloczyn kartezjański wzorca tygodnia i 16 poniedziałków, więc liczba wierszy wynika z danych,
// a nie z tekstu skryptu. Sam literał nie jest tu opcją, a przepuszczenie DOWOLNEGO wyrażenia
// zamieniłoby guarda w atrapę.
//
// Dlatego zamiast listy dozwolonych funkcji (czyli zaufania) analizator DOWODZI kształtu: liczy,
// jaki ciąg znaków wyrażenie może wyprodukować. Każda pozycja to albo znak stały (z literału), albo
// „jakaś mała cyfra szesnastkowa" (z `md5()`, które w PostgreSQL ZAWSZE zwraca 32 małe znaki hex).
// Wyrażenie przechodzi wyłącznie wtedy, gdy dowiedziony kształt ma dokładnie 36 znaków, myślniki na
// 9/14/19/24, nibble wersji z `[1-5]`, nibble wariantu z `[89ab]` i hex wszędzie indziej — czyli
// dokładnie to, czego wymaga `UUID_RE` od literałów. To NIE jest rozluźnienie kontraktu: stary dług
// `'ds26-' || left(md5(…), 30)` nadal go łamie (patrz test „analizator nie jest pieczątką"), bo
// 'ds26-' nie jest prefiksem UUID-a, a 5 + 30 != 36.
//
// Nieznana funkcja (`gen_random_uuid()`, `uuid_generate_v4()`, kolumna, podzapytanie) -> null, czyli
// ODRZUCENIE. Rozszerzaj świadomie i tylko o funkcje o stałej, znanej długości wyniku.
// -------------------------------------------------------------------------------------------------

/** Jedna pozycja dowiedzionego kształtu: znak stały albo „mała cyfra szesnastkowa". */
type ShapeChar = { kind: 'lit'; ch: string } | { kind: 'hex' }

/** Split on top-level `||` (SQL concat), quote- and paren-aware. */
function splitConcat(sql: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'") {
      current += ch
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += "''"
          i += 2
          continue
        }
        current += sql[i]
        if (sql[i] === "'") {
          i++
          break
        }
        i++
      }
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === '|' && sql[i + 1] === '|' && depth === 0) {
      parts.push(current)
      current = ''
      i += 2
      continue
    }
    current += ch
    i++
  }
  parts.push(current)
  return parts
}

/** Stała całkowita (`12`) -> 12; cokolwiek innego -> null. */
function asIntLiteral(expression: string): number | null {
  const trimmed = expression.trim()
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

const hexChars = (count: number): ShapeChar[] => Array.from({ length: count }, () => ({ kind: 'hex' }) as ShapeChar)

/**
 * Dowiedziony kształt wyniku wyrażenia albo `null`, gdy nie da się go dowieść.
 * Obsługiwane: literał, `a || b`, `md5(x)` (32 hex), `left(x, n)`, `substr(x, from, len)`.
 */
function shapeOf(expression: string): ShapeChar[] | null {
  const segments = splitConcat(expression)
  if (segments.length > 1) {
    const out: ShapeChar[] = []
    for (const segment of segments) {
      const shape = shapeOf(segment)
      if (shape === null) return null
      out.push(...shape)
    }
    return out
  }

  const trimmed = expression.trim()
  const literal = asLiteral(trimmed)
  if (literal !== null) return [...literal].map((ch) => ({ kind: 'lit', ch }) as ShapeChar)

  const call = /^([a-z_][a-z0-9_]*)\s*\(/i.exec(trimmed)
  if (!call) return null
  // The call must span the WHOLE expression — otherwise something unmodelled follows it (a cast,
  // an operator, a second call) and we cannot claim to know the result.
  if (matchParen(trimmed, call[0].length - 1) !== trimmed.length) return null

  const fn = (call[1] ?? '').toLowerCase()
  const args = splitTopLevel(trimmed.slice(call[0].length, trimmed.length - 1))

  // PostgreSQL `md5()` is documented to return 32 LOWERCASE hex characters, for any input.
  if (fn === 'md5' && args.length === 1) return hexChars(32)

  if (fn === 'left' && args.length === 2) {
    const inner = shapeOf(args[0] ?? '')
    const n = asIntLiteral(args[1] ?? '')
    if (inner === null || n === null || n > inner.length) return null
    return inner.slice(0, n)
  }

  if (fn === 'substr' && args.length === 3) {
    const inner = shapeOf(args[0] ?? '')
    const from = asIntLiteral(args[1] ?? '')
    const len = asIntLiteral(args[2] ?? '')
    if (inner === null || from === null || len === null || from < 1 || from - 1 + len > inner.length) return null
    return inner.slice(from - 1, from - 1 + len)
  }

  return null
}

const HEX_CHAR_RE = /^[0-9a-f]$/
const DASH_POSITIONS = [9, 14, 19, 24]

/** Czy dowiedziony kształt SPEŁNIA `UUID_RE` dla każdej możliwej wartości hex? */
function isProvenUuid(shape: ShapeChar[] | null): boolean {
  if (shape === null || shape.length !== 36) return false
  const litAt = (position: number): string | null => {
    const char = shape[position - 1]
    return char !== undefined && char.kind === 'lit' ? char.ch.toLowerCase() : null
  }
  if (DASH_POSITIONS.some((position) => litAt(position) !== '-')) return false
  // Version and variant nibbles must be PINNED by a literal — a hex wildcard there could yield a
  // value the pipe rejects, so "sometimes a UUID" is not good enough.
  if (!/^[1-5]$/.test(litAt(15) ?? '')) return false
  if (!/^[89ab]$/.test(litAt(20) ?? '')) return false
  return shape.every((char, index) => {
    if (DASH_POSITIONS.includes(index + 1)) return true
    return char.kind === 'hex' || HEX_CHAR_RE.test(char.ch.toLowerCase())
  })
}

/** Wyrażenie SQL, o którym da się STATYCZNIE dowieść, że zawsze daje poprawny UUID. */
function producesUuid(expression: string): boolean {
  return isProvenUuid(shapeOf(expression))
}

/**
 * Extract, for every `INSERT INTO <table> (id, ...)` statement, the first value expression of each
 * inserted row — i.e. whatever lands in the primary key. Handles both `... SELECT <expr>, ...` and
 * `... VALUES (<expr>, ...), (<expr>, ...)` forms used across the seed scripts.
 */
function parseSeedIds(file: string, rawSql: string): SeedId[] {
  const sql = stripSqlComments(rawSql)
  const found: SeedId[] = []
  const insertRe = /\bINSERT\s+INTO\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*(?=\()/g

  let insertMatch: RegExpExecArray | null
  while ((insertMatch = insertRe.exec(sql)) !== null) {
    const table = (insertMatch[1] ?? '').toLowerCase()
    const columnsStart = insertMatch.index + insertMatch[0].length
    const columnsEnd = matchParen(sql, columnsStart)
    if (columnsEnd < 0) continue

    const columns = splitTopLevel(sql.slice(columnsStart + 1, columnsEnd - 1))
    const firstColumn = columns[0]?.trim().replace(/"/g, '').toLowerCase()
    if (firstColumn !== 'id') continue

    // The row source starts at the next top-level SELECT or VALUES keyword.
    const rest = sql.slice(columnsEnd)
    const sourceMatch = /\b(SELECT|VALUES)\b/i.exec(rest)
    if (!sourceMatch) continue

    const keyword = (sourceMatch[1] ?? '').toUpperCase()
    const after = rest.slice(sourceMatch.index + sourceMatch[0].length)

    if (keyword === 'VALUES') {
      // One or more `( ... )` tuples separated by commas, until the statement ends.
      let cursor = 0
      while (cursor < after.length) {
        const open = after.indexOf('(', cursor)
        if (open < 0) break
        // Anything other than whitespace/comma between tuples means the VALUES list is over.
        if (/[^\s,]/.test(after.slice(cursor, open))) break
        const close = matchParen(after, open)
        if (close < 0) break
        const first = splitTopLevel(after.slice(open + 1, close - 1))[0] ?? ''
        found.push({ file, table, literal: asLiteral(first), expression: first.trim() })
        cursor = close
      }
      continue
    }

    // SELECT form: the primary key is the first projected column.
    const first = splitTopLevel(after)[0] ?? ''
    found.push({ file, table, literal: asLiteral(first), expression: first.trim() })
  }

  return found
}

function loadAllSeedIds(): SeedId[] {
  const files = readdirSync(SEED_DIR).filter((name) => name.endsWith('.sql'))
  return files.flatMap((name) => parseSeedIds(name, readFileSync(join(SEED_DIR, name), 'utf8')))
}

/**
 * Klucz kontraktowy, który NIE jest UUID-em: albo zły literał, albo wyrażenie, o którym nie da się
 * dowieść UUID-owości (patrz `shapeOf`).
 */
function breaksContract(entry: SeedId): boolean {
  return entry.literal === null ? !producesUuid(entry.expression) : !UUID_RE.test(entry.literal)
}

describe('[I-01] kontrakt identyfikatorów w danych zasiewowych', () => {
  const allIds = loadAllSeedIds()
  const contractIds = allIds.filter((entry) => entry.table in UUID_CONTRACT_TABLES)

  it('parser znajduje zasiewy — sanity, żeby test nie przechodził „na pusto"', () => {
    // Gdyby parser przestał cokolwiek rozpoznawać, wszystkie asercje niżej byłyby wakacyjnie zielone.
    expect(allIds.length).toBeGreaterThan(5)
    expect(contractIds.length).toBeGreaterThan(5)
    expect(contractIds.filter((entry) => entry.table === 'employees').length).toBeGreaterThanOrEqual(3)
  })

  it('każdy literalny identyfikator pracownika w zasiewie jest poprawnym UUID-em', () => {
    const offenders = contractIds
      .filter((entry) => entry.table === 'employees' && entry.literal !== null)
      .filter((entry) => !UUID_RE.test(entry.literal as string))

    expect(
      offenders.map((entry) => `${entry.file}: employees.id = '${entry.literal}'`),
    ).toEqual([])
  })

  it('żaden klucz w tabeli walidowanej ParseUUIDPipe nie łamie kontraktu — ZERO wyjątków', () => {
    const offenders = contractIds.filter(breaksContract)

    if (offenders.length > 0) {
      const report = offenders
        .map(
          (entry) =>
            `  ${entry.file} -> ${entry.table}.id = ${entry.expression}\n` +
            `      trasa wymuszająca UUID: ${UUID_CONTRACT_TABLES[entry.table]}`,
        )
        .join('\n')
      throw new Error(
        'Zasiew wstawia klucz główny, który NIE jest UUID-em, do tabeli adresowanej przez `:id`\n' +
          'chroniony ParseUUIDPipe. Każde żądanie o taki rekord zwróci 400 (Validation failed —\n' +
          'uuid is expected), a ekran, który go pobiera, zostanie w stanie ładowania:\n' +
          `${report}\n` +
          'Napraw DANE (nadaj stały UUID), nie kontrakt — rozluźnienie pipe’a osłabia walidację\n' +
          'dla wszystkich wywołań.',
      )
    }
    expect(offenders).toEqual([])
  })

  it('zasiew strategic-brain nie zawiera już ŻADNEGO klucza kontraktowego spoza UUID', () => {
    // Twarda asercja bez ulg: plik naprawiony w I-01 nie ma prawa mieć ani slugu, ani wyrażenia.
    const own = contractIds.filter((entry) => entry.file === 'seed-demo-strategic-brain.sql')
    expect(own.length).toBeGreaterThanOrEqual(8)
    expect(own.filter(breaksContract).map((entry) => `${entry.table}.id = ${entry.expression}`)).toEqual([])
  })

  it('[L-1] zasiewy Grafik/Wnioski — dawny dług ds26-* / lr-demo-* jest domknięty', () => {
    // Twarda asercja per plik, taka sama jak dla strategic-brain wyżej: te dwa pliki miały ulgę w
    // KNOWN_ID_DEBT, więc muszą mieć własny, imienny test, a nie tylko rozpłynąć się w zbiorczym.
    for (const [file, minimum] of [
      ['seed-dataset-2026.sql', 4],
      ['seed-demo-m2-modules.sql', 4],
    ] as const) {
      const own = contractIds.filter((entry) => entry.file === file)
      expect({ file, count: own.length >= minimum }).toEqual({ file, count: true })
      expect(own.filter(breaksContract).map((entry) => `${file}: ${entry.table}.id = ${entry.expression}`)).toEqual([])
    }
  })

  it('[L-1] analizator NIE jest pieczątką — odrzuca dokładnie ten dług, który był w KNOWN_ID_DEBT', () => {
    // Bez tego testu rozszerzenie guarda o wyrażenia byłoby nie do odróżnienia od jego wyłączenia.
    // Lewa kolumna: formy ODRZUCANE. Prawa: jedyna forma, którą guard uznaje.
    expect(producesUuid("'ds26-' || left(md5(e.id || s.dt), 30)")).toBe(false) // dawny dług Grafik/Wnioski
    expect(producesUuid("'ds26-koord-jul-' || left(md5(e.id), 20)")).toBe(false) // dawny dług, druga rodzina
    expect(producesUuid("'lr-demo-' || g.n")).toBe(false) // dawny dług Wnioski
    expect(producesUuid('gen_random_uuid()')).toBe(false) // nieznana funkcja != zaufanie
    expect(producesUuid('e.id')).toBe(false) // referencja do kolumny
    expect(producesUuid('(SELECT id FROM employees LIMIT 1)')).toBe(false) // podzapytanie
    expect(producesUuid("md5('x')")).toBe(false) // 32 hex bez myślników to nie UUID
    expect(producesUuid("'d5260000-0000-4000-8000-' || left(md5('x'), 11)")).toBe(false) // 35 znaków
    expect(producesUuid("'d5260000-0000-4000-8000-' || left(md5('x'), 13)")).toBe(false) // 37 znaków
    expect(producesUuid("'d5260000-0000-0000-8000-' || left(md5('x'), 12)")).toBe(false) // nibble wersji '0'
    expect(producesUuid("'d5260000-0000-4000-c000-' || left(md5('x'), 12)")).toBe(false) // nibble wariantu 'c'
    expect(producesUuid("'d5260000-0000-4000-8000-' || left(md5('x'), 12)::text")).toBe(false) // ogon poza wywołaniem

    expect(producesUuid("'d5260000-0000-4000-8000-' || left(md5('x'), 12)")).toBe(true)
    expect(producesUuid("'d5260000-0000-4000-8000-' || substr(md5('x'), 5, 12)")).toBe(true)
    expect(producesUuid("'a1d00000-0000-4000-8000-000000000a01'")).toBe(true) // czysty literał też
  })

  it('kontrakt HTTP nadal wymaga UUID — inaczej ten zasiew wymaga ponownej decyzji', () => {
    // Powód istnienia całego pliku. Jeśli ktoś zdejmie ParseUUIDPipe, ten test przypomni, że stałe
    // UUID-y w zasiewie były konsekwencją kontraktu, a nie ozdobnikiem.
    const controller = readFileSync(CONTROLLER_PATH, 'utf8')
    expect(controller).toMatch(/@Get\('employee\/:id'\)/)
    expect(controller).toMatch(/@Param\('id',\s*ParseUUIDPipe\)/)
  })
})
