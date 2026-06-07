'use client'

import { useGuide } from './guide-provider'

export function GuideFab() {
  const { startTour, activeSpaceId } = useGuide()

  if (!activeSpaceId) return null

  return (
    <button
      type="button"
      aria-label="Otwórz przewodnik po tej przestrzeni"
      data-testid="guide-fab"
      onClick={() => startTour(activeSpaceId)}
      className="
        fixed bottom-6 right-6 z-50
        w-10 h-10 rounded-full
        bg-[#0c8fa3] text-white
        font-display font-bold text-[17px]
        shadow-[0_4px_16px_rgba(12,143,163,0.35)]
        flex items-center justify-center
        transition-transform hover:scale-110 focus:scale-110
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0c8fa3] focus-visible:ring-offset-2
      "
    >
      ?
    </button>
  )
}
