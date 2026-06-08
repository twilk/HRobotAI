import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  it('returns 200 with ok: true', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns service identifier', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.service).toBe('hrobot-web-kit')
  })

  it('does not leak stack traces or error details', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.error).toBeUndefined()
    expect(body.stack).toBeUndefined()
  })
})
