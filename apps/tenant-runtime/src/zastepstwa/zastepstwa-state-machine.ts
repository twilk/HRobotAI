/**
 * Track F — maszyna stanów orkiestracji kontaktu "kadrowy, który sam szuka zastępstwa".
 *
 *   KOLEJKA ──wyslijDoNastepnego (są kandydaci)──▶ OCZEKIWANIE
 *   KOLEJKA ──wyslijDoNastepnego (lista pusta)───▶ WYCZERPANO  (raport porażki + eskalacja)
 *   OCZEKIWANIE ──zastosujOdpowiedz(TAK, przed terminem)────▶ SUKCES
 *   OCZEKIWANIE ──zastosujOdpowiedz(NIE | BRAK_ODPOWIEDZI | * po terminie)──▶ KOLEJKA (następny)
 *   SUKCES ──potwierdzPrzezManagera──▶ POTWIERDZONE_PRZEZ_CZLOWIEKA   (JEDYNA droga do "przyznane")
 *   SUKCES ──manager odrzuca propozycję──▶ KOLEJKA (następny; manager może nie zgodzić się z wyborem)
 *   * ──anuluj──▶ ANULOWANE
 *
 * GRANICA ZGODNOŚCI (art. 22 RODO / `docs/HRobotDocs/m-zgodnosc-eu-ai-act.md`): `SUKCES` oznacza
 * WYŁĄCZNIE "kandydat odpowiedział TAK przed terminem" — to zdarzenie NIE jest przyznaniem
 * zastępstwa/urlopu. Jedyna funkcja, która wolno jej wyprodukować stan `POTWIERDZONE_PRZEZ_CZLOWIEKA`
 * to {@link potwierdzPrzezManagera}, i jest wywoływana WYŁĄCZNIE przez jawną akcję managera
 * (kontroler `zastepstwa.controller.ts`, endpoint `POST /zastepstwa/:id/potwierdz`, autoryzowany
 * rolą MANAGER/ADMIN). Nic w tym pliku ani w `zastepstwa.service.ts` woła tej funkcji automatycznie.
 * `zastepstwa.controller.spec.ts` / `zastepstwa-state-machine.spec.ts` pilnują tego wprost.
 */

export const ZastepstwoStan = {
  KOLEJKA: 'KOLEJKA',
  OCZEKIWANIE: 'OCZEKIWANIE',
  SUKCES: 'SUKCES',
  WYCZERPANO: 'WYCZERPANO',
  POTWIERDZONE_PRZEZ_CZLOWIEKA: 'POTWIERDZONE_PRZEZ_CZLOWIEKA',
  ANULOWANE: 'ANULOWANE',
} as const
export type ZastepstwoStan = (typeof ZastepstwoStan)[keyof typeof ZastepstwoStan]

/** Terminalne — dalsze wywołania mutujące (poza odczytem) są nielegalne. */
export const TERMINALNE: ReadonlySet<ZastepstwoStan> = new Set([
  ZastepstwoStan.POTWIERDZONE_PRZEZ_CZLOWIEKA,
  ZastepstwoStan.ANULOWANE,
])

export interface ZdarzenieHistorii {
  o: Date
  opis: string
}

export interface ZastepstwoProces {
  readonly id: string
  readonly shiftId: string
  readonly nieobecnyId: string
  /** Kolejka kandydatów DO wysłania, w kolejności rankingu (pierwszy = następny do zapytania). */
  readonly kolejka: readonly string[]
  /** Ile minut ma kandydat na odpowiedź — niesione w procesie, żeby kontynuacja (kolejny kandydat po odmowie/timeout) nie wymagała przekazywania tego z zewnątrz przy każdym kroku. */
  readonly terminMinut: number
  readonly stan: ZastepstwoStan
  readonly aktualnyKandydat: string | null
  readonly aktualneZapytanieId: string | null
  readonly terminOdpowiedzi: Date | null
  /** Ustawiane wyłącznie przez {@link potwierdzPrzezManagera}. */
  readonly wynik: { pracownikId: string; potwierdzilManagerId: string; potwierdzonoO: Date } | null
  readonly historia: readonly ZdarzenieHistorii[]
}

export class NielegalneStanoweTransition extends Error {
  constructor(
    public readonly stan: ZastepstwoStan,
    public readonly akcja: string,
  ) {
    super(`Niedozwolona akcja "${akcja}" ze stanu ${stan}`)
    this.name = 'NielegalneStanoweTransition'
  }
}

function zdarzenie(historia: readonly ZdarzenieHistorii[], o: Date, opis: string): ZdarzenieHistorii[] {
  return [...historia, { o, opis }]
}

export function rozpocznij(
  id: string,
  shiftId: string,
  nieobecnyId: string,
  kandydaciKolejka: readonly string[],
  now: Date,
  terminMinut = 30,
): ZastepstwoProces {
  return {
    id,
    shiftId,
    nieobecnyId,
    kolejka: [...kandydaciKolejka],
    terminMinut,
    stan: ZastepstwoStan.KOLEJKA,
    aktualnyKandydat: null,
    aktualneZapytanieId: null,
    terminOdpowiedzi: null,
    wynik: null,
    historia: zdarzenie(
      [],
      now,
      `proces rozpoczęty, ${kandydaciKolejka.length} kandydat(ów) w kolejce (wg rankingu)`,
    ),
  }
}

export interface DoWyslania {
  pracownikId: string
  terminOdpowiedzi: Date
}

/**
 * Zdejmuje z kolejki następnego kandydata i przenosi proces do `OCZEKIWANIE`, ustawiając termin
 * odpowiedzi na `now + terminMinut`. Jeśli kolejka jest pusta -> `WYCZERPANO` (raport porażki;
 * eskalacja do managera to osobna, jawna akcja UI/kontrolera, nie coś co ta funkcja robi sama).
 * Legalne wyłącznie ze stanu `KOLEJKA`.
 */
export function wyslijDoNastepnego(
  proces: ZastepstwoProces,
  now: Date,
): { proces: ZastepstwoProces; doWyslania: DoWyslania | null } {
  if (proces.stan !== ZastepstwoStan.KOLEJKA) {
    throw new NielegalneStanoweTransition(proces.stan, 'wyslijDoNastepnego')
  }
  if (proces.kolejka.length === 0) {
    return {
      proces: {
        ...proces,
        stan: ZastepstwoStan.WYCZERPANO,
        aktualnyKandydat: null,
        aktualneZapytanieId: null,
        terminOdpowiedzi: null,
        historia: zdarzenie(
          proces.historia,
          now,
          'kolejka kandydatów wyczerpana — raport porażki, wymaga eskalacji do managera',
        ),
      },
      doWyslania: null,
    }
  }
  const [nastepny, ...reszta] = proces.kolejka as [string, ...string[]]
  const termin = new Date(now.getTime() + proces.terminMinut * 60_000)
  return {
    proces: {
      ...proces,
      kolejka: reszta,
      stan: ZastepstwoStan.OCZEKIWANIE,
      aktualnyKandydat: nastepny,
      aktualneZapytanieId: null, // ustawi wywołujący po `outreach.zapytaj(...)` przez `zarejestrujZapytanie`
      terminOdpowiedzi: termin,
      historia: zdarzenie(proces.historia, now, `kontakt z kandydatem ${nastepny}, termin ${termin.toISOString()}`),
    },
    doWyslania: { pracownikId: nastepny, terminOdpowiedzi: termin },
  }
}

/** Dowiązuje identyfikator zapytania zwrócony przez `OutreachChannel.zapytaj(...)` do procesu. */
export function zarejestrujZapytanie(proces: ZastepstwoProces, zapytanieId: string): ZastepstwoProces {
  if (proces.stan !== ZastepstwoStan.OCZEKIWANIE) {
    throw new NielegalneStanoweTransition(proces.stan, 'zarejestrujZapytanie')
  }
  return { ...proces, aktualneZapytanieId: zapytanieId }
}

/**
 * Stosuje odpowiedź kandydata (z `OutreachChannel.odpowiedz(...)`) do procesu.
 *  - `TAK` PRZED terminem  -> `SUKCES` (czeka na człowieka — patrz nagłówek pliku).
 *  - `NIE`                 -> z powrotem `KOLEJKA` (następny kandydat).
 *  - `BRAK_ODPOWIEDZI`, jeśli PRZED terminem -> proces zostaje w `OCZEKIWANIE` bez zmian
 *    (polling — jeszcze jest czas).
 *  - `BRAK_ODPOWIEDZI` PO terminie, LUB `TAK`/`NIE` odebrane dopiero PO terminie -> traktowane jak
 *    upłynięcie terminu -> `KOLEJKA` (następny kandydat). Odpowiedź po terminie NIE liczy się,
 *    nawet jeśli brzmiała "TAK" — to jest dokładnie ścieżka testowa "odpowiedź po terminie".
 */
export function zastosujOdpowiedz(
  proces: ZastepstwoProces,
  odpowiedz: 'TAK' | 'NIE' | 'BRAK_ODPOWIEDZI',
  now: Date,
): ZastepstwoProces {
  if (proces.stan !== ZastepstwoStan.OCZEKIWANIE) {
    throw new NielegalneStanoweTransition(proces.stan, 'zastosujOdpowiedz')
  }
  const kandydat = proces.aktualnyKandydat
  const poTerminie = proces.terminOdpowiedzi !== null && now.getTime() > proces.terminOdpowiedzi.getTime()

  if (poTerminie) {
    const powod =
      odpowiedz === 'BRAK_ODPOWIEDZI'
        ? `brak odpowiedzi kandydata ${kandydat} w terminie — przechodzę do następnego`
        : `odpowiedź "${odpowiedz}" kandydata ${kandydat} nadeszła PO terminie (${proces.terminOdpowiedzi?.toISOString()}) — nie liczy się, przechodzę do następnego`
    return {
      ...proces,
      stan: ZastepstwoStan.KOLEJKA,
      aktualnyKandydat: null,
      aktualneZapytanieId: null,
      terminOdpowiedzi: null,
      historia: zdarzenie(proces.historia, now, powod),
    }
  }

  if (odpowiedz === 'BRAK_ODPOWIEDZI') {
    // Wciąż przed terminem — nic się nie zmienia, wywołujący odpyta ponownie później.
    return proces
  }

  if (odpowiedz === 'NIE') {
    return {
      ...proces,
      stan: ZastepstwoStan.KOLEJKA,
      aktualnyKandydat: null,
      aktualneZapytanieId: null,
      terminOdpowiedzi: null,
      historia: zdarzenie(proces.historia, now, `kandydat ${kandydat} odmówił — przechodzę do następnego`),
    }
  }

  // odpowiedz === 'TAK', przed terminem.
  return {
    ...proces,
    stan: ZastepstwoStan.SUKCES,
    historia: zdarzenie(
      proces.historia,
      now,
      `kandydat ${kandydat} zaakceptował — CZEKA NA POTWIERDZENIE MANAGERA (brak automatycznego przyznania)`,
    ),
  }
}

/**
 * JEDYNA funkcja mogąca wyprodukować stan `POTWIERDZONE_PRZEZ_CZLOWIEKA`. Legalna wyłącznie ze
 * stanu `SUKCES` — wywołanie z każdego innego stanu (w tym `OCZEKIWANIE`, `KOLEJKA`, `WYCZERPANO`)
 * rzuca `NielegalneStanoweTransition`. To jest strażnik granicy zgodności z briefu: "Przyznanie
 * urlopu bez potwierdzenia człowieka łamie art. 22 RODO".
 */
export function potwierdzPrzezManagera(
  proces: ZastepstwoProces,
  managerId: string,
  now: Date,
): ZastepstwoProces {
  if (proces.stan !== ZastepstwoStan.SUKCES || proces.aktualnyKandydat === null) {
    throw new NielegalneStanoweTransition(proces.stan, 'potwierdzPrzezManagera')
  }
  return {
    ...proces,
    stan: ZastepstwoStan.POTWIERDZONE_PRZEZ_CZLOWIEKA,
    wynik: { pracownikId: proces.aktualnyKandydat, potwierdzilManagerId: managerId, potwierdzonoO: now },
    historia: zdarzenie(
      proces.historia,
      now,
      `manager ${managerId} POTWIERDZIŁ przypisanie ${proces.aktualnyKandydat} — dopiero teraz uznane za rozstrzygnięte`,
    ),
  }
}

/**
 * Manager może odrzucić propozycję z `SUKCES` (np. wie coś, czego system nie wie) i wrócić do
 * kolejki, zamiast potwierdzać. Kandydat, który już powiedział TAK, NIE wraca do kolejki (już
 * został poinformowany, że nie jest brany — unikamy sprzecznych komunikatów), więc przechodzimy
 * po prostu w `KOLEJKA` z resztą listy.
 */
export function odrzucPropozycjeManagera(proces: ZastepstwoProces, managerId: string, now: Date): ZastepstwoProces {
  if (proces.stan !== ZastepstwoStan.SUKCES) {
    throw new NielegalneStanoweTransition(proces.stan, 'odrzucPropozycjeManagera')
  }
  return {
    ...proces,
    stan: ZastepstwoStan.KOLEJKA,
    aktualnyKandydat: null,
    aktualneZapytanieId: null,
    terminOdpowiedzi: null,
    historia: zdarzenie(
      proces.historia,
      now,
      `manager ${managerId} odrzucił propozycję ${proces.aktualnyKandydat} — przechodzę do następnego`,
    ),
  }
}

export function anuluj(proces: ZastepstwoProces, powod: string, now: Date): ZastepstwoProces {
  if (TERMINALNE.has(proces.stan)) {
    throw new NielegalneStanoweTransition(proces.stan, 'anuluj')
  }
  return {
    ...proces,
    stan: ZastepstwoStan.ANULOWANE,
    historia: zdarzenie(proces.historia, now, `anulowano: ${powod}`),
  }
}
