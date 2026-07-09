import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { type ProblemInput, type SolveResult, SolveResultSchema } from '@hrobot/shared'

/** DI token for the optimizer client so `GrafikService` can be handed a mock in tests. */
export const OPTIMIZER_CLIENT = Symbol('OPTIMIZER_CLIENT')

/** Transport-agnostic seam to the grafik-optimizer `POST /solve` endpoint. */
export interface OptimizerClient {
  solve(problem: ProblemInput): Promise<SolveResult>
}

/**
 * HTTP implementation talking to the grafik-optimizer FastAPI service.
 *
 * The base URL comes from `OPTIMIZER_URL`, defaulting to the compose service name
 * `http://optimizer:8000` (resolves on the compose network — we do NOT edit docker-compose). The
 * response is validated against the frozen `SolveResultSchema` before it leaves the client, so
 * callers always get a well-formed `SolveResult` or an exception.
 */
@Injectable()
export class HttpOptimizerClient implements OptimizerClient {
  private readonly logger = new Logger(HttpOptimizerClient.name)

  private baseUrl(): string {
    return process.env.OPTIMIZER_URL ?? 'http://optimizer:8000'
  }

  async solve(problem: ProblemInput): Promise<SolveResult> {
    const url = `${this.baseUrl()}/solve`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(problem),
      })
    } catch (err) {
      this.logger.error(`optimizer request to ${url} failed: ${String(err)}`)
      throw new ServiceUnavailableException('grafik-optimizer is unreachable')
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      this.logger.error(`optimizer /solve returned ${res.status}: ${detail}`)
      throw new ServiceUnavailableException(`grafik-optimizer /solve failed with status ${res.status}`)
    }
    return SolveResultSchema.parse(await res.json())
  }
}
