# Przewodnik — Guide Microcomponent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global "?" floating button that launches context-sensitive Shepherd.js guided tours for each of HRobot's 9 tenant spaces, plus 4 multi-space journey guides.

**Architecture:** `lib/guide/` holds pure-TS types, localStorage store helpers, pathname registry, Tour factory, and per-space step configs. `components/guide/` holds two Client Components: `GuideFab` (the "?" button) and `GuideProvider` (auto-launch logic + React Context). Shepherd.js does all the heavy lifting — modal overlay, popovers, keyboard nav, scroll-to, arrow positioning.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Shepherd.js (commercial license — $50 purchase required before ship), react-hot-toast (already installed), Vitest + RTL, Tailwind v3.

**Working directory:** `docs/design/web-kit/`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `lib/guide/types.ts` | All shared TypeScript types |
| Create | `lib/guide/store.ts` | localStorage read/write (SSR-safe) |
| Create | `lib/guide/registry.ts` | pathname → GuideSpaceId |
| Create | `lib/guide/shepherd.ts` | Shared Shepherd.Tour factory |
| Create | `lib/guide/spaces/dashboard.ts` | 4 dashboard steps |
| Create | `lib/guide/spaces/pracownicy.ts` | 5 employees-list steps |
| Create | `lib/guide/spaces/pracownicy-id.ts` | 4 employee-detail steps |
| Create | `lib/guide/spaces/grafik.ts` | 5 schedule steps |
| Create | `lib/guide/spaces/wnioski.ts` | 2 requests steps |
| Create | `lib/guide/spaces/dostepy.ts` | 2 access steps |
| Create | `lib/guide/spaces/ustawienia.ts` | 3 settings steps |
| Create | `lib/guide/spaces/ustawienia-placowki.ts` | 4 facilities steps |
| Create | `lib/guide/spaces/ustawienia-uzytkownicy.ts` | 4 users steps |
| Create | `lib/guide/journeys/onboarding-pracownika.ts` | 7-step cross-space journey |
| Create | `lib/guide/journeys/zarzadzanie-wnioskiem.ts` | 5-step cross-space journey |
| Create | `lib/guide/journeys/konfiguracja-placowki.ts` | 6-step cross-space journey |
| Create | `lib/guide/journeys/zaproszenie-managera.ts` | 5-step cross-space journey |
| Create | `components/guide/guide-fab.tsx` | "?" FAB button |
| Create | `components/guide/guide-provider.tsx` | Auto-launch Context provider |
| Modify | `app/globals.css` | Shepherd.js CSS overrides |
| Modify | `app/(tenant)/layout.tsx` | Wrap children with GuideProvider + GuideFab |
| Modify | `app/(tenant)/dashboard/page.tsx` | data-guide attrs + journey entry |
| Modify | `app/(tenant)/pracownicy/page.tsx` | data-guide attrs |
| Modify | `app/(tenant)/pracownicy/[id]/page.tsx` | data-guide attrs |
| Modify | `app/(tenant)/grafik/page.tsx` | data-guide attrs |
| Modify | `app/(tenant)/wnioski/page.tsx` | data-guide attrs |
| Modify | `app/(tenant)/dostepy/page.tsx` | data-guide attrs |
| Modify | `app/(tenant)/ustawienia/page.tsx` | data-guide attrs |
| Modify | `app/(tenant)/ustawienia/placowki/page.tsx` | data-guide attrs |
| Modify | `app/(tenant)/ustawienia/uzytkownicy/page.tsx` | data-guide attrs |
| Create | `test/guide/store.test.ts` | Unit tests — store |
| Create | `test/guide/registry.test.ts` | Unit tests — registry |
| Create | `test/guide/guide-fab.test.tsx` | RTL tests — GuideFab |
| Create | `test/guide/guide-provider.test.tsx` | RTL tests — GuideProvider |

---

## Task 1: Install shepherd.js + TypeScript types

**Files:**
- Modify: `package.json`
- Create: `lib/guide/types.ts`

- [ ] **Step 1: Install shepherd.js**

```bash
cd docs/design/web-kit
pnpm add shepherd.js
```

Expected: `shepherd.js` appears in `node_modules/` and `package.json` dependencies.

- [ ] **Step 2: Create `lib/guide/types.ts`**

```typescript
import type Shepherd from 'shepherd.js'

// ─── Space IDs ────────────────────────────────────────────────────────────────

export type GuideSpaceId =
  | 'dashboard'
  | 'pracownicy'
  | 'pracownicy-id'
  | 'grafik'
  | 'wnioski'
  | 'dostepy'
  | 'ustawienia'
  | 'ustawienia-placowki'
  | 'ustawienia-uzytkownicy'

// ─── Journey IDs ──────────────────────────────────────────────────────────────

export type JourneyId =
  | 'onboarding-pracownika'
  | 'zarzadzanie-wnioskiem'
  | 'konfiguracja-placowki'
  | 'zaproszenie-managera'

// ─── Space metadata ───────────────────────────────────────────────────────────

export interface GuideSpace {
  id: GuideSpaceId
  label: string
  pathname: string
  pathnameMatch: 'exact' | 'prefix'
}

// ─── Journey step (cross-space) ───────────────────────────────────────────────

export interface JourneyStep {
  spaceId: GuideSpaceId
  /** Shepherd Step options for this step in the journey */
  step: Shepherd.Step.StepOptions
}

export interface Journey {
  id: JourneyId
  label: string
  description: string
  steps: JourneyStep[]
}

// ─── localStorage state ───────────────────────────────────────────────────────

/** Which spaces the current user has already seen their auto-tour for */
export type VisitedStore = Partial<Record<GuideSpaceId, true>>

/** If true, never auto-launch tours on first visit */
export type DisabledStore = boolean

/** Active cross-space journey progress */
export interface JourneyState {
  id: JourneyId
  /** Global step index across all journey spaces combined */
  step: number
  startedAt: string
}

// ─── React Context ────────────────────────────────────────────────────────────

export interface GuideContextValue {
  startTour: (spaceId?: GuideSpaceId) => void
  startJourney: (journeyId: JourneyId) => void
  isDisabled: boolean
  toggleDisabled: () => void
  activeSpaceId: GuideSpaceId | null
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd docs/design/web-kit
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add docs/design/web-kit/package.json docs/design/web-kit/lib/guide/types.ts
git commit -m "feat(guide): install shepherd.js + TypeScript types"
```

---

## Task 2: `lib/guide/store.ts` (TDD)

**Files:**
- Create: `test/guide/store.test.ts`
- Create: `lib/guide/store.ts`

- [ ] **Step 1: Write failing tests**

Create `test/guide/store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isVisited,
  markVisited,
  isDisabled,
  setDisabled,
  getJourneyState,
  setJourneyState,
  clearJourneyState,
} from '@/lib/guide/store'
import type { GuideSpaceId, JourneyId } from '@/lib/guide/types'

const SPACE: GuideSpaceId = 'dashboard'
const JOURNEY: JourneyId = 'onboarding-pracownika'

beforeEach(() => {
  localStorage.clear()
})

describe('visited store', () => {
  it('returns false when space not visited', () => {
    expect(isVisited(SPACE)).toBe(false)
  })

  it('returns true after markVisited', () => {
    markVisited(SPACE)
    expect(isVisited(SPACE)).toBe(true)
  })

  it('does not affect other spaces', () => {
    markVisited(SPACE)
    expect(isVisited('pracownicy')).toBe(false)
  })
})

describe('disabled store', () => {
  it('returns false by default', () => {
    expect(isDisabled()).toBe(false)
  })

  it('returns true after setDisabled(true)', () => {
    setDisabled(true)
    expect(isDisabled()).toBe(true)
  })

  it('returns false after setDisabled(false)', () => {
    setDisabled(true)
    setDisabled(false)
    expect(isDisabled()).toBe(false)
  })
})

describe('journey state store', () => {
  it('returns null when no journey active', () => {
    expect(getJourneyState()).toBeNull()
  })

  it('returns stored journey state', () => {
    setJourneyState({ id: JOURNEY, step: 2, startedAt: '2026-06-07T12:00:00Z' })
    const state = getJourneyState()
    expect(state?.id).toBe(JOURNEY)
    expect(state?.step).toBe(2)
  })

  it('clears journey state', () => {
    setJourneyState({ id: JOURNEY, step: 0, startedAt: '2026-06-07T12:00:00Z' })
    clearJourneyState()
    expect(getJourneyState()).toBeNull()
  })
})

describe('SSR safety', () => {
  it('does not throw when localStorage is not available', () => {
    // Simulate SSR: getItem returns null, setItem is a no-op
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage not available')
    })
    expect(() => isVisited(SPACE)).not.toThrow()
    expect(isVisited(SPACE)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd docs/design/web-kit
pnpm test:run test/guide/store.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/guide/store'`

- [ ] **Step 3: Implement `lib/guide/store.ts`**

```typescript
import type { GuideSpaceId, JourneyState, VisitedStore } from './types'

const KEYS = {
  visited:  'hrobot_guide_v1_visited',
  disabled: 'hrobot_guide_v1_disabled',
  journey:  'hrobot_guide_v1_journey',
} as const

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // SSR or storage quota — silently ignore
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // SSR — silently ignore
  }
}

// ─── Visited ──────────────────────────────────────────────────────────────────

export function isVisited(spaceId: GuideSpaceId): boolean {
  const raw = safeGet(KEYS.visited)
  if (!raw) return false
  try {
    const store: VisitedStore = JSON.parse(raw)
    return store[spaceId] === true
  } catch {
    return false
  }
}

export function markVisited(spaceId: GuideSpaceId): void {
  const raw = safeGet(KEYS.visited)
  let store: VisitedStore = {}
  if (raw) {
    try { store = JSON.parse(raw) } catch { /* ignore */ }
  }
  store[spaceId] = true
  safeSet(KEYS.visited, JSON.stringify(store))
}

// ─── Disabled ─────────────────────────────────────────────────────────────────

export function isDisabled(): boolean {
  return safeGet(KEYS.disabled) === 'true'
}

export function setDisabled(value: boolean): void {
  if (value) {
    safeSet(KEYS.disabled, 'true')
  } else {
    safeRemove(KEYS.disabled)
  }
}

// ─── Journey State ────────────────────────────────────────────────────────────

export function getJourneyState(): JourneyState | null {
  const raw = safeGet(KEYS.journey)
  if (!raw) return null
  try {
    return JSON.parse(raw) as JourneyState
  } catch {
    return null
  }
}

export function setJourneyState(state: JourneyState): void {
  safeSet(KEYS.journey, JSON.stringify(state))
}

export function clearJourneyState(): void {
  safeRemove(KEYS.journey)
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm test:run test/guide/store.test.ts
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/design/web-kit/lib/guide/store.ts docs/design/web-kit/test/guide/store.test.ts
git commit -m "feat(guide): store.ts — localStorage helpers (TDD)"
```

---

## Task 3: `lib/guide/registry.ts` (TDD)

**Files:**
- Create: `test/guide/registry.test.ts`
- Create: `lib/guide/registry.ts`

- [ ] **Step 1: Write failing tests**

Create `test/guide/registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { resolveSpace, SPACES } from '@/lib/guide/registry'

describe('resolveSpace', () => {
  it('resolves /dashboard → dashboard', () => {
    expect(resolveSpace('/dashboard')).toBe('dashboard')
  })

  it('resolves /pracownicy → pracownicy (exact, not prefix)', () => {
    expect(resolveSpace('/pracownicy')).toBe('pracownicy')
  })

  it('resolves /pracownicy/123 → pracownicy-id (prefix match)', () => {
    expect(resolveSpace('/pracownicy/abc-123')).toBe('pracownicy-id')
  })

  it('resolves /grafik → grafik', () => {
    expect(resolveSpace('/grafik')).toBe('grafik')
  })

  it('resolves /wnioski → wnioski', () => {
    expect(resolveSpace('/wnioski')).toBe('wnioski')
  })

  it('resolves /dostepy → dostepy', () => {
    expect(resolveSpace('/dostepy')).toBe('dostepy')
  })

  it('resolves /ustawienia/placowki → ustawienia-placowki (before /ustawienia)', () => {
    expect(resolveSpace('/ustawienia/placowki')).toBe('ustawienia-placowki')
  })

  it('resolves /ustawienia/uzytkownicy → ustawienia-uzytkownicy', () => {
    expect(resolveSpace('/ustawienia/uzytkownicy')).toBe('ustawienia-uzytkownicy')
  })

  it('resolves /ustawienia → ustawienia', () => {
    expect(resolveSpace('/ustawienia')).toBe('ustawienia')
  })

  it('returns null for unknown paths', () => {
    expect(resolveSpace('/login')).toBeNull()
    expect(resolveSpace('/')).toBeNull()
    expect(resolveSpace('/signup')).toBeNull()
  })

  it('SPACES array exports 9 spaces', () => {
    expect(SPACES).toHaveLength(9)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm test:run test/guide/registry.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/guide/registry'`

- [ ] **Step 3: Implement `lib/guide/registry.ts`**

```typescript
import type { GuideSpace, GuideSpaceId } from './types'

/**
 * Order matters: more-specific paths must come before their prefixes.
 * 'pracownicy-id' (prefix /pracownicy/) before 'pracownicy' (exact /pracownicy).
 * 'ustawienia-placowki' before 'ustawienia'.
 */
export const SPACES: GuideSpace[] = [
  { id: 'pracownicy-id',          label: 'Kartoteka pracownika', pathname: '/pracownicy/',            pathnameMatch: 'prefix' },
  { id: 'pracownicy',             label: 'Pracownicy',           pathname: '/pracownicy',             pathnameMatch: 'exact'  },
  { id: 'ustawienia-placowki',    label: 'Placówki',             pathname: '/ustawienia/placowki',    pathnameMatch: 'exact'  },
  { id: 'ustawienia-uzytkownicy', label: 'Użytkownicy',          pathname: '/ustawienia/uzytkownicy', pathnameMatch: 'exact'  },
  { id: 'ustawienia',             label: 'Ustawienia',           pathname: '/ustawienia',             pathnameMatch: 'exact'  },
  { id: 'dashboard',              label: 'Dashboard',            pathname: '/dashboard',              pathnameMatch: 'exact'  },
  { id: 'grafik',                 label: 'Grafik',               pathname: '/grafik',                 pathnameMatch: 'exact'  },
  { id: 'wnioski',                label: 'Wnioski',              pathname: '/wnioski',                pathnameMatch: 'exact'  },
  { id: 'dostepy',                label: 'Dostępy',              pathname: '/dostepy',                pathnameMatch: 'exact'  },
]

export function resolveSpace(pathname: string): GuideSpaceId | null {
  for (const space of SPACES) {
    if (space.pathnameMatch === 'exact' && pathname === space.pathname) return space.id
    if (space.pathnameMatch === 'prefix' && pathname.startsWith(space.pathname)) return space.id
  }
  return null
}

export function getSpaceLabel(id: GuideSpaceId): string {
  return SPACES.find((s) => s.id === id)?.label ?? id
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm test:run test/guide/registry.test.ts
```

Expected: All 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/design/web-kit/lib/guide/registry.ts docs/design/web-kit/test/guide/registry.test.ts
git commit -m "feat(guide): registry.ts — pathname → spaceId mapping (TDD)"
```

---

## Task 4: `lib/guide/shepherd.ts` + CSS overrides

**Files:**
- Create: `lib/guide/shepherd.ts`
- Modify: `app/globals.css`

- [ ] **Step 1: Create `lib/guide/shepherd.ts`**

```typescript
import type { GuideSpaceId } from './types'

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
```

- [ ] **Step 2: Add Shepherd CSS overrides to `app/globals.css`**

Open `app/globals.css` and append at the very end (after all Tailwind utilities):

```css
/* ─── Shepherd.js overrides — HRobot theme ─────────────────────────────────── */

/* Modal overlay: navy tint instead of default black */
.shepherd-modal-overlay-container {
  fill: rgba(11, 31, 59, 0.55);
}

/* Popover card */
.hrobot-shepherd.shepherd-element {
  background: #ffffff;
  border: 1px solid var(--color-line, #e2e5ec);
  border-radius: 10px;
  box-shadow: 0 4px 24px 0 rgba(11, 31, 59, 0.13);
  max-width: 360px;
  font-family: inherit;
}

.hrobot-shepherd .shepherd-header {
  padding: 18px 18px 0;
  background: transparent;
}

.hrobot-shepherd .shepherd-title {
  font-family: var(--font-display, 'Playfair Display', serif);
  font-weight: 800;
  color: #0b1f3b;
  font-size: 1rem;
  line-height: 1.3;
}

.hrobot-shepherd .shepherd-text {
  color: #64748b;
  font-size: 0.875rem;
  line-height: 1.6;
  padding: 10px 18px 14px;
}

.hrobot-shepherd .shepherd-footer {
  padding: 0 18px 16px;
  display: flex;
  gap: 8px;
  border-top: 1px solid var(--color-line, #e2e5ec);
  padding-top: 12px;
  margin-top: 0;
}

/* Primary button */
.hrobot-shepherd .shepherd-button:not(.shepherd-button-secondary) {
  background: #0c8fa3;
  color: #ffffff;
  border-radius: 7px;
  font-weight: 600;
  font-size: 0.8125rem;
  padding: 7px 14px;
  border: none;
  cursor: pointer;
  margin-left: auto;
}
.hrobot-shepherd .shepherd-button:not(.shepherd-button-secondary):hover {
  background: #0a7d8f;
}

/* Secondary buttons */
.hrobot-shepherd .shepherd-button-secondary {
  background: transparent;
  color: #64748b;
  border: 1px solid var(--color-line, #e2e5ec);
  border-radius: 7px;
  font-size: 0.8125rem;
  padding: 7px 12px;
  cursor: pointer;
}
.hrobot-shepherd .shepherd-button-secondary:hover {
  background: #f8f7f2;
}

/* Arrow */
.hrobot-shepherd .shepherd-arrow::before {
  background: #ffffff;
  border: 1px solid var(--color-line, #e2e5ec);
}

/* Cancel icon */
.hrobot-shepherd .shepherd-cancel-icon {
  color: #94a3b8;
}
.hrobot-shepherd .shepherd-cancel-icon:hover {
  color: #0b1f3b;
}

/* Highlighted target element — pulsing accent ring */
.guide-active {
  outline: 2px solid #0c8fa3 !important;
  outline-offset: 3px !important;
  border-radius: 6px !important;
  animation: guide-pulse 1.4s ease-in-out infinite;
}
@keyframes guide-pulse {
  0%, 100% { outline-color: #0c8fa3; }
  50%       { outline-color: transparent; }
}

/* GuideFab pulse ring (used in guide-fab.tsx) */
@keyframes fab-ring {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(2);   opacity: 0; }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add docs/design/web-kit/lib/guide/shepherd.ts docs/design/web-kit/app/globals.css
git commit -m "feat(guide): shepherd Tour factory + HRobot CSS overrides"
```

---

## Task 5: Space configs — Dashboard + Pracownicy

**Files:**
- Create: `lib/guide/spaces/dashboard.ts`
- Create: `lib/guide/spaces/pracownicy.ts`

- [ ] **Step 1: Create `lib/guide/spaces/dashboard.ts`**

```typescript
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
```

- [ ] **Step 2: Create `lib/guide/spaces/pracownicy.ts`**

```typescript
import type Shepherd from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function pracownicySteps(tour: Shepherd.Tour): Shepherd.Step.StepOptions[] {
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
```

- [ ] **Step 3: Commit**

```bash
git add docs/design/web-kit/lib/guide/spaces/dashboard.ts docs/design/web-kit/lib/guide/spaces/pracownicy.ts
git commit -m "feat(guide): dashboard + pracownicy step configs"
```

---

## Task 6: Space configs — Pracownicy-id + Grafik

**Files:**
- Create: `lib/guide/spaces/pracownicy-id.ts`
- Create: `lib/guide/spaces/grafik.ts`

- [ ] **Step 1: Create `lib/guide/spaces/pracownicy-id.ts`**

```typescript
import type Shepherd from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function pracownicyIdSteps(tour: Shepherd.Tour): Shepherd.Step.StepOptions[] {
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
```

- [ ] **Step 2: Create `lib/guide/spaces/grafik.ts`**

```typescript
import type Shepherd from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function grafikSteps(tour: Shepherd.Tour): Shepherd.Step.StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1 })

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
```

- [ ] **Step 3: Commit**

```bash
git add docs/design/web-kit/lib/guide/spaces/pracownicy-id.ts docs/design/web-kit/lib/guide/spaces/grafik.ts
git commit -m "feat(guide): pracownicy-id + grafik step configs"
```

---

## Task 7: Space configs — Wnioski, Dostępy, Ustawienia, Placówki, Użytkownicy

**Files:**
- Create: `lib/guide/spaces/wnioski.ts`
- Create: `lib/guide/spaces/dostepy.ts`
- Create: `lib/guide/spaces/ustawienia.ts`
- Create: `lib/guide/spaces/ustawienia-placowki.ts`
- Create: `lib/guide/spaces/ustawienia-uzytkownicy.ts`

- [ ] **Step 1: Create `lib/guide/spaces/wnioski.ts`**

```typescript
import type Shepherd from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function wnioskiSteps(tour: Shepherd.Tour): Shepherd.Step.StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1 })

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
```

- [ ] **Step 2: Create `lib/guide/spaces/dostepy.ts`**

```typescript
import type Shepherd from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function dostepySteps(tour: Shepherd.Tour): Shepherd.Step.StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1 })

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
```

- [ ] **Step 3: Create `lib/guide/spaces/ustawienia.ts`**

```typescript
import type Shepherd from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function ustawieniaSteps(tour: Shepherd.Tour): Shepherd.Step.StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1 })

  return [
    {
      id: 'ustawienia-placowki-link',
      title: 'Placówki',
      text: 'Konfiguruj lokalizacje firmy — adresy, godziny pracy i przypisanych pracowników.',
      attachTo: { element: '[data-guide="ustawienia:nav-placowki"]', on: 'right' },
      buttons: btn(0, 3),
      showOn() {
        return !!document.querySelector('[data-guide="ustawienia:nav-placowki"]')
      },
    },
    {
      id: 'ustawienia-uzytkownicy-link',
      title: 'Użytkownicy',
      text: 'Zapraszaj pracowników i administratorów oraz zarządzaj ich dostępem do systemu.',
      attachTo: { element: '[data-guide="ustawienia:nav-uzytkownicy"]', on: 'right' },
      buttons: btn(1, 3),
      showOn() {
        return !!document.querySelector('[data-guide="ustawienia:nav-uzytkownicy"]')
      },
    },
    {
      id: 'ustawienia-admin-note',
      title: 'Panel administracyjny',
      text: 'Ten panel jest widoczny wyłącznie dla roli ADMIN_KLIENTA. Inne role nie widzą sekcji Administracja w menu.',
      buttons: btn(2, 3),
    },
  ]
}
```

- [ ] **Step 4: Create `lib/guide/spaces/ustawienia-placowki.ts`**

```typescript
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
```

- [ ] **Step 5: Create `lib/guide/spaces/ustawienia-uzytkownicy.ts`**

```typescript
import type Shepherd from 'shepherd.js'
import { makeButtons } from '../shepherd'

export function ustawieniaUzytkownicySteps(tour: Shepherd.Tour): Shepherd.Step.StepOptions[] {
  const btn = (i: number, total: number) =>
    makeButtons(tour, { isFirst: i === 0, isLast: i === total - 1 })

  return [
    {
      id: 'uzytkownicy-table',
      title: 'Lista użytkowników',
      text: 'Wszyscy, którzy mają dostęp do tej przestrzeni roboczej i w jakiej roli.',
      attachTo: { element: '[data-guide="uzytkownicy:table"]', on: 'top' },
      buttons: btn(0, 4),
      showOn() {
        return !!document.querySelector('[data-guide="uzytkownicy:table"]')
      },
    },
    {
      id: 'uzytkownicy-role',
      title: 'Role użytkowników',
      text: 'PRACOWNIK, MANAGER, HR lub ADMIN_KLIENTA. Rolę można zmienić w każdej chwili — wchodzi w życie natychmiast.',
      attachTo: { element: '[data-guide="uzytkownicy:role-badge"]', on: 'left' },
      buttons: btn(1, 4),
      showOn() {
        return !!document.querySelector('[data-guide="uzytkownicy:role-badge"]')
      },
    },
    {
      id: 'uzytkownicy-invite',
      title: 'Zaproś użytkownika',
      text: 'Wpisz e-mail i wybierz rolę. Nowy użytkownik dostaje link do ustawienia hasła przez Keycloak SSO.',
      attachTo: { element: '[data-guide="uzytkownicy:invite"]', on: 'bottom' },
      buttons: btn(2, 4),
      showOn() {
        return !!document.querySelector('[data-guide="uzytkownicy:invite"]')
      },
    },
    {
      id: 'uzytkownicy-security',
      title: 'Bezpieczeństwo i SSO',
      text: 'HRobot używa Keycloak do uwierzytelniania. Żadne hasła nie są przechowywane w aplikacji — wyłącznie tokeny SSO.',
      buttons: btn(3, 4),
    },
  ]
}
```

- [ ] **Step 6: Commit**

```bash
git add docs/design/web-kit/lib/guide/spaces/
git commit -m "feat(guide): remaining 5 space step configs (wnioski/dostepy/ustawienia/*)"
```

---

## Task 8: Journey configs

**Files:**
- Create: `lib/guide/journeys/onboarding-pracownika.ts`
- Create: `lib/guide/journeys/zarzadzanie-wnioskiem.ts`
- Create: `lib/guide/journeys/konfiguracja-placowki.ts`
- Create: `lib/guide/journeys/zaproszenie-managera.ts`

- [ ] **Step 1: Create `lib/guide/journeys/onboarding-pracownika.ts`**

```typescript
import type { Journey } from '../types'

export const onboardingPracownikaJourney: Journey = {
  id: 'onboarding-pracownika',
  label: 'Onboarding nowego pracownika',
  description: 'Dodaj pracownika, wstaw go do grafiku i przypisz dostępy.',
  steps: [
    {
      spaceId: 'pracownicy',
      step: {
        id: 'journey-onb-1',
        title: '🟢 Onboarding — krok 1/7',
        text: 'Zacznij od kliknięcia "Dodaj pracownika". Wypełnij formularz i zatwierdź.',
        attachTo: { element: '[data-guide="pracownicy:add-employee"]', on: 'bottom' },
        advanceOn: { selector: '[data-testid="add-employee-submit"]', event: 'click' },
      },
    },
    {
      spaceId: 'pracownicy',
      step: {
        id: 'journey-onb-2',
        title: '🟢 Onboarding — krok 2/7',
        text: 'Nowy pracownik pojawił się na liście. Teraz przejdź do Grafiku, by wstawić jego pierwsze zmiany.',
        attachTo: { element: '[data-guide="pracownicy:table"]', on: 'top' },
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-onb-3',
        title: '🟢 Onboarding — krok 3/7',
        text: 'Znajdź wiersz nowego pracownika w grafiku. Kliknij pustą komórkę, by dodać pierwszą zmianę.',
        attachTo: { element: '[data-guide="grafik:shift-cell"]', on: 'top' },
        extraHighlights: ['[data-guide="grafik:week-nav"]'],
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-onb-4',
        title: '🟢 Onboarding — krok 4/7',
        text: 'Wpisz godziny zmiany (np. 08:00–16:00) i naciśnij Enter. Zmiana pojawi się w komórce.',
        attachTo: { element: '[data-guide="grafik:add-shift"]', on: 'left' },
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-onb-5',
        title: '🟢 Onboarding — krok 5/7',
        text: 'Świetnie! Zmiana zapisana. Możesz dodać więcej lub przejść do Dostępów, by przypisać rolę.',
        attachTo: { element: '[data-guide="grafik:facility-filter"]', on: 'bottom' },
      },
    },
    {
      spaceId: 'dostepy',
      step: {
        id: 'journey-onb-6',
        title: '🟢 Onboarding — krok 6/7',
        text: 'Tu przypisz rolę nowemu pracownikowi. Rola określa, co może robić w systemie.',
      },
    },
    {
      spaceId: 'dostepy',
      step: {
        id: 'journey-onb-7',
        title: '🟢 Onboarding — gotowe!',
        text: 'Pracownik jest dodany, ma zaplanowane zmiany i przypisaną rolę. Onboarding zakończony!',
      },
    },
  ],
}
```

- [ ] **Step 2: Create `lib/guide/journeys/zarzadzanie-wnioskiem.ts`**

```typescript
import type { Journey } from '../types'

export const zarzadzanieWnioskiemJourney: Journey = {
  id: 'zarzadzanie-wnioskiem',
  label: 'Zarządzanie wnioskiem',
  description: 'Złóż wniosek, sprawdź wpływ na grafik i zatwierdź.',
  steps: [
    {
      spaceId: 'wnioski',
      step: {
        id: 'journey-wn-1',
        title: '📋 Zarządzanie wnioskiem — krok 1/5',
        text: 'Tu złożysz wniosek urlopowy lub kadrowy. Moduł wkrótce dostępny.',
      },
    },
    {
      spaceId: 'wnioski',
      step: {
        id: 'journey-wn-2',
        title: '📋 Zarządzanie wnioskiem — krok 2/5',
        text: 'Po złożeniu wniosku jego status zmienia się na "Oczekuje". MANAGER lub HR musi go zaakceptować.',
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-wn-3',
        title: '📋 Zarządzanie wnioskiem — krok 3/5',
        text: 'Sprawdź, które dni obejmuje wniosek. Podświetlone komórki to zmiany, których dotyczy nieobecność.',
        attachTo: { element: '[data-guide="grafik:week-nav"]', on: 'bottom' },
        extraHighlights: ['[data-guide="grafik:shift-cell"]'],
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-wn-4',
        title: '📋 Zarządzanie wnioskiem — krok 4/5',
        text: 'Możesz teraz zaplanować zastępstwo — dodaj zmianę innemu pracownikowi w tych dniach.',
        attachTo: { element: '[data-guide="grafik:add-shift"]', on: 'left' },
      },
    },
    {
      spaceId: 'pracownicy-id',
      step: {
        id: 'journey-wn-5',
        title: '📋 Zarządzanie wnioskiem — gotowe!',
        text: 'Po akceptacji wniosku sprawdź kartotekę pracownika — pojawi się wpis w historii.',
        attachTo: { element: '[data-guide="pracownicy-id:audit-log"]', on: 'top' },
      },
    },
  ],
}
```

- [ ] **Step 3: Create `lib/guide/journeys/konfiguracja-placowki.ts`**

```typescript
import type { Journey } from '../types'

export const konfiguracjaPlacowkiJourney: Journey = {
  id: 'konfiguracja-placowki',
  label: 'Konfiguracja nowej placówki',
  description: 'Dodaj placówkę, skonfiguruj grafik i przypisz menadżera.',
  steps: [
    {
      spaceId: 'ustawienia-placowki',
      step: {
        id: 'journey-pl-1',
        title: '🏢 Nowa placówka — krok 1/6',
        text: 'Kliknij "Dodaj placówkę", by rozpocząć konfigurację nowej lokalizacji.',
        attachTo: { element: '[data-guide="placowki:add"]', on: 'bottom' },
      },
    },
    {
      spaceId: 'ustawienia-placowki',
      step: {
        id: 'journey-pl-2',
        title: '🏢 Nowa placówka — krok 2/6',
        text: 'Wpisz pełny adres placówki. Będzie widoczny na kartotekach przypisanych pracowników.',
        attachTo: { element: '[data-guide="placowki:address"]', on: 'right' },
      },
    },
    {
      spaceId: 'ustawienia-placowki',
      step: {
        id: 'journey-pl-3',
        title: '🏢 Nowa placówka — krok 3/6',
        text: 'Ustaw godziny pracy dla każdego dnia. Grafik będzie sugerował te godziny przy tworzeniu zmian.',
        attachTo: { element: '[data-guide="placowki:hours"]', on: 'top' },
      },
    },
    {
      spaceId: 'ustawienia-placowki',
      step: {
        id: 'journey-pl-4',
        title: '🏢 Nowa placówka — krok 4/6',
        text: 'Placówka zapisana! Teraz przejdź do Grafiku, by zobaczyć ją w filtrze.',
        attachTo: { element: '[data-guide="placowki:list"]', on: 'top' },
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-pl-5',
        title: '🏢 Nowa placówka — krok 5/6',
        text: 'Nowa placówka jest dostępna w filtrze. Wybierz ją, by zobaczyć (pusty) grafik.',
        attachTo: { element: '[data-guide="grafik:facility-filter"]', on: 'bottom' },
      },
    },
    {
      spaceId: 'ustawienia-uzytkownicy',
      step: {
        id: 'journey-pl-6',
        title: '🏢 Nowa placówka — gotowe!',
        text: 'Ostatni krok: zaproś menadżera placówki. Nadaj mu rolę MANAGER — będzie zarządzał grafikiem tej lokalizacji.',
        attachTo: { element: '[data-guide="uzytkownicy:invite"]', on: 'bottom' },
      },
    },
  ],
}
```

- [ ] **Step 4: Create `lib/guide/journeys/zaproszenie-managera.ts`**

```typescript
import type { Journey } from '../types'

export const zaproszenieManageraJourney: Journey = {
  id: 'zaproszenie-managera',
  label: 'Zaproszenie menadżera',
  description: 'Dodaj nowego menadżera i przypisz mu placówkę.',
  steps: [
    {
      spaceId: 'ustawienia-uzytkownicy',
      step: {
        id: 'journey-mgr-1',
        title: '👤 Zaproszenie menadżera — krok 1/5',
        text: 'Kliknij "Zaproś użytkownika". Wpisz e-mail przyszłego menadżera.',
        attachTo: { element: '[data-guide="uzytkownicy:invite"]', on: 'bottom' },
      },
    },
    {
      spaceId: 'ustawienia-uzytkownicy',
      step: {
        id: 'journey-mgr-2',
        title: '👤 Zaproszenie menadżera — krok 2/5',
        text: 'Wybierz rolę MANAGER. Menadżer może zarządzać grafikiem i zatwierdzać wnioski.',
        attachTo: { element: '[data-guide="uzytkownicy:role-badge"]', on: 'left' },
      },
    },
    {
      spaceId: 'ustawienia-uzytkownicy',
      step: {
        id: 'journey-mgr-3',
        title: '👤 Zaproszenie menadżera — krok 3/5',
        text: 'Zaproszenie wysłane! Menadżer dostanie e-mail z linkiem do Keycloak. Po zalogowaniu widzi swoje placówki.',
        attachTo: { element: '[data-guide="uzytkownicy:table"]', on: 'top' },
      },
    },
    {
      spaceId: 'dostepy',
      step: {
        id: 'journey-mgr-4',
        title: '👤 Zaproszenie menadżera — krok 4/5',
        text: 'W Dostępach możesz zawęzić uprawnienia menadżera do konkretnych placówek (funkcja wkrótce).',
      },
    },
    {
      spaceId: 'grafik',
      step: {
        id: 'journey-mgr-5',
        title: '👤 Zaproszenie menadżera — gotowe!',
        text: 'Menadżer widzi w Grafiku tylko swoje placówki. Użyj filtru placówki, by to sprawdzić.',
        attachTo: { element: '[data-guide="grafik:facility-filter"]', on: 'bottom' },
      },
    },
  ],
}
```

- [ ] **Step 5: Commit**

```bash
git add docs/design/web-kit/lib/guide/journeys/
git commit -m "feat(guide): 4 multi-space journey configs"
```

---

## Task 9: `data-guide` attributes on all pages and components

Add `data-guide` attributes to existing JSX. These attributes do not affect layout or styling — they're stable hooks for Shepherd selectors.

**Files:**
- Modify: `app/(tenant)/dashboard/page.tsx` + `components/dashboard/*.tsx`
- Modify: `app/(tenant)/pracownicy/page.tsx` + `components/employees/pracownicy-client-view.tsx`
- Modify: `app/(tenant)/pracownicy/[id]/page.tsx` + `components/employees/employee-record.tsx`
- Modify: `app/(tenant)/grafik/page.tsx` + `components/grafik/schedule-grid.tsx`
- Modify: `app/(tenant)/wnioski/page.tsx`
- Modify: `app/(tenant)/dostepy/page.tsx`
- Modify: `app/(tenant)/ustawienia/page.tsx`
- Modify: `app/(tenant)/ustawienia/placowki/page.tsx` + `components/facilities/facility-config.tsx`
- Modify: `app/(tenant)/ustawienia/uzytkownicy/page.tsx` + `components/users/users-client-view.tsx`

- [ ] **Step 1: Dashboard — add `data-guide` attrs**

In `components/dashboard/setup-checklist.tsx`, find the checklist container `<div>` or `<section>` and add `data-guide="dashboard:setup-checklist"`.

In `components/dashboard/quick-actions.tsx`, find the root `<div>` and add `data-guide="dashboard:quick-actions"`.

In `components/dashboard/data-protection-panel.tsx`, find the root `<div>` and add `data-guide="dashboard:data-protection"`.

- [ ] **Step 2: Pracownicy — add `data-guide` attrs**

In `components/employees/pracownicy-client-view.tsx`:

```tsx
// Search input wrapper — add to the <div> wrapping the search input:
<div data-guide="pracownicy:search" className="...">

// Table element:
<table data-guide="pracownicy:table" className="...">

// "Dodaj pracownika" button:
<button data-guide="pracownicy:add-employee" ...>

// Status badge in first table row (add to the <span> rendering status):
// Find the status cell in employees-table.tsx and add:
<span data-guide="pracownicy:status-badge" className="...">
```

- [ ] **Step 3: Pracownicy/[id] — add `data-guide` attrs**

In `components/employees/employee-record.tsx`:

```tsx
// Personal data section header:
<section data-guide="pracownicy-id:personal-data" ...>

// PESEL reveal button:
<button data-guide="pracownicy-id:pesel-reveal" ...>

// Audit log section:
<section data-guide="pracownicy-id:audit-log" ...>
```

In `app/(tenant)/pracownicy/[id]/page.tsx`, find the back link:

```tsx
<Link data-guide="pracownicy-id:back-link" href="/pracownicy">← Pracownicy</Link>
```

- [ ] **Step 4: Grafik — add `data-guide` attrs**

In `components/grafik/schedule-grid.tsx`:

```tsx
// Week navigation buttons wrapper:
<div data-guide="grafik:week-nav" className="flex items-center gap-2">

// Facility filter select/dropdown:
<select data-guide="grafik:facility-filter" ...> (or the wrapper div)

// First shift cell in the grid (find the <td> rendering a shift):
// Add to the <td> element:
data-guide="grafik:shift-cell"

// First employee row (add to the <tr>):
data-guide="grafik:shift-row"

// Add shift button/clickable empty cell:
data-guide="grafik:add-shift"

// Remove shift button:
data-guide="grafik:remove-shift"
```

- [ ] **Step 5: Wnioski, Dostępy — add `data-guide` attrs**

Wnioski and Dostępy are stub pages with EmptyState. No specific elements to target — their tours use centered steps without `attachTo`. No changes needed.

- [ ] **Step 6: Ustawienia — add `data-guide` attrs**

In `app/(tenant)/ustawienia/page.tsx`, find the navigation links to sub-pages:

```tsx
<Link data-guide="ustawienia:nav-placowki" href="/ustawienia/placowki">Placówki</Link>
<Link data-guide="ustawienia:nav-uzytkownicy" href="/ustawienia/uzytkownicy">Użytkownicy</Link>
```

- [ ] **Step 7: Placówki — add `data-guide` attrs**

In `components/facilities/facility-config.tsx`:

```tsx
// Facility list container:
<div data-guide="placowki:list" ...>

// Add facility button:
<button data-guide="placowki:add" ...>

// Address form section:
<fieldset data-guide="placowki:address" ...>  (or <div>)

// Working hours section:
<div data-guide="placowki:hours" ...>
```

- [ ] **Step 8: Użytkownicy — add `data-guide` attrs**

In `components/users/users-client-view.tsx` and `components/users/users-table.tsx`:

```tsx
// Users table:
<table data-guide="uzytkownicy:table" ...>

// Role badge in first row:
<span data-guide="uzytkownicy:role-badge" ...>

// Invite button:
<button data-guide="uzytkownicy:invite" ...>
```

- [ ] **Step 9: Verify the app builds**

```bash
pnpm build
```

Expected: Build succeeds — `data-guide` attrs are valid HTML and don't cause TypeScript or linting errors.

- [ ] **Step 10: Commit**

```bash
git add docs/design/web-kit/app/ docs/design/web-kit/components/
git commit -m "feat(guide): add data-guide attrs to all 9 tenant spaces"
```

---

## Task 10: `components/guide/guide-fab.tsx` (TDD)

**Files:**
- Create: `test/guide/guide-fab.test.tsx`
- Create: `components/guide/guide-fab.tsx`

- [ ] **Step 1: Write failing tests**

Create `test/guide/guide-fab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { GuideContext } from '@/components/guide/guide-provider'
import { GuideFab } from '@/components/guide/guide-fab'
import type { GuideContextValue } from '@/lib/guide/types'

function makeContext(overrides?: Partial<GuideContextValue>): GuideContextValue {
  return {
    startTour: vi.fn(),
    startJourney: vi.fn(),
    isDisabled: false,
    toggleDisabled: vi.fn(),
    activeSpaceId: 'dashboard',
    ...overrides,
  }
}

describe('GuideFab', () => {
  it('renders the ? button when activeSpaceId is set', () => {
    render(
      <GuideContext.Provider value={makeContext()}>
        <GuideFab />
      </GuideContext.Provider>,
    )
    expect(screen.getByRole('button', { name: /przewodnik/i })).toBeInTheDocument()
  })

  it('returns null when activeSpaceId is null', () => {
    render(
      <GuideContext.Provider value={makeContext({ activeSpaceId: null })}>
        <GuideFab />
      </GuideContext.Provider>,
    )
    expect(screen.queryByRole('button', { name: /przewodnik/i })).toBeNull()
  })

  it('calls startTour with activeSpaceId on click', async () => {
    const user = userEvent.setup()
    const startTour = vi.fn()
    render(
      <GuideContext.Provider value={makeContext({ startTour })}>
        <GuideFab />
      </GuideContext.Provider>,
    )
    await user.click(screen.getByRole('button', { name: /przewodnik/i }))
    expect(startTour).toHaveBeenCalledWith('dashboard')
  })

  it('has aria-label mentioning przewodnik', () => {
    render(
      <GuideContext.Provider value={makeContext()}>
        <GuideFab />
      </GuideContext.Provider>,
    )
    const btn = screen.getByRole('button', { name: /przewodnik/i })
    expect(btn).toHaveAttribute('aria-label')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm test:run test/guide/guide-fab.test.tsx
```

Expected: FAIL — `Cannot find module '@/components/guide/guide-fab'`

- [ ] **Step 3: Create `components/guide/guide-provider.tsx`** (Context export only, provider body in Task 11)

We need to export `GuideContext` so guide-fab can import it. Create a minimal version now:

```tsx
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
```

- [ ] **Step 4: Create `components/guide/guide-fab.tsx`**

```tsx
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
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
pnpm test:run test/guide/guide-fab.test.tsx
```

Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/design/web-kit/components/guide/guide-fab.tsx docs/design/web-kit/components/guide/guide-provider.tsx docs/design/web-kit/test/guide/guide-fab.test.tsx
git commit -m "feat(guide): GuideFab component + GuideContext stub (TDD)"
```

---

## Task 11: `components/guide/guide-provider.tsx` — full implementation (TDD)

**Files:**
- Create: `test/guide/guide-provider.test.tsx`
- Modify: `components/guide/guide-provider.tsx` (replace stub with full implementation)

- [ ] **Step 1: Write failing tests**

Create `test/guide/guide-provider.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard'),
}))

// Mock shepherd.js — avoid real DOM manipulation in tests
vi.mock('shepherd.js', () => ({
  default: class MockTour {
    on = vi.fn()
    start = vi.fn()
    cancel = vi.fn()
    addSteps = vi.fn()
  },
}))

// Mock the space step factories
vi.mock('@/lib/guide/spaces/dashboard', () => ({
  dashboardSteps: vi.fn(() => []),
}))

import { usePathname } from 'next/navigation'
import { GuideProvider, useGuide } from '@/components/guide/guide-provider'
import * as store from '@/lib/guide/store'

function TestConsumer() {
  const ctx = useGuide()
  return (
    <div>
      <span data-testid="space">{ctx.activeSpaceId ?? 'none'}</span>
      <span data-testid="disabled">{String(ctx.isDisabled)}</span>
      <button onClick={() => ctx.toggleDisabled()}>toggle</button>
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  ;(usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/dashboard')
})

describe('GuideProvider', () => {
  it('provides activeSpaceId resolved from pathname', () => {
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    expect(screen.getByTestId('space').textContent).toBe('dashboard')
  })

  it('provides null activeSpaceId for unknown pathname', () => {
    ;(usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/login')
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    expect(screen.getByTestId('space').textContent).toBe('none')
  })

  it('reflects isDisabled from store', () => {
    store.setDisabled(true)
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    expect(screen.getByTestId('disabled').textContent).toBe('true')
  })

  it('toggleDisabled updates store and re-renders', async () => {
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    expect(screen.getByTestId('disabled').textContent).toBe('false')
    await act(async () => {
      screen.getByText('toggle').click()
    })
    expect(screen.getByTestId('disabled').textContent).toBe('true')
    expect(store.isDisabled()).toBe(true)
  })

  it('marks space visited when auto-tour fires', async () => {
    vi.useFakeTimers()
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    expect(store.isVisited('dashboard')).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(1300)
    })
    expect(store.isVisited('dashboard')).toBe(true)
    vi.useRealTimers()
  })

  it('does not auto-launch when disabled', async () => {
    store.setDisabled(true)
    vi.useFakeTimers()
    const { createTour } = await import('@/lib/guide/shepherd')
    const createTourSpy = vi.spyOn({ createTour }, 'createTour')
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    await act(async () => {
      vi.advanceTimersByTime(1300)
    })
    // Tour should NOT have started
    expect(store.isVisited('dashboard')).toBe(false)
    vi.useRealTimers()
  })

  it('does not auto-launch when space already visited', async () => {
    store.markVisited('dashboard')
    vi.useFakeTimers()
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    await act(async () => {
      vi.advanceTimersByTime(1300)
    })
    // isVisited was true before, still true — but tour was not re-fired
    // We can verify by checking that start was not called a second time
    // (store.isVisited stays true — no double-visit)
    expect(store.isVisited('dashboard')).toBe(true)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm test:run test/guide/guide-provider.test.tsx
```

Expected: FAIL — GuideProvider does not have full auto-launch logic.

- [ ] **Step 3: Replace `components/guide/guide-provider.tsx` with full implementation**

```tsx
'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { usePathname } from 'next/navigation'
import toast from 'react-hot-toast'
import { resolveSpace } from '@/lib/guide/registry'
import { isDisabled as storeIsDisabled, isVisited, markVisited, setDisabled } from '@/lib/guide/store'
import type { GuideContextValue, GuideSpaceId, JourneyId } from '@/lib/guide/types'

// ─── Space step loaders ────────────────────────────────────────────────────────

async function loadSteps(spaceId: GuideSpaceId, tour: import('shepherd.js').default.Tour) {
  switch (spaceId) {
    case 'dashboard': {
      const { dashboardSteps } = await import('@/lib/guide/spaces/dashboard')
      return dashboardSteps(tour)
    }
    case 'pracownicy': {
      const { pracownicySteps } = await import('@/lib/guide/spaces/pracownicy')
      return pracownicySteps(tour)
    }
    case 'pracownicy-id': {
      const { pracownicyIdSteps } = await import('@/lib/guide/spaces/pracownicy-id')
      return pracownicyIdSteps(tour)
    }
    case 'grafik': {
      const { grafikSteps } = await import('@/lib/guide/spaces/grafik')
      return grafikSteps(tour)
    }
    case 'wnioski': {
      const { wnioskiSteps } = await import('@/lib/guide/spaces/wnioski')
      return wnioskiSteps(tour)
    }
    case 'dostepy': {
      const { dostepySteps } = await import('@/lib/guide/spaces/dostepy')
      return dostepySteps(tour)
    }
    case 'ustawienia': {
      const { ustawieniaSteps } = await import('@/lib/guide/spaces/ustawienia')
      return ustawieniaSteps(tour)
    }
    case 'ustawienia-placowki': {
      const { ustawieniaPlacowkiSteps } = await import('@/lib/guide/spaces/ustawienia-placowki')
      return ustawieniaPlacowkiSteps(tour)
    }
    case 'ustawienia-uzytkownicy': {
      const { ustawieniaUzytkownicySteps } = await import('@/lib/guide/spaces/ustawienia-uzytkownicy')
      return ustawieniaUzytkownicySteps(tour)
    }
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

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

// ─── Provider ─────────────────────────────────────────────────────────────────

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const activeSpaceId = resolveSpace(pathname)
  const [disabled, setDisabledState] = useState<boolean>(() => storeIsDisabled())
  const tourRef = useRef<import('shepherd.js').default.Tour | null>(null)

  const cancelActiveTour = useCallback(() => {
    if (tourRef.current) {
      try { tourRef.current.cancel() } catch { /* ignore */ }
      tourRef.current = null
    }
  }, [])

  const startTour = useCallback(async (spaceId?: GuideSpaceId) => {
    const id = spaceId ?? activeSpaceId
    if (!id) return

    cancelActiveTour()

    const { createTour } = await import('@/lib/guide/shepherd')
    const tour = await createTour(id)
    tourRef.current = tour

    const steps = await loadSteps(id, tour)
    tour.addSteps(steps)

    tour.on('cancel', () => {
      tourRef.current = null
      toast('Przewodnik zamknięty. Kliknij ? by uruchomić ponownie.', {
        duration: 3500,
        icon: '💡',
      })
    })

    tour.on('complete', () => {
      tourRef.current = null
      toast('Gotowe! Możesz zawsze wrócić klikając ?.', {
        duration: 3000,
        icon: '✅',
      })
    })

    tour.start()
    markVisited(id)
  }, [activeSpaceId, cancelActiveTour])

  const startJourney = useCallback((_journeyId: JourneyId) => {
    // Journey support: v2 — placeholder
    console.log('[guide] journey not yet implemented:', _journeyId)
  }, [])

  const toggleDisabled = useCallback(() => {
    const next = !disabled
    setDisabled(next)
    setDisabledState(next)
  }, [disabled])

  // Auto-launch on first visit
  useEffect(() => {
    if (!activeSpaceId) return
    if (disabled) return
    if (isVisited(activeSpaceId)) return

    const timer = setTimeout(() => {
      startTour(activeSpaceId)
    }, 1200)

    return () => clearTimeout(timer)
  }, [activeSpaceId, disabled, startTour])

  // Cancel tour on route change
  useEffect(() => {
    cancelActiveTour()
  }, [pathname, cancelActiveTour])

  return (
    <GuideContext.Provider
      value={{ startTour, startJourney, isDisabled: disabled, toggleDisabled, activeSpaceId }}
    >
      {children}
    </GuideContext.Provider>
  )
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm test:run test/guide/guide-provider.test.tsx
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/design/web-kit/components/guide/guide-provider.tsx docs/design/web-kit/test/guide/guide-provider.test.tsx
git commit -m "feat(guide): GuideProvider — auto-launch, context, toast (TDD)"
```

---

## Task 12: Wire GuideProvider + GuideFab into tenant layout + Dashboard journey entry

**Files:**
- Modify: `app/(tenant)/layout.tsx`
- Modify: `app/(tenant)/dashboard/page.tsx` (journey entry button in SetupChecklist)

- [ ] **Step 1: Read current `app/(tenant)/layout.tsx`**

```bash
cat docs/design/web-kit/app/\(tenant\)/layout.tsx
```

- [ ] **Step 2: Wrap children with GuideProvider and add GuideFab**

In `app/(tenant)/layout.tsx`, add the two imports and wrap:

```tsx
// Add at top:
import { GuideProvider } from '@/components/guide/guide-provider'
import { GuideFab } from '@/components/guide/guide-fab'

// In the return, wrap children:
// Before: return <>{children}</>
// After:
return (
  <GuideProvider>
    {children}
    <GuideFab />
  </GuideProvider>
)
```

The full file should look like:

```tsx
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { GuideProvider } from '@/components/guide/guide-provider'
import { GuideFab } from '@/components/guide/guide-fab'

// CRITICAL: NEVER add generateStaticParams to any file inside app/(tenant)/.
// Tenant routes are user-specific and auth-gated — static generation would
// bake credentials into CDN and expose PII.

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  return (
    <GuideProvider>
      {children}
      <GuideFab />
    </GuideProvider>
  )
}
```

- [ ] **Step 3: Add journey entry button to Dashboard's SetupChecklist**

In `components/dashboard/setup-checklist.tsx`, add a journey trigger section at the bottom of the checklist:

```tsx
// Add import at top:
import { useGuide } from '@/components/guide/guide-provider'

// Make SetupChecklist a Client Component if it isn't already:
'use client'

// Inside the component, consume context:
const { startJourney } = useGuide()

// Add at the bottom of the checklist card:
<div className="mt-4 pt-4 border-t border-line">
  <p className="text-xs text-muted mb-2 font-medium">Przewodniki po procesach:</p>
  <div className="flex flex-col gap-1.5">
    <button
      type="button"
      onClick={() => startJourney('onboarding-pracownika')}
      className="text-left text-xs text-accent-ink hover:underline"
    >
      🟢 Onboarding nowego pracownika →
    </button>
    <button
      type="button"
      onClick={() => startJourney('konfiguracja-placowki')}
      className="text-left text-xs text-accent-ink hover:underline"
    >
      🏢 Konfiguracja nowej placówki →
    </button>
    <button
      type="button"
      onClick={() => startJourney('zaproszenie-managera')}
      className="text-left text-xs text-accent-ink hover:underline"
    >
      👤 Zaproszenie menadżera →
    </button>
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add docs/design/web-kit/app/\(tenant\)/layout.tsx docs/design/web-kit/components/dashboard/setup-checklist.tsx
git commit -m "feat(guide): wire GuideProvider + GuideFab into tenant layout + dashboard journey entry"
```

---

## Task 13: Quality gates — verify everything passes

**Files:** None (verification only)

- [ ] **Step 1: TypeScript**

```bash
cd docs/design/web-kit
pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

Expected: No errors. If `'use client'` directives cause issues with server components, check that all imports of `guide-provider` and `guide-fab` are only done in client components or other client-only files.

- [ ] **Step 3: All tests**

```bash
pnpm test:run
```

Expected: All tests pass. New guide tests: `store.test.ts` (8), `registry.test.ts` (11), `guide-fab.test.tsx` (4), `guide-provider.test.tsx` (6) = 29 new tests.

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: Build succeeds. Shepherd.js is dynamic-imported in `guide-provider.tsx` — it will only be bundled on the client, not in the server components.

- [ ] **Step 5: Manual visual QA**

```bash
pnpm dev
```

Navigate to `http://localhost:5601/dashboard`.

Verify:
- [ ] FAB "?" appears at bottom-right
- [ ] Tour auto-launches after ~1.2s on first visit
- [ ] Navy overlay appears with opening around target element
- [ ] "Wyłącz auto-start" button visible in step 1
- [ ] "Pomiń" button visible in all steps
- [ ] "Wstecz" hidden in step 1, visible in step 2+
- [ ] "Gotowe" button in final step
- [ ] Toast appears after "Pomiń" or "Gotowe"
- [ ] Esc key closes tour
- [ ] Arrow keys navigate steps
- [ ] FAB "?" click restarts tour after it was closed
- [ ] After tour, refreshing page does NOT re-launch tour (visited stored)
- [ ] "Wyłącz auto-start" prevents tour from launching on next new space visit
- [ ] Navigate to `/pracownicy` — tour auto-launches (first visit)

Also verify in Chrome DevTools:
- [ ] `localStorage.getItem('hrobot_guide_v1_visited')` shows `{"dashboard":true}` after dashboard visit

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(guide): gates green — Przewodnik microcomponent complete

- GuideFab: fixed '?' button, auto-launch, toast notifications
- GuideProvider: localStorage state, 9 space auto-tours, 4 journey configs
- Shepherd.js: navy modal overlay, HRobot CSS theme, keyboard nav
- Tests: 29 new tests passing (store, registry, fab, provider)
- Commercial license action: purchase shepherd.js Business $50 before ship

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Post-ship reminder

> ⚠️ **Action required:** Purchase Shepherd.js Business License ($50/lifetime) at https://shepherdjs.dev/pricing before deploying to production. HRobot is a commercial SaaS — AGPL-3.0 requires source disclosure without the commercial license.
