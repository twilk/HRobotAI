# Przewodnik — Guide Microcomponent Design

**Date:** 2026-06-07  
**Status:** Approved  
**Scope:** web-kit (reference implementation); port to apps/web in follow-up

---

## Overview

A global "?" floating action button that launches a context-sensitive guided tour for the currently visited space. Each space has its own tour. First-time visitors see tours auto-launched. Users can skip and/or disable auto-launch at any time during a tour. Four multi-space "journey" guides cover end-to-end HR processes.

---

## Library: Shepherd.js

**Version:** latest (`shepherd.js`)  
**License:** AGPL-3.0 (open source) / Commercial (SaaS) — **$50 one-time Business Plan required before ship**  
**Why Shepherd:** rich feature set (modal overlay, keyboard nav, lazy element resolution, advanceOn, extraHighlights, conditional showOn, beforeShowPromise for async gates), actively maintained, React-compatible via vanilla JS + Context pattern.

### Shepherd features used in full

| Feature | Usage |
|---|---|
| `useModalOverlay: true` | Every tour — navy-tinted overlay with cutout around target |
| `modalOverlayOpeningRadius: 6` | Matches `rounded-lg` (6px) from HRobot design system |
| `modalOverlayOpeningPadding: 8` | Breathing room around highlighted element |
| `exitOnEsc: true` | Esc key closes tour |
| `keyboardNavigation: true` | ← → arrow key navigation between steps |
| `cancelIcon: {enabled, label, attrs}` | ✕ button with `aria-label="Zamknij przewodnik"` + `data-testid` |
| `scrollTo: {behavior:'smooth', block:'center'}` | Auto-scrolls to element when step shows |
| `advanceOn: {selector, event}` | Auto-advance after user interaction (e.g., modal open) |
| `extraHighlights: []` | Simultaneously highlight related elements without tooltip |
| `highlightClass: 'guide-active'` | Pulsing accent ring on active target element |
| `showOn()` | Conditional steps — skip if precondition not met (e.g., no employees) |
| `beforeShowPromise` | Journey resume gate — waits for page to stabilize |
| `when.show` | Analytics hook fired on each step show |
| `arrow: {padding: 8}` | Arrow with comfortable padding |
| `buttons[].attrs` | `data-testid` attributes for Vitest/RTL |
| `buttons[].secondary` | Adds `shepherd-button-secondary` class |
| `attachTo.element` as function | Lazy DOM resolution — evaluated at before-show phase |

---

## Architecture

### File layout

```
docs/design/web-kit/
  lib/guide/
    types.ts                       — GuideSpaceId, StepConfig, Journey, GuideStore types
    store.ts                       — localStorage read/write (visited, disabled, journeyState)
    registry.ts                    — pathname → GuideSpaceId mapping + space metadata
    shepherd.ts                    — shared Tour factory with defaultStepOptions + CSS vars
    spaces/
      dashboard.ts                 — 4 steps
      pracownicy.ts                — 5 steps
      pracownicy-id.ts             — 4 steps
      grafik.ts                    — 5 steps
      wnioski.ts                   — 2 steps (prospective)
      dostepy.ts                   — 2 steps (prospective)
      ustawienia.ts                — 3 steps
      ustawienia-placowki.ts       — 4 steps
      ustawienia-uzytkownicy.ts    — 4 steps
    journeys/
      onboarding-pracownika.ts     — 7 steps across Pracownicy → Grafik → Dostępy
      zarzadzanie-wnioskiem.ts     — 5 steps across Wnioski → Grafik → Pracownicy/[id]
      konfiguracja-placowki.ts     — 6 steps across Placówki → Grafik → Użytkownicy
      zaproszenie-managera.ts      — 5 steps across Użytkownicy → Dostępy → Grafik

  components/guide/
    guide-provider.tsx             — React Context + auto-launch logic (Client Component)
    guide-fab.tsx                  — Fixed "?" FAB button with pulse indicator (Client Component)

  app/globals.css                  — shepherd-overrides block (navy overlay, HRobot popover style)
```

---

## localStorage State

Three keys, all prefixed `hrobot_guide_v1_`:

```ts
// Which spaces the user has already visited (auto-launch won't re-fire)
hrobot_guide_v1_visited:  Record<GuideSpaceId, true>

// Global flag: if true, no tours auto-launch on first visit
hrobot_guide_v1_disabled: boolean

// Active cross-space journey progress (null when no journey active)
// step = global step index across all journey spaces combined
hrobot_guide_v1_journey:  { id: JourneyId; step: number; startedAt: string } | null
```

All reads are wrapped in try/catch (SSR-safe: localStorage is undefined on server).

---

## Types (`lib/guide/types.ts`)

```ts
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

export type JourneyId =
  | 'onboarding-pracownika'
  | 'zarzadzanie-wnioskiem'
  | 'konfiguracja-placowki'
  | 'zaproszenie-managera'

export interface GuideSpace {
  id: GuideSpaceId
  label: string           // Polish display name
  pathname: string        // exact or prefix match
  pathnameMatch: 'exact' | 'prefix'
}

export interface GuideContext {
  startTour: (spaceId?: GuideSpaceId) => void
  startJourney: (journeyId: JourneyId) => void
  isDisabled: boolean
  toggleDisabled: () => void
  activeSpaceId: GuideSpaceId | null
}
```

---

## Registry (`lib/guide/registry.ts`)

Maps `usePathname()` output to `GuideSpaceId`:

```ts
const SPACES: GuideSpace[] = [
  { id: 'dashboard',                pathname: '/dashboard',              pathnameMatch: 'exact'  },
  { id: 'pracownicy-id',            pathname: '/pracownicy/',             pathnameMatch: 'prefix' }, // before 'pracownicy'
  { id: 'pracownicy',               pathname: '/pracownicy',              pathnameMatch: 'exact'  },
  { id: 'grafik',                   pathname: '/grafik',                  pathnameMatch: 'exact'  },
  { id: 'wnioski',                  pathname: '/wnioski',                 pathnameMatch: 'exact'  },
  { id: 'dostepy',                  pathname: '/dostepy',                 pathnameMatch: 'exact'  },
  { id: 'ustawienia-placowki',      pathname: '/ustawienia/placowki',     pathnameMatch: 'exact'  },
  { id: 'ustawienia-uzytkownicy',   pathname: '/ustawienia/uzytkownicy',  pathnameMatch: 'exact'  },
  { id: 'ustawienia',               pathname: '/ustawienia',              pathnameMatch: 'exact'  },
]

export function resolveSpace(pathname: string): GuideSpaceId | null
```

---

## Tour Factory (`lib/guide/shepherd.ts`)

```ts
import Shepherd from 'shepherd.js'
import 'shepherd.js/dist/css/shepherd.css'

export function createTour(spaceId: GuideSpaceId): Shepherd.Tour {
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
```

---

## Step Button Layout

Every step gets 3 buttons. Layout (left → right):

```
[Wyłącz auto-start*]  [Wstecz]  [Dalej →]
```

- **Wyłącz auto-start** — only in step 1; `secondary: true`; sets `disabled=true` in store then `tour.cancel()`
- **Wstecz** — `secondary: true`; `this.back()`; hidden (via `showOn`) in step 1
- **Dalej** — primary; `this.next()`; last step becomes **Gotowe** → `tour.complete()`
- **Pomiń** — always present as secondary; `this.cancel()`

On `tour.cancel()` → `react-hot-toast`: *"Przewodnik zamknięty. Kliknij ? by uruchomić ponownie."*  
On `tour.complete()` → toast: *"Gotowe! Możesz zawsze wrócić klikając ?."*

---

## `data-guide` Selector Convention

DOM elements that are tour targets get a `data-guide` attribute:

```
Format: data-guide="<spaceId>:<element-name>"
Example: data-guide="pracownicy:add-employee"
```

Step configs reference via:
```ts
attachTo: { element: '[data-guide="pracownicy:add-employee"]', on: 'bottom' }
```

This makes selectors refactor-safe. The `data-guide` attribute is added to existing JSX — it does not change layout or styling.

---

## GuideProvider (`components/guide/guide-provider.tsx`)

```
'use client'

usePathname() → spaceId = resolveSpace(pathname)

On spaceId change:
  if spaceId && !store.isDisabled() && !store.isVisited(spaceId):
    setTimeout(1200ms):
      store.markVisited(spaceId)
      createTour(spaceId) + addSteps(spaces[spaceId])
      tour.on('cancel', showCancelToast)
      tour.on('complete', showCompleteToast)
      tour.start()

  // Journey resume:
  if journey = store.getJourney():
    // Look up config by journey.id; current step tells us which spaceId is expected
    const config = JOURNEYS[journey.id]
    const expectedSpaceId = config.steps[journey.step].spaceId
    if expectedSpaceId === spaceId && !Shepherd.activeTour:
      resumeJourney(journey)  // starts Shepherd tour from that step's steps subset

Provides GuideContext value to tree
```

The provider is inserted in `app/(tenant)/layout.tsx` wrapping `{children}`.

---

## GuideFab (`components/guide/guide-fab.tsx`)

```
'use client'

Fixed position: bottom-6 right-6 z-50
Shape: 40×40px circle, bg-accent, text-white, font-display bold
Label: "?"
aria-label: "Otwórz przewodnik po tej przestrzeni"

Pulse indicator (animated ring): shown when:
  activeSpaceId && !store.isVisited(activeSpaceId) && !Shepherd.activeTour

onClick: context.startTour(activeSpaceId)

If no activeSpaceId (e.g., on marketing pages): button is hidden (returns null)
```

---

## Space Tour Content

### Dashboard (4 steps)

| # | Target `data-guide` | Title | Text |
|---|---|---|---|
| 1 | *(centered, no attachTo)* | Witaj w HRobot! | Krótkie intro, co to jest i jak nawigować. |
| 2 | `dashboard:setup-checklist` | Lista startowa | Wykonaj te kroki, by w pełni skonfigurować przestrzeń. |
| 3 | `dashboard:quick-actions` | Szybkie akcje | Skróty do najczęstszych operacji. |
| 4 | `dashboard:data-protection` | Ochrona danych | Dane chronione w UE — RODO Art.5. |

### Pracownicy (5 steps)

| # | Target | Title | Text |
|---|---|---|---|
| 1 | `pracownicy:search` | Wyszukiwanie | Filtruj pracowników po imieniu, nazwisku lub stanowisku. |
| 2 | `pracownicy:table` | Lista pracowników | Kliknij wiersz by zobaczyć pełny profil. |
| 3 | `pracownicy:status-badge` | Status zatrudnienia | Aktywny / Nieaktywny — widoczny w tabeli. |
| 4 | `pracownicy:add-employee` | Dodaj pracownika | Otwiera formularz z walidacją Zod. |
| 5 | *(centered)* | Kartoteka pracownika | Pełny profil — dane, PESEL, log audytu. Kliknij wiersz by wejść. |

### Pracownicy/[id] (4 steps)

| # | Target | Title | Text |
|---|---|---|---|
| 1 | `pracownicy-id:personal-data` | Dane osobowe | Sekcja kontaktowa i kadrowa pracownika. |
| 2 | `pracownicy-id:pesel-reveal` | Odkrycie PESEL | Wymaga potwierdzenia. Każde odkrycie jest logowane (RODO Art.30). |
| 3 | `pracownicy-id:audit-log` | Log audytu | Historia dostępów do wrażliwych danych. |
| 4 | `pracownicy-id:back-link` | Powrót do listy | Wróć do listy pracowników. |

### Grafik (5 steps)

| # | Target | Title | Text |
|---|---|---|---|
| 1 | `grafik:week-nav` | Nawigacja tygodniami | Strzałki lub klawiatura ← → przełączają tydzień. |
| 2 | `grafik:facility-filter` | Filtr placówki | Pokaż grafik tylko dla wybranej lokalizacji. |
| 3 | `grafik:shift-cell` | Komórka zmiany | Kliknij by dodać lub edytować zmianę. |
| 4 | `grafik:add-shift` | Dodaj zmianę | extraHighlights: cały wiersz pracownika. |
| 5 | `grafik:remove-shift` | Usuń zmianę | Przycisk widoczny po najechaniu lub focus (keyboard a11y). |

### Wnioski (2 steps — prospektywne)

| # | Target | Title | Text |
|---|---|---|---|
| 1 | *(centered)* | Wnioski — wkrótce | Moduł wniosków urlopowych i kadrowych. |
| 2 | *(centered)* | Jak będzie działać | Pracownik składa wniosek → obieg akceptacji → powiadomienie. |

### Dostępy (2 steps — prospektywne)

| # | Target | Title | Text |
|---|---|---|---|
| 1 | *(centered)* | Dostępy — wkrótce | Zarządzanie rolami i uprawnieniami. |
| 2 | *(centered)* | Role w HRobot | PRACOWNIK, MANAGER, HR, ADMIN_KLIENTA — i co każda może. |

### Ustawienia (3 steps)

| # | Target | Title | Text |
|---|---|---|---|
| 1 | `ustawienia:nav-placowki` | Placówki | Konfiguruj lokalizacje firmy — adresy i godziny pracy. |
| 2 | `ustawienia:nav-uzytkownicy` | Użytkownicy | Zapraszaj i zarządzaj dostępem do systemu. |
| 3 | *(centered)* | Panel administracyjny | Widoczny tylko dla ADMIN_KLIENTA. |

### Ustawienia/Placówki (4 steps)

| # | Target | Title | Text |
|---|---|---|---|
| 1 | `placowki:list` | Lista placówek | Twoje lokalizacje — kliknij by edytować. |
| 2 | `placowki:add` | Dodaj placówkę | Formularz adresu i nazwy. |
| 3 | `placowki:address` | Adres | Ulica, kod pocztowy, miasto. |
| 4 | `placowki:hours` | Godziny pracy | Ustaw godziny dla każdego dnia tygodnia. |

### Ustawienia/Użytkownicy (4 steps)

| # | Target | Title | Text |
|---|---|---|---|
| 1 | `uzytkownicy:table` | Lista użytkowników | Kto ma dostęp do przestrzeni i w jakiej roli. |
| 2 | `uzytkownicy:role-badge` | Role | PRACOWNIK / MANAGER / HR / ADMIN_KLIENTA. |
| 3 | `uzytkownicy:invite` | Zaproś użytkownika | Wyślij zaproszenie e-mail. Użytkownik otrzymuje link do Keycloak. |
| 4 | *(centered)* | Bezpieczeństwo | Uwierzytelnianie przez Keycloak SSO — bez haseł lokalnych. |

---

## Journey Configs

### 🟢 Onboarding nowego pracownika (7 kroków)

```
Strona          Element                        Akcja przewodnika
pracownicy      add-employee button            "Kliknij Dodaj pracownika"
pracownicy      modal-first-name               "Wypełnij imię"  [advanceOn: form submit]
pracownicy      modal-submit                   "Zatwierdź formularz"
pracownicy      new-employee-row               "Pracownik dodany!"  → "Przejdź do Grafiku →"
grafik          week-nav                       "Znajdź tydzień startu pracownika"
grafik          shift-cell (row=newEmployee)   "Dodaj pierwszą zmianę"
dostepy         (centered)                     "Przypisz rolę w Dostępach"
```

Journey entry: Button "Rozpocznij przewodnik po procesie" in Dashboard's `<SetupChecklist>` component (existing component, add journey trigger button). FAB dropdown menu is v2.  
Po każdej stronie: przycisk "Kontynuuj w [następna przestrzeń] →" w ostatnim kroku na danej stronie.

### 📋 Zarządzanie wnioskiem (5 kroków)

```
wnioski    submit-button     "Złóż wniosek"  (stub — prospektywne)
wnioski    status-badge      "Status: oczekuje na akceptację"
grafik     affected-week     "Sprawdź wpływ na grafik" [extraHighlights: affected cells]
grafik     (summary)         "Tydzień z wnioskiem podświetlony"
pracownicy-id  (record)      "Sprawdź kartotekę pracownika po akceptacji"
```

### 🏢 Konfiguracja nowej placówki (6 kroków)

```
placowki   add-button        "Dodaj placówkę"
placowki   address-form      "Wypełnij adres"
placowki   hours-editor      "Ustaw godziny pracy"
placowki   save              "Zapisz placówkę"
grafik     facility-filter   "Placówka dostępna w filtrze Grafiku"
uzytkownicy invite           "Zaproś managera placówki"
```

### 👤 Zaproszenie menadżera (5 kroków)

```
uzytkownicy  invite-button   "Zaproś nowego użytkownika"
uzytkownicy  role-select     "Wybierz rolę MANAGER"
uzytkownicy  invite-submit   "Wyślij zaproszenie"
dostepy      (centered)      "Sprawdź uprawnienia MANAGER-a"
grafik       facility-filter "Manager widzi swoje placówki"
```

---

## CSS Overrides (HRobot theme)

Added to `app/globals.css` in a dedicated `/* Shepherd.js overrides */` block:

```css
/* Overlay — navy tint, not black */
.shepherd-modal-overlay-container {
  fill: rgba(11, 31, 59, 0.55);
}

/* Popover card */
.hrobot-shepherd.shepherd-element {
  background: #ffffff;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  box-shadow: var(--shadow-lift);
  max-width: 360px;
}
.hrobot-shepherd .shepherd-title {
  font-family: var(--font-display);
  font-weight: 800;
  color: var(--color-navy);
  font-size: 1rem;
}
.hrobot-shepherd .shepherd-text {
  color: var(--color-muted);
  font-size: 0.875rem;
  line-height: 1.55;
}

/* Primary button */
.hrobot-shepherd .shepherd-button:not(.shepherd-button-secondary) {
  background: var(--color-accent);
  color: #ffffff;
  border-radius: 7px;
  font-weight: 600;
  font-size: 0.8125rem;
}
/* Secondary button */
.hrobot-shepherd .shepherd-button-secondary {
  background: transparent;
  color: var(--color-muted);
  border: 1px solid var(--color-line);
  border-radius: 7px;
  font-size: 0.8125rem;
}

/* Highlighted element pulse */
.guide-active {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
  border-radius: 6px;
  animation: guide-pulse 1.4s ease-in-out infinite;
}
@keyframes guide-pulse {
  0%, 100% { outline-color: var(--color-accent); }
  50%       { outline-color: transparent; }
}

/* GuideFab pulse indicator */
@keyframes fab-ring {
  0%   { transform: scale(1);   opacity: 0.7; }
  100% { transform: scale(1.9); opacity: 0; }
}
```

---

## Tests

| File | What's tested |
|---|---|
| `test/guide/store.test.ts` | visited CRUD, disabled toggle, journey state, SSR-safe (no localStorage) |
| `test/guide/registry.test.ts` | pathname → spaceId for all 9 spaces + unknown paths |
| `test/guide/guide-provider.test.tsx` | auto-launch after 1200ms, skip if disabled, skip if visited, mark visited, journey resume |
| `test/guide/guide-fab.test.tsx` | renders when spaceId known, hidden on unknown path, click calls startTour, pulse indicator |
| `test/guide/shepherd.test.ts` | createTour returns Tour with correct defaultStepOptions |

---

## Out of Scope (v1)

- Server-side tour state persistence (DB) — localStorage only in v1
- Journey entry via FAB dropdown menu — v1 journeys start from Dashboard cards only
- Tour analytics backend — `when.show` fires console.log in v1; hook for real analytics in v2
- Mobile (< 768px) — FAB hidden on mobile, tours disabled (overlay + popover don't fit)
- Port to `apps/web` — separate plan after web-kit ship

---

## Licensing Action Item

Before ship: purchase **Shepherd.js Business Plan — $50/lifetime** at  
`https://shepherdjs.dev/pricing` (1 project license covers HRobot web-kit + apps/web).
