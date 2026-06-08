# Changelog

All notable changes to HRobot web-kit are documented here.

---

## [0.4.0] - 2026-06-08

### Added
- **Employee onboarding integration** — `lib/actions/onboarding-actions.ts` exports `onboardNewEmployee` which atomically creates the employee record, a notification of type `employee-added`, default access entries for all 5 modules at `brak` level, and an initial leave balance record
- `addLeaveBalance(employeeId, employeeName, year)` added to `lib/leave-balance.ts` — creates a default entitlement (26 annual / 14 paternity / 10 other) for new employees
- **AddEmployeeModal** now calls `onboardNewEmployee` on form submit, replacing the piecemeal optimistic-only approach with full server-side coordination
- **Leave balance tracking** — `lib/leave-balance.ts` with year-keyed in-memory store, `getLeaveBalance`, `getAllLeaveBalances`, `deductLeave` functions; API routes `GET /api/leave-balance` and `GET /api/leave-balance/[employeeId]`; `LeaveBalanceBadge` component
- **Notifications system** — `lib/notifications.ts` with full CRUD (add, markRead, markAllRead, getUnreadCount); notification bell component in tenant layout; auto-notification added on wnioski approval
- **GrafikGrid** wired to `grafik-actions.ts` server actions for shift assignment and removal
- **DostepyClientView** wired to `dostepy-actions.ts` for per-module and bulk access updates
- **Auto-deduct leave days** — approving a wnioski record calls `deductLeave` to subtract days from the employee's balance

---

## [0.3.0] - 2026-06-08

### Added
- **Employee profile editing** — `EditEmployeeModal` with pre-filled name, position, department, email, phone fields and status dropdown (Aktywny / Nieaktywny / Na urlopie / Zawieszony); pencil-icon Edit button per row in the employees table
- `updateEmployee` and `setEmployeeStatus` mutation functions in `lib/employees.ts` with full TDD coverage (10+ tests)
- `lib/actions/employees-actions.ts` — `editEmployee`, `changeEmployeeStatus`, `addEmployee` server actions with validation and TDD coverage (7+ tests)
- `GET /api/pracownicy/[id]` and `PATCH /api/pracownicy/[id]` routes — returns single employee or 404; PATCH handles profile fields and status (6+ tests)
- **Raporty (Reports) module** — HR analytics dashboard with StatsPanel summary metrics
- **Server Actions** for all write paths: wnioski, dostępy, grafik, facilities
- **Dashboard StatsPanel** — real metrics panel using live HRSummary data

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
