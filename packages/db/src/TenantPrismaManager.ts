import { LRUCache } from 'lru-cache'
import type { TenantClient } from './clients.js'

export interface TenantConnectionResolver {
  /** Returns the DECRYPTED tenant database URL for the given tenant id. */
  resolveDbUrl(tenantId: string): Promise<string>
}

export type TenantClientFactory = (datasourceUrl: string) => TenantClient

export interface TenantPrismaManagerOptions {
  /** Max cached clients (= physical connection pools) per process. Default 100. Size this to
   *  your provisioned tenant count per pod and front Postgres with PgBouncer at real scale. */
  maxClients?: number
  /** Idle TTL in ms before an unused client is evicted. Default 10 min. */
  idleTtlMs?: number
  /** @deprecated renamed to {@link TenantPrismaManagerOptions.maxClients} */
  max?: number
  /** @deprecated renamed to {@link TenantPrismaManagerOptions.idleTtlMs} */
  ttl?: number
}

const DEFAULT_MAX = 100
const DEFAULT_TTL_MS = 1000 * 60 * 10

/**
 * Per-tenant PrismaClient cache. DB-per-tenant means one physical connection pool per active
 * tenant; this LRU bounds the count. Dependencies are injected for testability.
 *
 * Eviction safety: a client borrowed via {@link withClient} is never $disconnect()-ed while
 * the borrow is open. If the LRU evicts it (capacity) or its idle TTL fires mid-query, the
 * disconnect is DEFERRED until the last concurrent borrow returns — so eviction can't abort an
 * in-flight query. Prefer withClient() over getClient() for request handling.
 */
export class TenantPrismaManager {
  private readonly cache: LRUCache<string, TenantClient>
  // Deduplicates concurrent cold-start calls for the same tenant: the second concurrent
  // getClient('t') awaits the same Promise instead of opening a second connection.
  private readonly inflight = new Map<string, Promise<TenantClient>>()
  // Active borrow count per client (via withClient). >0 means "do not disconnect yet".
  private readonly leases = new Map<TenantClient, number>()
  // Clients evicted while borrowed; disconnected when the last borrow releases them.
  private readonly deferredDisconnect = new Set<TenantClient>()

  constructor(
    private readonly resolver: TenantConnectionResolver,
    private readonly clientFactory: TenantClientFactory,
    options: TenantPrismaManagerOptions = {},
  ) {
    this.cache = new LRUCache<string, TenantClient>({
      max: options.maxClients ?? options.max ?? DEFAULT_MAX,
      ttl: options.idleTtlMs ?? options.ttl ?? DEFAULT_TTL_MS,
      updateAgeOnGet: true, // idle TTL: each access resets the timer
      dispose: (client) => {
        this.disposeClient(client)
      },
    })
  }

  private disposeClient(client: TenantClient): void {
    if ((this.leases.get(client) ?? 0) > 0) {
      // In use — defer the disconnect so we don't kill in-flight queries.
      this.deferredDisconnect.add(client)
    } else {
      void client.$disconnect()
    }
  }

  async getClient(tenantId: string): Promise<TenantClient> {
    if (typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new Error('TenantPrismaManager.getClient: tenantId must be a non-empty string')
    }
    const cached = this.cache.get(tenantId)
    if (cached) return cached

    const pending = this.inflight.get(tenantId)
    if (pending) return pending

    const promise = (async () => {
      const url = await this.resolver.resolveDbUrl(tenantId)
      const client = this.clientFactory(url)
      await client.$connect()
      this.cache.set(tenantId, client)
      return client
    })()
    this.inflight.set(tenantId, promise)
    try {
      return await promise
    } finally {
      this.inflight.delete(tenantId)
    }
  }

  /**
   * Borrow a tenant client for the duration of `fn`. Guarantees the client is not
   * disconnected (by LRU eviction or idle TTL) while `fn` runs; a mid-borrow eviction defers
   * the disconnect until the last concurrent borrow returns. Use this for request handling.
   */
  async withClient<T>(tenantId: string, fn: (client: TenantClient) => Promise<T>): Promise<T> {
    const client = await this.getClient(tenantId)
    this.leases.set(client, (this.leases.get(client) ?? 0) + 1)
    try {
      return await fn(client)
    } finally {
      const remaining = (this.leases.get(client) ?? 1) - 1
      if (remaining <= 0) {
        this.leases.delete(client)
        if (this.deferredDisconnect.delete(client)) void client.$disconnect()
      } else {
        this.leases.set(client, remaining)
      }
    }
  }

  /** Explicit eviction (e.g. on tenant suspension); triggers $disconnect via dispose
   *  (deferred if the client is currently borrowed via withClient). */
  evict(tenantId: string): void {
    this.cache.delete(tenantId)
  }

  /** Disconnect and drop every cached client. Call on graceful shutdown. */
  async disconnectAll(): Promise<void> {
    const clients = [...this.cache.values()]
    this.cache.clear()
    await Promise.allSettled(clients.map((c) => c.$disconnect()))
  }
}
