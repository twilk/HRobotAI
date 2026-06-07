import type { Journey } from '../types'

export const konfiguracjaPlacowkiJourney: Journey = {
  id: 'konfiguracja-placowki',
  label: 'Konfiguracja nowej placówki',
  description: 'Dodaj placówkę, skonfiguruj grafik i przypisz menadżera.',
  steps: [
    {
      spaceId: 'ustawienia-placowki',
      step: {
        id: 'journey-pl-1',
        title: '🏢 Nowa placówka — krok 1/6',
        text: 'Kliknij "Dodaj placówkę", by rozpocząć konfigurację nowej lokalizacji.',
        attachTo: { element: '[data-guide="placowki:add"]', on: 'bottom' },
      },
    },
    {
      spaceId: 'ustawienia-placowki',
      step: {
        id: 'journey-pl-2',
        title: '🏢 Nowa placówka — krok 2/6',
        text: 'Wpisz pełny adres placówki. Będzie widoczny na kartotekach przypisanych pracowników.',
        attachTo: { element: '[data-guide="placowki:address"]', on: 'right' },
      },
    },
    {
      spaceId: 'ustawienia-placowki',
      step: {
        id: 'journey-pl-3',
        title: '🏢 Nowa placówka — krok 3/6',
        text: 'Ustaw godziny pracy dla każdego dnia. Grafik będzie sugerował te godziny przy tworzeniu zmian.',
        attachTo: { element: '[data-guide="placowki:hours"]', on: 'top' },
      },
    },
    {
      spaceId: 'ustawienia-placowki',
      step: {
        id: 'journey-pl-4',
        title: '🏢 Nowa placówka — krok 4/6',
        text: 'Placówka zapisana! Teraz przejdź do Grafiku, by zobaczyć ją w filtrze.',
        attachTo: { element: '[data-guide="placowki:list"]', on: 'top' },
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-pl-5',
        title: '🏢 Nowa placówka — krok 5/6',
        text: 'Nowa placówka jest dostępna w filtrze. Wybierz ją, by zobaczyć (pusty) grafik.',
        attachTo: { element: '[data-guide="grafik:facility-filter"]', on: 'bottom' },
      },
    },
    {
      spaceId: 'ustawienia-uzytkownicy',
      step: {
        id: 'journey-pl-6',
        title: '🏢 Nowa placówka — gotowe!',
        text: 'Ostatni krok: zaproś menadżera placówki. Nadaj mu rolę MANAGER — będzie zarządzał grafikiem tej lokalizacji.',
        attachTo: { element: '[data-guide="uzytkownicy:invite"]', on: 'bottom' },
      },
    },
  ],
}
