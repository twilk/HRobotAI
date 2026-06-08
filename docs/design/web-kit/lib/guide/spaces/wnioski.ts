import type { Tour, StepOptions } from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function wnioskiSteps(tour: Tour, onDisable?: () => void): StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1, onDisable })

  return [
    {
      id: 'wnioski-intro',
      title: 'Wnioski — wkrótce',
      text: 'Ten moduł obsługuje wnioski urlopowe, kadrowe i inne. Jest w trakcie budowy i pojawi się wkrótce.',
      buttons: btn(0, 2),
    },
    {
      id: 'wnioski-flow',
      title: 'Jak będzie działać',
      text: 'Pracownik składa wniosek → automatyczny obieg akceptacji przez MANAGER-a lub HR → powiadomienie e-mail o decyzji.',
      buttons: btn(1, 2),
    },
  ]
}
