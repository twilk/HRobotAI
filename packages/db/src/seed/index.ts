/**
 * Canonical synthetic seed (M2 #4) — the FROZEN, shared UAT/cold-start dataset. This barrel exposes
 * the PURE data + helpers (no DB/crypto), so Tor C and Tor E import the exact same set the runner
 * (`scripts/seed-synthetic.ts`) writes. See ./canonicalData.ts for the dataset and its invariants.
 */
export {
  buildCanonicalSeed,
  assertCanonicalInvariants,
  weekCoverage,
  CANONICAL_WEEKS,
  EMPLOYEE_COUNT,
  ROLE,
  FACILITY,
} from './canonicalData.js'
export type {
  CanonicalSeed,
  SeedUnit,
  SeedLocation,
  SeedEmployee,
  SeedLeave,
  SeedTemplate,
  SeedDemand,
  DemandWindow,
  CoverageResult,
  Shortfall,
  Role,
  Facility,
} from './canonicalData.js'
export {
  generateSyntheticPesel,
  assertSyntheticPesel,
  isSyntheticPesel,
  isValidPeselChecksum,
} from './pesel.js'
export type { SyntheticPesel } from './pesel.js'
export { stableId, SEED_NAMESPACE } from './determinism.js'
export {
  DEFAULT_SEED_TENANT_ID,
  deriveBlindIndexKey,
  encryptEmployeePii,
  homeAddressAad,
} from './persist.js'
export type { EncryptedEmployeePii } from './persist.js'
