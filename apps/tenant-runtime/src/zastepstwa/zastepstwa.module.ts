import { Module } from '@nestjs/common'
import { ZastepstwaController } from './zastepstwa.controller.js'
import { ZastepstwaService } from './zastepstwa.service.js'
import { OUTREACH_CHANNEL } from './outreach-channel.port.js'
import { InAppOutreachChannel } from './outreach-channel.in-app.adapter.js'
import { RANKING_CLIENT, HttpRankingClient } from './ranking.client.js'
import { ZASTEPSTWA_REPOSITORY, InMemoryZastepstwaRepository } from './zastepstwa.repository.js'

/**
 * Track F — "kadrowy, który sam szuka zastępstwa". Domyślnie wiąże adapter kontaktu w-aplikacji
 * ({@link InAppOutreachChannel}); telefon jest udokumentowanym, niewdrożonym adapterem tego samego
 * portu (`outreach-channel.phone.ts`) — podmiana providera `OUTREACH_CHANNEL` jest jedynym miejscem
 * wpięcia, orkiestracja (`ZastepstwaService`) się nie zmienia.
 *
 * NIE zarejestrowany w `app.module.ts` (plik jednego właściciela — integrator) — zgłoszone jako
 * patch-request, patrz `.context/AUTONOMY/patch-requests/F.md`.
 */
@Module({
  controllers: [ZastepstwaController],
  providers: [
    ZastepstwaService,
    { provide: OUTREACH_CHANNEL, useClass: InAppOutreachChannel },
    { provide: RANKING_CLIENT, useClass: HttpRankingClient },
    { provide: ZASTEPSTWA_REPOSITORY, useClass: InMemoryZastepstwaRepository },
  ],
  exports: [ZastepstwaService],
})
export class ZastepstwaModule {}
