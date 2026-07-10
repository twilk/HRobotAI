/**
 * Single, deliberately-isolated re-export of the tenant-runtime commute helper.
 *
 * The cold-start `ProblemInput` MUST be packed the exact way `POST /grafik/solve` packs it, or the
 * imitation data would train against a slightly different problem than production emits. The commute
 * cost is one such caller-side detail: the frozen contract stores it as a precomputed `travelMatrix`
 * (minutes), and the haversine + assumed-speed conversion lives OUTSIDE the contract, in
 * `apps/tenant-runtime/src/grafik/haversine.ts` (see its `ASSUMED_COMMUTE_KMH` note). We import that
 * exact function rather than copy it, so any tuning there flows through here with zero drift.
 *
 * The cross-package relative import is quarantined to this one file (and commented) on purpose:
 * `haversine.ts` is dependency-clean — it imports only a `LatLng` *type* from `@hrobot/shared`, which
 * type-erases — so pulling it in drags no NestJS/runtime surface along. If the helper is ever promoted
 * into `@hrobot/shared`, only this seam changes.
 */
export { commuteMinutes } from '../../../apps/tenant-runtime/src/grafik/haversine.js'
