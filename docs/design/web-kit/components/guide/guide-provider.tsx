'use client'

import { createContext, useContext } from 'react'
import type { GuideContextValue } from '@/lib/guide/types'

export const GuideContext = createContext<GuideContextValue>({
  startTour: () => {},
  startJourney: () => {},
  isDisabled: false,
  toggleDisabled: () => {},
  activeSpaceId: null,
})

export function useGuide(): GuideContextValue {
  return useContext(GuideContext)
}
