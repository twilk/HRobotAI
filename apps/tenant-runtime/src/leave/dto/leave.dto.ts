import { IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator'

/**
 * POST /wnioski — create a leave request (Wniosek urlopowy). `employeeId` is HONOURED ONLY for a
 * GLOBAL actor (HR/ADMIN_KLIENTA) filing on someone's behalf; for everyone else the service ignores
 * it and files against the caller's OWN Employee record (resolved via their Keycloak subject). The
 * request is always created in the PENDING state — a manager/HR must decide it. `type` is the
 * free-form leave kind (URLOP_WYPOCZYNKOWY, URLOP_NA_ZADANIE, …), mirroring the schema column.
 */
export class CreateLeaveDto {
  @IsOptional() @IsUUID() employeeId?: string
  @IsDateString() startDate!: string
  @IsDateString() endDate!: string
  @IsString() @IsNotEmpty() type!: string
}

/**
 * POST /wnioski/:id/decision — a manager/HR approve or reject decision. `reason` is an optional
 * free-text note (no PII) stored on the request alongside the decision. Approving triggers the
 * AI-grafik replacement auto-scan tie-in in the service.
 */
export class DecideDto {
  @IsBoolean() approve!: boolean
  @IsOptional() @IsString() reason?: string
}
