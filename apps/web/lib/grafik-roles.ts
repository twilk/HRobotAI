/**
 * Shift roles → colour. One source of truth for the whole app.
 *
 * The colour appears as a 3px bar on the leading edge of a shift chip, and as a swatch in the
 * legend. It is never the only carrier of the information: the role name is spelled out next to it
 * everywhere it is used, so greyscale print and colour blindness lose nothing.
 *
 * Values are existing DESIGN.md tokens — no new hues. `error` is deliberately absent: it stays
 * reserved for failure states, and a job title is not a failure.
 *
 * The bar is an inset box-shadow rather than `border-l-*` on purpose. The chip already sets
 * `border` for its source style (solid = AUTO, dashed = manual); a per-side border colour on top of
 * that shorthand would depend on Tailwind's emission order to win the cascade. A shadow cannot
 * collide with it, and adds no width, so the chip box is unchanged.
 *
 * Both maps spell their classes out as literals because Tailwind's scanner reads source text — a
 * class assembled at runtime would be purged from the stylesheet.
 */

const ROLE_BAR: Record<string, string> = {
  KOORDYNATOR: 'shadow-[inset_3px_0_0_theme(colors.navy.DEFAULT)]',
  KIEROWCA: 'shadow-[inset_3px_0_0_theme(colors.accent.DEFAULT)]',
  OPERATOR: 'shadow-[inset_3px_0_0_theme(colors.verified)]',
  SERWISANT: 'shadow-[inset_3px_0_0_theme(colors.warn)]',
}

const ROLE_SWATCH: Record<string, string> = {
  KOORDYNATOR: 'bg-navy',
  KIEROWCA: 'bg-accent',
  OPERATOR: 'bg-verified',
  SERWISANT: 'bg-warn',
}

const FALLBACK_BAR = 'shadow-[inset_3px_0_0_theme(colors.muted.2)]'
const FALLBACK_SWATCH = 'bg-muted-2'

/** Edge-bar class for a shift chip. An unrecognised role gets a neutral bar, never no bar. */
export function roleBar(role: string): string {
  return ROLE_BAR[role.toUpperCase()] ?? FALLBACK_BAR
}

/** Legend swatch class for a role. Same fallback rule as {@link roleBar}. */
export function roleSwatch(role: string): string {
  return ROLE_SWATCH[role.toUpperCase()] ?? FALLBACK_SWATCH
}

/** The roles the legend enumerates, in the order it shows them (seniority, then alphabetical). */
export const LEGEND_ROLES = ['KOORDYNATOR', 'KIEROWCA', 'OPERATOR', 'SERWISANT'] as const
