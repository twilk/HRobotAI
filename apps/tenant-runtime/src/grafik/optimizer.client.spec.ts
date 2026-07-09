import { ServiceUnavailableException } from '@nestjs/common'
import { SolveStatus, type ProblemInput } from '@hrobot/shared'
import { HttpOptimizerClient } from './optimizer.client.js'

const PROBLEM: ProblemInput = {
  horizon: { weekStart: '2026-07-13' },
  locations: [],
  employees: [],
  demands: [],
  travelMatrix: [],
  weights: { d: 1, e: 1, g: 1 },
  solverConfig: { seed: 42, timeLimit: 10 },
}

const OK_RESULT = {
  status: SolveStatus.OPTIMAL,
  assignments: [{ employeeId: 'emp-1', demandId: 'dem-1' }],
  metrics: { commuteTotal: 0, etatDeviation: 0, fairnessScore: 0 },
  unmet: [],
}

describe('HttpOptimizerClient', () => {
  const realFetch = global.fetch
  const realUrl = process.env.OPTIMIZER_URL
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => {
    global.fetch = realFetch
    if (realUrl === undefined) delete process.env.OPTIMIZER_URL
    else process.env.OPTIMIZER_URL = realUrl
  })

  it('POSTs to the compose default URL and parses a valid SolveResult', async () => {
    delete process.env.OPTIMIZER_URL
    fetchMock.mockResolvedValue({ ok: true, json: async () => OK_RESULT })

    const result = await new HttpOptimizerClient().solve(PROBLEM)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://optimizer:8000/solve',
      expect.objectContaining({ method: 'POST', headers: { 'content-type': 'application/json' } }),
    )
    expect(result.status).toBe(SolveStatus.OPTIMAL)
    expect(result.assignments).toHaveLength(1)
  })

  it('honours OPTIMIZER_URL override', async () => {
    process.env.OPTIMIZER_URL = 'http://localhost:9999'
    fetchMock.mockResolvedValue({ ok: true, json: async () => OK_RESULT })

    await new HttpOptimizerClient().solve(PROBLEM)

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9999/solve')
  })

  it('throws ServiceUnavailable on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })
    await expect(new HttpOptimizerClient().solve(PROBLEM)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('throws ServiceUnavailable when the optimizer is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(new HttpOptimizerClient().solve(PROBLEM)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
