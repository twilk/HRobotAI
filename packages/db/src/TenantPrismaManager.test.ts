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
    const mgr = new TenantPrismaManager(
      { resolveDbUrl: async (id) => `url/${id}` },
      factory,
    )
    const first = await mgr.getClient('t1')
    const second = await mgr.getClient('t1')
    expect(first).toBe(second)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('disconnects the client on explicit evict', async () => {
    const client = makeFakeClient('url/t1')
    const mgr = new TenantPrismaManager(
      { resolveDbUrl: async () => 'url/t1' },
      () => client as never,
    )
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
      { max: 2 },
    )
    await mgr.getClient('a')
    await mgr.getClient('b')
    await mgr.getClient('c') // evicts 'a' (LRU)
    expect(clients.get('a')!.$disconnect).toHaveBeenCalledTimes(1)
    expect(clients.get('b')!.$disconnect).not.toHaveBeenCalled()
  })
})
