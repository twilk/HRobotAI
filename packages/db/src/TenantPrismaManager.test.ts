import { TenantPrismaManager } from './TenantPrismaManager.js'

interface FakeClient {
  url: string
  connected: boolean
  $connect: jest.Mock
  $disconnect: jest.Mock
}

function makeFakeClient(url: string): FakeClient {
  const client: FakeClient = {
    url,
    connected: false,
    $connect: jest.fn(async () => {
      client.connected = true
    }),
    $disconnect: jest.fn(async () => {
      client.connected = false
    }),
  }
  return client
}

describe('TenantPrismaManager', () => {
  it('resolves the decrypted url and constructs a client on cache miss', async () => {
    const created: FakeClient[] = []
    const resolveDbUrl = jest.fn(async (id: string) => `postgresql://decrypted/${id}`)
    const mgr = new TenantPrismaManager(
      { resolveDbUrl },
      (url) => {
        const c = makeFakeClient(url)
        created.push(c)
        return c as never
      },
    )

    const client = (await mgr.getClient('tenant-a')) as unknown as FakeClient
    expect(resolveDbUrl).toHaveBeenCalledWith('tenant-a')
    expect(client.url).toBe('postgresql://decrypted/tenant-a')
    expect(client.$connect).toHaveBeenCalledTimes(1)
  })

  it('returns the cached client on the second call (factory runs once)', async () => {
    const factory = jest.fn((url: string) => makeFakeClient(url) as never)
    const mgr = new TenantPrismaManager({ resolveDbUrl: async (id) => `url/${id}` }, factory)
    const first = await mgr.getClient('t1')
    const second = await mgr.getClient('t1')
    expect(first).toBe(second)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('disconnects the client on explicit evict', async () => {
    const client = makeFakeClient('url/t1')
    const mgr = new TenantPrismaManager({ resolveDbUrl: async () => 'url/t1' }, () => client as never)
    await mgr.getClient('t1')
    mgr.evict('t1')
    expect(client.$disconnect).toHaveBeenCalledTimes(1)
  })

  it('disconnects the least-recently-used client when capacity is exceeded', async () => {
    const clients = new Map<string, FakeClient>()
    const mgr = new TenantPrismaManager(
      { resolveDbUrl: async (id) => `url/${id}` },
      (url) => {
        const id = url.split('/')[1]!
        const c = makeFakeClient(url)
        clients.set(id, c)
        return c as never
      },
      { maxClients: 2 },
    )
    await mgr.getClient('a')
    await mgr.getClient('b')
    await mgr.getClient('c') // evicts 'a' (LRU)
    expect(clients.get('a')!.$disconnect).toHaveBeenCalledTimes(1)
    expect(clients.get('b')!.$disconnect).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent getClient calls (only one $connect)', async () => {
    const factory = jest.fn((url: string) => makeFakeClient(url) as never)
    const mgr = new TenantPrismaManager({ resolveDbUrl: async (id) => `url/${id}` }, factory)
    const [first, second] = await Promise.all([mgr.getClient('t1'), mgr.getClient('t1')])
    expect(first).toBe(second)
    expect(factory).toHaveBeenCalledTimes(1)
    expect((first as unknown as FakeClient).$connect).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty tenantId', async () => {
    const mgr = new TenantPrismaManager({ resolveDbUrl: async () => 'u' }, () => makeFakeClient('u') as never)
    await expect(mgr.getClient('')).rejects.toThrow(/tenantId/)
    await expect(mgr.getClient('   ')).rejects.toThrow(/tenantId/)
  })

  it('does NOT disconnect a borrowed client when it is evicted mid-query (defers until release)', async () => {
    const client = makeFakeClient('url/t1')
    const mgr = new TenantPrismaManager(
      { resolveDbUrl: async () => 'url/t1' },
      () => client as never,
      { maxClients: 1 },
    )

    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const startedP = new Promise<void>((r) => {
      started = r
    })
    const borrowed = mgr.withClient('t1', async (c) => {
      expect(c as unknown as FakeClient).toBe(client)
      started() // borrow is now open: client cached + leased
      await gate // hold the borrow open
      return 'done'
    })

    await startedP // ensure getClient resolved and the lease is held BEFORE evicting
    // Evict while the borrow is still open — disconnect must be deferred.
    mgr.evict('t1')
    expect(client.$disconnect).not.toHaveBeenCalled()

    release()
    expect(await borrowed).toBe('done')
    expect(client.$disconnect).toHaveBeenCalledTimes(1) // disconnected once the borrow released
  })

  it('disconnectAll disconnects every cached client', async () => {
    const clients: FakeClient[] = []
    const mgr = new TenantPrismaManager(
      { resolveDbUrl: async (id) => `u/${id}` },
      (u) => {
        const c = makeFakeClient(u)
        clients.push(c)
        return c as never
      },
      { maxClients: 10 },
    )
    await mgr.getClient('a')
    await mgr.getClient('b')
    await mgr.disconnectAll()
    expect(clients).toHaveLength(2)
    expect(clients.every((c) => c.$disconnect.mock.calls.length >= 1)).toBe(true)
  })
})
