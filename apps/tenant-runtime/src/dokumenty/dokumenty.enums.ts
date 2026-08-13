/**
 * `dokumenty` — hand-kept mirrors of the Prisma tenant enums (SPEC §2.3). Prisma generates these
 * enum runtime values only at the top level of the generated client, which `@hrobot/db` does NOT
 * re-export (it exposes the `TenantPrisma` type namespace + `TenantClient` only). So — exactly as
 * `strategic-brain/performance-config.service.ts` hand-keeps `ProactivityLevel` — we hand-keep the
 * doc enums here as `const` objects usable by `@IsEnum()` (class-validator) AND by service logic,
 * kept in lockstep with `packages/db/prisma/tenant/schema.prisma`.
 *
 * DOK-10 (no external send): the `dokumenty-no-send.spec.ts` static test asserts BOTH that this
 * `DocumentStatus` and the authoritative `schema.prisma` enum contain NO `SENT`/`EXPORTED_EXTERNAL`
 * member — proving there is no lifecycle path off the module into an external system.
 */

export const DocumentType = {
  EWIDENCJA_CZASU_PRACY: 'EWIDENCJA_CZASU_PRACY',
  NADGODZINY: 'NADGODZINY',
  ZUS_KEDU: 'ZUS_KEDU',
} as const
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType]

export const DocumentFormat = {
  PDF: 'PDF',
  XML_KEDU: 'XML_KEDU',
} as const
export type DocumentFormat = (typeof DocumentFormat)[keyof typeof DocumentFormat]

/**
 * Lifecycle states (SPEC §2.3). GENERATED → APPROVED (human gate — NADGODZINY/ZUS) or → SUPERSEDED
 * (append-only regenerate). There is DELIBERATELY no `SENT`/`EXPORTED_EXTERNAL` — the module never
 * sends anything to ZUS/Płatnik (art. 22 RODO; SPEC §0/§1.3). DOK-10 asserts this absence.
 */
export const DocumentStatus = {
  GENERATED: 'GENERATED',
  APPROVED: 'APPROVED',
  SUPERSEDED: 'SUPERSEDED',
} as const
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus]

export const DocScopeType = {
  EMPLOYEE: 'EMPLOYEE',
  UNIT: 'UNIT',
  ALL: 'ALL',
} as const
export type DocScopeType = (typeof DocScopeType)[keyof typeof DocScopeType]
