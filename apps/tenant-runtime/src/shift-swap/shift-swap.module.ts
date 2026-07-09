import { Module } from '@nestjs/common'
import { ShiftSwapController } from './shift-swap.controller.js'
import { ShiftSwapService } from './shift-swap.service.js'
import {
  SWAP_FEASIBILITY_VALIDATOR,
  AllowAllSwapFeasibilityValidator,
} from './swap-feasibility-validator.js'

/**
 * Shift-swap module (M2 #3, D1 scope): the state-machine service + the feasibility-validator seam.
 * The seam is bound to the D1 no-op allow-all validator; M2-D2 rebinds {@link SWAP_FEASIBILITY_VALIDATOR}
 * to the real optimizer client and wires the controller endpoints.
 */
@Module({
  controllers: [ShiftSwapController],
  providers: [
    ShiftSwapService,
    { provide: SWAP_FEASIBILITY_VALIDATOR, useClass: AllowAllSwapFeasibilityValidator },
  ],
  exports: [ShiftSwapService],
})
export class ShiftSwapModule {}
