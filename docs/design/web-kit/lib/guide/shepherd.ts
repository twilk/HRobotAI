import type { GuideSpaceId } from './types'

function scrollInsideAppShell(element: HTMLElement) {
  const scrollParent = findScrollableParent(element)

  if (!scrollParent) {
    return
  }

  const parentRect = scrollParent.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const elementCenter = elementRect.top - parentRect.top + scrollParent.scrollTop + elementRect.height / 2
  const nextTop = elementCenter - parentRect.height / 2

  scrollParent.scrollTo({
    top: Math.max(0, nextTop),
    behavior: 'smooth',
  })
}

function findScrollableParent(element: HTMLElement) {
  let parent = element.parentElement

  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent)
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight

    if (canScrollY) {
      return parent
    }

    parent = parent.parentElement
  }

  return null
}

/**
 * Lazily imports Shepherd to avoid SSR issues (Shepherd accesses `document`).
 * Returns a new Tour configured with HRobot's defaults.
 *
 * Usage (always in a 'use client' component, after mount):
 *   const tour = await createTour('dashboard')
 *   tour.addSteps(dashboardSteps(tour))
 *   tour.start()
 */
export async function createTour(spaceId: GuideSpaceId) {
  const { default: Shepherd } = await import('shepherd.js')

  return new Shepherd.Tour({
    tourName: spaceId,
    useModalOverlay: true,
    exitOnEsc: true,
    keyboardNavigation: true,
    defaultStepOptions: {
      classes: 'hrobot-shepherd',
      cancelIcon: {
        enabled: true,
        label: 'Zamknij przewodnik',
        attrs: { 'data-testid': 'guide-cancel-icon' },
      },
      scrollTo: { behavior: 'smooth', block: 'center' },
      scrollToHandler: scrollInsideAppShell,
      modalOverlayOpeningPadding: 8,
      modalOverlayOpeningRadius: 6,
      arrow: { padding: 8 },
      highlightClass: 'guide-active',
    },
  })
}

/**
 * Standard button set for per-space tours (not journeys).
 * isFirst: hides Back, shows "Wyłącz auto-start".
 * isLast:  changes Next label to "Gotowe".
 */
export function makeButtons(
  tour: { back: () => void; next: () => void; cancel: () => void; complete: () => void },
  opts: { isFirst: boolean; isLast: boolean; onDisable?: () => void },
) {
  const buttons: object[] = []

  if (opts.isFirst && opts.onDisable) {
    buttons.push({
      text: 'Wyłącz auto-start',
      secondary: true,
      classes: 'shepherd-button-secondary shepherd-button-disable',
      attrs: { 'data-testid': 'guide-btn-disable' },
      action() { opts.onDisable!(); tour.cancel() },
    })
  }

  if (!opts.isFirst) {
    buttons.push({
      text: 'Wstecz',
      secondary: true,
      attrs: { 'data-testid': 'guide-btn-back' },
      action() { tour.back() },
    })
  }

  buttons.push({
    text: 'Pomiń',
    secondary: true,
    attrs: { 'data-testid': 'guide-btn-skip' },
    action() { tour.cancel() },
  })

  buttons.push({
    text: opts.isLast ? 'Gotowe' : 'Dalej →',
    attrs: { 'data-testid': opts.isLast ? 'guide-btn-done' : 'guide-btn-next' },
    action() { opts.isLast ? tour.complete() : tour.next() },
  })

  return buttons
}
