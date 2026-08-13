/**
 * `dokumenty` KEDU mapper — PURE structural mapping only (SPEC §3.4 / DOK-9). NO Prisma, NO
 * EncryptionService, NO I/O. The renderer (out of scope for D2) turns {@link KeduModel} into XML/PDF.
 *
 * PESEL discipline (SPEC §6): PESEL is passed IN as an argument on {@link KeduEmployeeInput}
 * (decrypted upstream in the service, controlled + audited). This function NEVER decrypts, fetches,
 * or derives a PESEL — it only copies the value it was handed into the RCA/RSA blocks that formally
 * require it. Everything the model produces is flagged `demo: true` and carries a poglądowa schema
 * version, so it can never be mistaken for a filing-ready document (SPEC §0 / §15 — no ZUS wysyłka).
 *
 * Blocks (poglądowe struktury ⚖️ art./ZUS — do potwierdzenia 4Mobility/radca):
 *  - DRA — deklaracja rozliczeniowa (płatnik header + period + headcount).
 *  - RCA — imienny raport miesięczny per ubezpieczony (needs PESEL); demo carries worked/OT minutes.
 *  - RSA — raport o przerwach, one block per contiguous absence run from the ewidencja.
 */

import { periodDayKeys, type EwidencjaRow, type Period } from './rcp.util.js'
import type { OvertimeSummary } from './overtime.util.js'
import { type DokumentyConfig, type LeaveCategory } from './dokumenty.config.js'

// =================================================================================================
// Types
// =================================================================================================

/** One insured person's identity for KEDU. PESEL is passed in (decrypted upstream — SPEC §6). */
export type KeduEmployeeInput = {
  employeeId: string
  /** Decrypted PESEL — supplied by the caller, never derived here. */
  pesel: string
  imie: string
  nazwisko: string
}

/** DRA — deklaracja rozliczeniowa (płatnik header). */
export type KeduDraBlock = {
  platnikNip: string
  platnikNazwa: string
  kodTerminu: string
  /** Period boundaries as `YYYY-MM-DD`. */
  okresOd: string
  okresDo: string
  liczbaUbezpieczonych: number
}

/** RCA — imienny raport miesięczny (per ubezpieczony). */
export type KeduRcaBlock = {
  employeeId: string
  pesel: string
  imie: string
  nazwisko: string
  /** Total worked minutes in the period (numeric days only). */
  workedMinutes: number
  ot50Min: number
  ot100Min: number
}

/** RSA — raport o przerwach (one contiguous absence run). */
export type KeduRsaBlock = {
  employeeId: string
  pesel: string
  category: LeaveCategory
  /** Demo RSA break code from cfg. */
  kod: string
  /** Absence run boundaries as `YYYY-MM-DD`. */
  od: string
  do: string
}

/** The full KEDU structural model — always demo-flagged. */
export type KeduModel = {
  demo: true
  wersjaSchematu: string
  dra: KeduDraBlock
  rca: KeduRcaBlock[]
  rsa: KeduRsaBlock[]
}

// =================================================================================================
// buildKeduModel
// =================================================================================================

/** Sum of numeric worked minutes across an employee's ewidencja rows (null days excluded). */
function sumWorked(rows: EwidencjaRow[]): number {
  return rows.reduce((sum, r) => sum + (r.workedMinutes ?? 0), 0)
}

/**
 * Collapse an employee's ewidencja rows into contiguous absence runs. Rows are taken in their given
 * order (the ewidencja is day-ordered by construction). A run breaks when the category changes or a
 * non-absence day interrupts it. Emits `{ category, od, do }` per run.
 */
function absenceRuns(rows: EwidencjaRow[]): { category: LeaveCategory; od: string; do: string }[] {
  const runs: { category: LeaveCategory; od: string; do: string }[] = []
  let cur: { category: LeaveCategory; od: string; do: string } | null = null
  for (const r of rows) {
    if (r.absence) {
      if (cur && cur.category === r.absence) {
        cur.do = r.date
      } else {
        if (cur) runs.push(cur)
        cur = { category: r.absence, od: r.date, do: r.date }
      }
    } else if (cur) {
      runs.push(cur)
      cur = null
    }
  }
  if (cur) runs.push(cur)
  return runs
}

/**
 * Build the demo KEDU structural model from already-computed ewidencja + overtime, keyed per
 * employee. `ewidencja[employeeId]` / `overtime[employeeId]` are the outputs of the RCP/overtime
 * engines. Pure: no Prisma, no decryption — PESEL flows straight from {@link KeduEmployeeInput}.
 */
export function buildKeduModel(
  employees: KeduEmployeeInput[],
  period: Period,
  ewidencja: Record<string, EwidencjaRow[]>,
  overtime: Record<string, OvertimeSummary>,
  cfg: DokumentyConfig,
): KeduModel {
  const days = periodDayKeys(period)
  const okresOd = days[0] ?? ''
  const okresDo = days[days.length - 1] ?? ''

  const rca: KeduRcaBlock[] = employees.map((emp) => {
    const rows = ewidencja[emp.employeeId] ?? []
    const ot = overtime[emp.employeeId]
    return {
      employeeId: emp.employeeId,
      pesel: emp.pesel,
      imie: emp.imie,
      nazwisko: emp.nazwisko,
      workedMinutes: sumWorked(rows),
      ot50Min: ot?.ot50Min ?? 0,
      ot100Min: ot?.ot100Min ?? 0,
    }
  })

  const rsa: KeduRsaBlock[] = []
  for (const emp of employees) {
    const rows = ewidencja[emp.employeeId] ?? []
    for (const run of absenceRuns(rows)) {
      rsa.push({
        employeeId: emp.employeeId,
        pesel: emp.pesel,
        category: run.category,
        kod: cfg.rsaKodPrzerwy[run.category],
        od: run.od,
        do: run.do,
      })
    }
  }

  return {
    demo: true,
    wersjaSchematu: cfg.keduWersjaSchematu,
    dra: {
      platnikNip: cfg.platnik.nip,
      platnikNazwa: cfg.platnik.nazwa,
      kodTerminu: cfg.platnik.kodTerminu,
      okresOd,
      okresDo,
      liczbaUbezpieczonych: employees.length,
    },
    rca,
    rsa,
  }
}
