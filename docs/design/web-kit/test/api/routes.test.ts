import { describe, it, expect } from 'vitest'
import { GET as slugGET } from '@/app/api/slugs/check/[slug]/route'
import { POST as signupPOST } from '@/app/api/auth/signup/route'
import { GET as provGET } from '@/app/api/provision/status/[jobId]/route'

describe('API: slug availability', () => {
  it('reports taken vs available (case-insensitive)', async () => {
    const taken = await slugGET(new Request('http://test'), { params: Promise.resolve({ slug: 'Admin' }) })
    expect(await taken.json()).toEqual({ available: false })
    const free = await slugGET(new Request('http://test'), { params: Promise.resolve({ slug: 'acme' }) })
    expect(await free.json()).toEqual({ available: true })
  })
})

describe('API: signup', () => {
  it('returns 409 for a taken slug', async () => {
    const r = await signupPOST(new Request('http://test', { method: 'POST', body: JSON.stringify({ slug: 'demo' }) }))
    expect(r.status).toBe(409)
    expect((await r.json()).field).toBe('slug')
  })

  it('returns 202 + jobId for a free slug', async () => {
    const r = await signupPOST(
      new Request('http://test', { method: 'POST', body: JSON.stringify({ slug_normalized: 'nowa-firma-123' }) }),
    )
    expect(r.status).toBe(202)
    expect((await r.json()).jobId).toMatch(/^job-/)
  })

  it('does not throw on a malformed body', async () => {
    const r = await signupPOST(new Request('http://test', { method: 'POST', body: 'not-json' }))
    expect(r.status).toBe(202) // empty slug -> not taken -> provisioning starts
  })
})

describe('API: provisioning status', () => {
  it('returns a valid pipeline step and no error', async () => {
    const r = await provGET(new Request('http://test'), { params: Promise.resolve({ jobId: 'job-1' }) })
    const j = await r.json()
    expect(['CREATE_DB', 'RUN_MIGRATIONS', 'SEED', 'KEYCLOAK_SETUP', 'DONE']).toContain(j.step)
    expect(j.error).toBeNull()
  })
})
