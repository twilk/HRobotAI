import { migrateTenant } from './migrateTenant.js'

describe('migrateTenant', () => {
  it('invokes prisma migrate deploy with the tenant URL injected as DATABASE_URL', async () => {
    const calls: { cmd: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
    const fakeExec = (cmd: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv }) => {
      calls.push({ cmd, args, env: opts.env })
      return Promise.resolve()
    }

    await migrateTenant('postgresql://tenant-a-url', '/abs/prisma/tenant/schema.prisma', fakeExec)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.args).toContain('migrate')
    expect(calls[0]!.args).toContain('deploy')
    expect(calls[0]!.args).toContain('--schema=/abs/prisma/tenant/schema.prisma')
    expect(calls[0]!.env.DATABASE_URL).toBe('postgresql://tenant-a-url')
  })

  it('does NOT forward process secrets into the migration subprocess (env allowlist)', async () => {
    process.env['TENANT_DB_ENCRYPTION_KEY'] = 'a'.repeat(64)
    process.env['NEXTAUTH_SECRET'] = 'super-secret'
    process.env['CONTROL_PLANE_DATABASE_URL'] = 'postgresql://control/plane'
    let captured: NodeJS.ProcessEnv = {}
    await migrateTenant('postgresql://only-this', '/s.prisma', (_cmd, _args, opts) => {
      captured = opts.env
      return Promise.resolve()
    })
    expect(captured['DATABASE_URL']).toBe('postgresql://only-this')
    expect(captured['TENANT_DB_ENCRYPTION_KEY']).toBeUndefined()
    expect(captured['NEXTAUTH_SECRET']).toBeUndefined()
    expect(captured['CONTROL_PLANE_DATABASE_URL']).toBeUndefined()
  })

  it('wraps exec errors with command context (keeps the cause message)', async () => {
    const failingExec = () => Promise.reject(new Error('prisma failed'))
    await expect(migrateTenant('url', '/schema.prisma', failingExec)).rejects.toThrow('prisma failed')
    await expect(migrateTenant('url', '/schema.prisma', failingExec)).rejects.toThrow(/migrateTenant:/)
  })
})
