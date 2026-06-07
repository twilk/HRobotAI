import type Shepherd from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function ustawieniaSteps(tour: Shepherd.Tour): Shepherd.Step.StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1 })

  return [
    {
      id: 'ustawienia-placowki-link',
      title: 'Placówki',
      text: 'Konfiguruj lokalizacje firmy — adresy, godziny pracy i przypisanych pracowników.',
      attachTo: { element: '[data-guide="ustawienia:nav-placowki"]', on: 'right' },
      buttons: btn(0, 3),
      showOn() {
        return !!document.querySelector('[data-guide="ustawienia:nav-placowki"]')
      },
    },
    {
      id: 'ustawienia-uzytkownicy-link',
      title: 'Użytkownicy',
      text: 'Zapraszaj pracowników i administratorów oraz zarządzaj ich dostępem do systemu.',
      attachTo: { element: '[data-guide="ustawienia:nav-uzytkownicy"]', on: 'right' },
      buttons: btn(1, 3),
      showOn() {
        return !!document.querySelector('[data-guide="ustawienia:nav-uzytkownicy"]')
      },
    },
    {
      id: 'ustawienia-admin-note',
      title: 'Panel administracyjny',
      text: 'Ten panel jest widoczny wyłącznie dla roli ADMIN_KLIENTA. Inne role nie widzą sekcji Administracja w menu.',
      buttons: btn(2, 3),
    },
  ]
}
