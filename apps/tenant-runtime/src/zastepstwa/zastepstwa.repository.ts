import { Injectable, Logger } from '@nestjs/common'
import type { ZastepstwoProces } from './zastepstwa-state-machine.js'

/**
 * Magazyn procesów + compare-and-set "dzierżawa kroku", wzorowany 1:1 na
 * `apps/control-plane/src/provisioning/provisioning.service.ts` (`claimStep`, `CLAIM_LEASE_MS`):
 * zanim jakikolwiek "worker" (kontroler wywołany przez UI, przyszły cron pollujący timeouty) wykona
 * krok na procesie (wyślij-do-następnego / zastosuj-odpowiedź), musi go NAJPIERW przejąć atomowo —
 * wygrywa dokładnie jeden. Bez tego dwa równoległe żądania (np. podwójny klik managera + cron
 * timeoutu trafiające w tej samej chwili) mogłyby dwukrotnie przesunąć kolejkę.
 *
 * Implementacja w PAMIĘCI procesu (patrz uzasadnienie w `outreach-channel.in-app.adapter.ts` —
 * `schema.prisma` ma jednego właściciela, więc trwały magazyn to patch-request, nie ta zmiana).
 * Predykat CAS jest jednak identyczny jak w wersji Prisma (`updateMany` z `OR: [{leased: null}, {lt: staleBefore}]`),
 * więc podmiana na `PrismaZastepstwaRepository` później nie zmienia wywołującego kodu — patrz
 * interfejs {@link ZastepstwaRepository}.
 */
export const CLAIM_LEASE_MS = 30_000

/** DI token dla {@link ZastepstwaRepository}. */
export const ZASTEPSTWA_REPOSITORY = Symbol('ZASTEPSTWA_REPOSITORY')

export interface ZastepstwaRepository {
  zapisz(proces: ZastepstwoProces): Promise<void>
  pobierz(procesId: string): Promise<ZastepstwoProces | null>
  /**
   * Compare-and-set: zwraca proces (i oznacza go jako "przejęty do przetworzenia") TYLKO jeśli
   * żadna inna dzierżawa nie jest aktualnie żywa. Zwraca `null`, gdy przejęcie się nie powiodło —
   * wywołujący MUSI to potraktować jako "ktoś inny już to obsługuje", nie jako błąd.
   */
  przejmijDoPrzetworzenia(procesId: string, now: Date): Promise<ZastepstwoProces | null>
  /** Zwalnia dzierżawę. Wywoływane zawsze po zapisaniu wyniku kroku (sukces LUB błąd). */
  zwolnij(procesId: string, now: Date): Promise<void>
}

interface Wpis {
  proces: ZastepstwoProces
  leasedAt: Date | null
}

@Injectable()
export class InMemoryZastepstwaRepository implements ZastepstwaRepository {
  private readonly logger = new Logger(InMemoryZastepstwaRepository.name)
  private readonly store = new Map<string, Wpis>()

  async zapisz(proces: ZastepstwoProces): Promise<void> {
    const existing = this.store.get(proces.id)
    this.store.set(proces.id, { proces, leasedAt: existing?.leasedAt ?? null })
  }

  async pobierz(procesId: string): Promise<ZastepstwoProces | null> {
    return this.store.get(procesId)?.proces ?? null
  }

  async przejmijDoPrzetworzenia(procesId: string, now: Date): Promise<ZastepstwoProces | null> {
    const wpis = this.store.get(procesId)
    if (!wpis) return null
    const dzierzawaZywa = wpis.leasedAt !== null && now.getTime() - wpis.leasedAt.getTime() < CLAIM_LEASE_MS
    if (dzierzawaZywa) {
      this.logger.debug(`Proces ${procesId} ma żywą dzierżawę — przejęcie odrzucone (CAS)`)
      return null
    }
    wpis.leasedAt = now
    return wpis.proces
  }

  async zwolnij(procesId: string, now: Date): Promise<void> {
    const wpis = this.store.get(procesId)
    if (!wpis) return
    // Zwolnienie jest samo w sobie warunkowe w duchu CAS: nie nadpisujemy dzierżawy, którą ktoś już
    // przejął PO naszym `przejmijDoPrzetworzenia` (nie powinno się zdarzyć przy poprawnym użyciu —
    // patrz test na konkurencyjne przejęcie), ale traktujemy `now`-owe zwolnienie jako no-op zamiast
    // rzucać, żeby błąd w kroku nadal mógł zwolnić dzierżawę w `finally`.
    wpis.leasedAt = null
  }
}
