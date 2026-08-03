import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  buildMessage,
} from 'class-validator'

/**
 * Shared grafik DTO constraints [Q2].
 *
 * Two classes of bad input reached the solver unchallenged: a degenerate shift window, and a
 * horizon that does not start on a Monday. Both produce nonsense rather than an error, which is
 * the worst failure mode — the schedule comes back "successful" and wrong.
 */

/** `HH:mm` → minutes since midnight. Assumes the value already passed the HH:mm regex. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * Rejects a ZERO-LENGTH window (`end === start`).
 *
 * Deliberately does NOT require `end > start`: the solver documents `end <= start` as "crossing
 * midnight" and adds 24h (grafik-optimizer/app/solver.py `_abs_window`), so 22:00–06:00 is a
 * legitimate night shift and forbidding it would break 24/7 operations outright.
 *
 * `end === start` falls into that same branch, which silently turns a zero-minute demand into a
 * TWENTY-FOUR HOUR one — no error, just an absurd shift that then drives rest/overlap arithmetic
 * and the cost model. That is the case worth rejecting at the edge.
 */
export function IsNotSameTimeAs(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isNotSameTimeAs',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [relatedPropertyName] = args.constraints as [string]
          const related = (args.object as Record<string, unknown>)[relatedPropertyName]
          // PATCH semantics: if either side is absent there is no pair to compare here.
          if (typeof value !== 'string' || typeof related !== 'string') return true
          return toMinutes(value) !== toMinutes(related)
        },
        defaultMessage: buildMessage(
          () =>
            'end must differ from start — a zero-length window is read as a 24h overnight shift ' +
            '(overnight windows like 22:00-06:00 are allowed)',
          validationOptions,
        ),
      },
    })
  }
}

/**
 * Rejects an ISO date string that is not a real calendar date.
 *
 * The `^\d{4}-\d{2}-\d{2}$` regex the DTOs use happily accepts `2026-13-45`, which only fails
 * later inside the solver's `date.fromisoformat` — as a 500 from a Python service rather than a
 * 400 naming the offending field.
 */
export function IsRealCalendarDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isRealCalendarDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
          const d = new Date(`${value}T00:00:00.000Z`)
          if (Number.isNaN(d.getTime())) return false
          // Round-trip guard: JS would otherwise roll 2026-02-30 forward to 2026-03-02.
          return d.toISOString().slice(0, 10) === value
        },
        defaultMessage: buildMessage(
          (prefix) => `${prefix}must be a real calendar date (YYYY-MM-DD)`,
          validationOptions,
        ),
      },
    })
  }
}

/**
 * Rejects a horizon that does not start on a Monday.
 *
 * Everything downstream assumes it: the solver derives day offsets from `weekStart` and the UI
 * renders a Mon→Sun grid. A Wednesday `weekStart` does not error — it silently shifts the whole
 * week, so demands land on the wrong days and the returned schedule looks plausible but is not
 * the week anyone asked for.
 */
export function IsMonday(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isMonday',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
          const d = new Date(`${value}T00:00:00.000Z`)
          if (Number.isNaN(d.getTime())) return false
          return d.getUTCDay() === 1
        },
        defaultMessage: buildMessage(
          (prefix) => `${prefix}must be a Monday — the horizon is the 7 days starting there`,
          validationOptions,
        ),
      },
    })
  }
}
