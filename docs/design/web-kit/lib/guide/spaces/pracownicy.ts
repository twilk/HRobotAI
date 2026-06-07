import type { Tour, StepOptions } from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function pracownicySteps(tour: Tour): StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1 })

  return [
    {
      id: 'pracownicy-search',
      title: 'Wyszukiwanie pracowników',
      text: 'Wpisz imię, nazwisko lub stanowisko. Filtrowanie działa w czasie rzeczywistym.',
      attachTo: { element: '[data-guide="pracownicy:search"]', on: 'bottom' },
      buttons: btn(0, 5),
      showOn() {
        return !!document.querySelector('[data-guide="pracownicy:search"]')
      },
    },
    {
      id: 'pracownicy-table',
      title: 'Lista pracowników',
      text: 'Każdy wiersz to jeden pracownik. Kliknij wiersz, by otworzyć pełną kartotekę z danymi i logiem audytu.',
      attachTo: { element: '[data-guide="pracownicy:table"]', on: 'top' },
      buttons: btn(1, 5),
      showOn() {
        return !!document.querySelector('[data-guide="pracownicy:table"]')
      },
    },
    {
      id: 'pracownicy-status',
      title: 'Status zatrudnienia',
      text: 'Zielony = aktywny, szary = nieaktywny. Kliknij kartotekę pracownika, by zmienić status.',
      attachTo: { element: '[data-guide="pracownicy:status-badge"]', on: 'left' },
      buttons: btn(2, 5),
      showOn() {
        return !!document.querySelector('[data-guide="pracownicy:status-badge"]')
      },
    },
    {
      id: 'pracownicy-add',
      title: 'Dodaj pracownika',
      text: 'Otwiera formularz z walidacją. Wymagane pola: imię, nazwisko, PESEL, stanowisko. Pracownik otrzyma zaproszenie e-mail.',
      attachTo: { element: '[data-guide="pracownicy:add-employee"]', on: 'bottom' },
      buttons: btn(3, 5),
      showOn() {
        return !!document.querySelector('[data-guide="pracownicy:add-employee"]')
      },
    },
    {
      id: 'pracownicy-detail-hint',
      title: 'Kartoteka pracownika',
      text: 'Kliknij dowolny wiersz, by zobaczyć pełny profil: dane osobowe, PESEL (chroniony), historię zmian i log audytu.',
      buttons: btn(4, 5),
    },
  ]
}
