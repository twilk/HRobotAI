import { ForbiddenException, Injectable } from '@nestjs/common'
import type { TenantClient, TenantPrisma } from '@hrobot/db'
import { LeaveStatus } from '@hrobot/shared'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import { drawsDownAnnualEntitlement } from '../common/leave-type.js'
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
  startOfUtcDay,
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
 * Statutory annual leave entitlement in working days, applied as a FLAT rate.
 *
 * The tenant schema models no leave-balance table, so no per-employee entitlement can be read, and
 * it cannot be derived either: art. 155 KP counts service with PREVIOUS employers plus an education
 * credit (up to 8 years for a university degree), while `Employee.hiredAt` only knows service HERE.
 * Guessing from `hiredAt` would be worse than a flat rate, because it would look precise.
 *
 * The rate is the LOWER of the two art. 154 §1 figures (20 days, under 10 years of service) rather
 * than the higher one. Both choices are wrong for somebody; this one is wrong in the CAUTIOUS
 * direction. At 26 days every employee actually entitled to 20 carried a balance overstated by six
 * days, which pushed the whole cohort a bucket or two up the histogram and filled
 * {@link UrlopyResult.ryzykoPrzepadniecia} — a list meant to be acted on, by name — with people
 * whose real balance was 4 days. A named list of false alarms is worse than a shorter one: it stops
 * being read. At 20 days the error runs the other way and the list can MISS somebody on the 26-day
 * rate, which is stated in {@link AnalitykMeta.uwagi} alongside the figure.
 */
export const WYMIAR_URLOPU_DNI = 20

/** The `user.deactivated` audit action departures and the historical headcount are reconstructed from. */
const AKCJA_DEZAKTYWACJI = 'user.deactivated'

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
  /** Headcount RECONSTRUCTED as of the end of the range (see {@link AnalitykService.naStanie}). */
  stanNaKoniec: number
  /** Headcount reconstructed as of the first day of the range — comparable with {@link stanNaKoniec}. */
  stanNaPoczatek: number
  przyjecia: number
  /**
   * Account deactivations inside the range, re-scoped to the caller's units. `null` (UNKNOWN) when
   * the figure is not measurable at all — see {@link AnalitykService.zatrudnienie}. Never a
   * falsely-reassuring `0`.
   */
  odejscia: number | null
  /** Net change over the range (`przyjecia - odejscia`); `null` when `odejscia` is unknown. */
  zmiana: number | null
  /**
   * `odejscia / średni stan` FOR THIS RANGE — a raw period rate, deliberately NOT annualized, so
   * 33% over 14 days is 33% over 14 days and not a yearly figure. `null` when unknown or when there
   * is nobody to rotate.
   */
  rotacjaWOkresie: number | null
  wgJednostek: UnitBreakdown[]
  /** Employees with at least one shift in the range, grouped by the location they worked at. */
  wgLokalizacji: UnitBreakdown[]
  dynamika: { miesiac: string; przyjecia: number; odejscia: number | null }[]
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
  /**
   * Rostered hours ABOVE the WEEKLY norm, summed per employee-week (never netted against deficits).
   *
   * NOT "nadgodziny" in the Kodeks pracy sense, and deliberately not named so: this is scheduled
   * time from `Shift`, with no punch-clock, no unpaid-break deduction (art. 141) and — decisively —
   * no DAILY norm (art. 151 §1). Three 12h days inside one week are 36h ≤ 40h and therefore ZERO
   * here, while KP counts 12 hours of overtime. Use it as a roster-planning signal, never as a
   * payroll or compliance figure.
   */
  nadwyzkaPonadNorme: number
  /** Rostered hours BELOW the weekly norm, summed per employee-week. Same caveats as above. */
  niedoborDoNormy: number
  wgJednostek: { unitId: string; nazwa: string; godziny: number; nadwyzka: number }[]
  topNadwyzka: { employeeId: string; unitId: string; nadwyzka: number }[]
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
  /**
   * Requests open AS OF THE END OF THE RANGE, reconstructed from `createdAt`/`decidedAt` rather than
   * read off the current status — otherwise a backlog the team has since cleared would still be
   * counted, and the figure could only ever grow between two windows.
   */
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

  /** An employee counts toward the CURRENT headcount unless their login is deactivated right now. */
  private static isActive(e: ScopedEmployee): boolean {
    return e.user === null || e.user.active
  }

  /**
   * Was this employee ON THE BOOKS at instant `at`? The question every period-over-period figure
   * actually needs, and the one the module used to answer wrongly.
   *
   * The previous implementation read the CURRENT `User.active` flag for both windows, which made
   * `stanNaKoniec` monotonically non-decreasing in `at` (the only varying term was `hiredAt < at`):
   * a tenant that lost half its staff could never show a fall, and the `SPADEK_ZATRUDNIENIA` rule —
   * which needs a drop of ≥ 2 — was unreachable dead code in production.
   *
   * The state is therefore reconstructed from the append-only audit trail:
   *  - hired before `at` (a person not yet hired is nobody's headcount);
   *  - the account is STILL ON today → on the books throughout. A deactivation in the log was
   *    evidently reversed, and reactivation is not audited (`users.service.ts` logs only
   *    `user.invited` / `user.deactivated` / `user.reconciled`), so its timestamp is unknowable —
   *    we decline to invent a departure the person demonstrably came back from;
   *  - the account is OFF today, WITH a `user.deactivated` row → off the books from that row's
   *    timestamp onwards, on the books before it;
   *  - the account is OFF today with NO audit row → off for the whole history. We know it is off, we
   *    do not know since when, and guessing "employed" would fabricate a departure later.
   */
  private static naStanie(e: ScopedEmployee, at: Date, dezaktywacje: Map<string, Date>): boolean {
    if (e.hiredAt.getTime() >= at.getTime()) return false
    if (AnalitykService.isActive(e)) return true
    const wylaczone = e.userId ? dezaktywacje.get(e.userId) : undefined
    return wylaczone !== undefined && wylaczone.getTime() >= at.getTime()
  }

  /**
   * The WHOLE `user.deactivated` history, deliberately UNBOUNDED in time. Both ends of a range need
   * it: the headcount at `od` depends on what happened before the range, and — less obviously — an
   * account switched off AFTER the range must still count as employed inside it. A query cut at
   * `toExcl` would hide that row, leaving an employee who is inactive today with no visible record
   * and striking them off the books retroactively.
   */
  private async dezaktywacje(client: TenantClient): Promise<{ entityId: string; createdAt: Date }[]> {
    return client.auditLog.findMany({
      where: { action: AKCJA_DEZAKTYWACJI, entityType: 'User' },
      select: { entityId: true, createdAt: true },
    })
  }

  /**
   * `userId → the LATEST deactivation` for the employees in scope. Audit rows are tenant-wide, so
   * rows belonging to a user outside the caller's scope are dropped here rather than leaking into a
   * manager's figures.
   */
  private static ostatniaDezaktywacja(
    employees: ScopedEmployee[],
    rows: { entityId: string; createdAt: Date }[],
  ): Map<string, Date> {
    const wZakresie = new Set(employees.filter((e) => e.userId).map((e) => e.userId as string))
    const latest = new Map<string, Date>()
    for (const row of rows) {
      if (!wZakresie.has(row.entityId)) continue
      const previous = latest.get(row.entityId)
      if (!previous || previous.getTime() < row.createdAt.getTime()) latest.set(row.entityId, row.createdAt)
    }
    return latest
  }

  // --- 1. Stan zatrudnienia -----------------------------------------------------------------------

  /**
   * Headcount at the start and at the end of the range, its split by unit and by worked location,
   * and the hire/departure dynamics. Departures come from `audit_log` (`user.deactivated`), then get
   * re-scoped through `Employee.userId` so a manager's report never counts another unit's departure.
   *
   * TWO HONESTY RULES apply here and are surfaced in `meta.uwagi`:
   *  1. Both headcounts are RECONSTRUCTED as of their instant ({@link naStanie}), so the comparison
   *     between two windows can genuinely go down.
   *  2. When not a single employee in scope carries a `userId`, the audit trail cannot be joined to
   *     anyone and departures are structurally UNMEASURABLE. That case returns `null`, not `0` — the
   *     canonical seed produces exactly this shape (`SeedEmployee` has no `userId`), and a "Rotacja
   *     0%" tile there would be falsely reassuring rather than merely imprecise.
   */
  async zatrudnienie(client: TenantClient, scope: UnitScope, range: AnalitykRange): Promise<ZatrudnienieResult> {
    const [employees, names, deactivations, shifts] = await Promise.all([
      this.scopedEmployees(client, scope, range),
      this.unitNames(client, scope),
      this.dezaktywacje(client),
      client.shift.findMany({
        where: { date: { gte: range.from, lt: range.toExcl }, employee: this.employeeScope(scope) },
        select: { employeeId: true, lokalizacjaId: true, lokalizacja: { select: { name: true } } },
      }),
    ])

    // Re-scope departures: audit rows are tenant-wide, so keep only those whose User maps to an
    // employee inside the caller's scope.
    const userIdsWScope = new Set(employees.filter((e) => e.userId).map((e) => e.userId as string))
    const scopedDeactivations = deactivations.filter((d) => userIdsWScope.has(d.entityId))
    const ostatniaDezaktywacja = AnalitykService.ostatniaDezaktywacja(employees, deactivations)

    const naKoniec = employees.filter((e) => AnalitykService.naStanie(e, range.toExcl, ostatniaDezaktywacja))
    const stanNaKoniec = naKoniec.length
    const stanNaPoczatek = employees.filter((e) => AnalitykService.naStanie(e, range.from, ostatniaDezaktywacja)).length
    const przyjecia = employees.filter((e) => e.hiredAt.getTime() >= range.from.getTime()).length

    // Departures are only measurable when at least one employee record is joined to a user account.
    // An empty scope is a different thing entirely: there is nobody to depart, so 0 is the truth.
    const mierzalne = employees.length === 0 || employees.some((e) => e.userId !== null)
    const wZakresie = scopedDeactivations.filter(
      (d) => d.createdAt.getTime() >= range.from.getTime() && d.createdAt.getTime() < range.toExcl.getTime(),
    )
    const odejscia = mierzalne ? wZakresie.length : null

    const wgJednostekMap = new Map<string, number>()
    for (const e of naKoniec) wgJednostekMap.set(e.unitId, (wgJednostekMap.get(e.unitId) ?? 0) + 1)
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
      odejscia: mierzalne ? wZakresie.filter((d) => monthKey(d.createdAt) === miesiac).length : null,
    }))

    const sredniStan = (stanNaPoczatek + stanNaKoniec) / 2

    return {
      meta: this.buildMeta(range, scope, [
        'Odejścia pochodzą z dziennika audytu (dezaktywacja konta) — schemat nie ma daty ustania zatrudnienia.',
        'Stan zatrudnienia odtwarzany na dany moment z dziennika audytu, a nie z bieżącej flagi konta — dzięki temu porównanie okresów może wykazać spadek.',
        'Rotacja podana ZA WSKAZANY OKRES (nie w ujęciu rocznym) — nie porównuj jej wprost ze wskaźnikiem rocznym.',
        ...(odejscia === null
          ? ['Odejścia i rotacja NIEZNANE: żadna kartoteka pracownika w tym zakresie nie ma powiązanego konta użytkownika, więc dziennika audytu nie da się do nikogo przypiąć.']
          : []),
      ]),
      stanNaKoniec,
      stanNaPoczatek,
      przyjecia,
      odejscia,
      zmiana: odejscia === null ? null : przyjecia - odejscia,
      rotacjaWOkresie: odejscia === null ? null : ratio(odejscia, sredniStan),
      wgJednostek,
      wgLokalizacji,
      dynamika,
    }
  }

  // --- 2. Absencje --------------------------------------------------------------------------------

  /**
   * Absence rate = APPROVED-leave working days ÷ working days of EMPLOYMENT EXPOSURE, tenant-wide and
   * per unit, plus a split by leave type. Only APPROVED leave counts — a PENDING request is not an
   * absence yet.
   *
   * NUMERATOR AND DENOMINATOR ARE THE SAME POPULATION, PRO-RATED. They used not to be: the numerator
   * took every leave row of the unit (no `active` filter, no `hiredAt` filter) while the denominator
   * was `dni robocze × liczba OBECNIE aktywnych`. Two consequences, in opposite directions:
   *  - somebody deactivated after the period ended still contributed their leave days to the top of
   *    the fraction but had vanished from the bottom → rate overstated;
   *  - somebody hired on the last day of the period contributed a FULL set of working days to the
   *    bottom → rate understated.
   *
   * Each employee now contributes only the working days for which they were actually on the books
   * inside the range — from `max(od, hiredAt)` to the earlier of `do` and their deactivation — and
   * their leave is clipped to that same interval. An employee whose account is off today with no
   * audit row contributes to NEITHER side: we know they are gone, not since when, and inventing an
   * exposure window would bias the rate in an unknown direction.
   *
   * STILL APPROXIMATE, and disclosed as such: working days are Mon–Fri rather than the employee's own
   * shift pattern (this product models weekend shift work), and exposure is not weighted by `etat`,
   * so a half-time employee contributes as many working days as a full-time one.
   */
  async absencje(client: TenantClient, scope: UnitScope, range: AnalitykRange): Promise<AbsencjeResult> {
    const [employees, names, leaves, deactivations] = await Promise.all([
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
      this.dezaktywacje(client),
    ])

    const dniRobocze = businessDaysBetween(range.from, range.toIncl)
    const ostatniaDezaktywacja = AnalitykService.ostatniaDezaktywacja(employees, deactivations)

    // The exposure window per employee: the slice of the range they were actually on the books for.
    const ekspozycja = new Map<string, { unitId: string; from: Date; toIncl: Date; dni: number }>()
    for (const e of employees) {
      const hired = startOfUtcDay(e.hiredAt)
      const from = hired.getTime() > range.from.getTime() ? hired : range.from
      let toIncl = range.toIncl
      if (!AnalitykService.isActive(e)) {
        const wylaczone = e.userId ? ostatniaDezaktywacja.get(e.userId) : undefined
        if (wylaczone === undefined) continue // gone, since when unknown → neither side of the ratio
        const ostatniDzien = startOfUtcDay(wylaczone)
        if (ostatniDzien.getTime() < toIncl.getTime()) toIncl = ostatniDzien
      }
      if (toIncl.getTime() < from.getTime()) continue
      ekspozycja.set(e.id, { unitId: e.unitId, from, toIncl, dni: businessDaysBetween(from, toIncl) })
    }

    const dniRoboczeLacznie = [...ekspozycja.values()].reduce((sum, e) => sum + e.dni, 0)

    const perType = new Map<string, number>()
    const perUnitDni = new Map<string, number>()
    let dniNieobecnosci = 0

    for (const leave of leaves) {
      // A leave row whose employee is not in the population cannot count — that asymmetry is exactly
      // what made the two sides of the fraction describe different groups of people.
      const okno = ekspozycja.get(leave.employeeId)
      if (!okno) continue
      const dni = businessDaysInRange(leave.startDate, leave.endDate, okno)
      if (dni === 0) continue
      dniNieobecnosci += dni
      perType.set(leave.type, (perType.get(leave.type) ?? 0) + dni)
      perUnitDni.set(okno.unitId, (perUnitDni.get(okno.unitId) ?? 0) + dni)
    }

    const perUnitDniRobocze = new Map<string, number>()
    for (const e of ekspozycja.values()) perUnitDniRobocze.set(e.unitId, (perUnitDniRobocze.get(e.unitId) ?? 0) + e.dni)

    const wgTypu = [...perType.entries()]
      .map(([typ, dni]) => ({ typ, dni, udzial: ratio(dni, dniNieobecnosci) }))
      .sort((a, b) => b.dni - a.dni || a.typ.localeCompare(b.typ, 'pl'))

    const wgJednostek = [...new Set([...perUnitDniRobocze.keys(), ...perUnitDni.keys()])]
      .map((unitId) => {
        const unitDniRobocze = perUnitDniRobocze.get(unitId) ?? 0
        const dni = perUnitDni.get(unitId) ?? 0
        return { unitId, nazwa: names.get(unitId) ?? unitId, dni, dniRobocze: unitDniRobocze, wskaznik: ratio(dni, unitDniRobocze) }
      })
      .sort((a, b) => (b.wskaznik ?? -1) - (a.wskaznik ?? -1) || a.nazwa.localeCompare(b.nazwa, 'pl'))

    return {
      meta: this.buildMeta(range, scope, [
        'Liczone wyłącznie wnioski ZATWIERDZONE; dni poza zakresem są przycinane.',
        `Mianownik to dni robocze FAKTYCZNEGO zatrudnienia w zakresie (proporcjonalnie do daty zatrudnienia i dezaktywacji konta), a nie ${dniRobocze} dni × liczba osób.`,
        'Mianownik nie jest ważony etatem, a dni robocze to pn–pt, nie indywidualny rozkład zmian — dla pracy weekendowej wskaźnik jest przybliżeniem.',
      ]),
      dniNieobecnosci,
      dniRoboczeLacznie,
      wskaznik: ratio(dniNieobecnosci, dniRoboczeLacznie),
      wgTypu,
      wgJednostek,
    }
  }

  // --- 3. Czas pracy ------------------------------------------------------------------------------

  /**
   * ROSTERED hours from `Shift`, with the surplus/shortfall measured per EMPLOYEE-WEEK against the
   * contractual weekly norm (`etat × 8h × working days of that week inside the range`).
   *
   * READ THE NAMES LITERALLY. The result carries `nadwyzkaPonadNorme`, NOT `nadgodziny`, because
   * this is not overtime in the Kodeks pracy sense and the module must not pretend otherwise:
   *  - the figures are PLANNED time (there is no attendance table), so a no-show, a late start or a
   *    cancelled shift cannot move them;
   *  - no unpaid break is deducted (art. 141 allows up to 60 min), so an 8h window counts as 8h;
   *  - only the WEEKLY norm is applied. Art. 151 §1 also knows a DAILY norm — 12h on each of three
   *    days is 36h ≤ 40h and scores zero here, while KP counts 12 hours of overtime. The figure
   *    therefore systematically UNDERSTATES statutory overtime for shift operations.
   *
   * Only employee-weeks that CONTAIN at least one shift are evaluated: an employee who was on leave
   * for a whole week must not surface as a 40h shortfall — that is an absence (see {@link absencje}),
   * not under-worked time. Surplus and shortfall are summed separately and never netted against each
   * other, so a week of +5h and a week of −5h reports as 5h surplus AND 5h shortfall, not as zero.
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

    const perEmployeeNadwyzka = new Map<string, { employeeId: string; unitId: string; nadwyzka: number }>()
    const perUnitNadwyzka = new Map<string, number>()
    let normaGodzin = 0
    let nadwyzkaPonadNorme = 0
    let niedoborDoNormy = 0

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
      nadwyzkaPonadNorme += nad
      niedoborDoNormy += nied

      if (nad > 0) {
        const entry = perEmployeeNadwyzka.get(bucket.employeeId) ?? { employeeId: bucket.employeeId, unitId: bucket.unitId, nadwyzka: 0 }
        entry.nadwyzka += nad
        perEmployeeNadwyzka.set(bucket.employeeId, entry)
        perUnitNadwyzka.set(bucket.unitId, (perUnitNadwyzka.get(bucket.unitId) ?? 0) + nad)
      }
    }

    const wgJednostek = [...perUnitGodziny.entries()]
      .map(([unitId, godziny]) => ({
        unitId,
        nazwa: names.get(unitId) ?? unitId,
        godziny: round(godziny),
        nadwyzka: round(perUnitNadwyzka.get(unitId) ?? 0),
      }))
      .sort((a, b) => b.godziny - a.godziny || a.nazwa.localeCompare(b.nazwa, 'pl'))

    const topNadwyzka = [...perEmployeeNadwyzka.values()]
      .map((e) => ({ ...e, nadwyzka: round(e.nadwyzka) }))
      .sort((a, b) => b.nadwyzka - a.nadwyzka || a.employeeId.localeCompare(b.employeeId))
      .slice(0, 10)

    return {
      meta: this.buildMeta(range, scope, [
        'Czas pracy liczony z grafiku (zmiany), nie z rejestracji wejść/wyjść — schemat nie ma tabeli obecności.',
        'Norma = etat × 8h × dni robocze tygodnia w zakresie; oceniane tylko tygodnie ze zmianami.',
        'To NADWYŻKA PONAD NORMĘ TYGODNIOWĄ z grafiku, a nie nadgodziny w rozumieniu KP: bez normy dobowej (art. 151 §1) i bez odliczenia przerwy niepłatnej (art. 141). Praca 12 h przez 3 dni (36 h/tydz.) daje tu 0, a wg KP 12 h nadgodzin.',
      ]),
      sumaGodzin: round(sumaGodzin),
      liczbaZmian: shifts.length,
      osobodni: osobodni.size,
      sredniaDzienna: osobodni.size > 0 ? round(sumaGodzin / osobodni.size) : null,
      normaGodzin: round(normaGodzin),
      nadwyzkaPonadNorme: round(nadwyzkaPonadNorme),
      niedoborDoNormy: round(niedoborDoNormy),
      wgJednostek,
      topNadwyzka,
    }
  }

  // --- 4. Wykorzystanie urlopów -------------------------------------------------------------------

  /**
   * Annual leave utilization for the calendar year `do` falls in: used working days per employee
   * against the flat statutory {@link WYMIAR_URLOPU_DNI}, the distribution of remaining balances, and
   * the at-risk list (a high balance late in the year, when the days can still be forfeited).
   *
   * WHICH leave draws the entitlement down is decided by the shared `common/leave-type.ts`
   * classifier, IN MEMORY. It used to be a Prisma `startsWith: 'URLOP'` filter, which was wrong in
   * both directions: it swept in `URLOP_BEZPŁATNY` / `URLOP_MACIERZYŃSKI` / `URLOP_RODZICIELSKI` /
   * `URLOP_WYCHOWAWCZY` (none of which consume the art. 154 pool — an employee back from a year of
   * maternity leave would show a deeply negative balance), while being CASE-SENSITIVE on Postgres,
   * so a lower-cased `urlop_wypoczynkowy` was not counted at all. Classifying in memory also keeps
   * this module and `strategic-brain` reading the same row the same way.
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
          startDate: { lte: yearEnd },
          endDate: { gte: yearStart },
          employee: this.employeeScope(scope),
        },
        select: { employeeId: true, startDate: true, endDate: true, type: true },
      }),
    ])

    const active = employees.filter((e) => AnalitykService.isActive(e))
    const usedByEmployee = new Map<string, number>()
    for (const leave of leaves) {
      if (!drawsDownAnnualEntitlement(leave.type)) continue
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
        `Wymiar urlopu przyjęty ryczałtowo (${WYMIAR_URLOPU_DNI} dni, KP art. 154 §1) — schemat nie przechowuje indywidualnych wymiarów, a stażu z art. 155 (poprzedni pracodawcy, zaliczenie za wykształcenie) nie da się z niego wyprowadzić.`,
        'Przyjęto stawkę NIŻSZĄ: dla osób uprawnionych do 26 dni saldo jest zaniżone o 6 dni, więc lista ryzyka przepadnięcia może kogoś POMINĄĆ. Odwrotny błąd (ryczałt 26 dni) zapełniał ją fałszywymi alarmami.',
        `Ryzyko przepadnięcia sygnalizowane od saldo ≥ ${PROG_RYZYKA_PRZEPADNIECIA} dni w IV kwartale.`,
        'Wymiar pomniejszają wyłącznie urlop wypoczynkowy i na żądanie; bezpłatny, macierzyński, rodzicielski i wychowawczy są nieobecnością, ale puli z art. 154 nie konsumują.',
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
   *
   * THE BACKLOG IS RECONSTRUCTED, NOT READ OFF THE CURRENT STATUS. The query used to be
   * `status = PENDING AND createdAt < do`, i.e. "filed before the end of the range and undecided
   * RIGHT NOW" — which describes today, not the end of the window. Combined with an ever-widening
   * `createdAt` bound that made `wToku` monotonically non-decreasing across two windows, so a queue
   * the HR team had just cleared could only ever look flat or worse. `decidedAt` is written on every
   * approve/reject/cancel (`leave.service.ts`), so "open at T" is exactly `createdAt < T AND
   * (decidedAt IS NULL OR decidedAt >= T)`.
   */
  async wnioski(client: TenantClient, scope: UnitScope, range: AnalitykRange): Promise<WnioskiResult> {
    const [zlozoneRows, pendingRows, units] = await Promise.all([
      client.leaveRequest.findMany({
        where: { createdAt: { gte: range.from, lt: range.toExcl }, employee: this.employeeScope(scope) },
        select: { id: true, status: true, type: true, createdAt: true, decidedAt: true, decidedByUserId: true },
      }),
      client.leaveRequest.findMany({
        where: {
          createdAt: { lt: range.toExcl },
          employee: this.employeeScope(scope),
          OR: [
            // Never decided at all — still open, and was open at the end of the range too.
            { status: LeaveStatus.PENDING, decidedAt: null },
            // Decided, but only AFTER the window closed → it was still in the queue back then.
            { decidedAt: { gte: range.toExcl } },
          ],
        },
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
        'Wnioski w toku odtwarzane na koniec zakresu z dat złożenia i decyzji, a nie z bieżącego statusu — rozładowana kolejka faktycznie pokazuje poprawę.',
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
        nadwyzkaPonadNorme: round(biezacy.nadwyzkaPonadNorme - poprzedni.nadwyzkaPonadNorme),
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
      nadwyzkaPonadNorme: czasPracy.nadwyzkaPonadNorme,
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
  /** Rostered hours above the WEEKLY norm — see {@link CzasPracyResult.nadwyzkaPonadNorme}. */
  nadwyzkaPonadNorme: number
  wnioskiWToku: number
  medianaGodzinDoDecyzji: number | null
}

/** `a - b`, but `null` when EITHER side is unknown — an unknown minus a number is not a delta. */
function deltaOrNull(a: number | null, b: number | null, digits: number): number | null {
  if (a === null || b === null) return null
  return round(a - b, digits)
}
