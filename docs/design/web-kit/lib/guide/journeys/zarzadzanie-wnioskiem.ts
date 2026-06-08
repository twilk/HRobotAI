import type { Journey } from '../types'

export const zarzadzanieWnioskiemJourney: Journey = {
  id: 'zarzadzanie-wnioskiem',
  label: 'Zarządzanie wnioskiem',
  description: 'Złóż wniosek, sprawdź wpływ na grafik i zatwierdź.',
  steps: [
    {
      spaceId: 'wnioski',
      step: {
        id: 'journey-wn-1',
        title: '📋 Zarządzanie wnioskiem — krok 1/5',
        text: 'Tu złożysz wniosek urlopowy lub kadrowy. Moduł wkrótce dostępny.',
      },
    },
    {
      spaceId: 'wnioski',
      step: {
        id: 'journey-wn-2',
        title: '📋 Zarządzanie wnioskiem — krok 2/5',
        text: 'Po złożeniu wniosku jego status zmienia się na "Oczekuje". MANAGER lub HR musi go zaakceptować.',
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-wn-3',
        title: '📋 Zarządzanie wnioskiem — krok 3/5',
        text: 'Sprawdź, które dni obejmuje wniosek. Podświetlone komórki to zmiany, których dotyczy nieobecność.',
        attachTo: { element: '[data-guide="grafik:week-nav"]', on: 'bottom' },
        extraHighlights: ['[data-guide="grafik:shift-cell"]'],
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-wn-4',
        title: '📋 Zarządzanie wnioskiem — krok 4/5',
        text: 'Możesz teraz zaplanować zastępstwo — dodaj zmianę innemu pracownikowi w tych dniach.',
        attachTo: { element: '[data-guide="grafik:add-shift"]', on: 'left' },
      },
    },
    {
      spaceId: 'pracownicy-id',
      step: {
        id: 'journey-wn-5',
        title: '📋 Zarządzanie wnioskiem — gotowe!',
        text: 'Po akceptacji wniosku sprawdź kartotekę pracownika — pojawi się wpis w historii.',
        attachTo: { element: '[data-guide="pracownicy-id:audit-log"]', on: 'top' },
      },
    },
  ],
}
