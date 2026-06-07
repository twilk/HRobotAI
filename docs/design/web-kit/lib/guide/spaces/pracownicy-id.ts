import type { Tour, StepOptions } from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function pracownicyIdSteps(tour: Tour): StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1 })

  return [
    {
      id: 'pracid-personal',
      title: 'Dane osobowe',
      text: 'Sekcja kontaktowa i kadrowa pracownika — adres, stanowisko, data zatrudnienia.',
      attachTo: { element: '[data-guide="pracownicy-id:personal-data"]', on: 'bottom' },
      buttons: btn(0, 4),
      showOn() {
        return !!document.querySelector('[data-guide="pracownicy-id:personal-data"]')
      },
    },
    {
      id: 'pracid-pesel',
      title: 'PESEL — dane wrażliwe',
      text: 'Kliknij "Odkryj PESEL" i potwierdź przyciskiem. Każde odkrycie jest logowane z Twoją nazwą użytkownika zgodnie z RODO Art.30.',
      attachTo: { element: '[data-guide="pracownicy-id:pesel-reveal"]', on: 'bottom' },
      buttons: btn(1, 4),
      showOn() {
        return !!document.querySelector('[data-guide="pracownicy-id:pesel-reveal"]')
      },
    },
    {
      id: 'pracid-audit',
      title: 'Log audytu',
      text: 'Historia wszystkich dostępów do danych wrażliwych tego pracownika. Widoczny dla HR i ADMIN_KLIENTA.',
      attachTo: { element: '[data-guide="pracownicy-id:audit-log"]', on: 'top' },
      buttons: btn(2, 4),
      showOn() {
        return !!document.querySelector('[data-guide="pracownicy-id:audit-log"]')
      },
    },
    {
      id: 'pracid-back',
      title: 'Powrót do listy',
      text: 'Wróć do listy wszystkich pracowników. Możesz też użyć przycisku Wstecz przeglądarki.',
      attachTo: { element: '[data-guide="pracownicy-id:back-link"]', on: 'bottom' },
      buttons: btn(3, 4),
      showOn() {
        return !!document.querySelector('[data-guide="pracownicy-id:back-link"]')
      },
    },
  ]
}
