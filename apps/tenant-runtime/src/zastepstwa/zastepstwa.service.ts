import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { OUTREACH_CHANNEL, type OutreachChannel } from './outreach-channel.port.js'
import { RANKING_CLIENT, type RankingClient } from './ranking.client.js'
import { ZASTEPSTWA_REPOSITORY, type ZastepstwaRepository } from './zastepstwa.repository.js'
import {
  type ZastepstwoProces,
  ZastepstwoStan,
  NielegalneStanoweTransition,
  rozpocznij as rozpocznijProces,
  wyslijDoNastepnego,
  zarejestrujZapytanie,
  zastosujOdpowiedz,
  potwierdzPrzezManagera,
  odrzucPropozycjeManagera,
} from './zastepstwa-state-machine.js'
import type { RozpocznijPoszukiwanieDto } from './dto/rozpocznij-poszukiwanie.dto.js'

/** Duck-typed rozszerzenie {@link OutreachChannel} — wspierane tylko przez adapter w-aplikacji (patrz plik adaptera). */
interface WspieraRejestracjeOdpowiedzi {
  zarejestrujOdpowiedzPracownika(zapytanieId: string, odpowiedz: 'TAK' | 'NIE'): void
}
function wspieraRejestracje(x: unknown): x is WspieraRejestracjeOdpowiedzi {
  return (
    typeof x === 'object' &&
    x !== null &&
    'zarejestrujOdpowiedzPracownika' in x &&
    typeof (x as WspieraRejestracjeOdpowiedzi).zarejestrujOdpowiedzPracownika === 'function'
  )
}

const PYTANIE = (shiftId: string) =>
  `Czy możesz wziąć zastępstwo na zmianie ${shiftId}? Odpowiedz TAK lub NIE — masz ograniczony czas na odpowiedź.`

@Injectable()
export class ZastepstwaService {
  private readonly logger = new Logger(ZastepstwaService.name)

  constructor(
    @Inject(OUTREACH_CHANNEL) private readonly outreach: OutreachChannel,
    @Inject(RANKING_CLIENT) private readonly ranking: RankingClient,
    @Inject(ZASTEPSTWA_REPOSITORY) private readonly repo: ZastepstwaRepository,
  ) {}

  async rozpocznij(dto: RozpocznijPoszukiwanieDto): Promise<ZastepstwoProces> {
    const pozycje = await this.ranking.rankuj(dto.shiftId, dto.nieobecnyId, dto.kandydaci, dto.wagi)
    // Tylko KWALIFIKUJĄCY SIĘ kandydaci trafiają do kolejki kontaktu — dyskwalifikacja (dostępność
    // / wykonalność) jest twardym warunkiem ustalonym przez `ranking.py`; nie kontaktujemy nikogo,
    // kogo walidatory już odrzuciły (`ranking.uzasadnienie` niesie ten powód dla audytu managera).
    const kwalifikujacySie = new Set(
      dto.kandydaci.filter((k) => k.dostepny && k.wykonalnaZamiana).map((k) => k.pracownikId),
    )
    const kolejka = pozycje.map((p) => p.pracownikId).filter((id) => kwalifikujacySie.has(id))

    const id = randomUUID()
    let proces = rozpocznijProces(id, dto.shiftId, dto.nieobecnyId, kolejka, new Date(), dto.terminMinut ?? 30)
    await this.repo.zapisz(proces)

    proces = await this.krokWyslijIKontynuuj(id)
    return proces
  }

  async pobierz(procesId: string): Promise<ZastepstwoProces> {
    const proces = await this.repo.pobierz(procesId)
    if (!proces) throw new NotFoundException(`Proces zastępstwa nie znaleziony: ${procesId}`)
    return proces
  }

  /**
   * Pracownik odpowiada na zapytanie (przez akcję w aplikacji). Rejestruje odpowiedź w kanale, po
   * czym natychmiast przetwarza krok — jeśli to była odmowa (albo dotarła po terminie), automatycznie
   * kontynuuje do następnego kandydata w tym samym wywołaniu (patrz `krokWyslijIKontynuuj`).
   */
  async pracownikOdpowiedzial(
    procesId: string,
    zapytanieId: string,
    odpowiedz: 'TAK' | 'NIE',
  ): Promise<ZastepstwoProces> {
    if (wspieraRejestracje(this.outreach)) {
      this.outreach.zarejestrujOdpowiedzPracownika(zapytanieId, odpowiedz)
    }
    return this.przetworzOczekujacyKrok(procesId, zapytanieId)
  }

  /** Wywoływane przez poller/cron (lub ręcznie w testach) do wykrycia upłynięcia terminu bez odpowiedzi. */
  async sprawdzTimeout(procesId: string): Promise<ZastepstwoProces> {
    const aktualny = await this.repo.pobierz(procesId)
    if (!aktualny) throw new NotFoundException(`Proces zastępstwa nie znaleziony: ${procesId}`)
    if (aktualny.stan !== ZastepstwoStan.OCZEKIWANIE || !aktualny.aktualneZapytanieId) return aktualny
    return this.przetworzOczekujacyKrok(procesId, aktualny.aktualneZapytanieId)
  }

  /**
   * Jedyna droga do stanu "rozstrzygnięte" — wymaga jawnego wywołania przez managera. Nie robi nic
   * automatycznie: rzuca, jeśli proces nie jest w `SUKCES` (patrz `zastepstwa-state-machine.ts`).
   */
  async potwierdz(procesId: string, managerId: string): Promise<ZastepstwoProces> {
    return this.krokPodDzierzawa(procesId, (proces, now) => {
      const nowy = potwierdzPrzezManagera(proces, managerId, now)
      return { proces: nowy, kontynuuj: false }
    })
  }

  async odrzucPropozycje(procesId: string, managerId: string): Promise<ZastepstwoProces> {
    const wynik = await this.krokPodDzierzawa(procesId, (proces, now) => {
      const nowy = odrzucPropozycjeManagera(proces, managerId, now)
      return { proces: nowy, kontynuuj: true }
    })
    return wynik
  }

  // ---- wewnętrzne ----

  private async przetworzOczekujacyKrok(procesId: string, zapytanieId: string): Promise<ZastepstwoProces> {
    return this.krokPodDzierzawa(procesId, async (proces, now) => {
      if (proces.stan !== ZastepstwoStan.OCZEKIWANIE || proces.aktualneZapytanieId !== zapytanieId) {
        // Nieaktualne zapytanie (np. spóźniony webhook po tym jak proces już poszedł dalej) — no-op.
        return { proces, kontynuuj: false }
      }
      const odpowiedz = await this.outreach.odpowiedz(zapytanieId)
      const nowy = zastosujOdpowiedz(proces, odpowiedz, now)
      // `zastosujOdpowiedz` wraca do KOLEJKA gdy NIE / timeout / spóźniona odpowiedź -> kontynuujemy
      // automatycznie do następnego kandydata w TYM SAMYM kroku (nie zostawiamy procesu "zawieszonego").
      return { proces: nowy, kontynuuj: nowy.stan === ZastepstwoStan.KOLEJKA }
    })
  }

  private async krokWyslijIKontynuuj(procesId: string): Promise<ZastepstwoProces> {
    return this.krokPodDzierzawa(procesId, async (proces, now) => {
      if (proces.stan !== ZastepstwoStan.KOLEJKA) return { proces, kontynuuj: false }
      const { proces: nowy, doWyslania } = wyslijDoNastepnego(proces, now)
      if (!doWyslania) return { proces: nowy, kontynuuj: false } // WYCZERPANO
      const zapytanieId = await this.outreach.zapytaj(doWyslania.pracownikId, PYTANIE(proces.shiftId), doWyslania.terminOdpowiedzi)
      return { proces: zarejestrujZapytanie(nowy, zapytanieId), kontynuuj: false }
    })
  }

  /**
   * Przejmuje dzierżawę (CAS, patrz `zastepstwa.repository.ts`), wykonuje pojedynczy krok, zapisuje
   * wynik, zwalnia dzierżawę — zawsze w `finally`, żeby wyjątek nie zostawił procesu zablokowanego.
   * Jeśli krok zwrócił `kontynuuj: true` (przejście z powrotem do `KOLEJKA`), rekurencyjnie wywołuje
   * `krokWyslijIKontynuuj` PO zwolnieniu dzierżawy tego kroku — to realizuje "brak odpowiedzi/odmowa
   * -> automatycznie następny kandydat" bez trzymania dzierżawy przez cały łańcuch.
   */
  private async krokPodDzierzawa(
    procesId: string,
    krok: (
      proces: ZastepstwoProces,
      now: Date,
    ) => { proces: ZastepstwoProces; kontynuuj: boolean } | Promise<{ proces: ZastepstwoProces; kontynuuj: boolean }>,
  ): Promise<ZastepstwoProces> {
    const now = new Date()
    const przejety = await this.repo.przejmijDoPrzetworzenia(procesId, now)
    if (!przejety) {
      const aktualny = await this.repo.pobierz(procesId)
      if (!aktualny) throw new NotFoundException(`Proces zastępstwa nie znaleziony: ${procesId}`)
      this.logger.debug(`Proces ${procesId}: dzierżawa zajęta, pomijam ten krok (CAS)`)
      return aktualny
    }
    let wynik: { proces: ZastepstwoProces; kontynuuj: boolean }
    try {
      wynik = await krok(przejety, now)
      await this.repo.zapisz(wynik.proces)
    } catch (err) {
      if (err instanceof NielegalneStanoweTransition) {
        this.logger.warn(`Proces ${procesId}: ${err.message}`)
      }
      throw err
    } finally {
      await this.repo.zwolnij(procesId, now)
    }
    if (wynik.kontynuuj) {
      return this.krokWyslijIKontynuuj(procesId)
    }
    return wynik.proces
  }
}
