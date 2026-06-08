import { describe, it, expect } from 'vitest'
import { GET as GET_ALL } from '@/app/api/dostepy/route'
import { GET as GET_ONE, PUT } from '@/app/api/dostepy/[employeeId]/route'

function makeRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options)
}

describe('GET /api/dostepy', () => {
  it('returns 200 with an array of summaries', async () => {
    const res = await GET_ALL(makeRequest('http://test/api/dostepy'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(4)
  })

  it('each summary has employeeId, employeeName, and access object', async () => {
    const res = await GET_ALL(makeRequest('http://test/api/dostepy'))
    const body = await res.json()
    for (const s of body) {
      expect(s.employeeId).toBeTruthy()
      expect(s.employeeName).toBeTruthy()
      expect(typeof s.access).toBe('object')
    }
  })

  it('each summary.access has all 5 modules', async () => {
    const res = await GET_ALL(makeRequest('http://test/api/dostepy'))
    const body = await res.json()
    const MODULES = ['grafik', 'wnioski', 'dostepy', 'raporty', 'ustawienia']
    for (const s of body) {
      for (const m of MODULES) {
        expect(s.access[m]).toBeTruthy()
      }
    }
  })
})

describe('GET /api/dostepy/[employeeId]', () => {
  it('returns 200 with one employee summary', async () => {
    const res = await GET_ONE(
      makeRequest('http://test/api/dostepy/1'),
      { params: Promise.resolve({ employeeId: '1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.employeeId).toBe('1')
    expect(body.employeeName).toBeTruthy()
  })

  it('returns summary with 5 modules for employee 3', async () => {
    const res = await GET_ONE(
      makeRequest('http://test/api/dostepy/3'),
      { params: Promise.resolve({ employeeId: '3' }) },
    )
    const body = await res.json()
    const MODULES = ['grafik', 'wnioski', 'dostepy', 'raporty', 'ustawienia']
    for (const m of MODULES) {
      expect(body.access[m]).toBeTruthy()
    }
  })

  it('returns 404 for unknown employeeId', async () => {
    const res = await GET_ONE(
      makeRequest('http://test/api/dostepy/nonexistent'),
      { params: Promise.resolve({ employeeId: 'nonexistent' }) },
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })
})

describe('PUT /api/dostepy/[employeeId]', () => {
  it('updates all module levels and returns 200 with the updated summary', async () => {
    const modules = {
      grafik: 'admin',
      wnioski: 'edycja',
      dostepy: 'podgląd',
      raporty: 'brak',
      ustawienia: 'brak',
    }
    const res = await PUT(
      makeRequest('http://test/api/dostepy/2', {
        method: 'PUT',
        body: JSON.stringify({ modules, grantedBy: 'Jan Kowalski' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ employeeId: '2' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.employeeId).toBe('2')
    expect(body.access.grafik).toBe('admin')
    expect(body.access.wnioski).toBe('edycja')
    expect(body.access.dostepy).toBe('podgląd')
    expect(body.access.raporty).toBe('brak')
    expect(body.access.ustawienia).toBe('brak')
  })

  it('returns 404 for unknown employeeId', async () => {
    const res = await PUT(
      makeRequest('http://test/api/dostepy/nonexistent', {
        method: 'PUT',
        body: JSON.stringify({ modules: { grafik: 'brak', wnioski: 'brak', dostepy: 'brak', raporty: 'brak', ustawienia: 'brak' } }),
      }),
      { params: Promise.resolve({ employeeId: 'nonexistent' }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 when modules body is missing', async () => {
    const res = await PUT(
      makeRequest('http://test/api/dostepy/1', {
        method: 'PUT',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ employeeId: '1' }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('persists change — subsequent GET returns updated values', async () => {
    const modules = {
      grafik: 'edycja',
      wnioski: 'podgląd',
      dostepy: 'brak',
      raporty: 'edycja',
      ustawienia: 'brak',
    }
    await PUT(
      makeRequest('http://test/api/dostepy/4', {
        method: 'PUT',
        body: JSON.stringify({ modules }),
      }),
      { params: Promise.resolve({ employeeId: '4' }) },
    )
    const getRes = await GET_ONE(
      makeRequest('http://test/api/dostepy/4'),
      { params: Promise.resolve({ employeeId: '4' }) },
    )
    const body = await getRes.json()
    expect(body.access.grafik).toBe('edycja')
    expect(body.access.wnioski).toBe('podgląd')
  })
})
