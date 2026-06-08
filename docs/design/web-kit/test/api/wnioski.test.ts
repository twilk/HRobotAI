import { describe, it, expect } from 'vitest'
import { GET, POST } from '@/app/api/wnioski/route'
import { PATCH } from '@/app/api/wnioski/[id]/route'

function makeRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options)
}

describe('GET /api/wnioski', () => {
  it('returns all seed requests (at least 6)', async () => {
    const res = await GET(makeRequest('http://test/api/wnioski'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(6)
  })

  it('each item has required fields', async () => {
    const res = await GET(makeRequest('http://test/api/wnioski'))
    const body = await res.json()
    for (const r of body) {
      expect(r.id).toBeTruthy()
      expect(r.employeeId).toBeTruthy()
      expect(r.employeeName).toBeTruthy()
      expect(r.type).toBeTruthy()
      expect(r.status).toBeTruthy()
      expect(r.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.days).toBeGreaterThan(0)
    }
  })

  it('filters by status=pending query param', async () => {
    const res = await GET(makeRequest('http://test/api/wnioski?status=pending'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.every((r: { status: string }) => r.status === 'pending')).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(1)
  })

  it('filters by status=approved query param', async () => {
    const res = await GET(makeRequest('http://test/api/wnioski?status=approved'))
    const body = await res.json()
    expect(body.every((r: { status: string }) => r.status === 'approved')).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(1)
  })

  it('filters by employeeId query param', async () => {
    const res = await GET(makeRequest('http://test/api/wnioski?employeeId=1'))
    const body = await res.json()
    expect(body.every((r: { employeeId: string }) => r.employeeId === '1')).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(1)
  })

  it('returns empty array for unknown employeeId', async () => {
    const res = await GET(makeRequest('http://test/api/wnioski?employeeId=nonexistent-xyz'))
    const body = await res.json()
    expect(body).toHaveLength(0)
  })
})

describe('POST /api/wnioski', () => {
  it('creates a new leave request and returns 201 with the created item', async () => {
    const payload = {
      employeeId: '1',
      employeeName: 'Anna Nowak',
      type: 'urlop-wypoczynkowy',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-10',
      days: 8,
      reason: 'Urlop jesienny',
    }
    const res = await POST(
      makeRequest('http://test/api/wnioski', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeTruthy()
    expect(body.status).toBe('pending')
    expect(body.employeeId).toBe('1')
    expect(body.type).toBe('urlop-wypoczynkowy')
    expect(body.requestedAt).toBeTruthy()
  })

  it('returns 400 when employeeId is missing', async () => {
    const res = await POST(
      makeRequest('http://test/api/wnioski', {
        method: 'POST',
        body: JSON.stringify({ employeeName: 'Ktoś', type: 'inne', dateFrom: '2026-10-01', dateTo: '2026-10-01', days: 1 }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 400 when type is missing', async () => {
    const res = await POST(
      makeRequest('http://test/api/wnioski', {
        method: 'POST',
        body: JSON.stringify({ employeeId: '1', employeeName: 'Anna Nowak', dateFrom: '2026-10-01', dateTo: '2026-10-01', days: 1 }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('created request appears in GET list', async () => {
    const payload = {
      employeeId: '3',
      employeeName: 'Katarzyna Wójcik',
      type: 'inne',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-01',
      days: 1,
    }
    const postRes = await POST(
      makeRequest('http://test/api/wnioski', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    )
    const created = await postRes.json()
    const getRes = await GET(makeRequest(`http://test/api/wnioski?employeeId=3`))
    const list = await getRes.json()
    expect(list.some((r: { id: string }) => r.id === created.id)).toBe(true)
  })
})

describe('PATCH /api/wnioski/[id]', () => {
  it('approves a pending request', async () => {
    // First create one
    const postRes = await POST(
      makeRequest('http://test/api/wnioski', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: '2',
          employeeName: 'Piotr Wiśniewski',
          type: 'urlop-wypoczynkowy',
          dateFrom: '2026-12-01',
          dateTo: '2026-12-05',
          days: 5,
        }),
      }),
    )
    const { id } = await postRes.json()

    const res = await PATCH(
      makeRequest(`http://test/api/wnioski/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'approved', approvedBy: 'Jan Kowalski', approvedAt: '2026-06-08T12:00:00.000Z' }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('approved')
    expect(body.approvedBy).toBe('Jan Kowalski')
  })

  it('rejects a pending request with a reason', async () => {
    const postRes = await POST(
      makeRequest('http://test/api/wnioski', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: '4',
          employeeName: 'Tomasz Kamiński',
          type: 'inne',
          dateFrom: '2026-12-20',
          dateTo: '2026-12-20',
          days: 1,
        }),
      }),
    )
    const { id } = await postRes.json()

    const res = await PATCH(
      makeRequest(`http://test/api/wnioski/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected', rejectionReason: 'Brak dostępności' }),
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('rejected')
    expect(body.rejectionReason).toBe('Brak dostępności')
  })

  it('returns 404 for unknown id', async () => {
    const res = await PATCH(
      makeRequest('http://test/api/wnioski/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'approved' }),
      }),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    )
    expect(res.status).toBe(404)
  })
})
