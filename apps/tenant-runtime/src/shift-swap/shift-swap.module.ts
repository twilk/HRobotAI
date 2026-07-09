import { Module } from '@nestjs/common'
import { ShiftSwapController } from './shift-swap.controller.js'
import { ShiftSwapService } from './shift-swap.service.js'
import { SWAP_FEASIBILITY_VALIDATOR } from './swap-feasibility-validator.js'
import { OptimizerSwapFeasibilityValidator } from './optimizer-swap-feasibility.validator.js'
import { OPTIMIZER_CLIENT, HttpOptimizerClient } from './optimizer.client.js'

/**
 * Shift-swap module (M2 #3). D1 shipped the state-machine service + the feasibility seam bound to a
 * no-op; M2-D2 wires the HTTP endpoints and rebinds {@link SWAP_FEASIBILITY_VALIDATOR} to the REAL
 * {@link OptimizerSwapFeasibilityValidator}, which runs each affected employee's post-swap week
 * through the frozen optimizer `POST /solve` ({@link OPTIMIZER_CLIENT}) and rejects an INFEASIBLE
 * (H1–H4-breaking) swap before any `Shift` is mutated.
 */
@Module({
  controllers: [ShiftSwapController],
  providers: [
    ShiftSwapService,
    { provide: OPTIMIZER_CLIENT, useClass: HttpOptimizerClient },
    { provide: SWAP_FEASIBILITY_VALIDATOR, useClass: OptimizerSwapFeasibilityValidator },
  ],
  exports: [ShiftSwapService],
})
export class ShiftSwapModule {}
