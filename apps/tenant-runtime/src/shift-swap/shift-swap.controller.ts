import { Controller } from '@nestjs/common'

/**
 * Shift-swap controller seam. No routes yet — M2-D2 adds the endpoints (POST /shift-swap,
 * /:id/submit, /:id/peer-decision, /:id/manager-decision, GET /shift-swap) with the tenant-runtime
 * RBAC + audit interceptors, per the `employees` module. Present now only so D2 forks without an
 * `app.module.ts` collision, mirroring the `grafik` controller stub.
 */
@Controller('shift-swap')
export class ShiftSwapController {}
