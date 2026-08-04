import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { ZastepstwaService } from './zastepstwa.service.js'
import { RozpocznijPoszukiwanieDto } from './dto/rozpocznij-poszukiwanie.dto.js'
import { OdpowiedzPracownikaDto } from './dto/odpowiedz-pracownika.dto.js'

/** Kto może uruchamiać/oglądać/rozstrzygać poszukiwanie zastępstwa — nie pracownik-kandydat sam z siebie. */
const KADROWY_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const

/**
 * Track F — "kadrowy, który sam szuka zastępstwa". WYŁĄCZNIE ranking + orkiestracja kontaktu +
 * raportowanie. `POST :id/potwierdz` jest jedynym endpointem, po którym cokolwiek jest
 * "rozstrzygnięte" — patrz strażnik w `zastepstwa-state-machine.ts` (`potwierdzPrzezManagera`).
 * Faktyczne przyznanie urlopu / przypisanie zmiany w istniejących modułach (`leave`, `shift-swap`)
 * jest KROKIEM PO tym potwierdzeniu, wykonywanym przez managera przez te moduły — ten kontroler nie
 * mutuje `LeaveRequest`/`Shift` (poza właścicielstwem Toru F).
 */
@Controller('zastepstwa')
@TenantRoute()
export class ZastepstwaController {
  constructor(private readonly service: ZastepstwaService) {}

  @Post()
  @Roles(...KADROWY_ROLES)
  rozpocznij(@Body() dto: RozpocznijPoszukiwanieDto) {
    return this.service.rozpocznij(dto)
  }

  @Get(':procesId')
  @Roles(...KADROWY_ROLES)
  pobierz(@Param('procesId') procesId: string) {
    return this.service.pobierz(procesId)
  }

  /** Akcja pracownika w aplikacji ("Przyjmuję"/"Odmawiam") na powiadomienie o zastępstwie. */
  @Post(':procesId/zapytania/:zapytanieId/odpowiedz')
  @Roles(Role.PRACOWNIK, ...KADROWY_ROLES)
  odpowiedzPracownika(
    @Param('procesId') procesId: string,
    @Param('zapytanieId') zapytanieId: string,
    @Body() dto: OdpowiedzPracownikaDto,
  ) {
    return this.service.pracownikOdpowiedzial(procesId, zapytanieId, dto.odpowiedz)
  }

  /** Sprawdzenie upłynięcia terminu (poller/cron albo ręcznie z UI managera). */
  @Post(':procesId/timeout')
  @Roles(...KADROWY_ROLES)
  sprawdzTimeout(@Param('procesId') procesId: string) {
    return this.service.sprawdzTimeout(procesId)
  }

  /** JEDYNA droga do stanu rozstrzygniętego — jawne, ręczne potwierdzenie człowieka (managera). */
  @Post(':procesId/potwierdz')
  @Roles(...KADROWY_ROLES)
  potwierdz(@Param('procesId') procesId: string, @Body('managerId') managerId: string) {
    return this.service.potwierdz(procesId, managerId)
  }

  @Post(':procesId/odrzuc')
  @Roles(...KADROWY_ROLES)
  odrzucPropozycje(@Param('procesId') procesId: string, @Body('managerId') managerId: string) {
    return this.service.odrzucPropozycje(procesId, managerId)
  }
}
