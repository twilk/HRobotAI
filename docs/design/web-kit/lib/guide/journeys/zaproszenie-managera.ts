import type { Journey } from '../types'

export const zaproszenieManageraJourney: Journey = {
  id: 'zaproszenie-managera',
  label: 'Zaproszenie menadżera',
  description: 'Dodaj nowego menadżera i przypisz mu placówkę.',
  steps: [
    {
      spaceId: 'ustawienia-uzytkownicy',
      step: {
        id: 'journey-mgr-1',
        title: '👤 Zaproszenie menadżera — krok 1/5',
        text: 'Kliknij "Zaproś użytkownika". Wpisz e-mail przyszłego menadżera.',
        attachTo: { element: '[data-guide="uzytkownicy:invite"]', on: 'bottom' },
      },
    },
    {
      spaceId: 'ustawienia-uzytkownicy',
      step: {
        id: 'journey-mgr-2',
        title: '👤 Zaproszenie menadżera — krok 2/5',
        text: 'Wybierz rolę MANAGER. Menadżer może zarządzać grafikiem i zatwierdzać wnioski.',
        attachTo: { element: '[data-guide="uzytkownicy:role-badge"]', on: 'left' },
      },
    },
    {
      spaceId: 'ustawienia-uzytkownicy',
      step: {
        id: 'journey-mgr-3',
        title: '👤 Zaproszenie menadżera — krok 3/5',
        text: 'Zaproszenie wysłane! Menadżer dostanie e-mail z linkiem do Keycloak. Po zalogowaniu widzi swoje placówki.',
        attachTo: { element: '[data-guide="uzytkownicy:table"]', on: 'top' },
      },
    },
    {
      spaceId: 'dostepy',
      step: {
        id: 'journey-mgr-4',
        title: '👤 Zaproszenie menadżera — krok 4/5',
        text: 'W Dostępach możesz zawęzić uprawnienia menadżera do konkretnych placówek (funkcja wkrótce).',
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-mgr-5',
        title: '👤 Zaproszenie menadżera — gotowe!',
        text: 'Menadżer widzi w Grafiku tylko swoje placówki. Użyj filtru placówki, by to sprawdzić.',
        attachTo: { element: '[data-guide="grafik:facility-filter"]', on: 'bottom' },
      },
    },
  ],
}
