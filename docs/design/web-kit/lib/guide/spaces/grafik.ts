import type { Tour, StepOptions } from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function grafikSteps(tour: Tour, onDisable?: () => void): StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1, onDisable })

  return [
    {
      id: 'grafik-week-nav',
      title: 'Nawigacja tygodniami',
      text: 'Kliknij strzałki lub użyj klawiszy ← → na klawiaturze, by przełączać tygodnie. Dzisiejszy tydzień jest podświetlony.',
      attachTo: { element: '[data-guide="grafik:week-nav"]', on: 'bottom' },
      buttons: btn(0, 5),
      showOn() {
        return !!document.querySelector('[data-guide="grafik:week-nav"]')
      },
    },
    {
      id: 'grafik-facility',
      title: 'Filtr placówki',
      text: 'Wyświetl grafik tylko dla wybranej lokalizacji. Placówki konfigurujesz w Ustawieniach → Placówki.',
      attachTo: { element: '[data-guide="grafik:facility-filter"]', on: 'bottom' },
      buttons: btn(1, 5),
      showOn() {
        return !!document.querySelector('[data-guide="grafik:facility-filter"]')
      },
    },
    {
      id: 'grafik-cell',
      title: 'Komórka zmiany',
      text: 'Każda komórka to jeden dzień jednego pracownika. Kliknij komórkę, by dodać zmianę. Komórki z istniejącą zmianą pokazują godziny.',
      attachTo: { element: '[data-guide="grafik:shift-cell"]', on: 'top' },
      extraHighlights: ['[data-guide="grafik:shift-row"]'],
      buttons: btn(2, 5),
      showOn() {
        return !!document.querySelector('[data-guide="grafik:shift-cell"]')
      },
    },
    {
      id: 'grafik-add',
      title: 'Dodaj zmianę',
      text: 'Kliknij pustą komórkę, by wpisać godziny zmiany (np. 08:00–16:00). Zatwierdź Enterem.',
      attachTo: { element: '[data-guide="grafik:add-shift"]', on: 'left' },
      buttons: btn(3, 5),
      showOn() {
        return !!document.querySelector('[data-guide="grafik:add-shift"]')
      },
    },
    {
      id: 'grafik-remove',
      title: 'Usuń zmianę',
      text: 'Najedź na zmianę lub zaznacz ją klawiaturą (Tab) — pojawi się przycisk usuwania. Działa też klawiszem Delete.',
      attachTo: { element: '[data-guide="grafik:remove-shift"]', on: 'right' },
      buttons: btn(4, 5),
      showOn() {
        return !!document.querySelector('[data-guide="grafik:remove-shift"]')
      },
    },
  ]
}
