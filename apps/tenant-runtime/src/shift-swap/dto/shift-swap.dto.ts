import { Transform } from 'class-transformer'
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator'
import { SwapState } from '../swap-state-machine.js'

/** All legal `SwapState` values, for validating the `?state=` list filter. */
const SWAP_STATES = Object.values(SwapState)

/**
 * `POST /shift-swap` body. A 1:1 swap when `targetShiftId` is present (the swap counterparty is that
 * shift's holder); a "give away" request when omitted. The requester shift MUST belong to the caller
 * — enforced row-level in {@link ShiftSwapService.create}, not here.
 */
export class CreateSwapRequestDto {
  @IsUUID() requesterShiftId!: string
  @IsOptional() @IsUUID() targetShiftId?: string
}

/** `POST /shift-swap/:id/peer-decision` body — the target's accept/reject. */
export class PeerDecisionDto {
  @IsBoolean() accept!: boolean
}

/** `POST /shift-swap/:id/manager-decision` body — the manager's approve/reject. */
export class ManagerDecisionDto {
  @IsBoolean() approve!: boolean
}

/**
 * `GET /shift-swap` query. `state` narrows by lifecycle; `mine=true` restricts to requests where the
 * caller is the requester or the target (the worker's own view). `mine` arrives as a query string, so
 * `"true"`/`"1"` are coerced to `true`.
 */
export class ListSwapQueryDto {
  @IsOptional() @IsIn(SWAP_STATES) state?: (typeof SWAP_STATES)[number]

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  mine?: boolean
}
