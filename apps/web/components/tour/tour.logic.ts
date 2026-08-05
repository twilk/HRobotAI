/**
 * Czysta logika nawigacji przewodnika — bez Reacta, testowalna jednostkowo.
 * Trzyma kalkulacje indeksu kroku poza komponentem, tak by autoplay/Dalej/Wstecz
 * miały jedno, deterministyczne źródło prawdy (i żeby dało się je przetestować).
 */

/**
 * Następny indeks kroku w granicach [0, len). Nie zawija się — na krańcu „stoi w miejscu",
 * więc autoplay zatrzymuje się na ostatnim kroku zamiast wracać na początek.
 * @param i   bieżący indeks
 * @param len liczba kroków
 * @param dir kierunek: +1 (dalej) lub -1 (wstecz)
 */
export function nextIndex(i: number, len: number, dir: 1 | -1): number {
  if (len <= 0) return 0
  const next = i + dir
  if (next < 0) return 0
  if (next > len - 1) return len - 1
  return next
}

/** Czy dany indeks jest ostatnim krokiem (autoplay wtedy się zatrzymuje). */
export function isLast(i: number, len: number): boolean {
  return len <= 0 ? true : i >= len - 1
}

/** Zaciśnij dowolny indeks do poprawnego zakresu (obrona przed danymi spoza granic). */
export function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0
  if (i < 0) return 0
  if (i > len - 1) return len - 1
  return i
}
