import type Shepherd from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function ustawieniaPlacowkiSteps(tour: Shepherd.Tour): Shepherd.Step.StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1 })

  return [
    {
      id: 'placowki-list',
      title: 'Lista placówek',
      text: 'Twoje lokalizacje. Kliknij placówkę, by edytować adres, godziny pracy lub przypisanych pracowników.',
      attachTo: { element: '[data-guide="placowki:list"]', on: 'top' },
      buttons: btn(0, 4),
      showOn() {
        return !!document.querySelector('[data-guide="placowki:list"]')
      },
    },
    {
      id: 'placowki-add',
      title: 'Dodaj placówkę',
      text: 'Każda firma może mieć wiele lokalizacji. Kliknij, by dodać nową placówkę z adresem i nazwą.',
      attachTo: { element: '[data-guide="placowki:add"]', on: 'bottom' },
      buttons: btn(1, 4),
      showOn() {
        return !!document.querySelector('[data-guide="placowki:add"]')
      },
    },
    {
      id: 'placowki-address',
      title: 'Adres placówki',
      text: 'Ulica, numer, kod pocztowy i miasto. Adres jest wyświetlany na kartotekach pracowników przypisanych do tej placówki.',
      attachTo: { element: '[data-guide="placowki:address"]', on: 'right' },
      buttons: btn(2, 4),
      showOn() {
        return !!document.querySelector('[data-guide="placowki:address"]')
      },
    },
    {
      id: 'placowki-hours',
      title: 'Godziny pracy',
      text: 'Ustaw godziny otwarcia dla każdego dnia tygodnia. Te godziny pojawiają się jako sugestia podczas tworzenia zmian w Grafiku.',
      attachTo: { element: '[data-guide="placowki:hours"]', on: 'top' },
      buttons: btn(3, 4),
      showOn() {
        return !!document.querySelector('[data-guide="placowki:hours"]')
      },
    },
  ]
}
