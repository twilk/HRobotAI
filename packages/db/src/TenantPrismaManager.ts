import { LRUCache } from 'lru-cache'
import type { TenantClient } from './clients.js'

export interface TenantConnectionResolver {
  /** Returns the DECRYPTED tenant database URL for the given tenant id. */
  resolveDbUrl(tenantId: string): Promise<string>
}

export type TenantClientFactory = (datasourceUrl: string) => TenantClient

export interface TenantPrismaManagerOptions {
  /** Max cached connections per process (spec default: 100). */
  max?: number
  /** Idle TTL in ms before an unused client is evicted (spec default: 10 min). */
  ttl?: number
}

const DEFAULT_MAX = 100
const DEFAULT_TTL_MS = 1000 * 60 * 10

/**
 * Per-tenant PrismaClient cache. DB-per-tenant means one physical connection
 * pool per active tenant; this LRU bounds the count and disconnects evicted
 * clients. Dependencies are injected for testability.
 */
export class TenantPrismaManager {
  private readonly cache: LRUCache<string, TenantClient>

  constructor(
    private readonly resolver: TenantConnectionResolver,
    private readonly clientFactory: TenantClientFactory,
    options: TenantPrismaManagerOptions = {},
  ) {
    this.cache = new LRUCache<string, TenantClient>({
      max: options.max ?? DEFAULT_MAX,
      ttl: options.ttl ?? DEFAULT_TTL_MS,
      updateAgeOnGet: true, // idle TTL: each access resets the timer
      dispose: (client) => {
        void client.$disconnect()
      },
    })
  }

  async getClient(tenantId: string): Promise<TenantClient> {
    const cached = this.cache.get(tenantId)
    if (cached) return cached

    const url = await this.resolver.resolveDbUrl(tenantId)
    const client = this.clientFactory(url)
    await client.$connect()
    this.cache.set(tenantId, client)
    return client
  }

  /** Explicit eviction (e.g. on tenant suspension); triggers $disconnect via dispose. */
  evict(tenantId: string): void {
    this.cache.delete(tenantId)
  }
}
