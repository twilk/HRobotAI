/**
 * (Codex P1-5) `Employee.position` is FREE TEXT — there is no position catalog yet. A naive
 * `Employee.position === PositionCostRate.position` join produces SILENT MISSES on cosmetic
 * whitespace differences ("Kasjer", " Kasjer ", "Kasjer  zmianowy"). Every write of a rate AND
 * every lookup MUST run the position through this exact normalization first — trim the ends and
 * collapse any run of internal whitespace to a single space. Matching stays case-sensitive
 * (no guessing beyond whitespace).
 */
export function normalizePosition(position: string): string {
  return position.trim().replace(/\s+/g, ' ')
}
