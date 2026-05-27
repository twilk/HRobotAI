export const Role = {
  PRACOWNIK: 'PRACOWNIK',
  MANAGER: 'MANAGER',
  HR: 'HR',
  ADMIN_KLIENTA: 'ADMIN_KLIENTA',
} as const
export type Role = (typeof Role)[keyof typeof Role]

export const TenantStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DEPROVISIONED: 'DEPROVISIONED',
} as const
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus]

export const PlanType = {
  TRIAL: 'TRIAL',
  STANDARD: 'STANDARD',
  ENTERPRISE: 'ENTERPRISE',
} as const
export type PlanType = (typeof PlanType)[keyof typeof PlanType]

export const ProvisioningStep = {
  CREATE_DB: 'CREATE_DB',
  RUN_MIGRATIONS: 'RUN_MIGRATIONS',
  SEED: 'SEED',
  KEYCLOAK_SETUP: 'KEYCLOAK_SETUP',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const
export type ProvisioningStep = (typeof ProvisioningStep)[keyof typeof ProvisioningStep]

export const EmploymentType = {
  UMOWA_O_PRACE: 'UMOWA_O_PRACE',
  UMOWA_ZLECENIE: 'UMOWA_ZLECENIE',
  UMOWA_O_DZIELO: 'UMOWA_O_DZIELO',
  B2B: 'B2B',
} as const
export type EmploymentType = (typeof EmploymentType)[keyof typeof EmploymentType]
