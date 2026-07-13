import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  Role,
  EmploymentType,
  TenantStatus,
  PlanType,
  ProvisioningStep,
  AutonomyLevel,
  AiProposalType,
  AiProposalState,
  ConsentState,
} from '@hrobot/shared'

// Guards the hand-maintained duplication between the TS domain enums in @hrobot/shared and the
// Prisma `enum` blocks in the two schemas. Prisma can't import TS, so they are kept in sync by
// hand; this test fails loudly the moment a value is added/removed on one side only. (__dirname
// works because ts-jest transpiles to CommonJS.)
function prismaEnumValues(schemaPath: string, name: string): string[] {
  const src = readFileSync(schemaPath, 'utf8')
  const match = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(src)
  if (!match) throw new Error(`enum ${name} not found in ${schemaPath}`)
  return match[1]!
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('@'))
    .sort()
}

const tenantSchema = resolve(__dirname, '../prisma/tenant/schema.prisma')
const controlSchema = resolve(__dirname, '../prisma/control-plane/schema.prisma')

describe('enum parity: @hrobot/shared TS enums == Prisma enum blocks', () => {
  it('tenant Role', () => {
    expect(prismaEnumValues(tenantSchema, 'Role')).toEqual([...Object.values(Role)].sort())
  })
  it('tenant EmploymentType', () => {
    expect(prismaEnumValues(tenantSchema, 'EmploymentType')).toEqual(
      [...Object.values(EmploymentType)].sort(),
    )
  })
  it('tenant AutonomyLevel', () => {
    expect(prismaEnumValues(tenantSchema, 'AutonomyLevel')).toEqual(
      [...Object.values(AutonomyLevel)].sort(),
    )
  })
  it('tenant AiProposalType', () => {
    expect(prismaEnumValues(tenantSchema, 'AiProposalType')).toEqual(
      [...Object.values(AiProposalType)].sort(),
    )
  })
  it('tenant AiProposalState', () => {
    expect(prismaEnumValues(tenantSchema, 'AiProposalState')).toEqual(
      [...Object.values(AiProposalState)].sort(),
    )
  })
  it('tenant ConsentState', () => {
    expect(prismaEnumValues(tenantSchema, 'ConsentState')).toEqual(
      [...Object.values(ConsentState)].sort(),
    )
  })
  it('control-plane TenantStatus', () => {
    expect(prismaEnumValues(controlSchema, 'TenantStatus')).toEqual(
      [...Object.values(TenantStatus)].sort(),
    )
  })
  it('control-plane PlanType', () => {
    expect(prismaEnumValues(controlSchema, 'PlanType')).toEqual([...Object.values(PlanType)].sort())
  })
  it('control-plane ProvisioningStep', () => {
    expect(prismaEnumValues(controlSchema, 'ProvisioningStep')).toEqual(
      [...Object.values(ProvisioningStep)].sort(),
    )
  })
})
