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

  it('propagates errors from the exec runner', async () => {
    const failingExec = () => Promise.reject(new Error('prisma failed'))
    await expect(
      migrateTenant('url', '/schema.prisma', failingExec),
    ).rejects.toThrow('prisma failed')
  })
})
