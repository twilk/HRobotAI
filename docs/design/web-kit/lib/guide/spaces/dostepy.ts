import type { Tour, StepOptions } from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function dostepySteps(tour: Tour, onDisable?: () => void): StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1, onDisable })

  return [
    {
      id: 'dostepy-intro',
      title: 'Dostępy — wkrótce',
      text: 'Tu zarządzasz uprawnieniami i rolami użytkowników. Moduł jest w trakcie budowy.',
      buttons: btn(0, 2),
    },
    {
      id: 'dostepy-roles',
      title: 'Role w HRobot',
      text: 'PRACOWNIK — widzi swoje dane. MANAGER — zarządza grafikiem. HR — pełny dostęp kadrowy. ADMIN_KLIENTA — pełna administracja.',
      buttons: btn(1, 2),
    },
  ]
}
