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
 * ZNANY, ZASTANY DŁUG tej samej klasy — wykryty przez ten test przy okazji naprawy I-01 i świadomie
 * NIE naprawiony tutaj. To dane demo torów Grafik/Wnioski (`ds26-…` liczone `md5()`, rodzina
 * `lr-demo-*`), a nie strategic-brain. Przepisanie ich kluczy to osobna zmiana w cudzych plikach
 * zasiewowych, przy których równolegle pracują inne tory; naprawa jednego wiersza z czterech
 * bratnich byłaby gorsza niż spójny, opisany dług.
 *
 * SKUTEK DLA UŻYTKOWNIKA (do przekazania torowi Wnioski/Grafik): `GET /leave/:id` oraz
 * `GET /grafik/demands/:id` zwrócą 400 dla KAŻDEGO z tych rekordów, więc podgląd szczegółów wniosku
 * z demo i szczegółów zapotrzebowania są niedostępne dokładnie tak, jak było na `/analiza`.
 *
 * Wpis jest celowo JAWNY i wąski — para (plik, tabela). Każdy NOWY plik, tabela lub moduł, który
 * złamie kontrakt, przewraca test zamiast po cichu dołączyć do długu.
 */
const KNOWN_ID_DEBT: ReadonlyArray<{ file: string; table: string; ids: string }> = [
  { file: 'seed-dataset-2026.sql', table: 'shift_demands', ids: "'ds26-' || md5(...)" },
  { file: 'seed-dataset-2026.sql', table: 'leave_requests', ids: "'ds26-' || md5(...)" },
  { file: 'seed-demo-m2-modules.sql', table: 'leave_requests', ids: "'lr-demo-*'" },
]

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

function isKnownDebt(entry: SeedId): boolean {
  return KNOWN_ID_DEBT.some((d) => d.file === entry.file && d.table === entry.table)
}

/** Klucz kontraktowy, który NIE jest stałym UUID-em: albo zły literał, albo wyrażenie SQL. */
function breaksContract(entry: SeedId): boolean {
  return entry.literal === null || !UUID_RE.test(entry.literal)
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

  it('żaden klucz w tabeli walidowanej ParseUUIDPipe nie łamie kontraktu (poza opisanym długiem)', () => {
    const offenders = contractIds.filter((entry) => breaksContract(entry) && !isKnownDebt(entry))

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

  it('lista uznanego długu jest aktualna — każdy jej wpis nadal opisuje realne naruszenie', () => {
    // Zapobiega gniciu ulg: gdy tor Wnioski/Grafik naprawi swoje id, wpis trzeba usunąć, a nie
    // zostawić jako trwałą dziurę w guardzie.
    const stale = KNOWN_ID_DEBT.filter(
      (debt) =>
        !contractIds.some(
          (entry) => entry.file === debt.file && entry.table === debt.table && breaksContract(entry),
        ),
    )
    expect(stale.map((debt) => `${debt.file} -> ${debt.table} (${debt.ids})`)).toEqual([])
  })

  it('kontrakt HTTP nadal wymaga UUID — inaczej ten zasiew wymaga ponownej decyzji', () => {
    // Powód istnienia całego pliku. Jeśli ktoś zdejmie ParseUUIDPipe, ten test przypomni, że stałe
    // UUID-y w zasiewie były konsekwencją kontraktu, a nie ozdobnikiem.
    const controller = readFileSync(CONTROLLER_PATH, 'utf8')
    expect(controller).toMatch(/@Get\('employee\/:id'\)/)
    expect(controller).toMatch(/@Param\('id',\s*ParseUUIDPipe\)/)
  })
})
