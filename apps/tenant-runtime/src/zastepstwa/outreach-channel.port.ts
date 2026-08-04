/**
 * Track F — port kanału kontaktu z kandydatem na zastępstwo ("kadrowy, który sam szuka
 * zastępstwa"). Jeden port, wiele adapterów: D0 (ta zmiana) wiąże adapter w-aplikacji
 * (`InAppOutreachChannel`); telefon jest UDOKUMENTOWANY jako kolejny adapter tego samego portu w
 * `outreach-channel.phone.ts`, dokładnie wg wzorca `agent-glosowy/stt.port.ts` — port + jeden
 * realny adapter + jeden opisany-ale-niewdrożony adapter, zero gałęzi `if (kanal === 'telefon')`
 * rozsianych po serwisie.
 *
 * Kontrakt (z briefu):
 *   `zapytaj(pracownikId, pytanie, terminOdpowiedzi) -> zapytanieId`
 *   `odpowiedz(zapytanieId) -> TAK | NIE | BRAK_ODPOWIEDZI`
 *
 * `odpowiedz` jest CELOWO bezstanowe z punktu widzenia wywołującego — może być odpytywane
 * wielokrotnie (polling) przed terminem i zawsze zwróci `BRAK_ODPOWIEDZI` dopóki pracownik nie
 * zareaguje LUB termin nie minie. Maszyna stanów (`zastepstwa-state-machine.ts`) jest jedynym
 * miejscem, które nadaje temu znaczenie (timeout vs. wciąż czeka).
 */

/** Odpowiedź kandydata — dokładnie trzy wartości z kontraktu briefu, bez czwartej "w toku". */
export type OdpowiedzKandydata = 'TAK' | 'NIE' | 'BRAK_ODPOWIEDZI'

export interface OutreachChannel {
  /**
   * Wysyła zapytanie do pracownika i zwraca identyfikator zapytania (do późniejszego
   * `odpowiedz(zapytanieId)`). `terminOdpowiedzi` jest przekazywany do adaptera, żeby np. treść
   * powiadomienia mogła pokazać deadline pracownikowi — ale to WYWOŁUJĄCY (state machine) jest
   * właścicielem egzekwowania terminu, nie adapter.
   */
  zapytaj(pracownikId: string, pytanie: string, terminOdpowiedzi: Date): Promise<string>

  /**
   * Aktualny stan zapytania. `BRAK_ODPOWIEDZI` oznacza zarówno "jeszcze nie odpowiedział" (przed
   * terminem) jak i "nigdy nie odpowiedział" (po terminie) — rozróżnienie robi wywołujący,
   * porównując `terminOdpowiedzi` z zegarem.
   */
  odpowiedz(zapytanieId: string): Promise<OdpowiedzKandydata>
}

/** DI token dla {@link OutreachChannel}. */
export const OUTREACH_CHANNEL = Symbol('OUTREACH_CHANNEL')
