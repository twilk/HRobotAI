/**
 * Where each Analityk HR number comes from, shown next to the number itself.
 *
 * WHY. Four metrics on this screen were once wrong in a way no test could catch, and what made them
 * dangerous was not the arithmetic — it was that the screen presented every figure with identical
 * confidence. "Zerowa rotacja" looked exactly like a measurement when it actually meant "nie umiem
 * policzyć". The backend now computes all of this carefully and documents the caveats precisely in
 * `analityk.service.ts`; none of that reaches the person reading the dashboard. A reader seeing
 * "Nadwyżka ponad normę: 42 h" cannot tell it is ROSTERED time with no daily-norm rule applied, and
 * therefore systematically understates statutory overtime.
 *
 * Every string below is taken from the service's own doc comments — this module surfaces them, it
 * does not restate or soften them. If a computation changes, the caveat here must change with it;
 * `analityk-provenance.test.ts` pins that every KPI on the screen has an entry.
 */

/** How much the number can be trusted as a direct measurement. */
export type Rodzaj =
  /** Counted straight from stored rows. */
  | 'liczone'
  /** Reconstructed from an append-only trail because the state itself is not stored. */
  | 'odtwarzane'
  /** Planned/intended values, not observed ones. */
  | 'planowane'

export interface Prowieniencja {
  /** Which table(s) the figure is derived from, in the reader's language. */
  zrodlo: string
  rodzaj: Rodzaj
  /** The limitation a reader must know before quoting the number. Shown on hover. */
  uwaga: string
}

/** Keyed by the KPI's on-screen label so a new tile without an entry is obvious in review. */
export const PROWIENIENCJA: Record<string, Prowieniencja> = {
  'Stan zatrudnienia': {
    zrodlo: 'kartoteka + dziennik audytu',
    rodzaj: 'odtwarzane',
    uwaga:
      'Kartoteka nie ma kolumny końca zatrudnienia, więc stan na dany dzień jest odtwarzany z wpisów user.deactivated w dzienniku audytu. Konto wyłączone bez wpisu liczone jest jako nieobecne w całym okresie; reaktywacja nie jest audytowana, więc konto czynne dziś liczy się jako obecne przez cały okres.',
  },
  'Wskaźnik absencji': {
    zrodlo: 'zatwierdzone wnioski urlopowe',
    rodzaj: 'liczone',
    uwaga:
      'Liczone z zatwierdzonych nieobecności wobec dni roboczych w zakresie. Nieobecność niezgłoszona wnioskiem (np. nieusprawiedliwiona) nie istnieje w danych i nie podnosi wskaźnika.',
  },
  'Suma godzin': {
    zrodlo: 'grafik (czas zaplanowany)',
    rodzaj: 'planowane',
    uwaga:
      'To godziny ZAPLANOWANE w grafiku — nie ma tabeli ewidencji obecności, więc nieobecność, spóźnienie ani odwołana zmiana nie zmieniają tej liczby. Przerwa niepłatna nie jest odliczana: okno 8h liczy się jako 8h.',
  },
  'Nadwyżka ponad normę': {
    zrodlo: 'grafik wobec normy tygodniowej',
    rodzaj: 'planowane',
    uwaga:
      'To NIE są nadgodziny w rozumieniu Kodeksu pracy. Stosowana jest wyłącznie norma TYGODNIOWA (etat × 8h × dni robocze); art. 151 §1 zna też normę dobową, więc 12h przez trzy dni daje tu zero, a wg KP dwanaście nadgodzin. Liczba systematycznie ZANIŻA nadgodziny ustawowe w pracy zmianowej. Nadwyżka i niedobór są sumowane osobno, nigdy nie kompensują się wzajemnie.',
  },
  'Wnioski w toku': {
    zrodlo: 'wnioski urlopowe',
    rodzaj: 'liczone',
    uwaga: 'Stan kolejki na koniec zakresu — wnioski złożone i nierozstrzygnięte na ten moment.',
  },
  'Mediana czasu do decyzji': {
    zrodlo: 'wnioski rozstrzygnięte w zakresie',
    rodzaj: 'liczone',
    uwaga:
      'Mediana po wnioskach ROZSTRZYGNIĘTYCH w zakresie. Wniosek wiszący w kolejce od miesięcy nie wchodzi do mediany, więc rosnąca zaległość może jej nie ruszyć.',
  },
}

/** The one-line badge rendered under a KPI value. */
export function opisProwieniencji(p: Prowieniencja): string {
  return `${p.zrodlo} · ${p.rodzaj}`
}

/**
 * Window label for the KPI row. Stated once and explicitly, because every figure on the screen is
 * scoped to it and a period-over-period delta is meaningless without it.
 */
export function opisOkna(od: string, doIncl: string, dniRobocze: number): string {
  return `Okres ${od} – ${doIncl} · ${dniRobocze} dni roboczych`
}
