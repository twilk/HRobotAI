import type Shepherd from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function dashboardSteps(tour: Shepherd.Tour): Shepherd.Step.StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1 })

  return [
    {
      id: 'dashboard-welcome',
      title: 'Witaj w HRobot! 👋',
      text: 'To jest Twoja przestrzeń robocza. Zarządzaj pracownikami, grafikami i wnioskami — wszystko w jednym miejscu.',
      buttons: btn(0, 4),
      when: {
        show() { console.log('[guide] dashboard:welcome') },
      },
    },
    {
      id: 'dashboard-checklist',
      title: 'Lista startowa',
      text: 'Wykonaj te kroki, by w pełni skonfigurować przestrzeń roboczą. Zniknęła? Można ją przywrócić z menu.',
      attachTo: { element: '[data-guide="dashboard:setup-checklist"]', on: 'bottom' },
      buttons: btn(1, 4),
      showOn() {
        return !!document.querySelector('[data-guide="dashboard:setup-checklist"]')
      },
    },
    {
      id: 'dashboard-quick-actions',
      title: 'Szybkie akcje',
      text: 'Skróty do najczęstszych operacji — dodaj pracownika, wygeneruj raport lub sprawdź powiadomienia.',
      attachTo: { element: '[data-guide="dashboard:quick-actions"]', on: 'bottom' },
      buttons: btn(2, 4),
      showOn() {
        return !!document.querySelector('[data-guide="dashboard:quick-actions"]')
      },
    },
    {
      id: 'dashboard-data-protection',
      title: 'Ochrona danych (RODO)',
      text: 'Dane Twoich pracowników są przechowywane na serwerach w UE. Każdy dostęp do danych wrażliwych jest logowany zgodnie z RODO Art.30.',
      attachTo: { element: '[data-guide="dashboard:data-protection"]', on: 'top' },
      buttons: btn(3, 4),
      showOn() {
        return !!document.querySelector('[data-guide="dashboard:data-protection"]')
      },
    },
  ]
}
