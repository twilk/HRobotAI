import { Injectable } from '@nestjs/common'
import { ProblemInputSchema, SolveResultSchema } from '@hrobot/shared'

/**
 * Landing seam for the Grafik (Rdzeń Grafiku) module.
 *
 * Intentionally empty in M2-A1: CRUD/RBAC endpoints, demand generation, and the optimizer HTTP
 * client are built by M2-A3. Referencing the frozen `@hrobot/shared` grafik contract here proves
 * the envelope resolves from tenant-runtime and pins the sync point A3 forks from.
 */
@Injectable()
export class GrafikService {
  /** Frozen solver contract (Zod). A3 replaces this anchor with the real optimizer client. */
  readonly contract = { ProblemInputSchema, SolveResultSchema }
}
