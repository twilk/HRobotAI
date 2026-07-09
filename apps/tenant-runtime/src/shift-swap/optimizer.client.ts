import { Injectable, Logger } from '@nestjs/common'
import { type ProblemInput, type SolveResult, SolveResultSchema } from '@hrobot/shared'

/**
 * Port to the grafik-optimizer `POST /solve` service (the FROZEN `@hrobot/shared` contract). Kept as
 * an injectable seam so the feasibility validator can be unit-tested against a mocked solver without
 * a live optimizer (criterion SW2). D2 provides the HTTP implementation below.
 */
export interface OptimizerClient {
  solve(problem: ProblemInput): Promise<SolveResult>
}

/** DI token for {@link OptimizerClient}. Tests override this with a stub returning INFEASIBLE/OPTIMAL. */
export const OPTIMIZER_CLIENT = Symbol('OPTIMIZER_CLIENT')

/** Compose-service default; overridable via `OPTIMIZER_URL` (do NOT edit docker-compose for this). */
export const DEFAULT_OPTIMIZER_URL = 'http://optimizer:8000'

/**
 * HTTP client for the optimizer `POST /solve` endpoint. Reads the base URL from `OPTIMIZER_URL`
 * (default {@link DEFAULT_OPTIMIZER_URL}). The response is parsed through the frozen
 * {@link SolveResultSchema}, so a malformed reply throws rather than being mistaken for feasible.
 */
@Injectable()
export class HttpOptimizerClient implements OptimizerClient {
  private readonly logger = new Logger(HttpOptimizerClient.name)
  private readonly baseUrl: string = process.env.OPTIMIZER_URL ?? DEFAULT_OPTIMIZER_URL

  async solve(problem: ProblemInput): Promise<SolveResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/solve`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(problem),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      this.logger.error(`Optimizer /solve failed: HTTP ${res.status} ${detail.slice(0, 200)}`)
      throw new Error(`Optimizer /solve returned HTTP ${res.status}`)
    }
    return SolveResultSchema.parse(await res.json())
  }
}
