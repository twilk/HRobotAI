import { ControlPlanePrismaService } from './control-plane-prisma.service.js'

describe('ControlPlanePrismaService', () => {
  it('calls $connect on init and $disconnect on destroy', async () => {
    const service = new ControlPlanePrismaService()
    const connectSpy = jest.spyOn(service, '$connect').mockResolvedValue(undefined)
    const disconnectSpy = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined)

    await service.onModuleInit()
    await service.onModuleDestroy()

    expect(connectSpy).toHaveBeenCalledTimes(1)
    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })
})
