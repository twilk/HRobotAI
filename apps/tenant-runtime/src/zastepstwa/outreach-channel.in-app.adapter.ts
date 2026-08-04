import { Injectable, Logger } from '@nestjs/common'
import type { OdpowiedzKandydata, OutreachChannel } from './outreach-channel.port.js'

/**
 * OBALONA PRZESŁANKA BRIEFU — zapisane tu jawnie, bo zmienia kształt tego pliku: brief każe
 * "użyć modułu `notifications`, który istnieje". NIE ISTNIEJE — sprawdzone
 * (`apps/tenant-runtime/src/*`, `find`/`grep -ri notification` na całym repo): zero trafień poza
 * dokumentacją. Nie ma więc czego wywoływać. Ponieważ `schema.prisma` ma jednego właściciela
 * (protokół plików współdzielonych) i Tor F go nie edytuje, ten adapter trzyma zapytania W PAMIĘCI
 * procesu tenant-runtime — wystarczające dla demo/testów jednego procesu, NIE przeżywa restartu.
 * Trwały model (`ZastepstwoZapytanie` w schemacie tenanckim, z kolumną w stylu `claimedAt`/`answeredAt`
 * analogiczną do `ProvisioningJob.claimedAt`) jest zgłoszony jako patch-request do integratora —
 * patrz `.context/AUTONOMY/patch-requests/F.md`. Kontrakt {@link OutreachChannel} jest niezależny od
 * przechowywania, więc podmiana na Prisma-backed implementację nie zmienia orkiestracji.
 */
interface Zapytanie {
  id: string
  pracownikId: string
  pytanie: string
  terminOdpowiedzi: Date
  odpowiedz: OdpowiedzKandydata | null
  odpowiedzianoO: Date | null
}

let counter = 0

@Injectable()
export class InAppOutreachChannel implements OutreachChannel {
  private readonly logger = new Logger(InAppOutreachChannel.name)
  private readonly zapytania = new Map<string, Zapytanie>()

  async zapytaj(pracownikId: string, pytanie: string, terminOdpowiedzi: Date): Promise<string> {
    const id = `zap_${Date.now().toString(36)}_${(counter++).toString(36)}`
    this.zapytania.set(id, {
      id,
      pracownikId,
      pytanie,
      terminOdpowiedzi,
      odpowiedz: null,
      odpowiedzianoO: null,
    })
    // Stand-in dla realnego powiadomienia w aplikacji (moduł `notifications` nie istnieje — patrz
    // komentarz nad klasą). Pracownik "odpowiada" przez `zarejestrujOdpowiedzPracownika` poniżej,
    // który w realnej integracji byłby wywołany z kontrolera obsługującego akcję pracownika w UI.
    this.logger.log(
      `Powiadomienie w aplikacji do pracownika ${pracownikId}: "${pytanie}" (termin: ${terminOdpowiedzi.toISOString()}, zapytanie ${id})`,
    )
    return id
  }

  async odpowiedz(zapytanieId: string): Promise<OdpowiedzKandydata> {
    const z = this.zapytania.get(zapytanieId)
    if (!z) return 'BRAK_ODPOWIEDZI'
    return z.odpowiedz ?? 'BRAK_ODPOWIEDZI'
  }

  /**
   * Wejście symulujące akcję pracownika w aplikacji ("Przyjmuję" / "Odmawiam"). W realnym UI
   * byłoby to wywoływane z endpointu, na który pracownik klika w powiadomieniu; tu jest jawną
   * metodą adaptera, bo `notifications` (skąd brief oczekiwał tego przewodu) nie istnieje.
   * Rejestruje odpowiedź NIEZALEŻNIE od terminu — to `zastepstwa.service.ts` (state machine)
   * decyduje, czy odpowiedź po terminie jeszcze się liczy (patrz test "odpowiedź po terminie").
   */
  zarejestrujOdpowiedzPracownika(zapytanieId: string, odpowiedz: 'TAK' | 'NIE'): void {
    const z = this.zapytania.get(zapytanieId)
    if (!z) throw new Error(`Nieznane zapytanie: ${zapytanieId}`)
    if (z.odpowiedz !== null) return // pierwsza odpowiedź wygrywa, kolejne kliknięcia są no-opem
    z.odpowiedz = odpowiedz
    z.odpowiedzianoO = new Date()
  }

  /** Do testów/diagnostyki: pełny stan zapytania, wraz z faktycznym czasem odpowiedzi. */
  podgladZapytania(zapytanieId: string): Readonly<Zapytanie> | undefined {
    return this.zapytania.get(zapytanieId)
  }
}
