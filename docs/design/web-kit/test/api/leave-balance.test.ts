import { describe, it, expect, beforeEach } from 'vitest'
import { GET as GETAll } from '@/app/api/leave-balance/route'
import { GET as GETOne, PATCH } from '@/app/api/leave-balance/[employeeId]/route'
import { resetLeaveBalances } from '@/lib/leave-balance'

function makeRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options)
}

describe('GET /api/leave-balance', () => {
  beforeEach(() => resetLeaveBalances())

  it('returns an array of balances', async () => {
    const res = await GETAll(makeRequest('http://test/api/leave-balance'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('returns all 4 seed balances for current year', async () => {
    const res = await GETAll(makeRequest('http://test/api/leave-balance'))
    const body = await res.json()
    expect(body).toHaveLength(4)
  })

  it('each balance has required fields', async () => {
    const res = await GETAll(makeRequest('http://test/api/leave-balance'))
    const body = await res.json()
    for (const b of body) {
      expect(b.id).toBeTruthy()
      expect(b.employeeId).toBeTruthy()
      expect(b.employeeName).toBeTruthy()
      expect(b.year).toBeGreaterThan(2020)
      expect(b.urlop_wypoczynkowy).toBeDefined()
      expect(b.urlop_ojcowski).toBeDefined()
      expect(b.inne).toBeDefined()
    }
  })

  it('accepts year query param', async () => {
    const res = await GETAll(makeRequest('http://test/api/leave-balance?year=2026'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.every((b: { year: number }) => b.year === 2026)).toBe(true)
  })
})

describe('GET /api/leave-balance/[employeeId]', () => {
  beforeEach(() => resetLeaveBalances())

  it('returns balance for known employee', async () => {
    const res = await GETOne(
      makeRequest('http://test/api/leave-balance/1'),
      { params: Promise.resolve({ employeeId: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.employeeId).toBe('1')
    expect(body.employeeName).toBe('Anna Nowak')
  })

  it('returns 404 for unknown employee', async () => {
    const res = await GETOne(
      makeRequest('http://test/api/leave-balance/999'),
      { params: Promise.resolve({ employeeId: '999' }) },
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('returns correct urlop_wypoczynkowy entitled=26', async () => {
    const res = await GETOne(
      makeRequest('http://test/api/leave-balance/1'),
      { params: Promise.resolve({ employeeId: '1' }) },
    )
    const body = await res.json()
    expect(body.urlop_wypoczynkowy.entitled).toBe(26)
  })
})

describe('PATCH /api/leave-balance/[employeeId]', () => {
  beforeEach(() => resetLeaveBalances())

  it('deducts days from urlop-wypoczynkowy and returns updated balance', async () => {
    const getBefore = await GETOne(
      makeRequest('http://test/api/leave-balance/1'),
      { params: Promise.resolve({ employeeId: '1' }) },
    )
    const before = await getBefore.json()
    const remaining = before.urlop_wypoczynkowy.remaining

    const res = await PATCH(
      makeRequest('http://test/api/leave-balance/1', {
        method: 'PATCH',
        body: JSON.stringify({ leaveType: 'urlop-wypoczynkowy', days: 3 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ employeeId: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.urlop_wypoczynkowy.remaining).toBe(remaining - 3)
  })

  it('returns 400 when insufficient balance', async () => {
    const res = await PATCH(
      makeRequest('http://test/api/leave-balance/1', {
        method: 'PATCH',
        body: JSON.stringify({ leaveType: 'urlop-wypoczynkowy', days: 9999 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ employeeId: '1' }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 400 when leaveType missing', async () => {
    const res = await PATCH(
      makeRequest('http://test/api/leave-balance/1', {
        method: 'PATCH',
        body: JSON.stringify({ days: 3 }),
      }),
      { params: Promise.resolve({ employeeId: '1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown employee', async () => {
    const res = await PATCH(
      makeRequest('http://test/api/leave-balance/999', {
        method: 'PATCH',
        body: JSON.stringify({ leaveType: 'inne', days: 1 }),
      }),
      { params: Promise.resolve({ employeeId: '999' }) },
    )
    expect(res.status).toBe(404)
  })

  it('deducts inne leave type correctly', async () => {
    const getBefore = await GETOne(
      makeRequest('http://test/api/leave-balance/2'),
      { params: Promise.resolve({ employeeId: '2' }) },
    )
    const before = await getBefore.json()
    const remaining = before.inne.remaining

    const res = await PATCH(
      makeRequest('http://test/api/leave-balance/2', {
        method: 'PATCH',
        body: JSON.stringify({ leaveType: 'inne', days: 2 }),
      }),
      { params: Promise.resolve({ employeeId: '2' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inne.remaining).toBe(remaining - 2)
  })
})
