/**
 * Kroki prowadzonego przewodnika po HRobot (demo 4Mobility).
 *
 * Odtworzony koncept ze starego, vanilla toura (Shepherd.js — `apps/web/tour.js` w historii),
 * ale w wersji „produktowej": zamiast onboardingu control-plane oprowadza po realnych modułach
 * M1–M3 nowej apki. Każdy krok kotwiczy się do prawdziwego ekranu przez `screen` (href z nawigacji)
 * i do węzła w layoucie przez `target` (selektor CSS — dodaj `data-tour="..."` na elemencie, albo
 * użyj istniejącego selektora/`[href="..."]`). Teksty są realne (PL), nie placeholderowe.
 */
export interface TourStep {
  /** Stabilny, unikalny identyfikator kroku. */
  id: string
  /** Selektor CSS elementu do podświetlenia (spotlight). Fallback: cała plansza gdy brak dopasowania. */
  target: string
  /** Nagłówek dymka. */
  title: string
  /** Treść dymka (zwięzły opis wartości modułu). */
  text: string
  /** Opcjonalny href ekranu, którego dotyczy krok — pod deep-link / podświetlenie pozycji w menu. */
  screen?: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'dashboard',
    target: '[data-tour="dashboard"]',
    screen: '/dashboard',
    title: 'Pulpit menedżera',
    text: 'Start dnia w jednym miejscu: obsada zmian, otwarte wnioski i sygnały z AI. Kafelki prowadzą prosto do modułu, który wymaga decyzji — bez klikania po całej aplikacji.',
  },
  {
    id: 'pracownicy',
    target: '[href="/pracownicy"]',
    screen: '/pracownicy',
    title: 'Kartoteka pracowników',
    text: 'Zespół, role i dostępności w zgodzie z RODO — numery PESEL nigdy nie trafiają do przeglądarki. Każdy profil to punkt wyjścia do grafiku, wniosków i dokumentów pracownika.',
  },
  {
    id: 'grafik',
    target: '[href="/grafik"]',
    screen: '/grafik',
    title: 'Grafik zmian',
    text: 'Tygodniowy plan obsady z kontrolą kolizji i okien zmian. Widać kto, kiedy i na jakim stanowisku — a braki w pokryciu podświetlają się, zanim staną się problemem.',
  },
  {
    id: 'ai-grafik',
    target: '[href="/ai-grafik-manager"]',
    screen: '/ai-grafik-manager',
    title: 'AI Grafik Manager',
    text: 'Silnik optymalizacji układa grafik pod realne ograniczenia: dostępności, kompetencje i koszt. Menedżer dostaje gotowe propozycje zamian do zatwierdzenia jednym kliknięciem.',
  },
  {
    id: 'wnioski',
    target: '[href="/wnioski"]',
    screen: '/wnioski',
    title: 'Wnioski i akceptacje',
    text: 'Urlopy i nieobecności w jednym obiegu: pracownik składa, menedżer akceptuje, grafik reaguje. Każda decyzja jest audytowana i widoczna dla obu stron.',
  },
  {
    id: 'dokumenty',
    target: '[href="/dokumenty"]',
    screen: '/dokumenty',
    title: 'Dokumenty i ewidencja',
    text: 'Ewidencja czasu pracy i dokumenty kadrowe generowane jako PDF z poprawną polską typografią. Pracownik widzi swoją ewidencję w trybie tylko-do-odczytu.',
  },
  {
    id: 'analiza',
    target: '[href="/analiza"]',
    screen: '/analiza',
    title: 'Analityk HR',
    text: 'Pytania o zespół zadane po polsku, odpowiedzi liczone na Twoich danych: rotacja, nadgodziny, koszt obsady, ryzyka. Strategiczny obraz HR bez arkuszy i eksportów.',
  },
  {
    id: 'asystent',
    target: '[href="/asystent"]',
    screen: '/asystent',
    title: 'Agent głosowy',
    text: 'Asystent tekstowo-głosowy wykonuje polecenia w imieniu zalogowanego użytkownika — bez eskalacji uprawnień. Zapytaj o grafik albo złóż wniosek zwykłym zdaniem.',
  },
]
