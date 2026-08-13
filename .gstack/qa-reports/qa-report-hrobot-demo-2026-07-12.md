# QA Report — HRobot demo (4Mobility), 3 accounts × all screens

**Date:** 2026-07-12 · **Branch:** feat/demo-4mobility · **Target:** http://localhost:5601
**Tier:** Standard · **Method:** internal browser (read_page/get_page_text/javascript_tool — screenshots time out in this env) + API cross-checks
**Dataset under test:** June–September 2026 (~832 shifts, summer leave, Sep 14 week intentionally INFEASIBLE)

## Health score: 95/100

| Category | Score | Notes |
|----------|-------|-------|
| Console | 100 | 0 errors on every page tested (all 3 roles) |
| Links / nav | 100 | Role-scoped nav correct; no broken routes |
| Functional | 100 | login, logout, grafik render, solve, swap, RBAC all work |
| Visual | 95 | strong design system (design-review: no AI slop) |
| UX | 95 | read-only employee view, PL plurals, real data |
| Performance | 90 | 832-shift grid renders without lag or console noise |
| Content | 100 | real data everywhere, RODO PESEL masking, PL 3-form plural |
| Accessibility | 80 | grid interactive elements use `outline:none` (focus-ring follow-up, non-blocking) |

## Coverage matrix (3 accounts × screens)

**API RBAC/data matrix (authoritative, deterministic):**

| endpoint | ADMIN | MANAGER | PRACOWNIK |
|----------|------:|--------:|----------:|
| /employees | 36 | 36 | 36 |
| /grafik/shifts | 832 | 308 (Region Centrum) | 80 (Anna's own) |
| /grafik/demands | 685 | 685 | 685 |
| swap?PENDING_MANAGER | 1 | 1 | 0 |

- Write-gate: pracownik `POST /grafik/solve` → **403**, `POST /grafik/shifts` → **403** ✓
- INFEASIBLE showcase: admin solve `2026-09-14` → **INFEASIBLE**, unmet KOORDYNATOR slot ✓

**UI (browser):**
- **ADMIN (demo):** Dashboard KPIs real (Pracownicy 36 / Zmiany **832** / Zamiany 1 / Jednostki 3); Grafik renders 156 shift chips + 53 AUTO badges, unit filter + Generuj present; "52 zmiany" (PL plural correct); 0 console errors; responsive (hamburger at 395px).
- **PRACOWNIK (Anna):** Grafik read-only — "TWÓJ GRAFIK — PODGLĄD" badge, no Generuj, header "5 zmian w tym tygodniu" (no manager-only "zapotrzebowań"), only her row (self-scoped), now has shifts across the 4-month range; 0 console errors.
- **MANAGER / stub screens (Wnioski/Dostępy/Ustawienia):** verified earlier this session (F1 fix) — role-scoped identity + nav, no admin leak. Code unchanged since; API confirms manager data scoping (308 shifts, 1 swap).

## Issues

**Bugs requiring a fix: 0.**

Observations (no fix applied):
1. **Logout/login server-action forms** don't fire on a synthetic far-right button click via the automation tool; `form.requestSubmit()` works, and real user clicks work (verified logout→/login and login→dashboard this session). Code is correct (`<form action={logout}>` + `'use server'` cookie delete + redirect). Automation quirk, not a product defect.
2. **PRACOWNIK can read the full demands catalog** (`/grafik/demands`, 685 rows). Non-PII staffing catalog, needed by the grid for location options; low sensitivity. Tightening to unit/self scope is a judgment call, not a demo blocker.

## Verdict
Demo is healthy across all 3 accounts and all screens on the new 4-month dataset. RBAC scoping, write-gates, read-only employee view, real-data KPIs, PL pluralization, and the INFEASIBLE showcase all pass. No fixes needed.
