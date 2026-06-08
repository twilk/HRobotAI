import { describe, it, expect, beforeEach } from 'vitest'
import { resetFacilities } from '@/lib/facilities'
import { GET as GET_ALL } from '@/app/api/facilities/route'
import { GET as GET_ONE, PATCH } from '@/app/api/facilities/[id]/route'

function makeRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options)
}

beforeEach(() => {
  resetFacilities()
})

describe('GET /api/facilities', () => {
  it('returns 200 with all facilities', async () => {
    const res = await GET_ALL(makeRequest('http://test/api/facilities'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(3)
  })

  it('each facility has id, name, location, address, hours, employeeIds', async () => {
    const res = await GET_ALL(makeRequest('http://test/api/facilities'))
    const body = await res.json()
    for (const f of body) {
      expect(f.id).toBeTruthy()
      expect(f.name).toBeTruthy()
      expect(f.location).toBeTruthy()
      expect(typeof f.address).toBe('object')
      expect(Array.isArray(f.hours)).toBe(true)
      expect(f.hours).toHaveLength(7)
      expect(Array.isArray(f.employeeIds)).toBe(true)
    }
  })
})

describe('GET /api/facilities/[id]', () => {
  it('returns 200 with a single facility', async () => {
    const res = await GET_ONE(
      makeRequest('http://test/api/facilities/f1'),
      { params: Promise.resolve({ id: 'f1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('f1')
    expect(body.name).toBe('Centrala Warszawa')
  })

  it('returns 404 for unknown id', async () => {
    const res = await GET_ONE(
      makeRequest('http://test/api/facilities/nonexistent'),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })
})

describe('PATCH /api/facilities/[id]', () => {
  it('updates address fields and returns 200 with updated facility', async () => {
    const res = await PATCH(
      makeRequest('http://test/api/facilities/f1', {
        method: 'PATCH',
        body: JSON.stringify({ address: { street: 'ul. Nowa 99' } }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'f1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.address.street).toBe('ul. Nowa 99')
    expect(body.address.city).toBe('Warszawa') // unchanged
  })

  it('updates hours and returns 200 with updated facility', async () => {
    const newHours = [
      { open: '09:00', close: '17:00' },
      { open: '09:00', close: '17:00' },
      { open: '09:00', close: '17:00' },
      { open: '09:00', close: '17:00' },
      { open: '09:00', close: '17:00' },
      null,
      null,
    ]
    const res = await PATCH(
      makeRequest('http://test/api/facilities/f2', {
        method: 'PATCH',
        body: JSON.stringify({ hours: newHours }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'f2' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hours[0]).toEqual({ open: '09:00', close: '17:00' })
    expect(body.hours[5]).toBeNull()
  })

  it('can update address and hours together', async () => {
    const res = await PATCH(
      makeRequest('http://test/api/facilities/f3', {
        method: 'PATCH',
        body: JSON.stringify({
          address: { postalCode: '11-111' },
          hours: [null, null, null, null, null, null, null],
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'f3' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.address.postalCode).toBe('11-111')
    expect(body.hours[0]).toBeNull()
  })

  it('persists changes — subsequent GET reflects updated values', async () => {
    await PATCH(
      makeRequest('http://test/api/facilities/f1', {
        method: 'PATCH',
        body: JSON.stringify({ address: { city: 'Łódź' } }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'f1' }) },
    )
    const getRes = await GET_ONE(
      makeRequest('http://test/api/facilities/f1'),
      { params: Promise.resolve({ id: 'f1' }) },
    )
    const body = await getRes.json()
    expect(body.address.city).toBe('Łódź')
  })

  it('returns 404 for unknown id', async () => {
    const res = await PATCH(
      makeRequest('http://test/api/facilities/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ address: { city: 'X' } }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })
})
