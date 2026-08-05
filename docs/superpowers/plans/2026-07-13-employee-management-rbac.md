# Employee Management + RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only, unscoped Employees module into a role-scoped CRUD subsystem — scoped roster, employee profile detail, HR/ADMIN edit + add — with RODO-correct PESEL handling and audit.

**Architecture:** NestJS tenant-runtime (Jest) with a new `EmployeesService` mirroring the grafik RBAC pattern (`isGlobal`, managed-unit scoping, `keycloakSub` self-scoping); PESEL is stored/read ONLY through the canonical `@hrobot/db` `employeePii` helpers (AES-256-GCM + blind index, tenant-bound AAD). Web-kit (vitest) gets a profile page + edit/add forms gated by session roles, talking to the backend through a same-origin catch-all proxy.

**Tech Stack:** NestJS, Prisma, class-validator, `@hrobot/shared` EncryptionService, Jest (backend); Next.js 15, vitest (web-kit).

**Locked product decisions (confirmed 2026-07-13):**
1. PRACOWNIK roster/profile scope = **own unit** (not just self).
2. MANAGER = **read-only** on employees; create/edit/delete = **HR/ADMIN only**.
3. `peselLast4` returned **only to HR/ADMIN**; full PESEL is write-only, never returned.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `apps/tenant-runtime/src/tenant-runtime/rbac/unit-scope.ts` (new) | Shared `isGlobal(roles)` + `managedUnitIds(client, userId)` (extracted from GrafikService) | 0 |
| `apps/tenant-runtime/src/employees/employees.service.ts` (new) | Employee read-scoping + CRUD + PESEL encryption + audit | 0–4 |
| `apps/tenant-runtime/src/employees/employees.service.spec.ts` (new) | Jest for the service | 1–4 |
| `apps/tenant-runtime/src/employees/dto/employee.dto.ts` (new) | Create/Update DTOs + PESEL validator | 3–4 |
| `apps/tenant-runtime/src/employees/employees.controller.ts` | Routes: scoped list, `:id`, POST, PATCH; `@Roles` + actor | 1–4 |
| `apps/tenant-runtime/src/employees/employees.controller.spec.ts` (new) | RBAC-metadata + delegation tests | 1–4 |
| `apps/tenant-runtime/src/employees/employees.module.ts` | Provide EmployeesService + EncryptionService + blind-index key | 0 |
| `docs/design/web-kit/app/api/employees/[[...path]]/route.ts` (new) | Catch-all proxy (GET/POST/PATCH for `/api/employees/*`) | 2 |
| `docs/design/web-kit/app/(tenant)/pracownicy/[id]/page.tsx` (new) | Employee profile page (server shell + client detail) | 2 |
| `docs/design/web-kit/components/employees/employee-profile.tsx` (new) | Profile card + (HR/ADMIN) edit form | 2–3 |
| `docs/design/web-kit/components/employees/employee-add-dialog.tsx` (new) | HR/ADMIN add form; wires the "Dodaj pracownika" button | 4 |
| `docs/design/web-kit/components/employees/employees-screen.tsx` | Rows link to profile; add button gated + wired | 2, 4 |

---

## Task 0: Shared RBAC scope + EmployeesService skeleton + module wiring

**Files:**
- Create: `apps/tenant-runtime/src/tenant-runtime/rbac/unit-scope.ts`
- Create: `apps/tenant-runtime/src/employees/employees.service.ts`
- Modify: `apps/tenant-runtime/src/grafik/grafik.service.ts` (use the shared helpers), `apps/tenant-runtime/src/employees/employees.module.ts`

- [ ] **Step 1: Discover the blind-index key source**

Run: `grep -rn "blindIndex\|BLIND_INDEX\|biKey\|blindIndexKey\|encryptEmployeePesel" packages/db packages/config apps/tenant-runtime | grep -iv test`
Note how the seed / provisioning constructs the 32-byte blind-index key (an env var, e.g. `PESEL_BLIND_INDEX_KEY`, or derived). Use that exact source in Step 5. If none exists yet, STOP and report NEEDS_CONTEXT (the key must be a real configured secret, not invented).

- [ ] **Step 2: Extract the shared scope helpers**

Create `apps/tenant-runtime/src/tenant-runtime/rbac/unit-scope.ts`:

```ts
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'

/** HR and the tenant admin act across every unit; MANAGER is scoped to the unit(s) they manage. */
const GLOBAL_ROLES: string[] = [Role.HR, Role.ADMIN_KLIENTA]

export const isGlobal = (roles: string[]): boolean => roles.some((r) => GLOBAL_ROLES.includes(r))

/** Unit IDs the user holds a MANAGER role for (via tenant `UserRole`). */
export async function managedUnitIds(client: TenantClient, userId: string): Promise<string[]> {
  const rows = await client.userRole.findMany({
    where: { user: { keycloakSub: userId }, role: Role.MANAGER, unitId: { not: null } },
    select: { unitId: true },
  })
  return rows.map((r) => r.unitId).filter((u): u is string => u !== null)
}
```

- [ ] **Step 3: Point GrafikService at the shared helpers (no behavior change)**

In `apps/tenant-runtime/src/grafik/grafik.service.ts`: delete the local `GLOBAL_ROLES`/`isGlobal` consts and the private `managedUnitIds` method; add `import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'` and replace `this.managedUnitIds(client, x)` calls with `managedUnitIds(client, x)`.

- [ ] **Step 4: Verify grafik still green**

Run: `cd apps/tenant-runtime && npx jest grafik --silent`
Expected: PASS — all grafik suites unchanged (the extraction is behavior-preserving).

- [ ] **Step 5: EmployeesService skeleton + module wiring**

Create `apps/tenant-runtime/src/employees/employees.service.ts`:

```ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { EncryptionService } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'

/** The acting user projected from the JWT + IP (mirrors GrafikActor). */
export interface EmployeeActor {
  userId: string
  roles: string[]
  ipAddress: string
}

/** Fields safe to return to any in-scope reader — pesel is NEVER selected here (RODO). */
const SAFE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  position: true,
  employmentType: true,
  hiredAt: true,
  unitId: true,
  etat: true,
  qualifications: true,
} as const

@Injectable()
export class EmployeesService {
  constructor(
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    // 32-byte HMAC key for the PESEL blind index — provided in EmployeesModule (see Step 6).
    private readonly peselBlindIndexKey: Buffer,
  ) {}

  private writeAudit(client: TenantClient, actor: EmployeeActor, action: string, id: string, payload: Record<string, unknown>): Promise<void> {
    return this.audit.log({ tenantClient: client, actorUserId: actor.userId, action, entityType: 'Employee', entityId: id, payload, ipAddress: actor.ipAddress })
  }
}
```

Modify `apps/tenant-runtime/src/employees/employees.module.ts` to provide the service, EncryptionService, and the blind-index key (mirror the factory in `apps/tenant-runtime/src/provisioning/provisioning.module.ts`):

```ts
import { Module } from '@nestjs/common'
import { EncryptionService } from '@hrobot/shared'
import { parseEnv } from '@hrobot/config'
import { EmployeesController } from './employees.controller.js'
import { EmployeesService } from './employees.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'

const PESEL_BI_KEY = 'PESEL_BI_KEY' // DI token for the blind-index Buffer

@Module({
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    AuditService,
    {
      provide: EncryptionService,
      useFactory: (): EncryptionService => new EncryptionService(Buffer.from(parseEnv().TENANT_DB_ENCRYPTION_KEY, 'hex')),
    },
    // Replace <ENV_FROM_STEP_1> with the real blind-index-key env var discovered in Step 1.
    { provide: PESEL_BI_KEY, useFactory: (): Buffer => Buffer.from(parseEnv().<ENV_FROM_STEP_1>, 'hex') },
  ],
})
export class EmployeesModule {}
```
(Wire `@Inject(PESEL_BI_KEY)` on the service constructor's `peselBlindIndexKey` param. If `AuditService` is already provided by a shared module the app imports, import that module instead of re-providing — check `app.module.ts` / how GrafikModule gets AuditService, and mirror it.)

- [ ] **Step 6: Compile check**

Run: `cd apps/tenant-runtime && npx tsc --noEmit -p tsconfig.json`
Expected: clean (skeleton + wiring compile).

- [ ] **Step 7: Commit**

```bash
git add apps/tenant-runtime/src/tenant-runtime/rbac/unit-scope.ts apps/tenant-runtime/src/grafik/grafik.service.ts apps/tenant-runtime/src/employees/employees.service.ts apps/tenant-runtime/src/employees/employees.module.ts
git commit -m "refactor(rbac): shared unit-scope helper + EmployeesService skeleton"
```

---

## Task 1: Scoped roster (F1)

**Files:** `employees.service.ts`, `employees.controller.ts`, `employees.service.spec.ts`, `employees.controller.spec.ts`

- [ ] **Step 1: Write failing service tests**

Create `apps/tenant-runtime/src/employees/employees.service.spec.ts` with a mock client factory (mirror grafik's `makeClient`) exposing `employee: { findMany, findUnique, create, update }` and `userRole: { findMany }`, plus actor constants HR/ADMIN/MANAGER/PRACOWNIK. Then:

```ts
  describe('list scoping', () => {
    it('returns all employees for a global actor (HR/ADMIN)', async () => {
      client.employee.findMany.mockResolvedValue([])
      await service.list(asClient(client), HR)
      expect(client.employee.findMany).toHaveBeenCalledWith(expect.not.objectContaining({ where: expect.anything() }))
    })
    it('scopes a MANAGER to their managed units', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.employee.findMany.mockResolvedValue([])
      await service.list(asClient(client), MANAGER)
      expect(client.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { unitId: { in: ['unit-A'] } } }))
    })
    it('scopes a plain PRACOWNIK to their own unit', async () => {
      client.userRole.findMany.mockResolvedValue([])
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-B' })
      client.employee.findMany.mockResolvedValue([])
      await service.list(asClient(client), PRACOWNIK)
      expect(client.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { unitId: { in: ['unit-B'] } } }))
    })
  })
```

- [ ] **Step 2: Run — expect FAIL** (`service.list` undefined). `cd apps/tenant-runtime && npx jest employees.service --silent`

- [ ] **Step 3: Implement `list` + `peselLast4` (HR/ADMIN only)**

Add to `EmployeesService`:

```ts
  /** The plain employee's own unit (via their Keycloak subject), or null if they have no record. */
  private async ownUnitId(client: TenantClient, userId: string): Promise<string | null> {
    const me = await client.employee.findUnique({ where: { userId }, select: { unitId: true } }).catch(() => null)
    // Employee.userId is the DB user id, not the keycloak sub, so resolve via the user relation:
    const meBySub = me ?? (await client.employee.findFirst({ where: { user: { keycloakSub: userId } }, select: { unitId: true } }))
    return meBySub?.unitId ?? null
  }

  async list(client: TenantClient, actor: EmployeeActor): Promise<unknown[]> {
    const withLast4 = isGlobal(actor.roles)
    const select = withLast4 ? { ...SAFE_SELECT, peselHash: false } : SAFE_SELECT
    if (isGlobal(actor.roles)) {
      return client.employee.findMany({ orderBy: { hiredAt: 'desc' }, select })
    }
    const units = await managedUnitIds(client, actor.userId)
    const scopeUnits = units.length > 0 ? units : [await this.ownUnitId(client, actor.userId)].filter((u): u is string => !!u)
    return client.employee.findMany({ where: { unitId: { in: scopeUnits } }, orderBy: { hiredAt: 'desc' }, select })
  }
```
NOTE on `peselLast4`: the DB stores only ciphertext + blind index — there is no cheap "last 4". Do NOT decrypt every row on a list (perf + RODO). For the LIST, omit PESEL entirely for all roles; expose `peselLast4` only on the single-employee profile (Task 2) for HR/ADMIN by decrypting that one record. Adjust Step 1's global test if you removed the `withLast4` select branch — keep list PESEL-free for everyone.

- [ ] **Step 4: Run — expect PASS.** `cd apps/tenant-runtime && npx jest employees.service --silent`

- [ ] **Step 5: Controller — gate + actor + delegate**

Rewrite `apps/tenant-runtime/src/employees/employees.controller.ts` (mirror GrafikController's actor + @Roles pattern; `@Get()` now delegates to the scoped service):

```ts
import { Controller, Get, Ip } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { EmployeesService, type EmployeeActor } from './employees.service.js'

const READ_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK] as const
const WRITE_ROLES = [Role.HR, Role.ADMIN_KLIENTA] as const

@Controller('employees')
@TenantRoute()
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  private actor(user: JwtPayload, ip: string): EmployeeActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  @Get()
  @Roles(...READ_ROLES)
  async findAll(@CurrentTenantClient() client: TenantClient, @CurrentUser() user: JwtPayload, @Ip() ip: string): Promise<unknown[]> {
    return this.employees.list(client, this.actor(user, ip))
  }
}
```

- [ ] **Step 6: Controller RBAC test**

Create `apps/tenant-runtime/src/employees/employees.controller.spec.ts` (mirror grafik.controller.spec's guard-bypass + `rolesFor` metadata pattern):

```ts
    it('allows every scheduling role to read the roster (scoped in the service)', () => {
      expect(rolesFor('findAll')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK])
    })
```

- [ ] **Step 7: Run suites + live check.** `cd apps/tenant-runtime && npx jest employees --silent` (PASS). Then rebuild + verify counts differ by role:
```bash
docker compose -p hrobot --profile full up -d --build tenant-runtime && sleep 20
login(){ curl -s -X POST http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token -d client_id=hrobot-web -d username=$1 -d password=$2 -d grant_type=password | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4; }
TA=$(login demo demo-staging-2026); TM=$(login manager.demo 'Manager!2026'); TP=$(login pracownik.demo 'Pracownik!2026')
for p in "ADMIN:$TA" "MANAGER:$TM" "PRACOWNIK:$TP"; do echo "${p%%:*}: $(curl -s http://localhost:3001/api/employees -H "Authorization: Bearer ${p##*:}" | grep -o '"id"' | wc -l)"; done
```
Expected: ADMIN 36; MANAGER < 36 (own unit); PRACOWNIK ≤ its unit size, > 0. No PESEL in any response.

- [ ] **Step 8: Commit.** `git add apps/tenant-runtime/src/employees/ && git commit -m "feat(employees): role-scoped roster (manager unit, employee own unit)"`

---

## Task 2: Employee profile detail (F2)

**Files:** `employees.service.ts`, `employees.controller.ts`, both specs; web-kit `[[...path]]` proxy, `[id]/page.tsx`, `employee-profile.tsx`, `employees-screen.tsx`.

- [ ] **Step 1: Failing service test for `getById` (scoped, 403/404)**

```ts
  describe('getById scoping', () => {
    it('global reads any profile', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e1', unitId: 'u9', pesel: 'CIPHER' })
      await expect(service.getById(asClient(client), HR, 'e1')).resolves.toMatchObject({ id: 'e1' })
    })
    it('404 when the employee does not exist', async () => {
      client.employee.findUnique.mockResolvedValue(null)
      await expect(service.getById(asClient(client), HR, 'ghost')).rejects.toBeInstanceOf(NotFoundException)
    })
    it('403 when a MANAGER reads another unit', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e2', unitId: 'other', pesel: 'C' })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      await expect(service.getById(asClient(client), MANAGER, 'e2')).rejects.toBeInstanceOf(ForbiddenException)
    })
    it('403 when a PRACOWNIK reads a colleague in another unit', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e3', unitId: 'other', pesel: 'C' })
      client.userRole.findMany.mockResolvedValue([])
      client.employee.findFirst.mockResolvedValue({ unitId: 'mine' })
      await expect(service.getById(asClient(client), PRACOWNIK, 'e3')).rejects.toBeInstanceOf(ForbiddenException)
    })
  })
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `getById` (scope check + optional peselLast4 for HR/ADMIN)**

```ts
  async getById(client: TenantClient, actor: EmployeeActor, id: string, tenantId?: string): Promise<Record<string, unknown>> {
    const emp = await client.employee.findUnique({ where: { id } })
    if (!emp) throw new NotFoundException(`Employee ${id} not found`)
    if (!isGlobal(actor.roles)) {
      const units = await managedUnitIds(client, actor.userId)
      const inScope = units.length > 0 ? units.includes(emp.unitId) : emp.unitId === (await this.ownUnitId(client, actor.userId))
      if (!inScope) throw new ForbiddenException('Employee is outside your scope')
    }
    const { pesel, peselHash, ...safe } = emp as Record<string, unknown> & { pesel: string; peselHash: string }
    // HR/ADMIN get a masked last-4 by decrypting THIS one record; everyone else gets nothing.
    if (isGlobal(actor.roles) && tenantId) {
      try {
        const plain = decryptEmployeePesel(this.encryption, tenantId, pesel)
        return { ...safe, peselLast4: plain.slice(-4) }
      } catch {
        return safe
      }
    }
    return safe
  }
```
(Add `import { decryptEmployeePesel } from '@hrobot/db'` and mock `client.employee.findFirst` in the spec's makeClient.)

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Controller route `GET /employees/:id`**

Add to the controller (import `Param`, `ParseUUIDPipe`, `CurrentTenantId`):
```ts
  @Get(':id')
  @Roles(...READ_ROLES)
  async findOne(@CurrentTenantClient() client: TenantClient, @CurrentUser() user: JwtPayload, @Ip() ip: string, @CurrentTenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.employees.getById(client, this.actor(user, ip), id, tenantId)
  }
```
Add a controller RBAC test `rolesFor('findOne')` equals READ_ROLES.

- [ ] **Step 6: Backend suite + commit.** `npx jest employees --silent` (PASS). `git commit -m "feat(employees): GET /employees/:id scoped profile (403 out of scope)"`.

- [ ] **Step 7: Web-kit catch-all proxy**

Delete `docs/design/web-kit/app/api/employees/route.ts`; create `docs/design/web-kit/app/api/employees/[[...path]]/route.ts` (mirror app/api/grafik/[...path]/route.ts):
```ts
import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'
export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ path?: string[] }> }
async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  return proxyToTenantRuntime(req, joinBackendPath('employees', path ?? []), new URL(req.url).search)
}
export const GET = handle
export const POST = handle
export const PATCH = handle
```

- [ ] **Step 8: Profile page + component**

Create `docs/design/web-kit/app/(tenant)/pracownicy/[id]/page.tsx` (server shell mirroring pracownicy/page.tsx: getSession → AppShell) rendering `<EmployeeProfile id={id} canManage={rolesInclude HR/ADMIN} />`. Create `docs/design/web-kit/components/employees/employee-profile.tsx` (client) that `fetch('/api/employees/'+id)`, renders a read-only card (name, position, unit via `fetchUnitNames()` from lib/locations.ts, contract, etat, qualifications, and `peselLast4` masked as `•••••••{last4}` when present). In `employees-screen.tsx`, make each row a link to `/pracownicy/${e.id}`.

- [ ] **Step 9: Verify in browser (production).** Log in per role; open a profile in scope (200, no full PESEL); confirm a PRACOWNIK opening a colleague's out-of-scope id shows the 403 error. Commit web-kit: `git commit -m "feat(web-kit): employee profile page (scoped, RODO-masked)"`.

---

## Task 3: Edit employee (F3, HR/ADMIN only)

**Files:** `dto/employee.dto.ts` (new), `employees.service.ts`, `employees.controller.ts`, specs; web-kit `employee-profile.tsx` (edit form).

- [ ] **Step 1: DTO with PESEL validator**

Create `apps/tenant-runtime/src/employees/dto/employee.dto.ts` (mirror shift.dto.ts's class-validator style):
```ts
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min, Max, IsArray } from 'class-validator'
const PESEL = /^\d{11}$/
const CONTRACTS = ['UMOWA_O_PRACE', 'UMOWA_ZLECENIE', 'UMOWA_O_DZIELO', 'B2B'] as const

export class UpdateEmployeeDto {
  @IsOptional() @IsString() firstName?: string
  @IsOptional() @IsString() lastName?: string
  @IsOptional() @IsString() position?: string
  @IsOptional() @IsIn(CONTRACTS) employmentType?: (typeof CONTRACTS)[number]
  @IsOptional() @IsUUID() unitId?: string
  @IsOptional() @IsInt() @Min(0) @Max(1) etat?: number
  @IsOptional() @IsArray() @IsString({ each: true }) qualifications?: string[]
  /** Write-only: sets a new PESEL (encrypted + blind-indexed). Never returned. */
  @IsOptional() @Matches(PESEL, { message: 'pesel must be 11 digits' }) pesel?: string
}
```
(If `etat` is a Float in Prisma, use `@IsNumber()` instead of `@IsInt()` — confirm against the schema.)

- [ ] **Step 2: Failing service tests for `update`**

```ts
  describe('update (HR/ADMIN only)', () => {
    it('lets HR update fields + audits', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e1', unitId: 'u', position: 'old' })
      client.employee.update.mockResolvedValue({ id: 'e1', position: 'new' })
      await service.update(asClient(client), HR, 'e1', { position: 'new' }, 'tenant-1')
      expect(client.employee.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e1' }, data: expect.objectContaining({ position: 'new' }) }))
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'employee.update' }))
    })
    it('forbids MANAGER and PRACOWNIK', async () => {
      await expect(service.update(asClient(client), MANAGER, 'e1', { position: 'x' }, 't')).rejects.toBeInstanceOf(ForbiddenException)
      await expect(service.update(asClient(client), PRACOWNIK, 'e1', { position: 'x' }, 't')).rejects.toBeInstanceOf(ForbiddenException)
    })
    it('encrypts a new PESEL via employeePii and never audits it', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e1', unitId: 'u' })
      client.employee.update.mockResolvedValue({ id: 'e1' })
      await service.update(asClient(client), ADMIN, 'e1', { pesel: '44051401359' }, 'tenant-1')
      const data = client.employee.update.mock.calls[0][0].data
      expect(data.pesel).toBeDefined(); expect(data.peselHash).toBeDefined(); expect(data.pesel).not.toBe('44051401359')
      const auditPayload = audit.log.mock.calls[0][0].payload
      expect(JSON.stringify(auditPayload)).not.toContain('44051401359')
    })
  })
```

- [ ] **Step 3: Implement `update`**

```ts
  async update(client: TenantClient, actor: EmployeeActor, id: string, dto: UpdateEmployeeDto, tenantId: string): Promise<unknown> {
    if (!isGlobal(actor.roles)) throw new ForbiddenException('Only HR/ADMIN may edit employees')
    const before = await client.employee.findUnique({ where: { id } })
    if (!before) throw new NotFoundException(`Employee ${id} not found`)
    const { pesel, ...rest } = dto
    const data: Record<string, unknown> = { ...rest }
    if (pesel) Object.assign(data, encryptEmployeePesel(this.encryption, this.peselBlindIndexKey, tenantId, pesel))
    const after = await client.employee.update({ where: { id }, data })
    // Audit WITHOUT pesel fields.
    const safeBefore = { ...before, pesel: undefined, peselHash: undefined }
    const safeAfter = { ...(after as Record<string, unknown>), pesel: undefined, peselHash: undefined }
    await this.writeAudit(client, actor, 'employee.update', id, { before: safeBefore, after: safeAfter })
    return { id, ...rest }
  }
```
(Add `import { encryptEmployeePesel } from '@hrobot/db'`.)

- [ ] **Step 4: Controller `PATCH /employees/:id` (WRITE_ROLES) + delegation/RBAC tests + run suite.** Route mirrors `findOne` but `@Roles(...WRITE_ROLES)`, `@Patch(':id')`, `@Body() dto: UpdateEmployeeDto`, passes `tenantId`. Add controller tests: `rolesFor('update')` equals [HR, ADMIN_KLIENTA]. `npx jest employees --silent` PASS.

- [ ] **Step 5: Live RBAC check.** Rebuild; HR `PATCH` → 200; MANAGER/PRACOWNIK `PATCH` → 403; `GET` of the edited employee shows the change, no PESEL. Commit backend.

- [ ] **Step 6: Web-kit edit form** in `employee-profile.tsx`, shown only when `canManage`: fields for the DTO, unit select from `fetchUnitNames()`, PESEL "set new" (never prefilled), submit `PATCH /api/employees/:id`, refresh on success. Commit web-kit.

---

## Task 4: Add employee (F4, HR/ADMIN only)

**Files:** `dto/employee.dto.ts` (Create DTO), `employees.service.ts`, `employees.controller.ts`, specs; web-kit `employee-add-dialog.tsx`, `employees-screen.tsx`.

- [ ] **Step 1: CreateEmployeeDto** (append to dto/employee.dto.ts):
```ts
export class CreateEmployeeDto {
  @IsString() firstName!: string
  @IsString() lastName!: string
  @IsString() position!: string
  @IsIn(CONTRACTS) employmentType!: (typeof CONTRACTS)[number]
  @IsUUID() unitId!: string
  @Matches(PESEL, { message: 'pesel must be 11 digits' }) pesel!: string
  @IsOptional() @IsInt() @Min(0) @Max(1) etat?: number
  @IsOptional() @IsArray() @IsString({ each: true }) qualifications?: string[]
}
```

- [ ] **Step 2: Failing service tests for `create`** (HR creates → employee.create called with encrypted pesel + peselHash + `userId: null`, audits without pesel; MANAGER/PRACOWNIK → 403).

- [ ] **Step 3: Implement `create`**
```ts
  async create(client: TenantClient, actor: EmployeeActor, dto: CreateEmployeeDto, tenantId: string): Promise<unknown> {
    if (!isGlobal(actor.roles)) throw new ForbiddenException('Only HR/ADMIN may add employees')
    const { pesel, ...rest } = dto
    const enc = encryptEmployeePesel(this.encryption, this.peselBlindIndexKey, tenantId, pesel)
    const created = await client.employee.create({ data: { ...rest, ...enc, userId: null } })
    await this.writeAudit(client, actor, 'employee.create', (created as { id: string }).id, { after: { ...rest, id: (created as { id: string }).id } })
    return { id: (created as { id: string }).id, ...rest }
  }
```
(This creates the kadrowy PROFILE only — `userId: null`; provisioning a Keycloak login account is out of scope, per the spec.)

- [ ] **Step 4: Controller `POST /employees` (WRITE_ROLES) + tests + run.** `rolesFor('create')` equals [HR, ADMIN_KLIENTA]; validation rejects bad PESEL (400).

- [ ] **Step 5: Live check.** HR `POST` valid → 201 and appears in `GET`; MANAGER/PRACOWNIK → 403; bad PESEL → 400. IMPORTANT: use a synthetic test PESEL and DELETE the created row afterward (or use a throwaway unit) so the demo roster stays at 36 — do NOT leave test employees in the demo data. Commit backend.

- [ ] **Step 6: Web-kit add dialog.** Create `employee-add-dialog.tsx` (form for CreateEmployeeDto, unit select from `fetchUnitNames()`). In `employees-screen.tsx`, wire the "Dodaj pracownika" `<Button>` to open it, and render the button ONLY when the session has HR/ADMIN (pass a `canManage` prop from the page, like grafik). On success, refresh the list. Commit web-kit.

---

## Final verification (after all tasks)

- [ ] Backend green: `cd apps/tenant-runtime && npx jest --silent | tail -4`
- [ ] web-kit green: `cd docs/design/web-kit && npx vitest run | tail -3`
- [ ] RBAC matrix holds (re-run the audit's API probes): list scoped per role; `GET/PATCH/POST /employees[/:id]` → 403 for the wrong role, 404 for missing; no PESEL in any response; `peselLast4` only on the profile for HR/ADMIN.
- [ ] Demo anchors intact (no test employee left behind):
```bash
q(){ docker exec hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -tAc "$1"; }
echo "employees=$(q 'SELECT count(*) FROM employees;') (expect 36)  Anna 13-19=$(q "SELECT count(*) FROM shifts s JOIN employees e ON s.employee_id=e.id WHERE e.user_id='06a4c5a5-8cfa-4f8b-93e9-bd8c823379ed' AND s.date BETWEEN '2026-07-13' AND '2026-07-19';") (expect 5)  swap=$(q "SELECT state FROM shift_swap_requests WHERE id='dccccccc-0000-4000-8000-000000000001';")"
```

## Self-review notes (author)
- Spec coverage: F1 (Task 1), F2 (Task 2), F3 (Task 3), F4 (Task 4), shared-infra prereq (Task 0), RODO (employeePii helpers + audit-without-pesel + peselLast4-HR/ADMIN-only) — all covered.
- Genuine unknowns flagged as discovery steps, NOT fabricated: the blind-index key env (Task 0 Step 1), whether AuditService is already module-provided (Task 0 Step 5), whether `etat` is Int vs Float (Task 3 Step 1), and the exact `Employee.userId`↔keycloak mapping (Task 1 Step 3 `ownUnitId` — verify the relation and simplify to one query).
