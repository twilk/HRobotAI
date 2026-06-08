export { PrismaClient as ControlPlaneClient } from '../generated/control-plane/index.js'
export { PrismaClient as TenantClient } from '../generated/tenant/index.js'
// The Prisma namespace (input/where/enum/payload types) under explicit names. Avoids the
// previous `export * as ControlPlane/Tenant`, which re-exported the ENTIRE generated surface
// (runtime internals, Decimal, etc.) into every consumer's public type space.
export { Prisma as ControlPlanePrisma } from '../generated/control-plane/index.js'
export { Prisma as TenantPrisma } from '../generated/tenant/index.js'
