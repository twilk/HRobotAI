import { ForbiddenException, Injectable } from '@nestjs/common'
import type { TenantClient, TenantPrisma } from '@hrobot/db'
import { LeaveStatus } from '@hrobot/shared'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import { windowMinutes } from '../ai-grafik/week-range.util.js'
import {
  businessDaysBetween,
  businessDaysInRange,
  dayKey,
  daysInclusive,
  median,
  monthBuckets,
  monthKey,
  ratio,
  round,
  weekKey,
  type AnalitykRange,
} from './analityk.range.js'
import { wykryjAnomalie, type Anomalia } from './analityk.anomalie.js'

/** The acting user projected from the JWT + IP (identical shape to `LeaveActor`/`AccessActor`). */
export interface AnalitykActor {
  userId: string
  roles: string[]
  ipAddress: string
}

/**
 * The units an answer is computed over: `null` means "every unit in the tenant" (a GLOBAL HR/ADMIN
 * actor with no `unitId` filter); an array is an explicit allow-list already intersected with the
 * caller's RBAC scope.
 */
export type UnitScope = string[] | null

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Statutory annual leave entitlement in working days. The tenant schema models NO leave-balance
 * table, so the module cannot read a per-employee entitlement; it applies the higher of the two
 * Polish Kodeks pracy art. 154 §1 rates (26 days, ≥10 years of seniority) uniformly. Employees on the
 * 20-day rate will therefore show an OVERSTATED remaining balance — disclosed in
 * {@link AnalitykMeta.uwagi} rather than presented as an exact figure.
 */
export const WYMIAR_URLOPU_DNI = 26

/**
 * `LeaveRequest.type` is free text (schema comment: "URLOP_WYPOCZYNKOWY, URLOP_NA_ZADANIE, …"). Only
 * types under this prefix draw down the annual entitlement — sick leave (L4/CHOROBOWE) and
 * compassionate leave do not, so they must never reduce a leave balance even though they DO count as
 * absence in {@link AnalitykService.absencje}.
 */
const URLOP_TYPE_PREFIX = 'URLOP'

/** Remaining-balance threshold (working days) above which unused leave is flagged as at-risk. */
const PROG_RYZYKA_PRZEPADNIECIA = 10

/** Month (1-based) from which the at-risk flag activates — Q4, when the year-end deadline is real. */
const MIESIAC_RYZYKA = 10

/** Buckets the remaining-balance histogram is rendered from. */
const SALDO_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0', min: Number.NEGATIVE_INFINITY, max: 0 },
  { label: '1-5', min: 1, max: 5 },
  { label: '6-10', min: 6, max: 10 },
  { label: '11-15', min: 11, max: 15 },
  { label: '16-20', min: 16, max: 20 },
  { label: '21+', min: 21, max: Number.POSITIVE_INFINITY },
]

// --- result shapes --------------------------------------------------------------------------------

/** Echo of what a figure was computed over + the honest caveats that apply to it. */
export interface AnalitykMeta {
  od: string
  do: string
  /** `null` = the whole tenant (GLOBAL actor); otherwise the units actually aggregated. */
  unitIds: string[] | null
  /** Mon–Fri days in the range (the per-employee working-day denominator). */
  dniRobocze: number
  /** Caveats a UI must surface next to the numbers — never silently swallowed. */
  uwagi: string[]
}

export interface UnitBreakdown {
  unitId: string
  nazwa: string
  liczba: number
}

export interface ZatrudnienieResult {
  meta: AnalitykMeta
  stanNaKoniec: number
  stanNaPoczatek: number
  przyjecia: number
  odejscia: number
  /** Net change over the range (`przyjecia - odejscia`). */
  zmiana: number
  /** `odejscia / średni stan` — `null` when there is nobody to rotate. */
  rotacja: number | null
  wgJednostek: UnitBreakdown[]
  /** Employees with at least one shift in the range, grouped by the location they worked at. */
  wgLokalizacji: UnitBreakdown[]
  dynamika: { miesiac: string; przyjecia: number; odejscia: number }[]
}

export interface AbsencjeResult {
  meta: AnalitykMeta
  /** Working days lost to APPROVED leave inside the range. */
  dniNieobecnosci: number
  /** `dniRobocze × stan zatrudnienia` — the denominator of {@link wskaznik}. */
  dniRoboczeLacznie: number
  /** Absence rate 0..1, or `null` when the denominator is 0. */
  wskaznik: number | null
  wgTypu: { typ: string; dni: number; udzial: number | null }[]
  wgJednostek: { unitId: string; nazwa: string; dni: number; dniRobocze: number; wskaznik: number | null }[]
}

export interface CzasPracyResult {
  meta: AnalitykMeta
  sumaGodzin: number
  liczbaZmian: number
  /** Distinct (employee, day) pairs actually worked — the denominator of {@link sredniaDzienna}. */
  osobodni: number
  /** Average hours per worked employee-day, or `null` when nothing was worked. */
  sredniaDzienna: number | null
  /** Contractual norm (`etat × 8h` per working day) for the employee-weeks that contain shifts. */
  normaGodzin: number
  /** Hours above the weekly norm, summed per employee-week (never netted against deficits). */
  nadgodziny: number
  /** Hours below the weekly norm, summed per employee-week. */
  niedobor: number
  wgJednostek: { unitId: string; nazwa: string; godziny: number; nadgodziny: number }[]
  topNadgodziny: { employeeId: string; unitId: string; nadgodziny: number }[]
}

export interface UrlopyResult {
  meta: AnalitykMeta
  /** Calendar year the balances are computed for (the year `do` falls in). */
  rok: number
  wymiarDni: number
  liczbaPracownikow: number
  wykorzystaneDni: number
  /** `wykorzystaneDni / (wymiar × liczbaPracownikow)`, or `null` with no employees in scope. */
  wskaznikWykorzystania: number | null
  srednieSaldo: number | null
  rozkladSalda: { przedzial: string; liczba: number }[]
  ryzykoPrzepadniecia: { employeeId: string; unitId: string; saldo: number; wykorzystane: number }[]
}

export interface WnioskiResult {
  meta: AnalitykMeta
  zlozone: number
  /** Requests still PENDING at the end of the range (regardless of when they were filed). */
  wToku: number
  zaakceptowane: number
  odrzucone: number
  anulowane: number
  /** `odrzucone / (zaakceptowane + odrzucone)` — `null` when nothing was decided. */
  odsetekOdrzucen: number | null
  /** Median hours from filing to decision, or `null` when nothing was decided in the range. */
  medianaGodzinDoDecyzji: number | null
  wgTypu: { typ: string; liczba: number }[]
  /** Approval queues, worst first: which unit's approver has the longest / oldest backlog. */
  waskieGardla: {
    unitId: string
    nazwa: string
    /** The unit's manager (the approver accountable for the queue), `null` when unassigned. */
    managerUserId: string | null
    wToku: number
    najstarszyWiekDni: number
  }[]
  czasDecyzjiWgDecydenta: { decydentUserId: string; liczbaDecyzji: number; medianaGodzin: number | null }[]
}

export interface PodsumowanieResult {
  meta: AnalitykMeta
  zatrudnienie: ZatrudnienieResult
  absencje: AbsencjeResult
  czasPracy: CzasPracyResult
  urlopy: UrlopyResult
  wnioski: WnioskiResult
}

/** Minimal employee projection every aggregate scopes on — IDs + non-PII attributes only. */
interface ScopedEmployee {
  id: string
  unitId: string
  hiredAt: Date
  userId: string | null
  etat: unknown
  user: { active: boolean } | null
}

/**
 * Analityk HR (M3) — READ-ONLY workforce analytics over the tenant's own operational tables. Every
 * figure is a real Prisma aggregation; the module writes nothing, owns no schema, and adds no
 * columns.
 *
 * RBAC mirrors `LeaveService`/`CostService`: HR + ADMIN_KLIENTA (`isGlobal`) see the whole tenant, a
 * MANAGER only the unit(s) they manage (`managedUnitIds`), and a plain PRACOWNIK never reaches this
 * service at all — the controller's `@Roles` gate rejects them with a 403 before any query runs.
 * `resolveScope` intersects an explicit `unitId` filter with the caller's scope, so a MANAGER asking
 * for a foreign unit gets a 403 rather than that unit's data.
 *
 * RODO: results carry IDs and numbers ONLY — no name, PESEL, address or any other employee PII ever
 * enters a response, matching the `LEAVE_SELECT` allowlist convention. A UI enriches names from the
 * roster endpoint separately.
 *
 * DATA-SOURCE DECISIONS (no schema change was made for this module — see `uwagi` on every response):
 *  - **Working time** is derived from `Shift` (the realized roster), using the exact overnight/zero
 *    window semantics of `ai-grafik/week-range.util.ts#windowMinutes` that `CostService` also uses.
 *    There is no punch-clock/attendance table in the tenant schema.
 *  - **Departures** are read from the append-only `audit_log` (`action = 'user.deactivated'`), since
 *    `Employee` has no termination date and rows are never deleted.
 *  - **Leave balances** apply the flat statutory {@link WYMIAR_URLOPU_DNI}; there is no
 *    per-employee entitlement table.
 *  - **Working-day denominators** are Mon–Fri; the schema carries no public-holiday calendar.
 */
@Injectable()
export class AnalitykService {
  /**
   * Intersect the caller's RBAC scope with an optional `unitId` filter.
   *
   * GLOBAL (HR/ADMIN): `null` (whole tenant) or `[unitId]` when narrowed — no DB lookup needed.
   * MANAGER: their `managedUnitIds`; a `unitId` outside that set is a 403, and a manager who manages
   * nothing is a 403 too (rather than being silently shown an empty tenant-wide report).
   */
  async resolveScope(client: TenantClient, actor: AnalitykActor, unitId?: string): Promise<UnitScope> {
    if (isGlobal(actor.roles)) return unitId ? [unitId] : null

    const managed = await managedUnitIds(client, actor.userId)
    if (managed.length === 0) {
      throw new ForbiddenException('Brak jednostek w Twoim zakresie — analityka niedostępna')
    }
    if (unitId) {
      if (!managed.includes(unitId)) {
        throw new ForbiddenException('Jednostka jest poza Twoim zakresem')
      }
      return [unitId]
    }
    return managed
  }

  /** Prisma `where` fragment scoping an `Employee` relation to the resolved units. */
  private employeeScope(scope: UnitScope): TenantPrisma.EmployeeWhereInput {
    return scope === null ? {} : { unitId: { in: scope } }
  }

  private buildMeta(range: AnalitykRange, scope: UnitScope, uwagi: string[]): AnalitykMeta {
    return {
      od: dayKey(range.from),
      do: dayKey(range.toIncl),
      unitIds: scope,
      dniRobocze: businessDaysBetween(range.from, range.toIncl),
      uwagi: ['Dni robocze liczone jako pn–pt; schemat nie zawiera kalendarza świąt.', ...uwagi],
    }
  }

  /** Employees on the books by the end of the range, with the attributes every aggregate needs. */
  private async scopedEmployees(client: TenantClient, scope: UnitScope, range: AnalitykRange): Promise<ScopedEmployee[]> {
    return (await client.employee.findMany({
      where: { ...this.employeeScope(scope), hiredAt: { lt: range.toExcl } },
      select: {
        id: true,
        unitId: true,
        hiredAt: true,
        userId: true,
        etat: true,
        user: { select: { active: true } },
      },
    })) as unknown as ScopedEmployee[]
  }

  /** `unitId → name` for the units in scope (or every unit when the actor is unscoped). */
  private async unitNames(client: TenantClient, scope: UnitScope): Promise<Map<string, string>> {
    const units = await client.organizationalUnit.findMany({
      where: scope === null ? {} : { id: { in: scope } },
      select: { id: true, name: true },
    })
    return new Map(units.map((u) => [u.id, u.name]))
  }

  /** An employee counts toward the CURRENT headcount unless their login was deactivated. */
  private static isActive(e: ScopedEmployee): boolean {
    return e.user === null || e.user.active
  }

  // --- 1. Stan zatrudnienia -----------------------------------------------------------------------

  /**
   * Headcount, its split by unit and by worked location, and the hire/departure dynamics over the
   * range. Departures come from `audit_log` (`user.deactivated`), then get re-scoped through
   * `Employee.userId` so a manager's report never counts another unit's departure.
   */
  async zatrudnienie(client: TenantClient, scope: UnitScope, range: AnalitykRange): Promise<ZatrudnienieResult> {
    const [employees, names, deactivations, shifts] = await Promise.all([
      this.scopedEmployees(client, scope, range),
      this.unitNames(client, scope),
      client.auditLog.findMany({
        where: {
          action: 'user.deactivated',
          entityType: 'User',
          createdAt: { gte: range.from, lt: range.toExcl },
        },
        select: { entityId: true, createdAt: true },
      }),
      client.shift.findMany({
        where: { date: { gte: range.from, lt: range.toExcl }, employee: this.employeeScope(scope) },
        select: { employeeId: true, lokalizacjaId: true, lokalizacja: { select: { name: true } } },
      }),
    ])

    // Re-scope departures: audit rows are tenant-wide, so keep only those whose User maps to an
    // employee inside the caller's scope.
    const userIdToEmployee = new Map(employees.filter((e) => e.userId).map((e) => [e.userId as string, e]))
    const scopedDepartures = deactivations.filter((d) => userIdToEmployee.has(d.entityId))

    const active = employees.filter((e) => AnalitykService.isActive(e))
    const stanNaKoniec = active.length
    const przyjecia = employees.filter((e) => e.hiredAt.getTime() >= range.from.getTime()).length
    const odejscia = scopedDepartures.length
    const stanNaPoczatek = Math.max(0, stanNaKoniec - przyjecia + odejscia)

    const wgJednostekMap = new Map<string, number>()
    for (const e of active) wgJednostekMap.set(e.unitId, (wgJednostekMap.get(e.unitId) ?? 0) + 1)
    const wgJednostek = [...wgJednostekMap.entries()]
      .map(([unitId, liczba]) => ({ unitId, nazwa: names.get(unitId) ?? unitId, liczba }))
      .sort((a, b) => b.liczba - a.liczba || a.nazwa.localeCompare(b.nazwa, 'pl'))

    // Location split is DISTINCT EMPLOYEES per location (a person working 20 shifts counts once).
    const perLocation = new Map<string, { nazwa: string; employees: Set<string> }>()
    for (const s of shifts) {
      const entry = perLocation.get(s.lokalizacjaId) ?? { nazwa: s.lokalizacja?.name ?? s.lokalizacjaId, employees: new Set<string>() }
      entry.employees.add(s.employeeId)
      perLocation.set(s.lokalizacjaId, entry)
    }
    const wgLokalizacji = [...perLocation.entries()]
      .map(([unitId, v]) => ({ unitId, nazwa: v.nazwa, liczba: v.employees.size }))
      .sort((a, b) => b.liczba - a.liczba || a.nazwa.localeCompare(b.nazwa, 'pl'))

    const dynamika = monthBuckets(range).map((miesiac) => ({
      miesiac,
      przyjecia: employees.filter((e) => e.hiredAt.getTime() >= range.from.getTime() && monthKey(e.hiredAt) === miesiac).length,
      odejscia: scopedDepartures.filter((d) => monthKey(d.createdAt) === miesiac).length,
    }))

    const sredniStan = (stanNaPoczatek + stanNaKoniec) / 2

    return {
      meta: this.buildMeta(range, scope, [
        'Odejścia pochodzą z dziennika audytu (dezaktywacja konta) — schemat nie ma daty ustania zatrudnienia.',
      ]),
      stanNaKoniec,
      stanNaPoczatek,
      przyjecia,
      odejscia,
      zmiana: przyjecia - odejscia,
      rotacja: ratio(odejscia, sredniStan),
      wgJednostek,
      wgLokalizacji,
      dynamika,
    }
  }

  // --- 2. Absencje --------------------------------------------------------------------------------

  /**
   * Absence rate = APPROVED-leave working days ÷ (working days in range × headcount), tenant-wide and
   * per unit, plus a split by leave type. Only APPROVED leave counts — a PENDING request is not an
   * absence yet. Leave days outside the range are clipped, so a leave straddling the boundary
   * contributes only the days that actually fall inside it.
   */
  async absencje(client: TenantClient, scope: UnitScope, range: AnalitykRange): Promise<AbsencjeResult> {
    const [employees, names, leaves] = await Promise.all([
      this.scopedEmployees(client, scope, range),
      this.unitNames(client, scope),
      client.leaveRequest.findMany({
        where: {
          status: LeaveStatus.APPROVED,
          startDate: { lt: range.toExcl },
          endDate: { gte: range.from },
          employee: this.employeeScope(scope),
        },
        select: {
          employeeId: true,
          startDate: true,
          endDate: true,
          type: true,
          employee: { select: { unitId: true } },
        },
      }),
    ])

    const dniRobocze = businessDaysBetween(range.from, range.toIncl)
    const active = employees.filter((e) => AnalitykService.isActive(e))
    const dniRoboczeLacznie = dniRobocze * active.length

    const perType = new Map<string, number>()
    const perUnitDni = new Map<string, number>()
    let dniNieobecnosci = 0

    for (const leave of leaves) {
      const dni = businessDaysInRange(leave.startDate, leave.endDate, range)
      if (dni === 0) continue
      dniNieobecnosci += dni
      perType.set(leave.type, (perType.get(leave.type) ?? 0) + dni)
      const unitId = leave.employee?.unitId
      if (unitId) perUnitDni.set(unitId, (perUnitDni.get(unitId) ?? 0) + dni)
    }

    const perUnitHeadcount = new Map<string, number>()
    for (const e of active) perUnitHeadcount.set(e.unitId, (perUnitHeadcount.get(e.unitId) ?? 0) + 1)

    const wgTypu = [...perType.entries()]
      .map(([typ, dni]) => ({ typ, dni, udzial: ratio(dni, dniNieobecnosci) }))
      .sort((a, b) => b.dni - a.dni || a.typ.localeCompare(b.typ, 'pl'))

    const wgJednostek = [...new Set([...perUnitHeadcount.keys(), ...perUnitDni.keys()])]
      .map((unitId) => {
        const unitDniRobocze = dniRobocze * (perUnitHeadcount.get(unitId) ?? 0)
        const dni = perUnitDni.get(unitId) ?? 0
        return { unitId, nazwa: names.get(unitId) ?? unitId, dni, dniRobocze: unitDniRobocze, wskaznik: ratio(dni, unitDniRobocze) }
      })
      .sort((a, b) => (b.wskaznik ?? -1) - (a.wskaznik ?? -1) || a.nazwa.localeCompare(b.nazwa, 'pl'))

    return {
      meta: this.buildMeta(range, scope, ['Liczone wyłącznie wnioski ZATWIERDZONE; dni poza zakresem są przycinane.']),
      dniNieobecnosci,
      dniRoboczeLacznie,
      wskaznik: ratio(dniNieobecnosci, dniRoboczeLacznie),
      wgTypu,
      wgJednostek,
    }
  }

  // --- 3. Czas pracy ------------------------------------------------------------------------------

  /**
   * Worked hours from the realized roster (`Shift`), with overtime/deficit measured per EMPLOYEE-WEEK
   * against the contractual norm (`etat × 8h × working days of that week inside the range`).
   *
   * Only employee-weeks that CONTAIN at least one shift are evaluated: an employee who was on leave
   * for a whole week must not surface as a 40h "deficit" — that is an absence (see
   * {@link absencje}), not under-worked time. Overtime and deficit are summed separately and never
   * netted against each other, so a week of +5h and a week of −5h reports as 5h overtime AND 5h
   * deficit, not as zero.
   */
  async czasPracy(client: TenantClient, scope: UnitScope, range: AnalitykRange): Promise<CzasPracyResult> {
    const [shifts, names] = await Promise.all([
      client.shift.findMany({
        where: { date: { gte: range.from, lt: range.toExcl }, employee: this.employeeScope(scope) },
        select: {
          employeeId: true,
          date: true,
          start: true,
          end: true,
          employee: { select: { unitId: true, etat: true } },
        },
      }),
      this.unitNames(client, scope),
    ])

    const osobodni = new Set<string>()
    const perUnitGodziny = new Map<string, number>()
    const perEmployeeWeek = new Map<string, { employeeId: string; unitId: string; etat: number; weekStart: string; godziny: number }>()
    let sumaGodzin = 0

    for (const s of shifts) {
      const godziny = windowMinutes(s.start, s.end) / 60
      sumaGodzin += godziny
      osobodni.add(`${s.employeeId}|${dayKey(s.date)}`)

      const unitId = s.employee?.unitId ?? ''
      perUnitGodziny.set(unitId, (perUnitGodziny.get(unitId) ?? 0) + godziny)

      const week = weekKey(s.date)
      const key = `${s.employeeId}|${week}`
      const bucket = perEmployeeWeek.get(key) ?? {
        employeeId: s.employeeId,
        unitId,
        etat: Number(s.employee?.etat ?? 1),
        weekStart: week,
        godziny: 0,
      }
      bucket.godziny += godziny
      perEmployeeWeek.set(key, bucket)
    }

    const perEmployeeNadgodziny = new Map<string, { employeeId: string; unitId: string; nadgodziny: number }>()
    const perUnitNadgodziny = new Map<string, number>()
    let normaGodzin = 0
    let nadgodziny = 0
    let niedobor = 0

    for (const bucket of perEmployeeWeek.values()) {
      const weekStart = new Date(`${bucket.weekStart}T00:00:00.000Z`)
      const weekEnd = new Date(weekStart.getTime() + 6 * MS_PER_DAY)
      // Norm counts only the part of the week that lies inside the analysed range, so a range
      // starting mid-week never charges a full 40h norm against 2 days of data.
      const normaDni = businessDaysInRange(weekStart, weekEnd, range)
      const norma = bucket.etat * 8 * normaDni
      normaGodzin += norma

      const nad = Math.max(0, bucket.godziny - norma)
      const nied = Math.max(0, norma - bucket.godziny)
      nadgodziny += nad
      niedobor += nied

      if (nad > 0) {
        const entry = perEmployeeNadgodziny.get(bucket.employeeId) ?? { employeeId: bucket.employeeId, unitId: bucket.unitId, nadgodziny: 0 }
        entry.nadgodziny += nad
        perEmployeeNadgodziny.set(bucket.employeeId, entry)
        perUnitNadgodziny.set(bucket.unitId, (perUnitNadgodziny.get(bucket.unitId) ?? 0) + nad)
      }
    }

    const wgJednostek = [...perUnitGodziny.entries()]
      .map(([unitId, godziny]) => ({
        unitId,
        nazwa: names.get(unitId) ?? unitId,
        godziny: round(godziny),
        nadgodziny: round(perUnitNadgodziny.get(unitId) ?? 0),
      }))
      .sort((a, b) => b.godziny - a.godziny || a.nazwa.localeCompare(b.nazwa, 'pl'))

    const topNadgodziny = [...perEmployeeNadgodziny.values()]
      .map((e) => ({ ...e, nadgodziny: round(e.nadgodziny) }))
      .sort((a, b) => b.nadgodziny - a.nadgodziny || a.employeeId.localeCompare(b.employeeId))
      .slice(0, 10)

    return {
      meta: this.buildMeta(range, scope, [
        'Czas pracy liczony z grafiku (zmiany), nie z rejestracji wejść/wyjść — schemat nie ma tabeli obecności.',
        'Norma = etat × 8h × dni robocze tygodnia w zakresie; oceniane tylko tygodnie ze zmianami.',
      ]),
      sumaGodzin: round(sumaGodzin),
      liczbaZmian: shifts.length,
      osobodni: osobodni.size,
      sredniaDzienna: osobodni.size > 0 ? round(sumaGodzin / osobodni.size) : null,
      normaGodzin: round(normaGodzin),
      nadgodziny: round(nadgodziny),
      niedobor: round(niedobor),
      wgJednostek,
      topNadgodziny,
    }
  }

  // --- 4. Wykorzystanie urlopów -------------------------------------------------------------------

  /**
   * Annual leave utilization for the calendar year `do` falls in: used working days per employee
   * against the flat statutory {@link WYMIAR_URLOPU_DNI}, the distribution of remaining balances, and
   * the at-risk list (a high balance late in the year, when the days can still be forfeited).
   *
   * Only `URLOP*` leave types draw the entitlement down — sick and compassionate leave are absences
   * but not holiday, so counting them here would understate everyone's remaining balance.
   */
  async urlopy(client: TenantClient, scope: UnitScope, range: AnalitykRange): Promise<UrlopyResult> {
    const rok = range.toIncl.getUTCFullYear()
    const yearStart = new Date(Date.UTC(rok, 0, 1))
    const yearEnd = new Date(Date.UTC(rok, 11, 31))
    const yearRange = { from: yearStart, toIncl: yearEnd }

    const [employees, leaves] = await Promise.all([
      this.scopedEmployees(client, scope, range),
      client.leaveRequest.findMany({
        where: {
          status: LeaveStatus.APPROVED,
          type: { startsWith: URLOP_TYPE_PREFIX },
          startDate: { lte: yearEnd },
          endDate: { gte: yearStart },
          employee: this.employeeScope(scope),
        },
        select: { employeeId: true, startDate: true, endDate: true },
      }),
    ])

    const active = employees.filter((e) => AnalitykService.isActive(e))
    const usedByEmployee = new Map<string, number>()
    for (const leave of leaves) {
      const dni = businessDaysInRange(leave.startDate, leave.endDate, yearRange)
      if (dni > 0) usedByEmployee.set(leave.employeeId, (usedByEmployee.get(leave.employeeId) ?? 0) + dni)
    }

    const salda = active.map((e) => {
      const wykorzystane = usedByEmployee.get(e.id) ?? 0
      return { employeeId: e.id, unitId: e.unitId, wykorzystane, saldo: WYMIAR_URLOPU_DNI - wykorzystane }
    })

    const wykorzystaneDni = salda.reduce((sum, s) => sum + s.wykorzystane, 0)
    const rozkladSalda = SALDO_BUCKETS.map((b) => ({
      przedzial: b.label,
      liczba: salda.filter((s) => s.saldo >= b.min && s.saldo <= b.max).length,
    }))

    // The at-risk flag only fires in Q4: a 20-day balance in March is normal, in November it is a
    // forfeiture risk. Outside Q4 the list stays empty rather than crying wolf all year.
    const wQ4 = range.toIncl.getUTCMonth() + 1 >= MIESIAC_RYZYKA
    const ryzykoPrzepadniecia = wQ4
      ? salda
          .filter((s) => s.saldo >= PROG_RYZYKA_PRZEPADNIECIA)
          .sort((a, b) => b.saldo - a.saldo || a.employeeId.localeCompare(b.employeeId))
          .map((s) => ({ employeeId: s.employeeId, unitId: s.unitId, saldo: s.saldo, wykorzystane: s.wykorzystane }))
      : []

    return {
      meta: this.buildMeta(range, scope, [
        `Wymiar urlopu przyjęty ryczałtowo (${WYMIAR_URLOPU_DNI} dni, KP art. 154) — schemat nie przechowuje indywidualnych wymiarów.`,
        `Ryzyko przepadnięcia sygnalizowane od saldo ≥ ${PROG_RYZYKA_PRZEPADNIECIA} dni w IV kwartale.`,
      ]),
      rok,
      wymiarDni: WYMIAR_URLOPU_DNI,
      liczbaPracownikow: active.length,
      wykorzystaneDni,
      wskaznikWykorzystania: ratio(wykorzystaneDni, WYMIAR_URLOPU_DNI * active.length),
      srednieSaldo: active.length > 0 ? round(salda.reduce((sum, s) => sum + s.saldo, 0) / active.length) : null,
      rozkladSalda,
      ryzykoPrzepadniecia,
    }
  }

  // --- 5. Wnioski ---------------------------------------------------------------------------------

  /**
   * Leave-request throughput: volume filed in the range, the open backlog at its end, rejection share,
   * median time-to-decision, and the approval bottlenecks.
   *
   * A pending request has no assignee column, so a queue is attributed to the unit of the requesting
   * employee and to that unit's `managerUserId` — the approver actually accountable for it. Backlog
   * age is measured against the END of the range (`do`), which keeps the figure deterministic and
   * reproducible instead of drifting with wall-clock time.
   */
  async wnioski(client: TenantClient, scope: UnitScope, range: AnalitykRange): Promise<WnioskiResult> {
    const [zlozoneRows, pendingRows, units] = await Promise.all([
      client.leaveRequest.findMany({
        where: { createdAt: { gte: range.from, lt: range.toExcl }, employee: this.employeeScope(scope) },
        select: { id: true, status: true, type: true, createdAt: true, decidedAt: true, decidedByUserId: true },
      }),
      client.leaveRequest.findMany({
        where: { status: LeaveStatus.PENDING, createdAt: { lt: range.toExcl }, employee: this.employeeScope(scope) },
        select: { id: true, createdAt: true, employee: { select: { unitId: true } } },
      }),
      client.organizationalUnit.findMany({
        where: scope === null ? {} : { id: { in: scope } },
        select: { id: true, name: true, managerUserId: true },
      }),
    ])

    const zaakceptowane = zlozoneRows.filter((r) => r.status === LeaveStatus.APPROVED).length
    const odrzucone = zlozoneRows.filter((r) => r.status === LeaveStatus.REJECTED).length
    const anulowane = zlozoneRows.filter((r) => r.status === LeaveStatus.CANCELLED).length

    const decisionHours: number[] = []
    const perDecider = new Map<string, number[]>()
    for (const r of zlozoneRows) {
      if (!r.decidedAt) continue
      const hours = (r.decidedAt.getTime() - r.createdAt.getTime()) / (60 * 60 * 1000)
      if (hours < 0) continue // defensive: a clock-skewed row must not drag the median negative
      decisionHours.push(hours)
      if (r.decidedByUserId) {
        const list = perDecider.get(r.decidedByUserId) ?? []
        list.push(hours)
        perDecider.set(r.decidedByUserId, list)
      }
    }

    const perType = new Map<string, number>()
    for (const r of zlozoneRows) perType.set(r.type, (perType.get(r.type) ?? 0) + 1)

    const unitMeta = new Map(units.map((u) => [u.id, u]))
    const perUnitQueue = new Map<string, { wToku: number; najstarszy: number }>()
    for (const p of pendingRows) {
      const unitId = p.employee?.unitId
      if (!unitId) continue
      const wiekDni = Math.max(0, Math.floor((range.toIncl.getTime() - p.createdAt.getTime()) / MS_PER_DAY))
      const entry = perUnitQueue.get(unitId) ?? { wToku: 0, najstarszy: 0 }
      entry.wToku += 1
      entry.najstarszy = Math.max(entry.najstarszy, wiekDni)
      perUnitQueue.set(unitId, entry)
    }

    const waskieGardla = [...perUnitQueue.entries()]
      .map(([unitId, q]) => ({
        unitId,
        nazwa: unitMeta.get(unitId)?.name ?? unitId,
        managerUserId: unitMeta.get(unitId)?.managerUserId ?? null,
        wToku: q.wToku,
        najstarszyWiekDni: q.najstarszy,
      }))
      .sort((a, b) => b.wToku - a.wToku || b.najstarszyWiekDni - a.najstarszyWiekDni || a.nazwa.localeCompare(b.nazwa, 'pl'))

    const czasDecyzjiWgDecydenta = [...perDecider.entries()]
      .map(([decydentUserId, hours]) => {
        const m = median(hours)
        return { decydentUserId, liczbaDecyzji: hours.length, medianaGodzin: m === null ? null : round(m, 1) }
      })
      .sort((a, b) => (b.medianaGodzin ?? -1) - (a.medianaGodzin ?? -1) || a.decydentUserId.localeCompare(b.decydentUserId))

    const mediana = median(decisionHours)

    return {
      meta: this.buildMeta(range, scope, [
        'Wiek zaległych wniosków liczony względem końca zakresu ("do"), nie względem bieżącej daty.',
        'Kolejka akceptacji przypisana do kierownika jednostki wnioskodawcy — wniosek nie ma pola akceptującego.',
      ]),
      zlozone: zlozoneRows.length,
      wToku: pendingRows.length,
      zaakceptowane,
      odrzucone,
      anulowane,
      odsetekOdrzucen: ratio(odrzucone, zaakceptowane + odrzucone),
      medianaGodzinDoDecyzji: mediana === null ? null : round(mediana, 1),
      wgTypu: [...perType.entries()]
        .map(([typ, liczba]) => ({ typ, liczba }))
        .sort((a, b) => b.liczba - a.liczba || a.typ.localeCompare(b.typ, 'pl')),
      waskieGardla,
      czasDecyzjiWgDecydenta,
    }
  }

  // --- aggregate ------------------------------------------------------------------------------------

  /**
   * All five aggregates in one round trip — what the Analityk screen loads on mount. The five run
   * concurrently and share no state; they deliberately repeat a few small scoping queries rather than
   * threading a shared pre-fetch through every method, which keeps each aggregate independently
   * callable (and independently testable) at its own endpoint.
   */
  async podsumowanie(client: TenantClient, scope: UnitScope, range: AnalitykRange): Promise<PodsumowanieResult> {
    const [zatrudnienie, absencje, czasPracy, urlopy, wnioski] = await Promise.all([
      this.zatrudnienie(client, scope, range),
      this.absencje(client, scope, range),
      this.czasPracy(client, scope, range),
      this.urlopy(client, scope, range),
      this.wnioski(client, scope, range),
    ])
    return { meta: zatrudnienie.meta, zatrudnienie, absencje, czasPracy, urlopy, wnioski }
  }

  /**
   * Period-over-period comparison of the headline KPIs: the same aggregates re-run over the
   * IMMEDIATELY PRECEDING window of equal length, with the delta for each. Lets the UI answer "is
   * absence up or down?" without the caller doing date arithmetic.
   */
  async porownanie(
    client: TenantClient,
    scope: UnitScope,
    range: AnalitykRange,
  ): Promise<{ biezacy: PorownanieKpi; poprzedni: PorownanieKpi; zmiana: PorownanieKpi }> {
    const dlugoscDni = daysInclusive(range.from, range.toIncl)
    const prevToIncl = new Date(range.from.getTime() - MS_PER_DAY)
    const prevFrom = new Date(prevToIncl.getTime() - (dlugoscDni - 1) * MS_PER_DAY)
    const prevRange: AnalitykRange = { from: prevFrom, toIncl: prevToIncl, toExcl: range.from }

    const [biezacy, poprzedni] = await Promise.all([this.kpi(client, scope, range), this.kpi(client, scope, prevRange)])

    return {
      biezacy,
      poprzedni,
      zmiana: {
        od: biezacy.od,
        do: biezacy.do,
        stanZatrudnienia: biezacy.stanZatrudnienia - poprzedni.stanZatrudnienia,
        wskaznikAbsencji: deltaOrNull(biezacy.wskaznikAbsencji, poprzedni.wskaznikAbsencji, 4),
        sumaGodzin: round(biezacy.sumaGodzin - poprzedni.sumaGodzin),
        nadgodziny: round(biezacy.nadgodziny - poprzedni.nadgodziny),
        wnioskiWToku: biezacy.wnioskiWToku - poprzedni.wnioskiWToku,
        medianaGodzinDoDecyzji: deltaOrNull(biezacy.medianaGodzinDoDecyzji, poprzedni.medianaGodzinDoDecyzji, 1),
      },
    }
  }

  /**
   * Period-over-period comparison PLUS the rules that fired on it ({@link wykryjAnomalie}) — an
   * absence spike, an overtime surge, a growing approval queue, decisions slowing down, or headcount
   * dropping. Pure observation: the module flags what a human should look at and never acts on it.
   */
  async anomalie(
    client: TenantClient,
    scope: UnitScope,
    range: AnalitykRange,
  ): Promise<{ biezacy: PorownanieKpi; poprzedni: PorownanieKpi; anomalie: Anomalia[] }> {
    const { biezacy, poprzedni } = await this.porownanie(client, scope, range)
    return { biezacy, poprzedni, anomalie: wykryjAnomalie(biezacy, poprzedni) }
  }

  /** The headline KPI strip for one range — the subset {@link porownanie} compares. */
  private async kpi(client: TenantClient, scope: UnitScope, range: AnalitykRange): Promise<PorownanieKpi> {
    const [zatrudnienie, absencje, czasPracy, wnioski] = await Promise.all([
      this.zatrudnienie(client, scope, range),
      this.absencje(client, scope, range),
      this.czasPracy(client, scope, range),
      this.wnioski(client, scope, range),
    ])
    return {
      od: dayKey(range.from),
      do: dayKey(range.toIncl),
      stanZatrudnienia: zatrudnienie.stanNaKoniec,
      wskaznikAbsencji: absencje.wskaznik,
      sumaGodzin: czasPracy.sumaGodzin,
      nadgodziny: czasPracy.nadgodziny,
      wnioskiWToku: wnioski.wToku,
      medianaGodzinDoDecyzji: wnioski.medianaGodzinDoDecyzji,
    }
  }
}

/** Headline KPIs compared period-over-period by {@link AnalitykService.porownanie}. */
export interface PorownanieKpi {
  od: string
  do: string
  stanZatrudnienia: number
  wskaznikAbsencji: number | null
  sumaGodzin: number
  nadgodziny: number
  wnioskiWToku: number
  medianaGodzinDoDecyzji: number | null
}

/** `a - b`, but `null` when EITHER side is unknown — an unknown minus a number is not a delta. */
function deltaOrNull(a: number | null, b: number | null, digits: number): number | null {
  if (a === null || b === null) return null
  return round(a - b, digits)
}
