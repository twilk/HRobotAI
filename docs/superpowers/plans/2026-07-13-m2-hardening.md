# M2 Hardening (W4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five demo-time shortcuts found during the M2 build with production-grade solutions, each covered by a test and verified live.

**Architecture:** Backend is a NestJS tenant-runtime (`apps/tenant-runtime`, Jest tests) over Prisma; the demo UI is a nested Next.js 15 app (`docs/design/web-kit`, vitest tests) that talks to the backend only through same-origin proxy route handlers. Keycloak runs in Docker Compose. Each task is self-contained and must not touch the demo anchors (accounts, hero week 13–19 July, empty week 20–26, J5 swap `PENDING_MANAGER`).

**Tech Stack:** NestJS, Prisma, Jest (backend); Next.js 15 App Router, vitest (web-kit); Docker Compose + Keycloak 26.

---

## File Structure (what changes and why)

| File | Responsibility | Task |
|------|----------------|------|
| `docker-compose.yml` | Keycloak service: pin KC 26 + mount a data volume so realms survive `compose down` | 1 |
| `docs/design/web-kit/lib/session.ts` | Add `REFRESH_COOKIE` constant next to `SESSION_COOKIE` | 2 |
| `docs/design/web-kit/lib/refresh-token.ts` (new) | Server-only helper: exchange a refresh token for a new access token | 2 |
| `docs/design/web-kit/lib/refresh-token.test.ts` (new) | vitest for the helper | 2 |
| `docs/design/web-kit/lib/auth-actions.ts` | Store the refresh token on login; clear it on logout | 2 |
| `docs/design/web-kit/lib/tenant-runtime.ts` | On a cookie-token 401, refresh + retry + re-set cookies | 2 |
| `apps/tenant-runtime/src/grafik/grafik.service.ts` | `listLokalizacje` + `listUnits`; scope `listDemands` for a plain employee | 3, 4 |
| `apps/tenant-runtime/src/grafik/grafik.controller.ts` | `GET /grafik/lokalizacje`, `GET /grafik/units`; pass actor into `listDemands` | 3, 4 |
| `apps/tenant-runtime/src/grafik/grafik.service.spec.ts` | Tests for the new/changed service methods | 3, 4 |
| `apps/tenant-runtime/src/grafik/grafik.controller.spec.ts` | RBAC + delegation tests for the new routes | 3, 4 |
| `docs/design/web-kit/lib/locations.ts` (new) | Fetch id→name maps from the new endpoints (replaces the hardcoded `demo-locations.ts` maps) | 3 |
| `docs/design/web-kit/package.json` | `build:clean` script (rm .next before build) | 5 |
| `docs/design/web-kit/start-prod.mjs` | Clean `.next` before building to avoid the stale-chunk build error | 5 |

---

## Task 1: Persistent Keycloak realm (Compose volume)

**Problem:** The dev Keycloak runs `start-dev` on an H2 store inside the container with no mounted volume, so ANY `docker compose down` (even without `-v`) drops every realm. Today only `scripts/seed-keycloak-demo.mjs` rescues it.

**Files:**
- Modify: `docker-compose.yml` (the `keycloak:` service, ~lines 55–62, and the top-level `volumes:` block)

- [ ] **Step 1: Read the current keycloak service block**

Run: `sed -n '55,62p;150,152p' docker-compose.yml`
Expected: shows `image: quay.io/keycloak/keycloak:24.0`, `command: ["start-dev"]`, `KEYCLOAK_ADMIN*` env, `ports: - "8080:8080"`, and a top-level `volumes:` with only `hrobot_pgdata:`.

- [ ] **Step 2: Pin KC 26 + mount a data volume**

Replace the `keycloak:` service block in `docker-compose.yml` with:

```yaml
  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: ["start-dev"]
    environment:
      # KC 25+ renamed KEYCLOAK_ADMIN* -> KC_BOOTSTRAP_ADMIN*.
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    ports:
      - "8080:8080"
    # Persist KC's embedded H2 so realms/clients/users survive `docker compose down` (without -v).
    volumes:
      - hrobot_keycloak:/opt/keycloak/data
```

- [ ] **Step 3: Declare the volume**

In the top-level `volumes:` block of `docker-compose.yml`, add `hrobot_keycloak:` beneath `hrobot_pgdata:`:

```yaml
volumes:
  hrobot_pgdata:
  hrobot_keycloak:
```

- [ ] **Step 4: Validate the merged config resolves the volume**

Run: `docker compose -p hrobot --profile full config | grep -A3 'keycloak:26\|hrobot_hrobot_keycloak'`
Expected: shows `image: quay.io/keycloak/keycloak:26.0` and the volume `name: hrobot_hrobot_keycloak` mounted at `/opt/keycloak/data`.

- [ ] **Step 5: Functional check — realm survives a down/up**

Run:
```bash
node scripts/demo-up.mjs   # ensures realm hrobot-staging + swap exist
docker compose -p hrobot --profile full stop keycloak && docker compose -p hrobot --profile full up -d keycloak
sleep 40
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/realms/hrobot-staging/.well-known/openid-configuration
```
Expected: `200` (realm persisted across the recreate; before this task it would be `404`).

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "fix(infra): persist Keycloak realm — pin KC 26 + mount data volume"
```

---

## Task 2: Refresh-token rotation (web-kit)

**Problem:** `login` stores only the access token in `hrobot_token` with `maxAge = expires_in` (~1 h). When it lapses the proxy 401s and the user is re-gated to `/login`. Keycloak's direct-grant response also returns a `refresh_token`; use it to refresh transparently.

**Files:**
- Modify: `docs/design/web-kit/lib/session.ts`
- Create: `docs/design/web-kit/lib/refresh-token.ts`, `docs/design/web-kit/lib/refresh-token.test.ts`
- Modify: `docs/design/web-kit/lib/auth-actions.ts`, `docs/design/web-kit/lib/tenant-runtime.ts`

- [ ] **Step 1: Add the refresh-cookie constant**

In `docs/design/web-kit/lib/session.ts`, directly after the existing `export const SESSION_COOKIE = 'hrobot_token'` (line 13), add:

```ts
/** httpOnly cookie holding the Keycloak refresh token, used to rotate the access token on 401. */
export const REFRESH_COOKIE = 'hrobot_refresh'
```

- [ ] **Step 2: Write the failing test for the refresh helper**

Create `docs/design/web-kit/lib/refresh-token.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { refreshAccessToken } from './refresh-token'

afterEach(() => vi.restoreAllMocks())

describe('refreshAccessToken', () => {
  it('exchanges a refresh token for new tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'A2', refresh_token: 'R2', expires_in: 300, refresh_expires_in: 1800 }), { status: 200 })
    ))
    const out = await refreshAccessToken('R1')
    expect(out).toEqual({ accessToken: 'A2', refreshToken: 'R2', expiresIn: 300, refreshExpiresIn: 1800 })
  })

  it('returns null when Keycloak rejects the refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })))
    expect(await refreshAccessToken('expired')).toBeNull()
  })

  it('keeps the old refresh token when the response omits a new one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'A2', expires_in: 300 }), { status: 200 })
    ))
    const out = await refreshAccessToken('R1')
    expect(out?.refreshToken).toBe('R1')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd docs/design/web-kit && npx vitest run lib/refresh-token.test.ts`
Expected: FAIL — `Failed to resolve import "./refresh-token"`.

- [ ] **Step 4: Implement the refresh helper**

Create `docs/design/web-kit/lib/refresh-token.ts`:

```ts
// Server-only: exchange a Keycloak refresh token for a fresh access token (refresh_token grant).
// Mirrors the direct-grant config used by lib/auth-actions.ts.
const DEFAULT_TOKEN_URL = 'http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token'
const DEFAULT_CLIENT_ID = 'hrobot-web'

export interface RefreshedTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  refreshExpiresIn: number
}

export async function refreshAccessToken(refreshToken: string): Promise<RefreshedTokens | null> {
  const tokenUrl = process.env.KEYCLOAK_TOKEN_URL || DEFAULT_TOKEN_URL
  const clientId = process.env.KEYCLOAK_CLIENT_ID || DEFAULT_CLIENT_ID
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken })

  let res: Response
  try {
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const j = (await res.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; refresh_expires_in?: number }
    | null
  if (!j?.access_token) return null
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? refreshToken,
    expiresIn: j.expires_in ?? 300,
    refreshExpiresIn: j.refresh_expires_in ?? 1800,
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd docs/design/web-kit && npx vitest run lib/refresh-token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Store the refresh token on login, clear it on logout**

In `docs/design/web-kit/lib/auth-actions.ts`:

1. Change the import on line 15 to include the refresh cookie:
```ts
import { SESSION_COOKIE, REFRESH_COOKIE } from './session'
```
2. Widen the payload type (line 66) and parse (line 68) to include refresh fields:
```ts
  let payload: { access_token?: string; expires_in?: number; refresh_token?: string; refresh_expires_in?: number }
```
```ts
    payload = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string; refresh_expires_in?: number }
```
3. Directly after the existing `store.set(SESSION_COOKIE, ...)` block (ends line 85), add:
```ts
  if (payload.refresh_token) {
    store.set(REFRESH_COOKIE, payload.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: payload.refresh_expires_in ?? 1800,
    })
  }
```
4. In `logout()` (line 92), delete both cookies:
```ts
export async function logout(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  store.delete(REFRESH_COOKIE)
  redirect('/login')
}
```

- [ ] **Step 7: Refresh-on-401 in the proxy**

In `docs/design/web-kit/lib/tenant-runtime.ts`:

1. Add imports at the top (after line 13):
```ts
import { cookies } from 'next/headers'
import { refreshAccessToken } from './refresh-token'
import { SESSION_COOKIE, REFRESH_COOKIE } from './session'
```
2. Replace the `ResolvedAuth` interface (lines 26–29) so we know the token came from the cookie:
```ts
interface ResolvedAuth {
  authorization: string
  source: 'header' | 'cookie' | 'minted' | 'dev'
}
```
3. Update `resolveAuthorization` (lines 32–49) to tag the source:
```ts
async function resolveAuthorization(req: Request): Promise<ResolvedAuth | null> {
  const header = req.headers.get('authorization')
  if (header) return { authorization: header, source: 'header' }

  const cookie = req.headers.get('cookie')
  const match = cookie ? /(?:^|;\s*)hrobot_token=([^;]+)/.exec(cookie) : null
  if (match) return { authorization: `Bearer ${decodeURIComponent(match[1])}`, source: 'cookie' }

  const minted = await getKeycloakToken()
  if (minted) return { authorization: `Bearer ${minted}`, source: 'minted' }

  const devToken = process.env.TENANT_RUNTIME_DEV_TOKEN
  if (devToken) return { authorization: `Bearer ${devToken}`, source: 'dev' }

  return null
}
```
4. In `proxyToTenantRuntime`, replace the retry block (lines 86–95) with minted-retry PLUS cookie-refresh-retry:
```ts
  let upstream: Response
  try {
    upstream = await sendOnce(resolved.authorization)

    // A minted token can expire between our skew check and arrival; re-mint once.
    if (upstream.status === 401 && resolved.source === 'minted') {
      const refreshed = await getKeycloakToken(true)
      if (refreshed) upstream = await sendOnce(`Bearer ${refreshed}`)
    }

    // A cookie (logged-in user) token that 401s: rotate it with the refresh token, retry, and
    // re-set both cookies so the session continues instead of bouncing to /login.
    if (upstream.status === 401 && resolved.source === 'cookie') {
      const rc = req.headers.get('cookie')
      const rm = rc ? /(?:^|;\s*)hrobot_refresh=([^;]+)/.exec(rc) : null
      if (rm) {
        const rotated = await refreshAccessToken(decodeURIComponent(rm[1]))
        if (rotated) {
          upstream = await sendOnce(`Bearer ${rotated.accessToken}`)
          const store = await cookies()
          const base = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' }
          store.set(SESSION_COOKIE, rotated.accessToken, { ...base, maxAge: rotated.expiresIn })
          store.set(REFRESH_COOKIE, rotated.refreshToken, { ...base, maxAge: rotated.refreshExpiresIn })
        }
      }
    }
  } catch (err) {
```
(Leave the rest of the `catch` and the pass-through response unchanged.)

- [ ] **Step 8: Run the web-kit test suite**

Run: `cd docs/design/web-kit && npx vitest run`
Expected: PASS — existing suites (`tenant-runtime.test.ts`, `keycloak-token.test.ts`, …) plus the new `refresh-token.test.ts`, no failures.

- [ ] **Step 9: Commit**

```bash
git add docs/design/web-kit/lib/session.ts docs/design/web-kit/lib/refresh-token.ts docs/design/web-kit/lib/refresh-token.test.ts docs/design/web-kit/lib/auth-actions.ts docs/design/web-kit/lib/tenant-runtime.ts
git commit -m "feat(web-kit): refresh-token rotation — keep sessions alive past access-token expiry"
```

---

## Task 3: Real location + org-unit name endpoints

**Problem:** web-kit maps location/unit UUID→name from a hardcoded `lib/demo-locations.ts`. Expose the real names from tenant-runtime so the UI stops hardcoding tenant data.

**Files:**
- Modify: `apps/tenant-runtime/src/grafik/grafik.service.ts`, `apps/tenant-runtime/src/grafik/grafik.controller.ts`
- Modify: `apps/tenant-runtime/src/grafik/grafik.service.spec.ts`, `apps/tenant-runtime/src/grafik/grafik.controller.spec.ts`
- Create: `docs/design/web-kit/lib/locations.ts`

- [ ] **Step 1: Write the failing service tests**

In `apps/tenant-runtime/src/grafik/grafik.service.spec.ts`, first extend the mock client factory `makeClient()` (around line 34) to add the two delegates:

```ts
    lokalizacja: { findMany: jest.fn(), findUnique: jest.fn() },
    organizationalUnit: { findMany: jest.fn() },
```
(Replace the existing `lokalizacja: { findMany: jest.fn() },` line and add the `organizationalUnit` line beside it.)

Then add this describe block at the end of the top-level `describe('GrafikService', …)` body, before its closing `})`:

```ts
  describe('catalog name lookups', () => {
    it('lists lokalizacje as {id,name,typ}', async () => {
      client.lokalizacja.findMany.mockResolvedValue([{ id: 'L1', name: 'Lotnisko', typ: 'AIRPORT' }])
      const rows = await service.listLokalizacje(asClient(client))
      expect(client.lokalizacja.findMany).toHaveBeenCalledWith({
        select: { id: true, name: true, typ: true },
        orderBy: { name: 'asc' },
      })
      expect(rows).toEqual([{ id: 'L1', name: 'Lotnisko', typ: 'AIRPORT' }])
    })

    it('lists org units as {id,name}', async () => {
      client.organizationalUnit.findMany.mockResolvedValue([{ id: 'U1', name: 'Region Centrum' }])
      const rows = await service.listUnits(asClient(client))
      expect(client.organizationalUnit.findMany).toHaveBeenCalledWith({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
      expect(rows).toEqual([{ id: 'U1', name: 'Region Centrum' }])
    })
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/tenant-runtime && npx jest grafik.service --silent`
Expected: FAIL — `service.listLokalizacje is not a function`.

- [ ] **Step 3: Implement the service methods**

In `apps/tenant-runtime/src/grafik/grafik.service.ts`, add these two methods just before `listShifts` (i.e., right after the `writeAudit` method that ends near line 138):

```ts
  // --- Catalog name lookups (read-only; any scheduling role) ------------------------------------

  /** Location id→name catalog for UI labels (no PII, no geolocation). */
  async listLokalizacje(client: TenantClient): Promise<unknown[]> {
    return client.lokalizacja.findMany({ select: { id: true, name: true, typ: true }, orderBy: { name: 'asc' } })
  }

  /** Organizational-unit id→name catalog for UI labels. */
  async listUnits(client: TenantClient): Promise<unknown[]> {
    return client.organizationalUnit.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
  }
```

- [ ] **Step 4: Run to verify the service tests pass**

Run: `cd apps/tenant-runtime && npx jest grafik.service --silent`
Expected: PASS.

- [ ] **Step 5: Write the failing controller tests**

In `apps/tenant-runtime/src/grafik/grafik.controller.spec.ts`, add `listLokalizacje: jest.fn(), listUnits: jest.fn(),` to the `mockService` object (near line 17), then add inside the RBAC describe (near the existing read test at line 117):

```ts
    it('exposes catalog name lookups to every scheduling role including PRACOWNIK', () => {
      for (const m of ['listLokalizacje', 'listUnits'] as const) {
        expect(rolesFor(m)).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK])
      }
    })
```

- [ ] **Step 6: Run to verify failure**

Run: `cd apps/tenant-runtime && npx jest grafik.controller --silent`
Expected: FAIL — `rolesFor('listLokalizacje')` reads metadata off a route that does not exist yet.

- [ ] **Step 7: Add the controller routes**

In `apps/tenant-runtime/src/grafik/grafik.controller.ts`, add these two routes right after the `getShift` route (after line 87), keeping the `READ_ROLES` gate:

```ts
  @Get('lokalizacje')
  @Roles(...READ_ROLES)
  async listLokalizacje(@CurrentTenantClient() client: TenantClient): Promise<unknown[]> {
    return this.grafik.listLokalizacje(client)
  }

  @Get('units')
  @Roles(...READ_ROLES)
  async listUnits(@CurrentTenantClient() client: TenantClient): Promise<unknown[]> {
    return this.grafik.listUnits(client)
  }
```

- [ ] **Step 8: Run to verify the controller tests pass**

Run: `cd apps/tenant-runtime && npx jest grafik.controller --silent`
Expected: PASS.

- [ ] **Step 9: Commit the backend**

```bash
git add apps/tenant-runtime/src/grafik/grafik.service.ts apps/tenant-runtime/src/grafik/grafik.controller.ts apps/tenant-runtime/src/grafik/grafik.service.spec.ts apps/tenant-runtime/src/grafik/grafik.controller.spec.ts
git commit -m "feat(grafik): GET /grafik/lokalizacje + /grafik/units name catalogs"
```

- [ ] **Step 10: Wire the frontend to the real endpoints**

Create `docs/design/web-kit/lib/locations.ts`:

```ts
// Fetches the real location + org-unit name catalogs from tenant-runtime (via the same-origin proxy),
// replacing the hardcoded id→name maps in lib/demo-locations.ts.
export interface NamedCatalog { [id: string]: string }

async function fetchCatalog(url: string, key: 'name'): Promise<NamedCatalog> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return {}
  const rows = (await res.json()) as Array<{ id: string; name: string }>
  return Object.fromEntries(rows.map((r) => [r.id, r[key]]))
}

export const fetchLocationNames = (): Promise<NamedCatalog> => fetchCatalog('/api/grafik/lokalizacje', 'name')
export const fetchUnitNames = (): Promise<NamedCatalog> => fetchCatalog('/api/grafik/units', 'name')
```

- [ ] **Step 11: Verify the proxy route serves the new endpoints**

The existing catch-all `app/api/grafik/[...path]/route.ts` already proxies any `/api/grafik/*` path, so no new route file is needed. Verify with the stack up:
```bash
TOK=$(curl -s -X POST http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token -d client_id=hrobot-web -d username=demo -d password=demo-staging-2026 -d grant_type=password | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
curl -s http://localhost:3001/api/grafik/lokalizacje -H "Authorization: Bearer $TOK" | head -c 200; echo
curl -s http://localhost:3001/api/grafik/units -H "Authorization: Bearer $TOK"
```
Expected: JSON arrays of `{id,name,typ}` (15 locations) and `{id,name}` (units incl. "Region Centrum"). Rebuild tenant-runtime first if it 404s: `docker compose -p hrobot --profile full up -d --build tenant-runtime`.

- [ ] **Step 12: Commit the frontend helper**

```bash
git add docs/design/web-kit/lib/locations.ts
git commit -m "feat(web-kit): fetch location/unit names from the API (drop hardcoded map)"
```

---

## Task 4: Scope shift-demands for a plain employee

**Problem:** `listDemands(client)` returns the whole demand catalog (~685 rows) to anyone with a read role, including PRACOWNIK. Scope a plain employee (no managed units) to demands at the locations where they actually have shifts.

**Files:**
- Modify: `apps/tenant-runtime/src/grafik/grafik.service.ts` (`listDemands`, line 221)
- Modify: `apps/tenant-runtime/src/grafik/grafik.controller.ts` (`listDemands` route, line 128)
- Modify: `apps/tenant-runtime/src/grafik/grafik.service.spec.ts`

- [ ] **Step 1: Write the failing service tests**

In `apps/tenant-runtime/src/grafik/grafik.service.spec.ts`, add to the `catalog name lookups` describe (or a new `demand scoping` describe) inside `describe('GrafikService', …)`:

```ts
  describe('demand scoping', () => {
    it('returns all demands for a global actor (HR/ADMIN)', async () => {
      client.shiftDemand.findMany.mockResolvedValue([])
      await service.listDemands(asClient(client), HR)
      expect(client.shiftDemand.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ where: expect.anything() }),
      )
    })

    it('scopes a plain PRACOWNIK to demands at their own shift locations', async () => {
      client.userRole.findMany.mockResolvedValue([]) // manages nothing
      client.shift.findMany.mockResolvedValue([{ lokalizacjaId: 'L1' }, { lokalizacjaId: 'L1' }, { lokalizacjaId: 'L2' }])
      client.shiftDemand.findMany.mockResolvedValue([])
      await service.listDemands(asClient(client), PRACOWNIK)
      expect(client.shiftDemand.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { lokalizacjaId: { in: ['L1', 'L2'] } } }),
      )
    })
  })
```
(`HR` and `PRACOWNIK` actor constants already exist at the top of this spec.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/tenant-runtime && npx jest grafik.service --silent`
Expected: FAIL — `listDemands` currently ignores its second argument / has arity 1.

- [ ] **Step 3: Implement the scoping**

In `apps/tenant-runtime/src/grafik/grafik.service.ts`, replace `listDemands` (lines 221–223) with:

```ts
  async listDemands(client: TenantClient, actor: GrafikActor): Promise<unknown[]> {
    if (isGlobal(actor.roles)) {
      return client.shiftDemand.findMany({ orderBy: [{ date: 'desc' }, { start: 'asc' }] })
    }
    const units = await this.managedUnitIds(client, actor.userId)
    if (units.length > 0) {
      // A MANAGER sees demands at the locations their units staff.
      const unitShifts = await client.shift.findMany({
        where: { employee: { unitId: { in: units } } },
        select: { lokalizacjaId: true },
      })
      const locIds = [...new Set(unitShifts.map((s) => s.lokalizacjaId))]
      return client.shiftDemand.findMany({ where: { lokalizacjaId: { in: locIds } }, orderBy: [{ date: 'desc' }, { start: 'asc' }] })
    }
    // Plain employee: only demands at locations where they personally have shifts.
    const ownShifts = await client.shift.findMany({
      where: { employee: { user: { keycloakSub: actor.userId } } },
      select: { lokalizacjaId: true },
    })
    const locIds = [...new Set(ownShifts.map((s) => s.lokalizacjaId))]
    return client.shiftDemand.findMany({ where: { lokalizacjaId: { in: locIds } }, orderBy: [{ date: 'desc' }, { start: 'asc' }] })
  }
```

- [ ] **Step 4: Update the controller to pass the actor**

In `apps/tenant-runtime/src/grafik/grafik.controller.ts`, replace the `listDemands` route (lines 126–130) with:

```ts
  @Get('demands')
  @Roles(...READ_ROLES)
  async listDemands(@CurrentTenantClient() client: TenantClient, @CurrentUser() user: JwtPayload, @Ip() ip: string): Promise<unknown[]> {
    return this.grafik.listDemands(client, this.actor(user, ip))
  }
```

- [ ] **Step 5: Run the whole grafik suite**

Run: `cd apps/tenant-runtime && npx jest grafik --silent`
Expected: PASS — all grafik specs (service, controller, solve, optimizer, haversine), including the new demand-scoping tests.

- [ ] **Step 6: Live check — PRACOWNIK sees fewer demands than ADMIN**

```bash
login(){ curl -s -X POST http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token -d client_id=hrobot-web -d username=$1 -d password=$2 -d grant_type=password | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4; }
docker compose -p hrobot --profile full up -d --build tenant-runtime && sleep 20
TA=$(login demo demo-staging-2026); TP=$(login pracownik.demo 'Pracownik!2026')
echo "admin demands: $(curl -s http://localhost:3001/api/grafik/demands -H "Authorization: Bearer $TA" | grep -o '"id"' | wc -l)"
echo "pracownik demands: $(curl -s http://localhost:3001/api/grafik/demands -H "Authorization: Bearer $TP" | grep -o '"id"' | wc -l)"
```
Expected: admin count ≈ 685; pracownik count is much smaller (only their own shift locations), and > 0.

- [ ] **Step 7: Commit**

```bash
git add apps/tenant-runtime/src/grafik/grafik.service.ts apps/tenant-runtime/src/grafik/grafik.controller.ts apps/tenant-runtime/src/grafik/grafik.service.spec.ts
git commit -m "fix(grafik): scope shift-demands read by role (employee sees own locations only)"
```

---

## Task 5: Stable production build (no stale-chunk failure)

**Problem:** `next build` intermittently fails with `Cannot find module './NNN.js'` when `.next` holds a stale webpack chunk. `start-prod.mjs` should build from a clean `.next`.

**Files:**
- Modify: `docs/design/web-kit/package.json`, `docs/design/web-kit/start-prod.mjs`

- [ ] **Step 1: Add a clean-build script**

In `docs/design/web-kit/package.json`, add to the `"scripts"` block (next to the existing `"build"`):

```json
    "build:clean": "node -e \"require('fs').rmSync('.next',{recursive:true,force:true})\" && next build",
```

- [ ] **Step 2: Make start-prod build from a clean .next**

In `docs/design/web-kit/start-prod.mjs`, replace the build invocation (the `spawnSync(process.execPath, [nextBin, 'build'], …)` line inside the "next build" block) with a clean-first version. Immediately before that `spawnSync`, add:

```js
import { rmSync } from 'node:fs'
```
(add to the existing `node:fs`/`node:path` import group at the top), and just before the `console.log('▶ next build …')` line add:

```js
rmSync(join(dir, '.next'), { recursive: true, force: true })
```

- [ ] **Step 3: Verify a clean production build succeeds**

Run: `cd docs/design/web-kit && npm run build:clean 2>&1 | tail -5`
Expected: build completes with the route table (`/grafik`, `/zamiany`, …) and NO `Cannot find module './NNN.js'`.

- [ ] **Step 4: Verify start-prod boots the built app**

Run:
```bash
cd docs/design/web-kit && node start-prod.mjs &
sleep 60 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5601/login
```
Expected: `200`, and (in a browser) NO "N Issues" dev pill.

- [ ] **Step 5: Commit**

```bash
git add docs/design/web-kit/package.json docs/design/web-kit/start-prod.mjs
git commit -m "fix(web-kit): clean .next before production build to avoid stale-chunk failure"
```

---

## Final verification (after all tasks)

- [ ] Backend suite green: `cd apps/tenant-runtime && npx jest --silent 2>&1 | tail -5`
- [ ] web-kit suite green: `cd docs/design/web-kit && npx vitest run 2>&1 | tail -5`
- [ ] Demo anchors intact:
```bash
q(){ docker exec hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -tAc "$1"; }
echo "Anna 13-19: $(q "SELECT count(*) FROM shifts s JOIN employees e ON s.employee_id=e.id WHERE e.user_id='06a4c5a5-8cfa-4f8b-93e9-bd8c823379ed' AND s.date BETWEEN '2026-07-13' AND '2026-07-19';") (expect 5)"
echo "week 20-26 empty: $(q "SELECT count(*) FROM shifts WHERE date BETWEEN '2026-07-20' AND '2026-07-26';") (expect 0)"
echo "J5 swap: $(q "SELECT state FROM shift_swap_requests WHERE id='dccccccc-0000-4000-8000-000000000001';") (expect PENDING_MANAGER)"
```
