# Changelog

All notable changes to HRobot web-kit are documented here.

---

## [0.2.0] - 2026-06-08

### Added
- **Przewodnik (Guide) microcomponent** — global "?" FAB button that launches context-sensitive Shepherd.js guided tours for each of the 9 tenant spaces (Dashboard, Pracownicy, Pracownicy-ID, Grafik, Wnioski, Dostępy, Ustawienia, Ustawienia Placówki, Ustawienia Użytkownicy)
- First-time visitors see the tour automatically (1200ms delay after page load)
- Tours support modal overlay, keyboard navigation, scroll-to, cancel icons, and a "Wyłącz auto-start" button on the first step
- 4 multi-space process journey configs (onboarding pracownika, zarządzanie wnioskiem, konfiguracja placówki, zaproszenie managera) — journey execution is a v2 placeholder
- `data-guide` attributes added to 12 component files for stable Shepherd.js step anchors
- `lib/guide/` — full typed TypeScript library: types, SSR-safe localStorage store, pathname→spaceId registry, Shepherd.js tour factory
- 141 tests (32 new for the guide feature, 9 additional coverage tests)
- **Pracownicy** — live employee search filter + "Dodaj pracownika" modal with form validation and optimistic list update
- **Użytkownicy** — live user list + "Zaproś użytkownika" modal with email validation
- **Grafik** — interactive weekly schedule grid with shift assignment, facility switching, and week navigation
- **Placówki** — facility address and working-hours configuration editor
- **C4 Pracownicy-ID** — employee detail route with audited PESEL reveal (confirmation dialog + audit log entry)
- **Modal** primitive component (`components/ui/modal.tsx`) with keyboard trap and focus management

### Changed
- `app/(tenant)/layout.tsx` now wraps all tenant routes in `GuideProvider` and renders `GuideFab`
- `GuideContext.Provider` value is memoized (`useMemo`) to prevent unnecessary consumer re-renders
- `createTour` is imported statically from `lib/guide/shepherd` (SSR-safe — the actual `shepherd.js` import is guarded inside `createTour`)

### Fixed
- Tour "Przewodnik zamknięty" toast no longer fires when the tour is cancelled by navigation (only fires on explicit user cancel)
- Race condition: navigating away during async tour load now cancels the in-flight tour before `tour.start()` is called
- Guide step text in pracownicy-id space now matches the actual "Ujawnij i zapisz wpis" button label
- Debug `console.log` removed from dashboard space `when.show()` handler
- `shepherd.js` v15 named import (`Tour`, `StepOptions`) — resolved API change from v12 default export
