import { Controller } from '@nestjs/common'

/**
 * Grafik controller seam. No routes yet — M2-A3 adds the CRUD/RBAC endpoints (using the existing
 * tenant-runtime RBAC + audit interceptors, per the `employees` module). Present now only so A3
 * forks without an `app.module.ts` collision.
 */
@Controller('grafik')
export class GrafikController {}
