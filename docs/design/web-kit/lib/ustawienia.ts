/**
 * Ustawienia (company settings + organizational units) client model for the web-kit UAT surface.
 *
 * LIVE: `ustawieniaApi` talks to the REAL tenant-runtime REST API through the same-origin Next.js
 * proxy at `/api/ustawienia/*` (see app/api/ustawienia/[[...path]] + lib/tenant-runtime.ts), which
 * forwards to the NestJS `GET/PATCH /ustawienia/company` and `GET/POST/PATCH /ustawienia/units[/:id]`
 * endpoints with a cookie-resolved Keycloak bearer.
 *
 * The pure helpers (buildUnitTree / wouldCreateCycle) are exported separately so the screen and the
 * unit tests share one source of truth. Neither CompanySettings nor OrganizationalUnit carries PII
 * (see apps/tenant-runtime/src/ustawienia/ustawienia.service.ts's class doc), so no RODO concerns
 * here — unlike lib/ai-grafik.ts / lib/wnioski.ts, nothing needs id→name enrichment.
 */

/**
 * Tenant-wide company settings (the `CompanySettings` singleton). `GET /ustawienia/company` returns
 * either the persisted row (carrying id/createdAt/updatedAt) or a synthetic default before any row
 * exists yet (companyName/timezone/region/locale only) — see
 * `SettingsService.defaultCompany`/`getCompany`. The id/timestamps are never edited by this screen, so
 * they're optional here rather than a second "create" vs "read" type.
 */
export interface CompanySettings {
  id?: string
  companyName: string
  timezone: string
  region: string
  locale: string
  createdAt?: string
  updatedAt?: string
}

/** Fields the company-settings form can PATCH (`UpdateCompanyDto` — every field optional there too). */
export interface CompanySettingsUpdate {
  companyName?: string
  timezone?: string
  region?: string
  locale?: string
}

/**
 * Org-unit projection returned by `GET /ustawienia/units` (`SettingsService.UnitProjection`) — richer
 * than the `GET /grafik/units` `{id,name}` pair used elsewhere: carries `parentId`/`managerUserId` and
 * a `children` array of direct-child unit ids (derived server-side, not a recursive fetch).
 */
export interface OrgUnit {
  id: string
  name: string
  parentId: string | null
  managerUserId: string | null
  children: string[]
}

/** `POST /ustawienia/units` body (`CreateUnitDto`). */
export interface CreateUnitInput {
  name: string
  parentId?: string
}

/**
 * `PATCH /ustawienia/units/:id` body (`UpdateUnitDto`) — every field optional (partial edit).
 * `parentId`/`managerUserId` accept an explicit `null` (clear the field) in addition to `undefined`
 * (leave untouched) — the backend's `compact()` only drops `undefined` keys, so `null` reaches Prisma
 * as a real clear. Callers must NOT collapse `null` to `undefined` via `??`, or JSON.stringify will
 * drop the key and the clear silently no-ops.
 */
export interface UpdateUnitInput {
  name?: string
  parentId?: string | null
  managerUserId?: string | null
}

/** Carries the upstream HTTP status so the UI can distinguish 400 (validation/cycle) / 403 / 409. */
export class UstawieniaApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'UstawieniaApiError'
  }
}

async function ustawieniaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new UstawieniaApiError(res.status, humanizeError(detail) || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Surface the backend's `message` (NestJS error body) rather than a raw JSON blob. */
function humanizeError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] }
    const msg = Array.isArray(parsed.message) ? parsed.message.join('; ') : parsed.message
    if (msg) return msg
  } catch {
    /* fall through to the raw body */
  }
  return body
}

export const ustawieniaApi = {
  getCompany(): Promise<CompanySettings> {
    return ustawieniaFetch<CompanySettings>('/api/ustawienia/company')
  },
  updateCompany(input: CompanySettingsUpdate): Promise<CompanySettings> {
    return ustawieniaFetch<CompanySettings>('/api/ustawienia/company', {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
  listUnits(): Promise<OrgUnit[]> {
    return ustawieniaFetch<OrgUnit[]>('/api/ustawienia/units')
  },
  createUnit(input: CreateUnitInput): Promise<OrgUnit> {
    return ustawieniaFetch<OrgUnit>('/api/ustawienia/units', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  updateUnit(id: string, input: UpdateUnitInput): Promise<OrgUnit> {
    return ustawieniaFetch<OrgUnit>(`/api/ustawienia/units/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
}

// --- pure helpers: org-unit tree + cycle guard ------------------------------------------------------
//
// The backend already derives `children` (an id array) per unit server-side (no recursive query), but
// the screen needs actual nested unit OBJECTS to render a tree recursively. `buildUnitTree` re-nests
// the flat list using each unit's `parentId` (not the `children` id array — building from `parentId` is
// the single source of truth and self-consistent even if a caller passes a stale `children` snapshot).

/** A unit with its children resolved to nested {@link OrgUnitNode}s (not just ids), for tree rendering. */
export interface OrgUnitNode extends Omit<OrgUnit, 'children'> {
  children: OrgUnitNode[]
}

/**
 * Nest a flat `OrgUnit[]` into root-level {@link OrgUnitNode} trees, sorted by name at every level (the
 * backend already returns `listUnits` name-sorted, but sorting again here keeps this helper correct
 * standalone). A unit whose `parentId` points at a missing/foreign id (shouldn't happen — the backend
 * FK-guards `parentId` — but defends against a stale/partial snapshot) is treated as a root so no unit
 * silently disappears from the tree.
 */
export function buildUnitTree(units: OrgUnit[]): OrgUnitNode[] {
  const byId = new Map<string, OrgUnitNode>(units.map((u) => [u.id, { ...u, children: [] }]))
  const roots: OrgUnitNode[] = []

  for (const unit of units) {
    const node = byId.get(unit.id)!
    const parent = unit.parentId != null ? byId.get(unit.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pl')
  const sortTree = (nodes: OrgUnitNode[]): void => {
    nodes.sort(byName)
    for (const n of nodes) sortTree(n.children)
  }
  sortTree(roots)

  return roots
}

/** Index a flat `OrgUnit[]` by id for O(1) lookups (e.g. resolving a unit's own name in the UI). */
export function indexUnits(units: OrgUnit[]): Map<string, OrgUnit> {
  return new Map(units.map((u) => [u.id, u]))
}

/**
 * True iff reparenting unit `id` to `newParentId` would create a cycle — mirrors
 * `SettingsService.updateUnit`'s in-transaction guard exactly (self-parent, or a proposed parent that
 * is `id` itself or a descendant of `id`) so the UI can disable an invalid reparent choice BEFORE
 * hitting the backend. `newParentId == null` (clearing the parent / becoming a root) can never cycle.
 * An unresolvable `newParentId` (points at a unit not in `units`) is NOT flagged here — that surfaces
 * as a backend 400 (invalid parentId) instead, a different failure mode than a cycle.
 */
export function wouldCreateCycle(units: OrgUnit[], id: string, newParentId: string | null): boolean {
  if (newParentId == null) return false
  if (newParentId === id) return true

  const byId = indexUnits(units)
  let cursor: string | null = newParentId
  const seen = new Set<string>()
  while (cursor) {
    if (cursor === id) return true
    if (seen.has(cursor)) return false // defends against a corrupt/cyclic snapshot looping forever
    seen.add(cursor)
    const node = byId.get(cursor)
    if (!node) return false // unresolvable parent → a backend 400, not a cycle
    cursor = node.parentId
  }
  return false
}
