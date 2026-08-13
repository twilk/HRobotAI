/**
 * `dokumenty` — DEMO legal/config constants for the Moduł Dokumenty engine (M3).
 *
 * ┌───────────────────────────────────────────────────────────────────────────────────────────┐
 * │ WARTOŚCI POGLĄDOWE DEMO — DO POTWIERDZENIA 4Mobility / radca prawny / specjalista kadr-płac. │
 * └───────────────────────────────────────────────────────────────────────────────────────────┘
 * Every value in this module is a *demo placeholder* keyed to the SPEC §3.3 / §11 human-gate
 * table. NONE of it is authoritative for real payroll or ZUS filing. The engine (rcp/overtime/
 * kedu util) reads norms and rules EXCLUSIVELY from here (never hardcoded in the functions), so a
 * single confirmed change from 4Mobility flows to the whole module — mirroring how strategic-brain
 * reads weights from `PerformanceConfig` rather than from code.
 *
 * SPEC anchors: §3.3 (config), §3.1/§3.2 (norms/night/holiday), §3.4 (KEDU/RSA map), §6 (retention).
 */

// =================================================================================================
// Leave categories (LeaveRequest.type → kategoria). SPEC §3.1 / §14 pkt 5.
// =================================================================================================

/**
 * Structural category of an absence, derived from the (free-form string) `LeaveRequest.type`.
 * Modelled as an enum-like union so the engine excludes/classifies absences by STRUCTURE, not by
 * ad-hoc string matching (wzór strategic-brain M12). Unknown/unmapped types fall back to `INNE`.
 */
export type LeaveCategory =
  | 'URLOP_WYPOCZYNKOWY' // paid annual leave
  | 'URLOP_NA_ZADANIE' // on-demand leave (art. 167² KP)
  | 'URLOP_BEZPLATNY' // unpaid leave
  | 'URLOP_OKOLICZNOSCIOWY' // occasional leave
  | 'ZWOLNIENIE_LEKARSKIE' // sick leave (L4)
  | 'OPIEKA' // childcare / family-care leave
  | 'MACIERZYNSKI_RODZICIELSKI' // maternity / parental
  | 'INNE' // fallback for anything unmapped — surfaced, never silently dropped

/** Night-work window (SPEC §3.2 / §11 pkt 3 — 22:00–06:00 „poglądowo"). */
export type NightWindow = {
  /** Local (Europe/Warsaw) hour at which the night window opens (inclusive). */
  startHour: number
  /** Local (Europe/Warsaw) hour at which the night window closes (exclusive). */
  endHour: number
}

/** Overtime premium multipliers (SPEC §3.2 / §11 pkt 2 — art. 151¹ KP „poglądowo"). */
export type OvertimeRates = {
  /** Daily overtime (>8h/day) premium — +50%. */
  daily50: number
  /** Weekly-average / night / Sunday / holiday premium — +100%. */
  weekly100: number
}

/** DEMO płatnik (payer) header used to populate the KEDU/DRA block (SPEC §3.4). Synthetic. */
export type PlatnikDemo = {
  nip: string
  nazwa: string
  /** Kod terminu przesyłania (demo placeholder). */
  kodTerminu: string
}

export type DokumentyConfig = {
  /** Norma dobowa (daily norm) in minutes — 8h. SPEC §11 pkt 1. */
  normaDobowaMin: number
  /** Przeciętna norma tygodniowa (average weekly norm) in minutes — 40h. SPEC §11 pkt 1. */
  normaTygodnMin: number
  /** Okres rozliczeniowy (settlement period) in months — weekly OT settled at its end. SPEC §11 pkt 1. */
  okresRozliczeniowyMiesiace: number
  /** Night-work window (Europe/Warsaw). SPEC §11 pkt 3. */
  poraNocna: NightWindow
  /**
   * DEMO Polish public-holiday table as explicit `YYYY-MM-DD` strings (Europe/Warsaw calendar).
   * SPEC §3.2 / §11 pkt 3 — a small, jawnie-oznaczona demo array (2026), NOT a full movable-feast
   * engine. Real holiday calendar/rozkład dni wolnych = 🔴 DECYZJA-4M.
   */
  swietaPl: readonly string[]
  /** Overtime premium multipliers. SPEC §11 pkt 2. */
  stawkiNadgodzin: OvertimeRates
  /**
   * Annual overtime WARNING threshold in minutes — 150h/rok (art. 151 §3 KP „poglądowo"). This is
   * a WARNING only; the engine NEVER blocks on it (SPEC §3.2, art. 22 RODO — decyzja = człowiek).
   */
  limitRocznyNadgodzinMin: number
  /**
   * `LeaveRequest.type` (free-form string) → structural {@link LeaveCategory}. SPEC §14 pkt 5.
   * Documented, exhaustive-by-fallback: unmapped strings resolve to `INNE` via
   * {@link leaveCategoryOf}, never silently dropped.
   */
  leaveTypeToCategory: Readonly<Record<string, LeaveCategory>>
  /**
   * {@link LeaveCategory} → demo RSA break code (kod świadczenia/przerwy w KEDU-RSA). SPEC §3.4.
   * Codes are POGLĄDOWE — real ZUS RSA codes = 🔴 DECYZJA-4M / radca.
   */
  rsaKodPrzerwy: Readonly<Record<LeaveCategory, string>>
  /** Retention horizon in months added to `periodEnd` (SPEC §6 — 10 lat „poglądowo"). */
  retencjaMiesiace: number
  /** Demo KEDU schema version label — marks output as non-authoritative. SPEC §3.4 / §15. */
  keduWersjaSchematu: string
  /** DEMO synthetic płatnik header for the DRA block. SPEC §3.4. */
  platnik: PlatnikDemo
}

/**
 * The one and only demo config object. Passed as `cfg` into every engine function.
 *
 * WARTOŚCI POGLĄDOWE DEMO — DO POTWIERDZENIA 4Mobility/radca. Do not treat as production.
 */
export const DEMO_CONFIG: DokumentyConfig = {
  // 8h/dobę — wartość poglądowa demo, do potwierdzenia 4Mobility/radca.
  normaDobowaMin: 480,
  // 40h/tydzień (przeciętnie) — wartość poglądowa demo, do potwierdzenia 4Mobility/radca.
  normaTygodnMin: 2400,
  // 1-miesięczny okres rozliczeniowy — wartość poglądowa demo, do potwierdzenia 4Mobility/radca.
  okresRozliczeniowyMiesiace: 1,
  // Pora nocna 22:00–06:00 — wartość poglądowa demo, do potwierdzenia 4Mobility/radca.
  poraNocna: { startHour: 22, endHour: 6 },
  // Tablica świąt PL 2026 — wartości poglądowe demo, do potwierdzenia 4Mobility/radca.
  // (Wielkanoc 2026-04-05; Poniedziałek Wielkanocny 04-06; Boże Ciało 06-04; Zesłanie Ducha 05-24.)
  swietaPl: [
    '2026-01-01', // Nowy Rok
    '2026-01-06', // Trzech Króli
    '2026-04-05', // Wielkanoc
    '2026-04-06', // Poniedziałek Wielkanocny
    '2026-05-01', // Święto Pracy
    '2026-05-03', // Święto Konstytucji 3 Maja
    '2026-05-24', // Zesłanie Ducha Świętego
    '2026-06-04', // Boże Ciało
    '2026-08-15', // Wniebowzięcie NMP
    '2026-11-01', // Wszystkich Świętych
    '2026-11-11', // Narodowe Święto Niepodległości
    '2026-12-25', // Boże Narodzenie (1. dzień)
    '2026-12-26', // Boże Narodzenie (2. dzień)
  ],
  // Dodatki 50% (doba) / 100% (tydzień, noc, niedziela, święto) — poglądowo, do potwierdzenia radcy.
  stawkiNadgodzin: { daily50: 0.5, weekly100: 1.0 },
  // Limit roczny 150h = 9000 min — TYLKO ostrzeżenie, nigdy blokada. Wartość poglądowa demo.
  limitRocznyNadgodzinMin: 150 * 60,
  // Mapa typów urlopów — wartości poglądowe demo, do potwierdzenia 4Mobility/radca.
  leaveTypeToCategory: {
    URLOP_WYPOCZYNKOWY: 'URLOP_WYPOCZYNKOWY',
    URLOP_NA_ZADANIE: 'URLOP_NA_ZADANIE',
    URLOP_BEZPLATNY: 'URLOP_BEZPLATNY',
    URLOP_OKOLICZNOSCIOWY: 'URLOP_OKOLICZNOSCIOWY',
    L4: 'ZWOLNIENIE_LEKARSKIE',
    ZWOLNIENIE_LEKARSKIE: 'ZWOLNIENIE_LEKARSKIE',
    OPIEKA: 'OPIEKA',
    URLOP_MACIERZYNSKI: 'MACIERZYNSKI_RODZICIELSKI',
    URLOP_RODZICIELSKI: 'MACIERZYNSKI_RODZICIELSKI',
  },
  // Kody przerw RSA — wartości poglądowe demo, do potwierdzenia 4Mobility/radca.
  rsaKodPrzerwy: {
    URLOP_WYPOCZYNKOWY: '151', // urlop wypoczynkowy (poglądowo)
    URLOP_NA_ZADANIE: '151',
    URLOP_BEZPLATNY: '111', // urlop bezpłatny (poglądowo)
    URLOP_OKOLICZNOSCIOWY: '152',
    ZWOLNIENIE_LEKARSKIE: '331', // niezdolność do pracy (poglądowo)
    OPIEKA: '321', // opieka nad dzieckiem/członkiem rodziny (poglądowo)
    MACIERZYNSKI_RODZICIELSKI: '311', // zasiłek macierzyński (poglądowo)
    INNE: '000', // nieokreślone — wymaga klasyfikacji kadr
  },
  // Retencja 10 lat = 120 mies. — wartość poglądowa demo (dokumentacja pracownicza), do potwierdzenia.
  retencjaMiesiace: 120,
  // Wersja schematu KEDU — poglądowa, plik oznaczony jako demo (nie do wysyłki).
  keduWersjaSchematu: 'KEDU 5.4 (WERSJA POGLĄDOWA DEMO — NIE DO WYSYŁKI ZUS)',
  // Płatnik syntetyczny (demo) — nagłówek DRA.
  platnik: {
    nip: '0000000000',
    nazwa: '4Mobility (DANE SYNTETYCZNE — WERSJA DEMO)',
    kodTerminu: '3',
  },
}

/**
 * Structural lookup: `LeaveRequest.type` → {@link LeaveCategory}. Unmapped/blank types resolve to
 * `INNE` (surfaced downstream, never silently dropped). Kept as a helper so callers never string-
 * match inline. Match is case-insensitive on the trimmed type to tolerate seed/import noise.
 */
export function leaveCategoryOf(
  type: string | null | undefined,
  cfg: DokumentyConfig = DEMO_CONFIG,
): LeaveCategory {
  if (!type) return 'INNE'
  const key = type.trim().toUpperCase()
  return cfg.leaveTypeToCategory[key] ?? 'INNE'
}
