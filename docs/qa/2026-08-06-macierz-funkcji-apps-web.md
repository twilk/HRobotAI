# Macierz funkcji apps/web — rekonesans wieloagentowy

> **Cel (goal):** Każda zadeklarowana oraz widoczna na wszystkich ekranach funkcjonalność jest w pełni sprawna i działa intuicyjnie.
> **Data:** 2026-08-06 · **Branch:** feat/demo-4mobility · **Metoda:** 5 równoległych agentów-rekonesansu (read-only), każda funkcja prześledzona: handler UI → `lib/*` fetch → proxy `/api/*` → kontroler NestJS.
> **Stack:** 9/9 usług UP (Caddy :8080 → web → tenant-runtime). Legenda: ✅ WIRED · ⚠️ PARTIAL · ❌ STUB-DEAD/BRAK.

## 1. Podsumowanie liczbowe

| Moduł | ✅ | ⚠️ | ❌ | Werdykt |
|---|---|---|---|---|
| Shell / topbar / auth | 8 | 4 | 4 | **Słaby punkt** — profil, dzwonek, reset hasła martwe |
| Pracownicy | 9 | 2 | 6 | Edycja WIRED, ale gated + hardcoded units; brak delete/import/export |
| Grafik | 8 | 0 | 0 | **W pełni sprawny** |
| Zamiany | 5 | 4 | 0 | **Słaby punkt** — peer-flow nieosiągalny z UI (brak `/me`) |
| AI-Grafik Manager | 8 | 0 | 0 | **W pełni sprawny** |
| Wnioski / Dostępy / Ustawienia / Użytkownicy | 21 | 0 | 0 | **W pełni sprawny** |
| Dashboard + M3 (Analiza/Dokumenty/Asystent) | 24 | 3 | 3 | Solidny; Tour zbudowany lecz odpięty |

**Wniosek:** rdzeń produktowy (Grafik, AI-Grafik, Wnioski, Dostępy, Ustawienia, Użytkownicy, Analiza, Dokumenty, Asystent) jest realnie wpięty end-to-end. Luki koncentrują się w **warstwie powłoki (topbar)** i w **dwóch modułach** (Zamiany peer-flow, Pracownicy — braki CRUD + hardcoded units) — dokładnie tam, gdzie użytkownik zgłosił problemy.

---

## 2. Backlog luk — priorytety na pętlę naprawczą

### P0 — potwierdzone zgłoszenia użytkownika + blokery demo

| ID | Luka | Dowód | Naprawa |
|---|---|---|---|
| **G1** | **Ikona profilu (prawy górny róg) nic nie robi** — to `<span>`, nie przycisk; brak menu/trasy | `topbar.tsx:33-41` | Wydzielić kliencki `UserMenu` (wzorzec `mobile-drawer.tsx`): dropdown → Profil / Ustawienia / Wyloguj |
| **G2** | **Dzwonek powiadomień nie otwiera nic** — `<button>` bez `onClick`; czerwona kropka dekoracyjna; brak trasy/panelu | `topbar.tsx:25-32` | Panel powiadomień (dropdown) + realne źródło (wnioski/zamiany/AI do decyzji) lub świadome ukrycie do czasu wpięcia |
| **G3** | **Zamiany: peer-flow (Akceptuj/Odrzuć/Przekaż) nieosiągalny z UI** — `mineRole` zawsze `null` (brak `/me` w `lib/swaps.ts`) | `swaps.ts:187-190`, `swap-workspace.tsx:22-28` | Dodać resolver `fetchMyEmployeeId` (jak w `ai-grafik.ts`) → wyliczać `mineRole` → przyciski peer się renderują |
| **G4** | **Pracownicy: `unitId` z 4 hardcoded UUID (`DEMO_UNIT_NAMES`)** — brak endpointu listy jednostek → ryzyko 400 P2003 na żywym tenancie | `employee-edit-form.tsx:20`, `demo-locations.ts:35-40` | Wpiąć realny `GET /api/ustawienia/units` (istnieje!) zamiast stałej |

### P1 — martwe/mylące elementy widoczne dla użytkownika

| ID | Luka | Dowód | Naprawa |
|---|---|---|---|
| **G5** | **Tour/Przewodnik zbudowany, ale nigdy nie wyrenderowany** — brak `<TourTrigger/>` w topbarze | `tour/tour.tsx:265` (jedyny ref) | Dodać `<TourTrigger/>` do `topbar.tsx` (1 linia) |
| **G6** | **„Zapomniałeś hasła?" → `href="#"`** martwy link | `login-form.tsx:25` | Trasa resetu lub ukrycie linku do czasu implementacji |
| **G7** | **Badge „3" przy Wnioskach hardcoded** — nie odzwierciedla realnej liczby | `nav.ts:52` | Dynamiczny licznik PENDING lub usunięcie tagu |
| **G8** | **Import CSV pracowników — martwy placeholder „wkrótce"** | `employees-empty.tsx:29-34` | Ukryć lub zaimplementować |

### P2 — braki funkcjonalne (do decyzji zakresu)

| ID | Luka | Dowód | Uwaga |
|---|---|---|---|
| **G9** | Brak usuwania pracownika (żadnej warstwy) | brak `@Delete` w `employees.controller.ts` | Zbudować od zera lub świadomie pominąć (RODO: raczej deaktywacja) |
| **G10** | Brak eksportu / paginacji / sortowania listy pracowników | `employees-table.tsx` | Skala demo (36 os.) — niski priorytet |
| **G11** | Pola kontaktowe (email/telefon) pracownika nieedytowalne | brak w DTO `employee.dto.ts` | email jest na `User`, nie `Employee` |
| **G12** | Signup/provisioning = mock (in-memory `TAKEN`, `Date.now()` jobId) | `api/auth/signup/route.ts` | Front wpięty; realny provisioning to osobny temat |
| **G13** | SetupChecklist = komponent-sierota (dead code) | `setup-checklist.tsx` nieimportowany | Usunąć (świadomie zastąpiony `DashboardKpis`) |
| **G14** | Zamiany: „Zaproponuj/Moje prośby" puste dla admina (brak Employee) | `swap-workspace.tsx:118-137` | Znika po G3 + test na koncie PRACOWNIK |
| **G15** | RCP (wejście/wyjście) — brak UI w zakresie | — | Zweryfikować czy w ogóle w zakresie produktu |

### Świadomie martwe (NIE defekty)
- Mic w Asystencie (`disabled`, „wkrótce") — STT poza zakresem MVP.
- `fairnessScore` ukryty w metrykach Grafiku — placeholder M3 (`grafik.ts:164-168`).
- „Sesja szyfrowana" pill, „Dane chronione w UE" footer, DataProtectionPanel — statyczne znaczniki RODO (zamierzone).

---

## 3. Pełna macierz — moduł po module

### 3.1 Shell / Topbar / Sidebar / Auth
| Funkcja | Komponent | Status | Dowód |
|---|---|---|---|
| Ikona profilu (avatar) | topbar | ❌ | `topbar.tsx:33-41` — `<span>`, brak onClick/menu |
| Dzwonek / powiadomienia | topbar | ❌ | `topbar.tsx:25-32` — `<button>` bez handlera |
| User menu (dropdown) | topbar | ❌ BRAK | nie istnieje w kodzie |
| Wyloguj | topbar → auth-actions | ✅ | `topbar.tsx:42-51`, `auth-actions.ts:110` |
| „Sesja szyfrowana" pill | secured-chip | ⚠️ kosmet. | `secured-chip.tsx:6-18` |
| Hamburger + drawer (mobile) | mobile-drawer | ✅ | `mobile-drawer.tsx:22-53` |
| Nawigacja boczna (wszystkie) | sidebar-nav → nav.ts | ✅ | `sidebar-nav.tsx:38-70`, RBAC `nav.ts:75-78` |
| Badge „AI"/„3" | nav.ts | ⚠️ kosmet./mylące | `nav.ts:47,52,62` hardcoded |
| Footer „Dane chronione w UE" | sidebar-nav | ⚠️ kosmet. | `sidebar-nav.tsx:77-81` |
| Login (ROPC direct-grant) | login-form → auth-actions | ✅ | `auth-actions.ts:29-107`, httpOnly cookie |
| „Zapomniałeś hasła?" | login-form | ❌ | `login-form.tsx:25` — `href="#"` |
| Signup | signup-form → api | ✅ (mock BE) | `api/auth/signup/route.ts` in-memory |
| „Zaloguj się" (z signup) | signup/page | ✅ | `signup/page.tsx:29` |
| Provisioning status (poll) | provisioning-status | ✅ (mock BE) | poll 3s `/api/provision/status/:job` |

### 3.2 Pracownicy
| Funkcja | Status | Dowód |
|---|---|---|
| Lista (GET) | ✅ | `employees-screen.tsx:92` → controller `findAll` |
| Szukaj/filtruj | ✅ (client) | `employees-screen.tsx:121-127` |
| Klik wiersza → profil | ✅ | `employees-table.tsx:55` `router.push` |
| Profil `[id]` | ✅ | `employee-profile.tsx:58` |
| Przycisk „Edytuj" | ✅ (gated HR/ADMIN) | `employee-profile.tsx:143-155` `canManage` |
| Zapis edycji (PATCH) | ✅ | `employee-edit-form.tsx:101-113` → service `update` + audit |
| Pola: imię/stanowisko/typ/etat/kwalifikacje/PESEL | ✅ | form `133-227`, PESEL write-only |
| Dodaj pracownika | ✅ (gated) | `employees-screen.tsx:171-176` |
| Zapis dodania (POST) | ✅ | `employee-add-dialog.tsx:99-108` |
| `<select>` jednostki | ⚠️ hardcoded | `edit-form.tsx:20` `DEMO_UNIT_NAMES` |
| Kolumna/reveal PESEL | ⚠️ (RODO by design) | `employees-table.tsx:80-88` maska |
| Usuń pracownika | ❌ BRAK | brak `@Delete` |
| Import CSV | ❌ „wkrótce" | `employees-empty.tsx:29-34` |
| Eksport / paginacja / sort | ❌ BRAK | `employees-table.tsx` |
| Email/telefon edycja | ❌ BRAK | nie w DTO |

### 3.3 Grafik — ✅ w pełni
Generuj (solve) · Utwórz/Edytuj/Usuń zmianę · Wczytaj (employees/shifts/demands) · Filtr jednostki · Metryki (coverage/commute/etat/preferencje) · Nawigacja tygodnia — wszystkie ✅, handler → `grafik.ts` → `grafik.controller.ts`. `fairnessScore` świadomie ukryty.

### 3.4 Zamiany
| Funkcja | Status | Dowód |
|---|---|---|
| Zaproponuj (DRAFT) | ⚠️ 403 dla admina (brak Employee) | `swap-workspace.tsx:110-141` |
| Wyślij (submit) | ✅ | `swaps.ts:232` → ctrl:91 |
| Akceptuj/Odrzuć (peer) | ⚠️ **nieosiągalne z UI** | `mineRole` zawsze null `swaps.ts:187-190` |
| Przekaż managerowi | ⚠️ nieosiągalne (wymaga PEER_AGREED) | ctrl:116 |
| Zatwierdź/Odrzuć (manager) | ✅ | `swaps.ts:253` → ctrl:128 |
| Anuluj | ✅ | ctrl:149 |
| Auto-poll 4s | ✅ | `swap-workspace.tsx:60-70` |

### 3.5 AI-Grafik Manager — ✅ w pełni
Skan zastępstw · Utwórz propozycję · Zapytaj o zgodę · Manager decision · Δkoszt/travel badge · Zgoda pracownika · Config AI (autonomia/TTL/cisza) · Panel kosztów (tydzień/budżet/stawki read+upsert) — wszystkie ✅.

### 3.6 Wnioski / Dostępy / Ustawienia / Użytkownicy — ✅ w pełni (21 funkcji)
Wnioski: złóż/anuluj/zatwierdź/odrzuć/inbox/lista. Dostępy: wydaj/odwołaj/lista/selecty. Ustawienia: edycja firmy/jednostki (dodaj/edytuj/org-chart/cycle-guard). Użytkownicy: zaproś/nadaj-rolę/odbierz-rolę/dezaktywuj/lista. Wszystkie handler → `lib/*` → proxy → kontroler potwierdzone. RBAC warstwowy + graceful degradation selectów. RCP nieobecne (poza zakresem tych ekranów).

### 3.7 Dashboard + M3
| Funkcja | Status | Dowód |
|---|---|---|
| KPI tiles | ✅ | `dashboard-kpis.tsx:35-47` |
| Quick-actions (RBAC) | ✅ nav | `quick-actions.tsx:43-61` |
| Manager/Admin/Pracownik boards | ✅ | scan/decyzje/koszt/zdrowie org |
| SetupChecklist | ❌ sierota | nieimportowany |
| DataProtectionPanel | ⚠️ hardcoded | `data-protection-panel.tsx:9-14` |
| Analiza: heatmap/feed/karta/rekrutacja/self-card/config | ✅ | `strategic-brain/*` |
| „Zaakceptuj rekomendację" | ✅ | `recruitment-panel.tsx:58` |
| Dokumenty: generuj/zatwierdź/pobierz PDF/lista/moja-ewidencja | ✅ | `dokumenty-screen.tsx` |
| Asystent: interpret/execute/potwierdź/fallback | ✅ | `asystent-screen.tsx` |
| Mic | ⚠️ disabled (by design) | `asystent-screen.tsx:147-155` |
| Tour/Przewodnik | ❌ odpięty | `tour/tour.tsx:265` brak importu |

---

## 4. Następny krok: pakiet testów manualnych (3 konta)

Konta demo: **admin `demo`** / **`manager.demo`** / **`pracownik.demo`**. Dla każdej luki P0/P1 — dowód wizualny (screenshot) + status sieci (200/307/403/400) + zapis powodu faila. Cel: potwierdzić, które luki to realne błędy runtime, a które gate ról / brak Employee (znika po zalogowaniu na właściwe konto).
