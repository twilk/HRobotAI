import { describe, it, expect, beforeEach } from 'vitest'
import { resetShifts } from '@/lib/schedule'
import { GET, POST } from '@/app/api/grafik/shifts/route'
import { DELETE, PATCH } from '@/app/api/grafik/shifts/[id]/route'

function makeRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options)
}

beforeEach(() => {
  resetShifts()
})

describe('GET /api/grafik/shifts', () => {
  it('returns 200 with an empty array when no shifts exist', async () => {
    const res = await GET(makeRequest('http://test/api/grafik/shifts'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })

  it('returns added shifts', async () => {
    await POST(
      makeRequest('http://test/api/grafik/shifts', {
        method: 'POST',
        body: JSON.stringify({ employeeId: '1', facilityId: 'f1', date: '2026-06-02', timeFrom: '08:00', timeTo: '16:00' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const res = await GET(makeRequest('http://test/api/grafik/shifts'))
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].employeeId).toBe('1')
  })

  it('filters by facilityId', async () => {
    await POST(makeRequest('http://test/api/grafik/shifts', {
      method: 'POST',
      body: JSON.stringify({ employeeId: '1', facilityId: 'f1', date: '2026-06-02', timeFrom: '08:00', timeTo: '16:00' }),
      headers: { 'Content-Type': 'application/json' },
    }))
    await POST(makeRequest('http://test/api/grafik/shifts', {
      method: 'POST',
      body: JSON.stringify({ employeeId: '2', facilityId: 'f2', date: '2026-06-02', timeFrom: '06:00', timeTo: '14:00' }),
      headers: { 'Content-Type': 'application/json' },
    }))
    const res = await GET(makeRequest('http://test/api/grafik/shifts?facilityId=f1'))
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].facilityId).toBe('f1')
  })

  it('filters by weekStart', async () => {
    await POST(makeRequest('http://test/api/grafik/shifts', {
      method: 'POST',
      body: JSON.stringify({ employeeId: '1', facilityId: 'f1', date: '2026-06-01', timeFrom: '08:00', timeTo: '16:00' }),
      headers: { 'Content-Type': 'application/json' },
    }))
    await POST(makeRequest('http://test/api/grafik/shifts', {
      method: 'POST',
      body: JSON.stringify({ employeeId: '1', facilityId: 'f1', date: '2026-06-08', timeFrom: '08:00', timeTo: '16:00' }),
      headers: { 'Content-Type': 'application/json' },
    }))
    const res = await GET(makeRequest('http://test/api/grafik/shifts?weekStart=2026-06-01'))
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].date).toBe('2026-06-01')
  })
})

describe('POST /api/grafik/shifts', () => {
  it('returns 201 with the created shift', async () => {
    const res = await POST(
      makeRequest('http://test/api/grafik/shifts', {
        method: 'POST',
        body: JSON.stringify({ employeeId: '1', facilityId: 'f1', date: '2026-06-02', timeFrom: '08:00', timeTo: '16:00' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeTruthy()
    expect(body.employeeId).toBe('1')
    expect(body.facilityId).toBe('f1')
    expect(body.date).toBe('2026-06-02')
    expect(body.start).toBe('08:00')
    expect(body.end).toBe('16:00')
  })

  it('accepts an optional role field', async () => {
    const res = await POST(
      makeRequest('http://test/api/grafik/shifts', {
        method: 'POST',
        body: JSON.stringify({ employeeId: '2', facilityId: 'f2', date: '2026-06-03', timeFrom: '06:00', timeTo: '14:00', role: 'kierownik' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.role).toBe('kierownik')
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(
      makeRequest('http://test/api/grafik/shifts', {
        method: 'POST',
        body: JSON.stringify({ employeeId: '1' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })
})

describe('DELETE /api/grafik/shifts/[id]', () => {
  it('removes an existing shift and returns 200', async () => {
    const postRes = await POST(
      makeRequest('http://test/api/grafik/shifts', {
        method: 'POST',
        body: JSON.stringify({ employeeId: '1', facilityId: 'f1', date: '2026-06-02', timeFrom: '08:00', timeTo: '16:00' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { id } = await postRes.json()

    const res = await DELETE(
      makeRequest(`http://test/api/grafik/shifts/${id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 404 for an unknown shift id', async () => {
    const res = await DELETE(
      makeRequest('http://test/api/grafik/shifts/nonexistent', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })
})

describe('PATCH /api/grafik/shifts/[id]', () => {
  it('updates an existing shift and returns 200', async () => {
    const postRes = await POST(
      makeRequest('http://test/api/grafik/shifts', {
        method: 'POST',
        body: JSON.stringify({ employeeId: '1', facilityId: 'f1', date: '2026-06-02', timeFrom: '08:00', timeTo: '16:00' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { id } = await postRes.json()

    const res = await PATCH(
      makeRequest(`http://test/api/grafik/shifts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ start: '09:00', end: '17:00' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.start).toBe('09:00')
    expect(body.end).toBe('17:00')
    expect(body.employeeId).toBe('1') // unchanged
  })

  it('returns 404 for an unknown shift id', async () => {
    const res = await PATCH(
      makeRequest('http://test/api/grafik/shifts/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ start: '10:00' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('persists the patch — subsequent GET reflects updated values', async () => {
    const postRes = await POST(
      makeRequest('http://test/api/grafik/shifts', {
        method: 'POST',
        body: JSON.stringify({ employeeId: '1', facilityId: 'f1', date: '2026-06-02', timeFrom: '08:00', timeTo: '16:00' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { id } = await postRes.json()

    await PATCH(
      makeRequest(`http://test/api/grafik/shifts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ start: '10:00' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id }) },
    )

    const getRes = await GET(makeRequest('http://test/api/grafik/shifts'))
    const shifts = await getRes.json()
    expect(shifts[0].start).toBe('10:00')
  })
})
