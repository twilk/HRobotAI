import type { Journey } from '../types'

export const onboardingPracownikaJourney: Journey = {
  id: 'onboarding-pracownika',
  label: 'Onboarding nowego pracownika',
  description: 'Dodaj pracownika, wstaw go do grafiku i przypisz dostępy.',
  steps: [
    {
      spaceId: 'pracownicy',
      step: {
        id: 'journey-onb-1',
        title: '🟢 Onboarding — krok 1/7',
        text: 'Zacznij od kliknięcia "Dodaj pracownika". Wypełnij formularz i zatwierdź.',
        attachTo: { element: '[data-guide="pracownicy:add-employee"]', on: 'bottom' },
        advanceOn: { selector: '[data-testid="add-employee-submit"]', event: 'click' },
      },
    },
    {
      spaceId: 'pracownicy',
      step: {
        id: 'journey-onb-2',
        title: '🟢 Onboarding — krok 2/7',
        text: 'Nowy pracownik pojawił się na liście. Teraz przejdź do Grafiku, by wstawić jego pierwsze zmiany.',
        attachTo: { element: '[data-guide="pracownicy:table"]', on: 'top' },
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-onb-3',
        title: '🟢 Onboarding — krok 3/7',
        text: 'Znajdź wiersz nowego pracownika w grafiku. Kliknij pustą komórkę, by dodać pierwszą zmianę.',
        attachTo: { element: '[data-guide="grafik:shift-cell"]', on: 'top' },
        extraHighlights: ['[data-guide="grafik:week-nav"]'],
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-onb-4',
        title: '🟢 Onboarding — krok 4/7',
        text: 'Wpisz godziny zmiany (np. 08:00–16:00) i naciśnij Enter. Zmiana pojawi się w komórce.',
        attachTo: { element: '[data-guide="grafik:add-shift"]', on: 'left' },
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-onb-5',
        title: '🟢 Onboarding — krok 5/7',
        text: 'Świetnie! Zmiana zapisana. Możesz dodać więcej lub przejść do Dostępów, by przypisać rolę.',
        attachTo: { element: '[data-guide="grafik:facility-filter"]', on: 'bottom' },
      },
    },
    {
      spaceId: 'dostepy',
      step: {
        id: 'journey-onb-6',
        title: '🟢 Onboarding — krok 6/7',
        text: 'Tu przypisz rolę nowemu pracownikowi. Rola określa, co może robić w systemie.',
      },
    },
    {
      spaceId: 'dostepy',
      step: {
        id: 'journey-onb-7',
        title: '🟢 Onboarding — gotowe!',
        text: 'Pracownik jest dodany, ma zaplanowane zmiany i przypisaną rolę. Onboarding zakończony!',
      },
    },
  ],
}
