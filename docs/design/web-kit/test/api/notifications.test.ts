import { describe, it, expect, beforeEach } from 'vitest'
import { resetNotifications } from '@/lib/notifications'
import { GET, POST } from '@/app/api/notifications/route'
import { PATCH } from '@/app/api/notifications/[id]/route'
import { POST as postReadAll } from '@/app/api/notifications/read-all/route'

beforeEach(() => {
  resetNotifications()
})

function req(url: string, options?: RequestInit): Request {
  return new Request(url, options)
}

describe('GET /api/notifications', () => {
  it('returns a notifications array with at least 8 items', async () => {
    const res = await GET(req('http://test/api/notifications'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(8)
  })

  it('items have required fields', async () => {
    const res = await GET(req('http://test/api/notifications'))
    const body = await res.json()
    for (const n of body) {
      expect(n.id).toBeTruthy()
      expect(n.type).toBeTruthy()
      expect(n.priority).toBeTruthy()
      expect(n.title).toBeTruthy()
      expect(n.message).toBeTruthy()
      expect(typeof n.read).toBe('boolean')
      expect(n.createdAt).toBeTruthy()
    }
  })

  it('sorted by createdAt descending', async () => {
    const res = await GET(req('http://test/api/notifications'))
    const body = await res.json()
    for (let i = 1; i < body.length; i++) {
      expect(body[i - 1].createdAt >= body[i].createdAt).toBe(true)
    }
  })

  it('filters with unreadOnly=true', async () => {
    const res = await GET(req('http://test/api/notifications?unreadOnly=true'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.every((n: { read: boolean }) => !n.read)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
  })

  it('respects limit param', async () => {
    const res = await GET(req('http://test/api/notifications?limit=3'))
    const body = await res.json()
    expect(body.length).toBeLessThanOrEqual(3)
  })
})

describe('POST /api/notifications', () => {
  it('creates a new notification and returns 201', async () => {
    const payload = {
      type: 'employee-added',
      priority: 'medium',
      title: 'Nowy pracownik',
      message: 'Pracownik dołączył do systemu.',
      employeeId: 'emp-77',
      employeeName: 'Jan Testowy',
      actionUrl: '/pracownicy',
    }
    const res = await POST(
      req('http://test/api/notifications', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeTruthy()
    expect(body.read).toBe(false)
    expect(body.type).toBe('employee-added')
    expect(body.createdAt).toBeTruthy()
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(
      req('http://test/api/notifications', {
        method: 'POST',
        body: JSON.stringify({ priority: 'low' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/notifications/[id]', () => {
  it('marks a single notification as read', async () => {
    const listRes = await GET(req('http://test/api/notifications?unreadOnly=true'))
    const unread = await listRes.json()
    const target = unread[0]

    const res = await PATCH(
      req(`http://test/api/notifications/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ read: true }),
      }),
      { params: Promise.resolve({ id: target.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.read).toBe(true)
  })

  it('returns 404 for unknown id', async () => {
    const res = await PATCH(
      req('http://test/api/notifications/does-not-exist', {
        method: 'PATCH',
        body: JSON.stringify({ read: true }),
      }),
      { params: Promise.resolve({ id: 'does-not-exist' }) },
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/notifications/read-all', () => {
  it('marks all unread and returns markedRead count', async () => {
    const unreadBefore = await GET(req('http://test/api/notifications?unreadOnly=true'))
    const unreadList = await unreadBefore.json()
    const expectedCount = unreadList.length
    expect(expectedCount).toBeGreaterThan(0)

    const res = await postReadAll(
      req('http://test/api/notifications/read-all', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.markedRead).toBe(expectedCount)
  })

  it('returns markedRead: 0 when nothing is unread', async () => {
    // first call clears all
    await postReadAll(req('http://test/api/notifications/read-all', { method: 'POST' }))
    const res = await postReadAll(req('http://test/api/notifications/read-all', { method: 'POST' }))
    const body = await res.json()
    expect(body.markedRead).toBe(0)
  })
})
