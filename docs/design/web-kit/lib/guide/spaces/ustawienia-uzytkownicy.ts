import type { Tour, StepOptions } from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function ustawieniaUzytkownicySteps(tour: Tour, onDisable?: () => void): StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1, onDisable })

  return [
    {
      id: 'uzytkownicy-table',
      title: 'Lista użytkowników',
      text: 'Wszyscy, którzy mają dostęp do tej przestrzeni roboczej i w jakiej roli.',
      attachTo: { element: '[data-guide="uzytkownicy:table"]', on: 'top' },
      buttons: btn(0, 4),
      showOn() {
        return !!document.querySelector('[data-guide="uzytkownicy:table"]')
      },
    },
    {
      id: 'uzytkownicy-role',
      title: 'Role użytkowników',
      text: 'PRACOWNIK, MANAGER, HR lub ADMIN_KLIENTA. Rolę można zmienić w każdej chwili — wchodzi w życie natychmiast.',
      attachTo: { element: '[data-guide="uzytkownicy:role-badge"]', on: 'left' },
      buttons: btn(1, 4),
      showOn() {
        return !!document.querySelector('[data-guide="uzytkownicy:role-badge"]')
      },
    },
    {
      id: 'uzytkownicy-invite',
      title: 'Zaproś użytkownika',
      text: 'Wpisz e-mail i wybierz rolę. Nowy użytkownik dostaje link do ustawienia hasła przez Keycloak SSO.',
      attachTo: { element: '[data-guide="uzytkownicy:invite"]', on: 'bottom' },
      buttons: btn(2, 4),
      showOn() {
        return !!document.querySelector('[data-guide="uzytkownicy:invite"]')
      },
    },
    {
      id: 'uzytkownicy-security',
      title: 'Bezpieczeństwo i SSO',
      text: 'HRobot używa Keycloak do uwierzytelniania. Żadne hasła nie są przechowywane w aplikacji — wyłącznie tokeny SSO.',
      buttons: btn(3, 4),
    },
  ]
}
