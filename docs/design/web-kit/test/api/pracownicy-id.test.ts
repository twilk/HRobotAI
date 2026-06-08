import { describe, it, expect, beforeEach } from 'vitest'
import { GET, PATCH } from '@/app/api/pracownicy/[id]/route'
import { resetEmployees } from '@/lib/employees'

function req(url: string, options?: RequestInit): Request {
  return new Request(url, options)
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  resetEmployees()
})

describe('GET /api/pracownicy/[id]', () => {
  it('returns employee for known id', async () => {
    const res = await GET(req('http://test/api/pracownicy/1'), params('1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('1')
    expect(body.lastName).toBe('Nowak')
  })

  it('returns 404 for unknown id', async () => {
    const res = await GET(req('http://test/api/pracownicy/999'), params('999'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('response has required fields', async () => {
    const res = await GET(req('http://test/api/pracownicy/2'), params('2'))
    const body = await res.json()
    expect(body.firstName).toBeTruthy()
    expect(body.lastName).toBeTruthy()
    expect(body.email).toBeTruthy()
    expect(body.position).toBeTruthy()
    expect(body.status).toBeTruthy()
  })
})

describe('PATCH /api/pracownicy/[id]', () => {
  it('updates name fields', async () => {
    const res = await PATCH(
      req('http://test/api/pracownicy/1', {
        method: 'PATCH',
        body: JSON.stringify({ firstName: 'Zofia', lastName: 'Testowa' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      params('1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.firstName).toBe('Zofia')
    expect(body.lastName).toBe('Testowa')
  })

  it("updates status to 'inactive'", async () => {
    const res = await PATCH(
      req('http://test/api/pracownicy/1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'inactive' }),
      }),
      params('1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('inactive')
  })

  it("updates status to 'on-leave'", async () => {
    const res = await PATCH(
      req('http://test/api/pracownicy/2', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'on-leave' }),
      }),
      params('2'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('on-leave')
  })

  it('updates position and unit simultaneously', async () => {
    const res = await PATCH(
      req('http://test/api/pracownicy/3', {
        method: 'PATCH',
        body: JSON.stringify({ position: 'Lead HR', unit: 'People & Culture' }),
      }),
      params('3'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.position).toBe('Lead HR')
    expect(body.unit).toBe('People & Culture')
  })

  it('returns 404 for unknown id', async () => {
    const res = await PATCH(
      req('http://test/api/pracownicy/999', {
        method: 'PATCH',
        body: JSON.stringify({ firstName: 'Ghost' }),
      }),
      params('999'),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 400 for invalid status value', async () => {
    const res = await PATCH(
      req('http://test/api/pracownicy/1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'fired' }),
      }),
      params('1'),
    )
    expect(res.status).toBe(400)
  })
})
