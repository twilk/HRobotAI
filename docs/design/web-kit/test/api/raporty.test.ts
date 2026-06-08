import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/raporty/route'

function makeRequest(url: string): Request {
  return new Request(url)
}

describe('GET /api/raporty', () => {
  it('returns 200', async () => {
    const res = await GET(makeRequest('http://test/api/raporty'))
    expect(res.status).toBe(200)
  })

  it('returns a JSON body with the HRSummary shape', async () => {
    const res = await GET(makeRequest('http://test/api/raporty'))
    const body = await res.json()
    expect(body.employees).toBeDefined()
    expect(body.leave).toBeDefined()
    expect(body.schedule).toBeDefined()
    expect(body.access).toBeDefined()
    expect(typeof body.generatedAt).toBe('string')
  })

  it('employees.total matches seed count of 6', async () => {
    const res = await GET(makeRequest('http://test/api/raporty'))
    const { employees } = await res.json()
    expect(employees.total).toBe(6)
  })

  it('leave stats are present and have expected structure', async () => {
    const res = await GET(makeRequest('http://test/api/raporty'))
    const { leave } = await res.json()
    expect(typeof leave.pending).toBe('number')
    expect(typeof leave.approved).toBe('number')
    expect(typeof leave.rejected).toBe('number')
    expect(typeof leave.thisMonth).toBe('number')
    // seed: 2 pending + 3 approved + 1 rejected = 6
    expect(leave.pending + leave.approved + leave.rejected).toBeGreaterThanOrEqual(6)
  })

  it('schedule.coverageByFacility contains 3 entries', async () => {
    const res = await GET(makeRequest('http://test/api/raporty'))
    const { schedule } = await res.json()
    expect(Array.isArray(schedule.coverageByFacility)).toBe(true)
    expect(schedule.coverageByFacility).toHaveLength(3)
  })

  it('access.moduleAdoption is a non-empty array', async () => {
    const res = await GET(makeRequest('http://test/api/raporty'))
    const { access } = await res.json()
    expect(Array.isArray(access.moduleAdoption)).toBe(true)
    expect(access.moduleAdoption.length).toBeGreaterThan(0)
  })

  it('generatedAt is parseable as an ISO date', async () => {
    const res = await GET(makeRequest('http://test/api/raporty'))
    const { generatedAt } = await res.json()
    expect(new Date(generatedAt).toISOString()).toBe(generatedAt)
  })
})
