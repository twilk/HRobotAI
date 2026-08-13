# Zamkniecie luk wobec harmonogramu PARP — plan wdrozenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zamknąć osiem pozycji harmonogramu PARP bez pokrycia w kodzie przed odbiorem M3 (20.08.2026): pięć implementacyjnie (testy wydajności i bezpieczeństwa M3 g, audyt powdrożeniowy M3 i, personalizacja komunikacji M3 c, kanał powiadomień e-mail M1 j, eksport ICS M1 j) i trzy przez jawną deklarację zakresu w §5 raportu KM3 (RL, konektor HR, OAuth Google/MS). Każdy blok kończy się weryfikacją na żywym stosie i weryfikacją negatywną — cofnięcie poprawki musi zapalić test na czerwono, inaczej nie liczy się jako pokrycie. Nienaruszalne: `compositeScore` (`apps/tenant-runtime/src/strategic-brain/scoring.util.ts:100`), kotwice demo (39 pracowników, 1558 zmian) i cztery istniejące deklaracje w §5 raportu (dopisujemy, nie przepisujemy).

**Architecture:** Pięć bloków dotykających czterech rozłącznych warstw plus jedna warstwa wspólna, która jest źródłem wszystkich kolizji.
- **Narzędzia i dokumenty odbiorcze** (bloki A, B): `scripts/**` i `docs/raport-km3/**`. Nie importują kodu produktu; jedyny wyjątek to blok A, który zmienia bramę HTTP (`infra/caddy/Caddyfile`).
- **Frontend** (blok C, częściowo E): `apps/web/{lib,components,app,e2e}`. Logika produktowa w czystych modułach `lib/**` (vitest, środowisko `node`), komponenty bramkowane przez `tsc --noEmit` + `eslint` + Playwright.
- **Backend NestJS** (bloki D, E): nowe moduły `apps/tenant-runtime/src/notifications/` i `apps/tenant-runtime/src/kalendarz/`, wpięte przez porty (`NOTIFICATION_PORT`, `NotificationPort`) i `@Optional() @Inject(...)`, żeby żaden istniejący plik testowy nie wymagał edycji.
- **Infrastruktura** (bloki A, D, E): `infra/caddy/Caddyfile`, `docker-compose.yml`, `.env.example`, `packages/config/src/env.ts`.
- **Warstwa wspólna — jedyne realne pole konfliktu**: `package.json` (korzeń), `docs/raport-km3/Raport_KM3_HRobot.md` (§3.1, §3.3, §5, §8), łańcuch budowania PDF (`build/body.html` → `report.html` → `Raport_KM3_HRobot.pdf`) oraz inwentarz tras BFF (17 → 18 po bloku E). Sekcja „Kolizje i decyzje otwarte" na końcu wymienia każde takie miejsce z nazwy.

Żaden blok nie tworzy migracji i nie zmienia schematu bazy. Jedyne zapisy do bazy w całym planie to: append-only wpisy `audit_log` (bloki C, D) i jeden wniosek urlopowy tworzony i anulowany przez test E2E bloku E.

**Tech Stack:** Monorepo pnpm 10.30.3 + turbo, Node 22.12. Backend NestJS (`apps/tenant-runtime/src/`, prefiks `/api`, `main.ts:25`), Prisma tenant schema `packages/db/generated/tenant/schema.prisma`. Front Next.js App Router (`apps/web/`). Testy: jest 29.7.0 (`apps/tenant-runtime`, `packages/*` — `npx jest src/<modul>`), vitest 2.1.9 (`apps/web` — `npx vitest run <sciezka>`), Playwright (`apps/web/e2e`), wbudowany `node --test` (`scripts/**`, bez zależności zewnętrznych), pytest (`agent-service`). Stos demonstracyjny: `docker compose -p hrobot --profile full` (10 usług, Caddy `:8080`, Keycloak `:8081`, tenant-runtime `:3001`). Dokumenty: pandoc 3.9 + Chrome DevTools Protocol (`docs/raport-km3/build/print-km3.mjs`). Pomiar wydajności: `autocannon@8` przez `npx`, bez instalacji do repo.

---

## Numeracja

- **Zadania numerowane globalnie 1–49.** W nagłówku każdego zadania podany jest w nawiasie numer lokalny bloku (np. `Zadanie 19 (C-1)`), bo proza wewnątrz bloków odwołuje się do numeracji lokalnej („patrz zadanie 8", „Zadania 1–11").
- **Kroki numerowane lokalnie w obrębie bloku** — tak jak w planach źródłowych. Bloki A, B i D numerują kroki ciągiem przez cały blok (A: 1–52, B: 1–65, D: 1–68), bloki C i E numerują je od nowa w każdym zadaniu. Odwołania w prozie typu „patrz Krok 24" dotyczą **kroków tego samego bloku**. Nie renumerowano ich globalnie, bo każde odwołanie w kodzie, komentarzu i uzasadnieniu musiałoby zostać przepisane, a to jest dokładnie ta klasa zmiany, w której gubi się jeden odsyłacz i nikt tego nie zauważa.

---

## Struktura plikow

Kolumna **Kolizja** wskazuje pliki dotykane przez więcej niż jeden blok. Każda taka pozycja ma rozwinięcie w sekcji „Kolizje i decyzje otwarte".

### Narzędzia pomiarowe i raportowe (`scripts/`, blok A)

| Plik | Blok | Rodzaj | Jedna odpowiedzialność | Kolizja |
|---|---|---|---|---|
| `scripts/lib/perf-budget.mjs` | A | nowy | Budżety trzech ścieżek M3 g i przeliczenie wyniku `autocannon -j` na jeden wiersz raportu | — |
| `scripts/perf-budget.test.mjs` | A | nowy | Test arytmetyki werdyktu OK / PRZEKROCZONY / BLAD | — |
| `scripts/perf-smoke.mjs` | A | nowy | Przebieg pomiarowy trzech ścieżek i zapis surowego wyniku | — |
| `scripts/lib/security-headers.mjs` | A | nowy | Kontrakt pięciu nagłówków bezpieczeństwa + parser bloku `header` z Caddyfile | — |
| `scripts/security-headers.test.mjs` | A | nowy | Test kontraktu nagłówków wobec realnego `infra/caddy/Caddyfile` | — |
| `scripts/lib/security-suites.mjs` | A | nowy | Katalog 12 istniejących zestawów testów bezpieczeństwa + parser liczby zdanych | — |
| `scripts/security-suites.test.mjs` | A | nowy | Test katalogu i parserów czterech biegaczy | — |
| `scripts/lib/bff-routes.mjs` | A | nowy | Odkrywanie tras BFF z dysku dla skryptów (lustro `apps/web/lib/api-gate.ts` w czystym ESM) | **A×E** — blok E dodaje 18. trasę |
| `scripts/bff-routes.test.mjs` | A | nowy | Przypięcie liczb 17 / 14 / 3 po stronie skryptów | **A×E** |
| `scripts/security-suite.mjs` | A | nowy | `pnpm test:security`: uruchomienie 12 zestawów + dwie sondy na żywo + zapis JSON | **A×E** (liczby zestawów) |
| `scripts/raport-testy-koncowe.mjs` | A | nowy | Generator Zał. 6 wyłącznie z plików pomiarowych | — |

### Narzędzia audytowe (`scripts/audyt/`, blok B)

| Plik | Blok | Rodzaj | Jedna odpowiedzialność | Kolizja |
|---|---|---|---|---|
| `scripts/audyt/lib.mjs` | B | nowy | Czyste reguły audytu: model ustalenia, 6 kategorii kontroli, rekomendacje, renderer markdown | — |
| `scripts/audyt/lib.test.mjs` | B | nowy | 34 testy reguł audytu na fixture'ach o realnym kształcie | — |
| `scripts/audyt-powdrozeniowy.mjs` | B | nowy | Warstwa I/O audytu: docker, psql, HTTP → plik raportu + kod wyjścia | **B×D** — `EXPECTED_SERVICES` = 10 usług, blok D dodaje 11. (mailpit) |

### Artefakty przebiegów i dokumenty odbiorcze (`docs/raport-km3/`)

| Plik | Blok | Rodzaj | Jedna odpowiedzialność | Kolizja |
|---|---|---|---|---|
| `docs/raport-km3/build/perf-smoke.json` | A | artefakt | Surowy wynik pomiaru wydajności (git SHA + id obrazów) | — |
| `docs/raport-km3/build/security-run.json` | A | artefakt | Surowy wynik przebiegu bezpieczeństwa (zestawy + dwie sondy) | — |
| `docs/raport-km3/testy-koncowe.md` / `.html` / `Zal_6_Testy_koncowe.pdf` | A | artefakt | Zał. 6 — testy wydajności i bezpieczeństwa | — |
| `docs/raport-km3/audyt-powdrozeniowy.md` | B | artefakt | Zał. 7 — audyt powdrożeniowy, przebieg zdrowy | — |
| `docs/raport-km3/audyt-weryfikacja-negatywna.md` | B | artefakt | Dowód weryfikacji negatywnej audytu (zatrzymany `optimizer`) | — |
| `docs/raport-km3/audyt.html` / `Audyt_powdrozeniowy_KM3.pdf` | B | artefakt | Zał. 7 w postaci drukowanej | — |
| `docs/raport-km3/assets/mailpit-powiadomienie-urlop.png` | D | artefakt | Zrzut skrzynki Mailpit jako dowód odbiorczy kanału e-mail | — |
| `docs/raport-km3/build/print-testy-koncowe.mjs` | A | nowy | Druk Zał. 6 (pandoc + CDP, port 9338) | **A×B** — ten sam port CDP co `print-audyt.mjs` |
| `docs/raport-km3/build/print-audyt.mjs` | B | nowy | Druk Zał. 7 (pandoc + CDP, port 9338) | **A×B** |
| `docs/raport-km3/build/make-report-html.mjs` | A | nowy | Złożenie `report.html` ze `style.html` + `body.html` | **A×B×E** — trzy skrypty o tej samej odpowiedzialności |
| `docs/raport-km3/build/build-report-html.mjs` | B | nowy | Markdown → `body.html` → `report.html` | **A×B×E** |
| `docs/raport-km3/build/assemble-report.mjs` | E | nowy | Złożenie `report.html` ze `style.html` + `body.html` | **A×B×E** |
| `docs/raport-km3/build/body.html` | A, B, E | regeneracja | Wyjście pandoca z raportu głównego | **A×B×E** — kolejność przebudowy |
| `docs/raport-km3/report.html` | A, B, E | regeneracja | Wejście dla `print-km3.mjs` | **A×B×E** |
| `docs/raport-km3/Raport_KM3_HRobot.pdf` | A, B, E | regeneracja | PDF raportu głównego | **A×B×E** |
| `docs/raport-km3/Raport_KM3_HRobot.md` | A, B, C, D, E | zmiana | Raport główny: §3.1 (A), §3.3 (C), §5 (A, C, D, E), §8 (A, B) | **A×B×C×D×E — najcięższa kolizja planu** |

### Konfiguracja i infrastruktura

| Plik | Blok | Rodzaj | Jedna odpowiedzialność | Kolizja |
|---|---|---|---|---|
| `package.json` (korzeń) | A, B | zmiana | Skrypty: `test:perf`, `test:scripts`, `test:security`, `raport:testy` (A); `audyt`, `test:audyt`, `audyt:pdf` (B) | **A×B** — obie wstawki po `test:e2e:smoke` |
| `infra/caddy/Caddyfile` | A | zmiana | Blok `header` z pięcioma nagłówkami bezpieczeństwa + usunięcie `X-Powered-By` | — |
| `docker-compose.yml` | D, E | zmiana | Usługa `mailpit` + zmienne SMTP (D); `ICS_FEED_PUBLIC_BASE_URL` (E) | **D×E** — obie wstawki po `PORT: "3001"` |
| `.env.example` | D, E | zmiana | Dokumentacja `SMTP_*` (D) i `ICS_FEED_*` (E) | **D×E** — obie dopisują na końcu / w sekcji sekretów |
| `packages/config/src/env.ts` | E | zmiana | `icsFeedSecretSchema`, dwa opcjonalne pola `envSchema`, czytnik `readIcsFeedSecret` | — |
| `packages/config/src/index.ts` | E | zmiana | Eksport `icsFeedSecretSchema` i `readIcsFeedSecret` | — |
| `packages/config/src/env.test.ts` | E | zmiana | 5 testów czytnika sekretu kanału ICS | — |
| `C:\Users\Wilk\Documents\WORKSPACE\PORTS.md` | D | zmiana | Rejestr portów workspace: 8025 / 1025 dla Mailpita | poza repo, poza gitem |

### Frontend (`apps/web/`)

| Plik | Blok | Rodzaj | Jedna odpowiedzialność | Kolizja |
|---|---|---|---|---|
| `apps/web/lib/api-gate.security.test.ts` | A | nowy | Realny `middleware()` po wszystkich trasach odkrytych z dysku, cztery metody | **A×E** — przypina 17 tras z nazwy |
| `apps/web/lib/middleware-api-gate.test.ts` | E | zmiana | Dwie nowe trasy `/api/kalendarz/*` na liście `CHRONIONE` | **A×E** — zmienia liczbę testów rozliczaną w `test:security` |
| `apps/web/lib/agent-glosowy.ts` | C | zmiana | Lustro kontraktu backendu: 13 intencji, etykiety, linki fallbacku, `czytajSaldoUrlopu` | — |
| `apps/web/lib/agent-glosowy.test.ts` | C | zmiana | Testy etykiet 13 intencji i parsera salda | — |
| `apps/web/lib/personalizacja.ts` | C | nowy | Czyste funkcje personalizacji: profil, powitanie, podtytuł, podpowiedzi wg roli, zdanie o saldzie | — |
| `apps/web/lib/personalizacja.test.ts` | C | nowy | 21 testów personalizacji | — |
| `apps/web/app/(tenant)/asystent/page.tsx` | C | zmiana | Przekazanie `imieZSesji` i `roles` do ekranu asystenta | — |
| `apps/web/components/asystent/asystent-screen.tsx` | C | zmiana | Karta powitania, podpowiedzi wg roli, saldo w karcie potwierdzenia | — |
| `apps/web/e2e/km3-personalizacja-asystenta.spec.ts` | C | nowy | E2E personalizacji: imię, saldo, podpowiedzi, RODO, konto bez kartoteki | — |
| `apps/web/app/api/kalendarz/[[...path]]/route.ts` | E | nowy | Proxy BFF tras eksportu ICS wymagających sesji | **A×E** — 18. trasa pod `app/api` |
| `apps/web/lib/kalendarz-ics.ts` | E | nowy | Model kliencki eksportu ICS: etykiety, adresy, `webcal://` | — |
| `apps/web/lib/kalendarz-ics.test.ts` | E | nowy | Test nazewnictwa (zakaz obietnicy OAuth) i składania adresów | — |
| `apps/web/components/wnioski/wnioski-screen.tsx` | E | zmiana | Karta eksportu ICS + pobranie pojedynczego wniosku | — |
| `apps/web/e2e/ics-export.spec.ts` | E | nowy | E2E eksportu ICS, w tym kryterium E-4 (nagrobek `STATUS:CANCELLED`) | — |

### Backend — powiadomienia (`apps/tenant-runtime/src/notifications/`, blok D)

| Plik | Blok | Rodzaj | Jedna odpowiedzialność | Kolizja |
|---|---|---|---|---|
| `notification.port.ts` | D | nowy | Kontrakt kanału powiadomień (`channel`, `send`) + token DI | — |
| `notification.templates.ts` | D | nowy | Szablony PL; temat stały, wolny od PII | — |
| `notification.templates.spec.ts` | D | nowy | 6 testów szablonów, w tym zakaz cyfry w temacie | — |
| `smtp.client.ts` | D | nowy | Minimalny klient SMTP na `node:net`, bez nowej zależności | — |
| `smtp.client.spec.ts` | D | nowy | 8 testów klienta na atrapie serwera SMTP | — |
| `notification.noop.adapter.ts` | D | nowy | Adapter domyślny: brak konfiguracji nie wywraca zapisu | — |
| `notification.email.adapter.ts` | D | nowy | Adapter e-mail (cienki; szczery co do porażki) | rozjazd nazwy wobec specu (`email.adapter.ts`) |
| `notification.channel.factory.ts` | D | nowy | Jedyne miejsce wyboru adaptera na podstawie `SMTP_HOST` | — |
| `notification.channel.factory.spec.ts` | D | nowy | 4 testy fabryki, w tym degradacja do no-op przy złej konfiguracji | — |
| `notification.service.ts` | D | nowy | Dyspozytor: adresat z `Employee.user.email`, wpis do `audit_log`, kontrakt „nigdy nie rzuca" | — |
| `notification.service.spec.ts` | D | nowy | 8 testów dyspozytora, w tym RODO ładunku audytu | — |
| `notifications.module.ts` | D | nowy | Wiązanie `NOTIFICATION_PORT` z fabryką | — |
| `notifications.module.spec.ts` | D | nowy | Kompilacja modułu bez `SMTP_HOST` | — |
| `mailpit.integration.spec.ts` | D | nowy | Lane integracyjny: pełna ścieżka decyzja → SMTP → Mailpit | — |

### Backend — wpięcia i kalendarz (`apps/tenant-runtime/src/`, bloki D, E)

| Plik | Blok | Rodzaj | Jedna odpowiedzialność | Kolizja |
|---|---|---|---|---|
| `leave/leave.service.ts` | D | zmiana | Powiadomienie po zapisanej decyzji urlopowej (`notifyDecision`) | **D×E (miękka)** — E czyta `LeaveService.getById` |
| `leave/leave.module.ts` | D | zmiana | Import `NotificationsModule` | **D×E** — E importuje `LeaveModule` w `KalendarzModule` |
| `leave/leave.notifications.spec.ts` | D | nowy | 5 testów powiadomienia przy decyzji urlopowej | — |
| `shift-swap/shift-swap.service.ts` | D | zmiana | Powiadomienie obu stron po decyzji managera | — |
| `shift-swap/shift-swap.module.ts` | D | zmiana | Import `NotificationsModule` | — |
| `shift-swap/shift-swap.notifications.spec.ts` | D | nowy | 4 testy powiadomienia przy zamianie zmiany | — |
| `kalendarz/ics.util.ts` | E | nowy | Generator RFC 5545 (funkcja czysta, zero PII) | — |
| `kalendarz/ics.util.spec.ts` | E | nowy | 12 testów prymitywów i budowy VCALENDAR | — |
| `kalendarz/ics-rfc5545.validator.ts` | E | nowy | Walidator strukturalny RFC 5545 (kryterium E-1) | — |
| `kalendarz/ics-rfc5545.validator.spec.ts` | E | nowy | 7 testów walidatora | — |
| `kalendarz/feed-token.util.ts` | E | nowy | Bezstanowy token subskrypcji (HMAC-SHA256) | — |
| `kalendarz/feed-token.util.spec.ts` | E | nowy | 7 testów tokenu, w tym podmiana ładunku | — |
| `kalendarz/kalendarz.config.ts` | E | nowy | Dostawca konfiguracji modułu (sekret + adres publiczny) | — |
| `kalendarz/kalendarz.service.ts` | E | nowy | Mapowanie statusów wniosku na RFC 5545 + projekcja odczytu bez PII | — |
| `kalendarz/kalendarz.service.spec.ts` | E | nowy | 8 testów odczytu, w tym kryterium E-4 | — |
| `kalendarz/kalendarz.controller.ts` | E | nowy | Trasy uwierzytelnione sesją (`moje.ics`, `subskrypcja`, `wniosek/:id`) | — |
| `kalendarz/kalendarz.controller.spec.ts` | E | nowy | 5 testów kontrolera | — |
| `kalendarz/kalendarz-feed.controller.ts` | E | nowy | Kanał subskrypcyjny — jedyna trasa poza `@TenantRoute()` | — |
| `kalendarz/kalendarz-feed.controller.spec.ts` | E | nowy | 6 testów kanału, w tym odmowa po podmianie tokenu | — |
| `kalendarz/kalendarz.module.ts` | E | nowy | Rejestracja kontrolerów i dostawcy konfiguracji | — |
| `app.module.ts` | E | zmiana | Rejestracja `KalendarzModule` | — |

**Plik nietykany przez żaden blok, świadomie:** `apps/tenant-runtime/src/strategic-brain/scoring.util.ts`. Bloki B, C, D i E mają w treści jawny krok dowodowy (`git diff --stat ... -- apps/tenant-runtime/src/strategic-brain/` → puste). Blok A nie wchodzi do `apps/tenant-runtime/` w ogóle.

---

## Graf zaleznosci i kolejnosc

### Co jest naprawdę niezależne

Bloki **C**, **D** i **E** nie mają między sobą żadnej zależności kodowej. Dotykają rozłącznych katalogów: C wyłącznie `apps/web/{lib,components,app,e2e}`, D wyłącznie `apps/tenant-runtime/src/{notifications,leave,shift-swap}` + compose, E `apps/tenant-runtime/src/kalendarz/` + `packages/config` + jedna trasa BFF. Trzy przecięcia są płytkie i wymienione niżej. Można je prowadzić równolegle, w osobnych worktree'ach.

Bloki **A** i **B** są niezależne od siebie w warstwie kodu (`scripts/` vs `scripts/audyt/`), ale **nie** w warstwie dokumentu: obie dopisują wiersz do tej samej tabeli w §8 raportu i obie wstawiają skrypty do tej samej sekcji `package.json`.

### Zależności twarde (nie da się odwrócić)

```
                    ┌──────────────────────────────────────────┐
   E (ICS)  ────────┤ dodaje 18. trasę BFF i 2 wpisy CHRONIONE  │
   D (email) ───────┤ dodaje 11. usługę compose (mailpit)       │
   C (personalizacja)│ nie zmienia inwentarzy                   │
                    └───────────────┬──────────────────────────┘
                                    │ stan produktu ZAMROŻONY
                                    ▼
                    A (pomiar + Zał. 6)  ──► §8 „Zał. 6"
                                    │
                                    ▼  (bramka: Krok 60 bloku B)
                    B (audyt + Zał. 7)   ──► §8 „Zał. 7"
                                    │
                                    ▼
                    Jedna przebudowa report.html + PDF na końcu
```

1. **B po A — zależność jawnie zakodowana w planie.** Krok 60 bloku B jest bramką: „Jeśli Zał. 6 nie ma na liście, blok A jeszcze nie wylądował: przerwij Zadanie 12 tutaj". Dwa bloki dopisujące wiersz do tej samej prostej tabeli pandoc (kolumna „Nr" o szerokości 12 znaków, druga kolumna od offsetu 15) wykonane równolegle dają albo konflikt scalania, albo dwa razy „Zał. 6". Zadania 7–17 bloku B (B-1..B-11) są od A **całkowicie niezależne** i mogą iść równolegle z A; zależne jest wyłącznie Zadanie 18 (B-12).
2. **A po E — zależność liczbowa, nieoczywista i najkosztowniejsza, jeśli ją przeoczyć.** Blok A przypina inwentarz BFF co do liczby i nazwy w **dwóch niezależnych implementacjach** (`apps/web/lib/api-gate.security.test.ts` → 17 tras wymienionych z nazwy, 14 bramkowanych, 3 publiczne; `scripts/bff-routes.test.mjs` → te same liczby) oraz w oczekiwanych wynikach `pnpm test:security` (`bff-route-sweep — 94`, `bff-middleware — 49`, sumarycznie `265 testów`). Blok E dodaje `apps/web/app/api/kalendarz/[[...path]]/route.ts` (18. trasa, 15 bramkowanych) i dwa wpisy do `CHRONIONE` w `middleware-api-gate.test.ts`. Jeśli A wyląduje pierwszy, każda z tych liczb zapali się na czerwono po bloku E — a Zał. 6 wydrukuje inwentarz, którego już nie ma. **Blok E przed blokiem A** albo świadoma korekta liczb A (patrz „Kolizje", pozycja K-1).
3. **A po D — z tego samego powodu, tylko łagodniej.** Blok D dodaje usługę `mailpit` do compose. Sonda nagłówków i pomiar wydajności bloku A tego nie widzą, ale `perf-smoke.json` zapisuje identyfikatory obrazów jako metrykę przebiegu, a Zał. 6 podaje je jako „wersję obrazu" — pomiar wykonany przed przebudową obrazu `tenant-runtime` (D zmienia jego `environment`, nie obraz) pozostaje ważny, natomiast pomiar wykonany przed blokiem E **nie** obejmuje trasy `/api/kalendarz`. Ryzyko niskie, ale stan mierzony ma być stanem oddawanym.
4. **B po D — inwentarz usług.** `EXPECTED_SERVICES` bloku B wymienia dokładnie 10 usług i jawnie uzasadnia, dlaczego `agent` się nie liczy (profil `agent`). Blok D dodaje `mailpit` za profilem `full`, czyli jedenastą usługę uruchamianą tą samą komendą, którą audyt zakłada w Kroku 40. Audyt nie zapali się na czerwono (iteruje po `EXPECTED_SERVICES`), ale **przemilczy** działającą usługę — a to jest dokładnie ten rodzaj niekompletności, którego audyt powdrożeniowy ma nie mieć. Decyzja: patrz K-6.
5. **Przebudowa PDF raportu — dokładnie raz, na samym końcu.** Bloki A (Krok 50), B (Krok 63) i E (Zadanie 10) każdy kończy się przebudową `body.html` → `report.html` → PDF. Wykonane po kolei nie psują się nawzajem (pandoc jest deterministyczny), ale trzy przebudowy to trzy okazje do zacommitowania PDF-a bez cudzej zmiany. Rekomendacja: przebudowa jednorazowa po ostatniej edycji `Raport_KM3_HRobot.md`.

### Zależności miękkie (kolejność wpływa na koszt, nie na poprawność)

6. **D przed E w obrębie `apps/tenant-runtime/src/leave/`.** Blok D zmienia `leave.module.ts` (dodaje `NotificationsModule` do `imports`) i konstruktor `LeaveService` (dodaje `@Optional() @Inject(NotificationService)`). Blok E importuje `LeaveModule` w `KalendarzModule` i woła `LeaveService.getById`. Zmiany są rozłączne tekstowo, ale scalanie w odwrotnej kolejności wymaga ręcznego przejrzenia obu diffów tego samego pliku.
7. **D przed E w `docker-compose.yml` i `.env.example`.** Obie wstawki do `environment` usługi `tenant-runtime` celują w ten sam kotwiczny wiersz `PORT: "3001"` (linia 149). Wykonane sekwencyjnie są bezkonfliktowe; równolegle dają konflikt scalania w jednym hunku.
8. **C niezależny od wszystkiego.** Jedyne przecięcie z resztą planu to §5 raportu i pomiar kotwic demo (Krok 6 zadania 10 bloku C oczekuje `39/1558`). Blok E tworzy i anuluje jeden wniosek urlopowy w E2E — inna tabela, kotwic nie rusza.

### Rekomendowana kolejność, uzasadniona ryzykiem

Spec zakłada „A i B pierwsze, bo nie dotykają produktu, więc są nieodwracalnie w kieszeni". To założenie jest **fałszywe w dwóch miejscach** i dlatego kolejność poniżej jest inna:
- Blok A **dotyka produktu** — zmienia `infra/caddy/Caddyfile`, czyli nagłówki każdej odpowiedzi HTTP na publicznym originie.
- Bloki A i B **mierzą produkt**, więc puszczone przed C/D/E produkują dokumenty odbiorcze opisujące stan, którego w chwili odbioru już nie będzie (17 tras zamiast 18, 10 usług zamiast 11).

Kolejność rozliczana ryzykiem, od najdroższego błędu do najtańszego:

| Faza | Bloki | Dlaczego tutaj |
|---|---|---|
| **1** | **E** (zadania 40–49) | Jedyny blok zmieniający inwentarz, na którym opiera się cały pomiar bloku A. Wykonany pierwszy, kosztuje jedną korektę liczb w planie A **przed** ich napisaniem; wykonany po A, kosztuje przepisanie dwóch testów, trzech asercji `test:security` i przedruk Zał. 6. |
| **2** | **D** (zadania 29–39) | Zmienia compose (11. usługa) i `.env.example`, czyli drugi inwentarz rozliczany w bloku B. Ta sama arytmetyka co wyżej, o rząd wielkości tańsza. Wchodzi przed C, bo dotyka backendu, a C wyłącznie frontu — konflikt niemożliwy. |
| **3** | **C** (zadania 19–28) | Nie zmienia żadnego inwentarza. Kolejność wobec D i E jest obojętna; idzie trzeci, bo jego jedyne przecięcie (§5 raportu) jest tańsze do rozstrzygnięcia, gdy pozostałe wpisy §5 są już znane. |
| **4** | **A** (zadania 1–6) | Pomiar i Zał. 6 na **zamrożonym** stanie produktu. Blok A zamyka fazę zmian produktowych własną zmianą w bramie (Caddyfile), która jest natychmiast mierzona przez własną sondę. |
| **5** | **B** (zadania 7–18) | Audyt powdrożeniowy z definicji audytuje stan końcowy. Zadanie 18 (B-12) wymaga istniejącego wiersza „Zał. 6", więc jest ostatnie także formalnie. |
| **6** | jednorazowa przebudowa `report.html` + PDF | Po ostatniej edycji `Raport_KM3_HRobot.md`, jednym z trzech skryptów wybranym w K-3. |

**Co można prowadzić równolegle bez ryzyka:** E ∥ D ∥ C (rozłączne katalogi, trzy przecięcia opisane wyżej wymagają wyłącznie sekwencyjnego scalania w `docker-compose.yml`, `.env.example` i `Raport_KM3_HRobot.md`). Zadania 7–17 bloku B (B-1..B-11) są niezależne od A i mogą iść równolegle z A; zależne jest wyłącznie Zadanie 18.

**Czego nie wolno prowadzić równolegle:** żadnych dwóch bloków edytujących `Raport_KM3_HRobot.md`, `package.json` ani `docker-compose.yml` — to trzy pliki jednego właściciela w każdym momencie.

---

## Blok A — Testy wydajności i bezpieczeństwa + raport końcowy (M3 g)

*Zadania globalne 1–6. Kroki numerowane ciągiem 1–52 w obrębie bloku.*

**Ustalenia zweryfikowane w repo i na żywym stosie** (`C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2`, gałąź `feat/demo-4mobility`, `docker ps`: 10 usług `healthy`, front za Caddy na `http://localhost:8080`, Keycloak na hoście `8081`, tenant-runtime `3001` z prefiksem `/api`).

1. **Tras pod `apps/web/app/api` jest dokładnie 17** — ale **nie każda ma zwrócić 401**. Trzy są świadomie publiczne (`PUBLICZNE_API` w `apps/web/lib/api-gate.ts`): `/api/auth/signup`, `/api/slugs/check/[slug]`, `/api/provision/status/[jobId]` — kroki przed-uwierzytelnieniowe rejestracji, nie sięgają backendu i nie dotykają danych osobowych. Pomiar na żywo, bez ciasteczka: 14 tras → **401**, `/api/slugs/check/acme` → **200**, `/api/provision/status/job-1` → **200**, `GET /api/auth/signup` → **405** (trasa eksportuje wyłącznie `POST`). Podział **14 bramkowanych / 3 publiczne** przypinamy co do liczby i nazwy.

2. **Co naprawdę istnieje, a czego brakuje w testach BFF.** `apps/web/lib/api-gate.test.ts` (19 testów, zielony) **już odkrywa trasy z dysku** (funkcja `apiRoutes()`, `readdirSync` po `app/api`) i już przypina zbiór publiczny (`OCZEKIWANE_PUBLICZNE`) w obie strony — twierdzenie, że nowość polega na „odkrywaniu z dysku”, byłoby fałszywe. Ten plik sprawdza jednak wyłącznie **predykaty polityki**, nigdy nie uruchamia bramki. `apps/web/lib/middleware-api-gate.test.ts` (44 testy) uruchamia REALNY `middleware()`, ale po **liście 17 adresów zaszytej w kodzie** (`CHRONIONE`) i **tylko metodą GET**. Realna luka, którą domyka Zadanie 3, brzmi więc: *żaden test nie uruchamia realnego `middleware()` po trasach odkrytych z dysku ani po metodach innych niż GET*.

3. **`autocannon` v8 nie publikuje p95.** Zweryfikowane przebiegiem `-j` na v8.0.0: obiekt `latency` zawiera `average, mean, stddev, min, max, p0_001, p0_01, p0_1, p1, p2_5, p10, p25, p50, p75, p90, p97_5, p99, p99_9, p99_99, p99_999, totalCount` — **p95 nie występuje**, a `--help` v8 nie ma żadnej flagi wyboru percentyli (przejrzane w całości). Raport podaje **p50 / p90 / p97,5 / p99**, a próg akceptacji rozliczamy na **p97,5** — wartości ostrzejszej niż p95, więc próg spełniony na p97,5 jest spełniony i na p95. Raport mówi to wprost, zamiast podpisywać cudzą liczbę pod etykietą „p95”.

4. **Dwie ścieżki wydajnościowe wymagają tokenu.** Bez tokenu `/api/grafik/shifts` → 401 i `/api/strategic-brain/overview` → 401. Z tokenem direct grantu (`hrobot-staging`, klient `hrobot-web`, konto `demo`, hasło `demo-staging-2026` = domyślne `KEYCLOAK_DEMO_PASSWORD` z `docker-compose.yml`) obie → **200** (odpowiednio 591 234 B i 19 008 B).

5. **`npx.cmd` nie da się uruchomić z `spawn` na Node 22** (`EINVAL`, mitygacja CVE-2024-27980). Wariant zweryfikowany przebiegiem: `spawnSync(process.execPath, ['<node_modules/npm/bin/npx-cli.js>', '--yes', 'autocannon@8', …])`, bez `shell:true`. Ścieżka istnieje: `C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js`. Uwaga: na Linuksie/macOS npm leży w `<node>/../lib/node_modules/npm`, więc skrypt sprawdza obie lokalizacje.

6. **Nagłówki bezpieczeństwa nie istnieją.** Pomiar na żywo: `GET /login` → 200 **bez** `x-frame-options`, **bez** `content-security-policy`, **bez** `x-content-type-options`, **bez** `referrer-policy`, za to z `x-powered-by: Next.js`; `GET /dashboard` → 307 również bez żadnego z nich. To jest druga pozycja punktu „Bezpieczeństwo” specu i **jedyna luka bloku A bez pokrycia** — domyka ją Zadanie 4. Bramą jest Caddy (`infra/caddy/Caddyfile` montowany do kontenera jako wolumin), więc zmiana wchodzi przez `caddy reload` bez przebudowy jakiegokolwiek obrazu. Wariant zweryfikowany na kontenerze-sondzie `caddy:2-alpine` w sieci `hrobot_default`: wszystkie pięć nagłówków pojawia się na `/login` (200), `/dashboard` (307) i `/api/employees` (401), a `x-powered-by` znika.

7. **`stt-service` nie ma wirtualnego środowiska** (`agent-service/.venv` jest, `stt-service/.venv` nie), a `tenant-isolation.integration.spec.ts` pomija się bez `POSTGRES_SUPERUSER_URL`. Obie pozycje są w zestawie, ale z jawnym statusem `POMINIETY` + powodem w JSON-ie i w raporcie — nie udajemy, że przeszły.

8. **Kotwice demo w raporcie KM3 są nieaktualne.** `Raport_KM3_HRobot.md:227` i `:406` mówią „36 pracowników, 832 zmiany”; żywy stos zwraca **39 pracowników i 1558 zmian** (policzone z `/api/employees` i `/api/grafik/shifts` z tokenem: `employees 39`, `shifts 1558`), zgodnie z kotwicami z `docs/demo/2026-08-10-demo-4mobility-parp.md:48`. Zał. 6 wydrukuje liczby zmierzone, więc rozjazd byłby w jednym pakiecie dla PARP. Zadanie 6 koryguje te dwie liczby — nie przepisuje §5.

**Fakty potwierdzone przebiegiem, na których stoi plan:**

| Fakt | Jak sprawdzony |
|---|---|
| `docs/raport-km3/build/print-km3.mjs` (Chrome CDP, logo w nagłówku, stopka ze stronami) | przeczytany |
| `report.html` = `<!doctype…><title>…</title>\n` + `build/style.html` + `</head><body>\n` + `build/body.html` + `</body></html>\n` | porównanie bajt-w-bajt w Node: **zgodne co do znaku** (31 671 B) |
| `pandoc 3.9` produkuje `<span class="lbl">`, `<div class="keep">`, twarde łamania `\` | przebieg na próbce |
| `node --test <katalog>` **nie działa** na Node 22.12 (`Cannot find module <katalog>`) | przebieg |
| `node --test` liczy testy zbiorczo (`# pass N`), a plik, który nie ładuje się przez brak modułu, daje `# tests 1 / # fail 1` | przebieg |
| autocannon `-H K=V`, `-n`, `-j`; wersja 8.0.0 | `--help` + przebieg |
| `apps/web/node_modules/vitest/vitest.mjs`, `apps/tenant-runtime/node_modules/jest/bin/jest.js`, `packages/shared/node_modules/jest/bin/jest.js` | `fs.existsSync` = true dla wszystkich trzech |
| `jest 29.7.0` (`--testPathPattern` działa bez ostrzeżenia), `vitest 2.1.9`, `pytest`, `Node 22.12`, `pnpm 10.30.3` | przebiegi |

**Istniejące testy bezpieczeństwa (uruchomione, zielone, liczby zmierzone):**

| Pakiet | Zmierzone |
|---|---|
| `apps/web/lib/api-gate.test.ts` | 19 |
| `apps/web/lib/middleware-api-gate.test.ts` | 44 |
| `apps/web/lib/middleware-matcher.test.ts` | 5 |
| `apps/web/lib/tenant-runtime.test.ts` | 27 |
| `rbac.guard` + `keycloak-jwt.strategy` + `tenant-context.interceptor` | 3 zestawy, 26 |
| `audit.interceptor` + `audit.service` | 2 zestawy, 5 |
| `strategic-brain/write-boundary` + `dokumenty/dokumenty-no-send` | 2 zestawy, 6 |
| `packages/shared/src/encryption.test.ts` | 13 |
| `agent-service`: `test_auth` + `test_auth_issuer` + `test_demo_router_auth` + `test_tenant_isolation` | 18 |

---

### Zadanie 1 (A-1): Budżety wydajnościowe i podsumowanie przebiegu (moduł czysty + TDD)

**Pliki:**
- Utwórz: `scripts/lib/perf-budget.mjs`
- Test: `scripts/perf-budget.test.mjs`

- [ ] **Krok 1: Napisz czerwony test budżetów.** Utwórz `scripts/perf-budget.test.mjs`:
  ```js
  // Testy jednostkowe modulu budzetow wydajnosciowych. Brak sieci — czysta arytmetyka werdyktu.
  import { test } from 'node:test'
  import assert from 'node:assert/strict'
  import { PERF_TARGETS, summariseRun } from './lib/perf-budget.mjs'

  /** Wynik autocannon-a zawezony do pol, ktorych uzywa summariseRun (nazwy 1:1 z realnym `-j`). */
  function fakeResult({ p50 = 10, p90 = 20, p97_5 = 30, p99 = 40, ok = 100, non2xx = 0, errors = 0, timeouts = 0 }) {
    return {
      connections: 10,
      duration: 30,
      '2xx': ok,
      non2xx,
      errors,
      timeouts,
      requests: { average: 123.456 },
      latency: { p50, p90, p97_5, p99 },
    }
  }

  test('PERF_TARGETS to dokladnie trzy sciezki z briefu M3 g', () => {
    assert.equal(PERF_TARGETS.length, 3)
    assert.deepEqual(
      PERF_TARGETS.map((t) => [t.id, t.path, t.connections, t.durationSec, t.budgetMs, t.auth]),
      [
        ['grafik-shifts', '/api/grafik/shifts', 10, 30, 800, true],
        ['strategic-brain-overview', '/api/strategic-brain/overview', 5, 30, 3000, true],
        ['login-ssr', '/login', 20, 30, 500, false],
      ],
    )
  })

  test('werdykt OK gdy p97,5 miesci sie w budzecie i nie ma odpowiedzi spoza 2xx', () => {
    const s = summariseRun(PERF_TARGETS[0], fakeResult({ p97_5: 551 }))
    assert.equal(s.verdict, 'OK')
    assert.equal(s.p97_5, 551)
    assert.equal(s.budgetMs, 800)
    assert.equal(s.durationSec, 30)
    assert.equal(s.nonOk, 0)
    assert.equal(s.rps, 123.5)
  })

  test('werdykt PRZEKROCZONY gdy p97,5 przebija budzet', () => {
    const s = summariseRun(PERF_TARGETS[2], fakeResult({ p97_5: 501 }))
    assert.equal(s.verdict, 'PRZEKROCZONY')
  })

  test('werdykt BLAD gdy pojawily sie odpowiedzi spoza 2xx, nawet przy szybkich czasach', () => {
    const s = summariseRun(PERF_TARGETS[1], fakeResult({ p97_5: 5, non2xx: 3 }))
    assert.equal(s.verdict, 'BLAD')
    assert.equal(s.nonOk, 3)
  })

  test('bledy transportowe i timeouty licza sie do nonOk', () => {
    const s = summariseRun(PERF_TARGETS[1], fakeResult({ errors: 2, timeouts: 1 }))
    assert.equal(s.nonOk, 3)
    assert.equal(s.verdict, 'BLAD')
  })
  ```

- [ ] **Krok 2: Zobacz, że pada.** Uruchom `node --test scripts/perf-budget.test.mjs`.
  Oczekiwane dokładnie: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…\scripts\lib\perf-budget.mjs' imported from …\scripts\perf-budget.test.mjs`, a w podsumowaniu `# tests 1`, `# pass 0`, `# fail 1`.
  (Jeden, nie pięć: plik się nie ładuje, więc `node --test` raportuje jako nieudany **cały plik**, a nie poszczególne testy. Zweryfikowane na Node 22.12.)

- [ ] **Krok 3: Napisz moduł.** Utwórz `scripts/lib/perf-budget.mjs`:
  ```js
  // Budzety wydajnosciowe M3 g i przeliczenie surowego wyniku `autocannon -j` na jeden wiersz raportu.
  //
  // DLACZEGO p97,5, A NIE p95. autocannon v8.0.0 zwraca w `latency` percentyle
  // p0_001 p0_01 p0_1 p1 p2_5 p10 p25 p50 p75 p90 p97_5 p99 p99_9 p99_99 p99_999 — p95 NIE ISTNIEJE,
  // a `--help` v8 nie ma zadnej flagi wyboru percentyli (sprawdzone w calosci). p97_5 jest wartoscia
  // OSTRZEJSZA niz p95, wiec prog spelniony na p97,5 jest spelniony rowniez na p95 — rozliczamy
  // zmierzone, nie zyczone.
  //
  // Progi ponizej sa WSTEPNE: pierwszy przebieg je kalibruje, a raport podaje liczbe i wniosek.
  // Jesli pomiar wypadnie gorzej, poprawiamy system albo opisujemy wynik — nie prog.

  export const PERF_TARGETS = [
    { id: 'grafik-shifts', label: 'GET /api/grafik/shifts', path: '/api/grafik/shifts', connections: 10, durationSec: 30, budgetMs: 800, auth: true },
    { id: 'strategic-brain-overview', label: 'GET /api/strategic-brain/overview', path: '/api/strategic-brain/overview', connections: 5, durationSec: 30, budgetMs: 3000, auth: true },
    { id: 'login-ssr', label: 'GET /login (SSR)', path: '/login', connections: 20, durationSec: 30, budgetMs: 500, auth: false },
  ]

  /**
   * Jeden wiersz raportu z surowego wyniku autocannon-a. Werdykt ma trzy stany, bo „szybko, ale
   * polowa odpowiedzi to 401" nie jest sukcesem wydajnosciowym — to zepsuty pomiar.
   */
  export function summariseRun(target, result) {
    const latency = result.latency
    const nonOk = (result.non2xx ?? 0) + (result.errors ?? 0) + (result.timeouts ?? 0)
    let verdict = 'OK'
    if (nonOk > 0) verdict = 'BLAD'
    else if (latency.p97_5 > target.budgetMs) verdict = 'PRZEKROCZONY'

    return {
      id: target.id,
      label: target.label,
      path: target.path,
      connections: result.connections,
      durationSec: result.duration,
      requests2xx: result['2xx'] ?? 0,
      nonOk,
      rps: Number(result.requests.average.toFixed(1)),
      p50: latency.p50,
      p90: latency.p90,
      p97_5: latency.p97_5,
      p99: latency.p99,
      budgetMs: target.budgetMs,
      verdict,
    }
  }
  ```

- [ ] **Krok 4: Zobacz zielone.** `node --test scripts/perf-budget.test.mjs` → `# tests 5`, `# pass 5`, `# fail 0`.

- [ ] **Krok 5: Commit.** `git add scripts/lib/perf-budget.mjs scripts/perf-budget.test.mjs; git commit -m "test(km3-a): budzety wydajnosciowe M3 g + werdykt przebiegu"`

---

### Zadanie 2 (A-2): `scripts/perf-smoke.mjs` — realny pomiar trzech ścieżek

**Pliki:**
- Utwórz: `scripts/perf-smoke.mjs`
- Utwórz (wynik przebiegu): `docs/raport-km3/build/perf-smoke.json`
- Zmień: `package.json` (korzeń, skrypt `test:perf`)

- [ ] **Krok 6: Napisz skrypt pomiarowy.** Utwórz `scripts/perf-smoke.mjs`:
  ```js
  #!/usr/bin/env node
  // M3 g — pomiar wydajnosci trzech sciezek produktu przez `autocannon` (npx, bez instalacji do repo).
  //
  // DLACZEGO PRZEZ node + npx-cli.js, A NIE `spawn('npx')`. Node 22 odmawia uruchomienia `.cmd`
  // bez `shell:true` (mitygacja CVE-2024-27980) — `spawnSync('npx.cmd', …)` konczy sie EINVAL.
  // Uruchamiamy wiec bezposrednio JS-owy entrypoint npx biezacym interpreterem: bez powloki,
  // bez cytowania argumentow, identycznie na kazdym hoscie.
  //
  // DWIE Z TRZECH SCIEZEK WYMAGAJA SESJI. middleware.ts 401-uje anonima na /api/**, wiec skrypt
  // bije token direct grantem z Keycloak i podaje go naglowkiem.
  //
  // UCZCIWIE O TOKENIE: token NIE trafia do stdout skryptu ani do pliku JSON (tam laduje wylacznie
  // fakt `auth: true`). Trafia natomiast do `argv` procesu potomnego autocannon-a, wiec przez czas
  // przebiegu jest widoczny w liscie procesow systemu (`tasklist` / `ps`). To konto DEMO na
  // srodowisku demonstracyjnym; na jakimkolwiek innym srodowisku podaj wlasne PERF_USERNAME/
  // PERF_PASSWORD i traktuj host pomiarowy jak zaufany.
  //
  // Uzycie:
  //   node scripts/perf-smoke.mjs                 # pelny przebieg 3 x 30 s
  //   node scripts/perf-smoke.mjs --duration 5    # skrocony przebieg dymny (kalibracja)
  //
  // Env (domyslne wartosci = zywy stos demo `docker compose -p hrobot --profile full`):
  //   PERF_BASE_URL       http://localhost:8080          (Caddy → web:3000)
  //   PERF_TOKEN_URL      http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token
  //   PERF_CLIENT_ID      hrobot-web
  //   PERF_USERNAME       demo
  //   PERF_PASSWORD       demo-staging-2026

  import { spawnSync } from 'node:child_process'
  import fs from 'node:fs'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'
  import { PERF_TARGETS, summariseRun } from './lib/perf-budget.mjs'

  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const OUT = path.join(ROOT, 'docs', 'raport-km3', 'build', 'perf-smoke.json')

  /**
   * Entrypoint npx. Na Windows npm siedzi obok binarki node (C:\Program Files\nodejs\node_modules),
   * na Linuksie/macOS o poziom wyzej w lib/. Sprawdzamy obie lokalizacje i mowimy wprost, gdy nie ma
   * zadnej — cichy fallback dalby EINVAL kilka linijek dalej i nikt by nie wiedzial dlaczego.
   */
  function resolveNpxCli() {
    const nodeDir = path.dirname(process.execPath)
    const candidates = [
      path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
      path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    ]
    const found = candidates.find((c) => fs.existsSync(c))
    if (!found) throw new Error(`Nie znalazlem npx-cli.js. Sprawdzone: ${candidates.join(' | ')}`)
    return found
  }

  const NPX_CLI = resolveNpxCli()

  const args = process.argv.slice(2)
  let DURATION_OVERRIDE = null
  if (args.includes('--duration')) {
    const raw = args[args.indexOf('--duration') + 1]
    DURATION_OVERRIDE = Number(raw)
    if (!Number.isFinite(DURATION_OVERRIDE) || DURATION_OVERRIDE <= 0) {
      throw new Error(`--duration wymaga dodatniej liczby sekund, dostalem: ${raw}`)
    }
  }

  const BASE_URL = (process.env.PERF_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '')
  const TOKEN_URL = process.env.PERF_TOKEN_URL ?? 'http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token'
  const CLIENT_ID = process.env.PERF_CLIENT_ID ?? 'hrobot-web'
  const USERNAME = process.env.PERF_USERNAME ?? 'demo'
  const PASSWORD = process.env.PERF_PASSWORD ?? 'demo-staging-2026'

  /** Token dostepowy dla konta demo. Rzuca z czytelnym powodem — brak tokenu = brak pomiaru. */
  async function mintToken() {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT_ID, username: USERNAME, password: PASSWORD }),
    })
    if (!res.ok) throw new Error(`Keycloak ${res.status} przy ${TOKEN_URL} — czy stos stoi i czy konto ${USERNAME} istnieje?`)
    const body = await res.json()
    if (!body.access_token) throw new Error('Keycloak nie zwrocil access_token')
    return body.access_token
  }

  /** Identyfikator obrazu kontenera — „wersja obrazu" w metryce raportu. null gdy brak dockera. */
  function imageId(container) {
    const r = spawnSync('docker', ['inspect', '--format', '{{.Image}}', container], { encoding: 'utf8' })
    if (r.status !== 0 || !r.stdout) return null
    return r.stdout.trim()
  }

  function gitSha() {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
    return r.status === 0 ? r.stdout.trim() : null
  }

  /** Jeden przebieg autocannon-a. Zwraca sparsowany wynik `-j`. */
  function runAutocannon(target, token) {
    const durationSec = DURATION_OVERRIDE ?? target.durationSec
    const argv = [
      NPX_CLI, '--yes', 'autocannon@8',
      '-d', String(durationSec),
      '-c', String(target.connections),
      '-n', '-j',
    ]
    if (target.auth) argv.push('-H', `authorization=Bearer ${token}`)
    argv.push(`${BASE_URL}${target.path}`)

    const r = spawnSync(process.execPath, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (r.status !== 0) throw new Error(`autocannon zakonczyl sie kodem ${r.status} dla ${target.path}: ${r.stderr ?? ''}`)
    const start = r.stdout.indexOf('{')
    if (start < 0) throw new Error(`autocannon nie zwrocil JSON-a dla ${target.path}`)
    return JSON.parse(r.stdout.slice(start))
  }

  const token = await mintToken()
  const runs = []
  for (const target of PERF_TARGETS) {
    process.stdout.write(`[perf] ${target.label} — ${target.connections} pol., ${DURATION_OVERRIDE ?? target.durationSec} s\n`)
    runs.push(summariseRun(target, runAutocannon(target, token)))
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    tool: 'autocannon@8 (npx)',
    percentileNote:
      'autocannon v8 zwraca p0_001…p99_999 (m.in. p50/p75/p90/p97_5/p99) — p95 nie wystepuje w histogramie i CLI nie ma flagi wyboru percentyli. Prog rozliczany na p97,5, czyli wartosci ostrzejszej niz p95.',
    gitSha: gitSha(),
    images: { web: imageId('hrobot-web-1'), tenantRuntime: imageId('hrobot-tenant-runtime-1') },
    runs,
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  for (const run of runs) {
    process.stdout.write(`[perf] ${run.label}: p50=${run.p50} p90=${run.p90} p97,5=${run.p97_5} p99=${run.p99} ms · ${run.rps} rps · ${run.verdict}\n`)
  }
  process.stdout.write(`[perf] ZAPISANO ${OUT}\n`)

  // Kod wyjscia rozlicza progi, ale JSON zapisuje sie ZAWSZE — raport ma miec liczbe takze wtedy,
  // gdy przebieg wypadl zle. To jest cala roznica miedzy pomiarem a zyczeniem.
  process.exit(runs.every((r) => r.verdict === 'OK') ? 0 : 1)
  ```

- [ ] **Krok 7: Dodaj `test:perf` do korzenia.** W `package.json`, w `"scripts"`, zaraz po wierszu `"test:e2e:smoke": "node scripts/e2e-smoke.mjs",`, wstaw:
  ```json
    "test:perf": "node scripts/perf-smoke.mjs",
  ```

- [ ] **Krok 8: Przebieg skrócony — zobacz, że skrypt mierzy naprawdę.** Przy stojącym stosie uruchom `node scripts/perf-smoke.mjs --duration 5`.
  Bramka przejścia (sprawdzana wzrokowo, nie „mniej więcej”): trzy wiersze `[perf] <label>: p50=… p90=… p97,5=… p99=… ms · … rps · OK`, wiersz `[perf] ZAPISANO …\perf-smoke.json`, kod wyjścia **0**. Każde `p97,5` musi być liczbą, a każdy werdykt musi brzmieć `OK`. Wartości odniesienia zmierzone na tym stosie mieszczą się w budżetach 800/3000/500 ms; jeśli któraś nie mieści się, przechodzimy do Kroku 10 z werdyktem `PRZEKROCZONY` i opisujemy pomiar — **nie podnosimy progu**.

- [ ] **Krok 9: Weryfikacja negatywna — skrypt musi umieć zapalić się na czerwono.** Uruchom w PowerShellu z chwilowo zaniżonym budżetem:
  ```powershell
  node -e "const fs=require('fs');const p='scripts/lib/perf-budget.mjs';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('budgetMs: 500','budgetMs: 1'));"
  node scripts/perf-smoke.mjs --duration 5
  Write-Host "EXIT=$LASTEXITCODE"
  git checkout -- scripts/lib/perf-budget.mjs
  ```
  Oczekiwane: wiersz `[perf] GET /login (SSR): … PRZEKROCZONY` oraz `EXIT=1`. Bez tego kroku zielony przebieg nie dowodzi niczego. (`git checkout` działa, bo plik został zacommitowany w Kroku 5.)

- [ ] **Krok 10: Pełny przebieg 3 × 30 s i commit wyniku.** `node scripts/perf-smoke.mjs` → kod 0, `docs/raport-km3/build/perf-smoke.json` z trzema wpisami w `runs` oraz niepustymi `gitSha`, `images.web`, `images.tenantRuntime`. Potem:
  ```powershell
  git add scripts/perf-smoke.mjs package.json docs/raport-km3/build/perf-smoke.json
  git commit -m "feat(km3-a): pomiar wydajnosci 3 sciezek autocannonem + zapis przebiegu"
  ```

---

### Zadanie 3 (A-3): Przemiatarka wszystkich tras BFF przez realny `middleware()`

**Pliki:**
- Utwórz: `apps/web/lib/api-gate.security.test.ts` (test jest produktem tego zadania)

- [ ] **Krok 11: Napisz czerwoną przemiatarkę.** Utwórz `apps/web/lib/api-gate.security.test.ts`:
  ```ts
  import { readdirSync } from 'node:fs'
  import { fileURLToPath } from 'node:url'
  import { NextRequest } from 'next/server'
  import { describe, expect, it } from 'vitest'
  import { middleware } from '../middleware'
  import { isPublicApiPath } from './api-gate'

  /**
   * [M3 g] PRZEMIATARKA CALEJ POWIERZCHNI BFF — dowod do Zal. 6 raportu KM3.
   *
   * CZEGO NIE MA W ISTNIEJACYCH TESTACH. lib/api-gate.test.ts JUZ odkrywa trasy z dysku i JUZ
   * przypina zbior publiczny w obie strony — ale sprawdza wylacznie PREDYKATY polityki, nigdy nie
   * uruchamia bramki. lib/middleware-api-gate.test.ts uruchamia REALNY middleware(), ale po LISCIE
   * ADRESOW zaszytej w kodzie (`CHRONIONE`) i wylacznie metoda GET.
   *
   * Luka, ktora ten plik zamyka, jest wiec dokladnie ta: nikt nie uruchamia REALNEGO middleware()
   * po trasach ODKRYTYCH Z DYSKU ani po metodach innych niz GET. Nowa trasa pod app/api/ jest tu
   * objeta automatycznie, a POST/PATCH/DELETE sa sprawdzane tak samo jak GET.
   *
   * NIE KAZDA TRASA MA ZWRACAC 401. Trzy z siedemnastu sa swiadomie publiczne (PUBLICZNE_API
   * w lib/api-gate.ts) — to kroki PRZED uwierzytelnieniem w rejestracji, ktore nie siegaja backendu
   * i nie dotykaja danych osobowych. Sa tu wymienione z nazwy i przypiete co do liczby.
   */

  const webRoot = fileURLToPath(new URL('..', import.meta.url))

  /** Kazdy `route.ts` pod app/api/, jako sciezka URL z zachowanymi segmentami dynamicznymi. */
  function discoverApiRoutes(): string[] {
    const found: string[] = []
    const walk = (relative: string) => {
      for (const entry of readdirSync(`${webRoot}app/api${relative}`, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${relative}/${entry.name}`)
        else if (entry.name === 'route.ts') found.push(`/api${relative}`)
      }
    }
    walk('')
    return found.sort()
  }

  /**
   * Zamienia wzorzec trasy na KONKRETNY adres, ktory Next dopasuje do tej samej trasy:
   *   [[...path]] → segment znika (opcjonalny catch-all lapie takze brak segmentu),
   *   [...path]   → jeden segment sondy (wymagany catch-all potrzebuje co najmniej jednego),
   *   [jobId]     → jeden segment sondy.
   */
  function materialiseRoute(routePath: string): string {
    const segments = routePath
      .split('/')
      .filter(Boolean)
      .flatMap((segment) => {
        if (/^\[\[\.\.\..+\]\]$/.test(segment)) return []
        const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment)
        if (catchAll) return [`sonda-${catchAll[1]}`]
        const dynamic = /^\[(.+)\]$/.exec(segment)
        if (dynamic) return [`sonda-${dynamic[1]}`]
        return [segment]
      })
    return `/${segments.join('/')}`
  }

  function request(path: string, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(new Request(`http://localhost:5601${path}`, { headers }))
  }

  const ROUTES = discoverApiRoutes()
  const ADRESY = ROUTES.map((route) => ({ route, url: materialiseRoute(route) }))
  const BRAMKOWANE = ADRESY.filter(({ url }) => !isPublicApiPath(url))
  const PUBLICZNE = ADRESY.filter(({ url }) => isPublicApiPath(url))

  describe('materialiseRoute', () => {
    it('usuwa opcjonalny catch-all, bo trasa lapie takze goly prefiks', () => {
      expect(materialiseRoute('/api/employees/[[...path]]')).toBe('/api/employees')
    })

    it('podstawia jeden segment pod wymagany catch-all', () => {
      expect(materialiseRoute('/api/grafik/[...path]')).toBe('/api/grafik/sonda-path')
    })

    it('podstawia jeden segment pod parametr nazwany', () => {
      expect(materialiseRoute('/api/provision/status/[jobId]')).toBe('/api/provision/status/sonda-jobId')
    })

    it('nie rusza segmentow statycznych', () => {
      expect(materialiseRoute('/api/voice/transcribe')).toBe('/api/voice/transcribe')
    })
  })

  describe('powierzchnia BFF — inwentarz', () => {
    // KOTWICA NAZW. Kryterium odbioru M3 g brzmi „test wymienia trasy z nazwy", wiec wymieniamy je
    // co do znaku. Nowa trasa zapala ten test CELOWO: ma trafic do Zal. 6 swiadomie, a nie po cichu.
    it('pod app/api jest dokladnie 17 tras, wymienionych z nazwy', () => {
      expect(ROUTES).toEqual([
        '/api/agent-glosowy/[[...path]]',
        '/api/ai-grafik/[[...path]]',
        '/api/analityk/[[...path]]',
        '/api/auth/signup',
        '/api/dokumenty/[[...path]]',
        '/api/dostepy/[[...path]]',
        '/api/employees/[[...path]]',
        '/api/grafik/[...path]',
        '/api/koszty/[[...path]]',
        '/api/provision/status/[jobId]',
        '/api/shift-swap/[[...path]]',
        '/api/slugs/check/[slug]',
        '/api/strategic-brain/[[...path]]',
        '/api/ustawienia/[[...path]]',
        '/api/uzytkownicy/[[...path]]',
        '/api/voice/transcribe',
        '/api/wnioski/[[...path]]',
      ])
    })

    it('14 tras jest bramkowanych, 3 sa publiczne i wymienione z nazwy', () => {
      expect(BRAMKOWANE).toHaveLength(14)
      expect(PUBLICZNE.map((a) => a.route)).toEqual([
        '/api/auth/signup',
        '/api/provision/status/[jobId]',
        '/api/slugs/check/[slug]',
      ])
    })
  })

  describe('kazda bramkowana trasa BFF odmawia anonimowi', () => {
    it.each(BRAMKOWANE.map(({ route, url }) => [route, url]))(
      '%s (%s) → 401 bez ciasteczka sesji',
      async (_route, url) => {
        const res = middleware(request(url))
        expect(res.status).toBe(401)
        expect(await res.json()).toMatchObject({ error: 'unauthenticated' })
        // Brak naglowka rewrite = zadanie NIE dotarlo do handlera, a nie „handler odpowiedzial 401".
        expect(res.headers.get('x-middleware-next')).toBeNull()
      },
    )

    it.each(
      BRAMKOWANE.flatMap(({ url }) => ['GET', 'POST', 'PATCH', 'DELETE'].map((method) => [url, method])),
    )('%s odmawia rowniez metodzie %s', (url, method) => {
      const res = middleware(new NextRequest(new Request(`http://localhost:5601${url}`, { method })))
      expect(res.status).toBe(401)
    })
  })

  describe('[KONTROLA NEGATYWNA] przemiatarka wykrywa bramkowanie, nie odmawia wszystkiemu', () => {
    it.each(BRAMKOWANE.map(({ url }) => url))('%s przepuszcza zadanie z ciasteczkiem sesji', (url) => {
      const res = middleware(request(url, { cookie: 'hrobot_token=jwt' }))
      expect(res.headers.get('x-middleware-next')).toBe('1')
    })

    it.each(PUBLICZNE.map(({ url }) => url))('%s pozostaje otwarta bez zadnych powiadczen', (url) => {
      const res = middleware(request(url))
      expect(res.headers.get('x-middleware-next')).toBe('1')
    })
  })
  ```

- [ ] **Krok 12: Zobacz, że pada, zanim uwierzysz, że działa.** Zepsuj bramkę na chwilę — w `apps/web/lib/api-gate.ts` zamień ciało `apiRequestIsAllowed` na `return true`, po czym `cd apps/web; node node_modules/vitest/vitest.mjs run lib/api-gate.security.test.ts`.
  Oczekiwane: **70 nieudanych** przypadków — 14 z bloku „odmawia anonimowi” (`expected 200 to be 401`) plus 56 z wariantu metod; bloki `materialiseRoute`, „inwentarz” i „KONTROLA NEGATYWNA” pozostają zielone (partycja na 14/3 opiera się na `isPublicApiPath`, nietkniętym).
  Cofnij: `git checkout -- lib/api-gate.ts`.

- [ ] **Krok 13: Zobacz zielone.** `cd apps/web; node node_modules/vitest/vitest.mjs run lib/api-gate.security.test.ts` → `Test Files 1 passed (1)` i `Tests 94 passed (94)`.
  Rozbiór: 4 (materialiseRoute) + 2 (inwentarz) + 14 (anonim) + 56 (14 tras × 4 metody) + 14 (kontrola z ciasteczkiem) + 3 (publiczne) + 1 (kotwica nazw jest jednym z dwóch testów inwentarza — patrz wyżej) = **94**. Struktura bez kotwicy nazw została zmierzona przebiegiem na tym repo i dała 93; kotwica dokłada dokładnie jeden.

- [ ] **Krok 14: Sprawdź, że nowy plik wchodzi do domyślnego pakietu.** `cd apps/web; node node_modules/vitest/vitest.mjs run 2>&1 | Select-String "api-gate.security"` → wiersz `✓ lib/api-gate.security.test.ts`. Wzorzec `include` w `apps/web/vitest.config.ts` to `['lib/**/*.test.ts', 'components/**/*.test.ts']`, więc pierwszy wzorzec obejmuje nowy plik i **żadna zmiana konfiguracji nie jest potrzebna**.

- [ ] **Krok 15: Commit.** `git add apps/web/lib/api-gate.security.test.ts; git commit -m "test(km3-a): realny middleware po wszystkich trasach BFF odkrytych z dysku, 4 metody"`

---

### Zadanie 4 (A-4): Nagłówki bezpieczeństwa na brzegu (`/login`, `/dashboard`, `/api/**`)

To jest luka, której oryginalny plan nie miał w ogóle. Spec Bloku A wymienia dwa nowe testy bezpieczeństwa, nie jeden: przemiatarkę tras **oraz** nagłówki odpowiedzi. Pomiar na żywo potwierdził, że dziś nie ma ani jednego nagłówka bezpieczeństwa, a `x-powered-by: Next.js` wycieka.

**Pliki:**
- Utwórz: `scripts/lib/security-headers.mjs`
- Test: `scripts/security-headers.test.mjs`
- Zmień: `infra/caddy/Caddyfile`

- [ ] **Krok 16: Zmierz stan wyjściowy i zapisz go do notatki roboczej.** Uruchom:
  ```powershell
  node -e "(async()=>{for(const u of ['/login','/dashboard']){const r=await fetch('http://localhost:8080'+u,{redirect:'manual'});console.log('===',u,r.status);for(const [k,v] of r.headers)console.log('   ',k,':',v)}})()"
  ```
  Oczekiwane (stan sprzed zmiany, zmierzony): `/login` → 200 i `/dashboard` → 307, w obu wypadkach **brak** `x-frame-options`, `content-security-policy`, `x-content-type-options`, `referrer-policy`, a na `/login` obecny `x-powered-by: Next.js`. To jest dowód, że luka jest realna — przepisz wyjście do Zał. 6 §5 jako stan „przed”.

- [ ] **Krok 17: Napisz czerwony test nagłówków.** Utwórz `scripts/security-headers.test.mjs`:
  ```js
  // [M3 g] Naglowki bezpieczenstwa na brzegu. Egzekwuje je Caddy (infra/caddy/Caddyfile), bo to
  // JEDYNY publiczny origin: obsluguje i ekrany SSR, i przekierowania middleware, i odpowiedzi 401
  // z BFF — jedna regula zamiast trzech miejsc, ktore moglyby sie rozjechac.
  import { test } from 'node:test'
  import assert from 'node:assert/strict'
  import fs from 'node:fs'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'
  import {
    REQUIRED_SECURITY_HEADERS,
    REMOVED_HEADERS,
    parseCaddyHeaderBlock,
    checkHeaderResponse,
  } from './lib/security-headers.mjs'

  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const CADDYFILE = path.join(ROOT, 'infra', 'caddy', 'Caddyfile')

  const PROBKA = `:8080 {
  \tencode gzip

  \theader {
  \t\tdefer
  \t\tX-Frame-Options "DENY"
  \t\t-X-Powered-By
  \t}

  \treverse_proxy web:3000
  }
  `

  test('parser czyta wartosci ustawiane w bloku header', () => {
    assert.equal(parseCaddyHeaderBlock(PROBKA).set['x-frame-options'], 'DENY')
  })

  test('parser rozpoznaje `defer`', () => {
    assert.equal(parseCaddyHeaderBlock(PROBKA).defer, true)
  })

  test('parser rozpoznaje usuwanie naglowka zapisem `-Nazwa`', () => {
    assert.deepEqual(parseCaddyHeaderBlock(PROBKA).removed, ['x-powered-by'])
  })

  test('REALNY Caddyfile ustawia kazdy wymagany naglowek z dokladna wartoscia', () => {
    const parsed = parseCaddyHeaderBlock(fs.readFileSync(CADDYFILE, 'utf8'))
    assert.equal(parsed.found, true, 'brak bloku `header` w infra/caddy/Caddyfile')
    for (const h of REQUIRED_SECURITY_HEADERS) {
      assert.equal(parsed.set[h.name], h.value, `${h.name}: oczekiwano "${h.value}", jest "${parsed.set[h.name]}"`)
    }
  })

  test('REALNY Caddyfile usuwa naglowki ujawniajace stos', () => {
    const parsed = parseCaddyHeaderBlock(fs.readFileSync(CADDYFILE, 'utf8'))
    for (const name of REMOVED_HEADERS) assert.ok(parsed.removed.includes(name), `brak usuniecia ${name}`)
  })

  test('REALNY Caddyfile ma `defer` — bez niego usuniecie naglowka upstreamu nie zadziala', () => {
    assert.equal(parseCaddyHeaderBlock(fs.readFileSync(CADDYFILE, 'utf8')).defer, true)
  })

  test('checkHeaderResponse wykrywa brak CSP', () => {
    const rows = checkHeaderResponse(new Headers({ 'x-frame-options': 'DENY' }))
    const csp = rows.find((r) => r.name === 'content-security-policy')
    assert.equal(csp.ok, false)
    assert.equal(csp.actual, null)
  })

  test('checkHeaderResponse akceptuje komplet i wykrywa wyciek x-powered-by', () => {
    const pelne = new Headers(Object.fromEntries(REQUIRED_SECURITY_HEADERS.map((h) => [h.name, h.value])))
    assert.ok(checkHeaderResponse(pelne).every((r) => r.ok))
    pelne.set('x-powered-by', 'Next.js')
    assert.equal(checkHeaderResponse(pelne).find((r) => r.name === 'x-powered-by').ok, false)
  })
  ```

- [ ] **Krok 18: Zobacz, że pada na braku modułu.** `node --test scripts/security-headers.test.mjs` → `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…\scripts\lib\security-headers.mjs'`, `# tests 1`, `# fail 1`.

- [ ] **Krok 19: Napisz moduł.** Utwórz `scripts/lib/security-headers.mjs`:
  ```js
  // [M3 g] Kontrakt naglowkow bezpieczenstwa dla publicznego originu (Caddy → web).
  //
  // DLACZEGO NA BRZEGU, A NIE W next.config. Caddy widzi WSZYSTKIE odpowiedzi jednym przejsciem:
  // ekran SSR (/login, 200), przekierowanie z middleware (/dashboard, 307) i odmowe BFF
  // (/api/**, 401). Regula w Next objelaby tylko czesc z nich i wymagalaby przebudowy obrazu przy
  // kazdej zmianie; Caddyfile jest montowany jako wolumin, wiec wchodzi przez `caddy reload`.
  //
  // DLACZEGO CSP JEST WASKIE. `frame-ancestors` / `base-uri` / `form-action` sa bezpieczne dla
  // Next.js bez zadnych zmian w aplikacji. Pelne `script-src` wymagaloby noncow w kazdym skrypcie
  // hydracji — to osobna praca, poza zakresem M3 g, i tak jest to nazwane w Zal. 6 oraz w §5 raportu.
  // HSTS swiadomie NIE ustawiamy: demonstracyjny origin chodzi po czystym HTTP, wiec naglowek
  // bylby deklaracja bez pokrycia.

  export const REQUIRED_SECURITY_HEADERS = [
    { name: 'x-frame-options', value: 'DENY', why: 'Blokuje osadzenie ekranow kadrowych w ramce (clickjacking).' },
    {
      name: 'content-security-policy',
      value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      why: 'Zakaz ramkowania (nowoczesny odpowiednik XFO), zakaz podmiany <base> i wysylki formularza na obcy origin.',
    },
    { name: 'x-content-type-options', value: 'nosniff', why: 'Przegladarka nie zgaduje typu tresci — plik kadrowy nie stanie sie skryptem.' },
    { name: 'referrer-policy', value: 'strict-origin-when-cross-origin', why: 'Sciezka ekranu (np. /pracownicy/<id>) nie wycieka w Referer na obcy origin.' },
    {
      name: 'permissions-policy',
      value: 'camera=(), geolocation=(), payment=(), microphone=(self)',
      why: 'Odciecie nieuzywanych API urzadzen; mikrofon zostaje dla Agenta Glosowego, wylacznie na wlasnym originie.',
    },
  ]

  /** Naglowki, ktore brama ma USUWAC (ujawniaja stos technologiczny). */
  export const REMOVED_HEADERS = ['x-powered-by']

  /**
   * Wyciaga blok `header { … }` z Caddyfile'a. Zwraca `{ found, defer, set, removed }`.
   * Zamykajacy nawias szukamy jako pierwsze `}` stojace na poczatku wiersza (po ewentualnych
   * spacjach/tabach) — blok `header` jest wciety, wiec nie zlapiemy nawiasu calego serwera.
   */
  export function parseCaddyHeaderBlock(caddyfile) {
    const block = /^[\t ]*header[\t ]*\{([\s\S]*?)^[\t ]*\}/m.exec(caddyfile)
    if (!block) return { found: false, defer: false, set: {}, removed: [] }
    const result = { found: true, defer: false, set: {}, removed: [] }
    for (const raw of block[1].split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      if (line === 'defer') { result.defer = true; continue }
      if (line.startsWith('-')) { result.removed.push(line.slice(1).trim().toLowerCase()); continue }
      const quoted = /^(\S+)[\t ]+"([^"]*)"$/.exec(line)
      const bare = /^(\S+)[\t ]+(.+)$/.exec(line)
      const m = quoted ?? bare
      if (m) result.set[m[1].toLowerCase()] = m[2]
    }
    return result
  }

  /**
   * Ocena REALNEJ odpowiedzi HTTP wobec kontraktu. Zwraca jeden wiersz na naglowek — takze na te,
   * ktore maja NIE wystapic. `ok` jest jedynym miejscem, w ktorym zapada werdykt; wartosc `actual`
   * zawsze trafia do raportu, zeby recenzent widzial pomiar, a nie tylko ocene.
   */
  export function checkHeaderResponse(headers) {
    const get = (n) => (typeof headers.get === 'function' ? headers.get(n) : headers[n]) ?? null
    const rows = REQUIRED_SECURITY_HEADERS.map((h) => {
      const actual = get(h.name)
      return { name: h.name, expected: h.value, actual, ok: actual === h.value, why: h.why }
    })
    for (const name of REMOVED_HEADERS) {
      const actual = get(name)
      rows.push({ name, expected: '(brak)', actual, ok: actual === null, why: 'Naglowek ujawniajacy stos — brama ma go usuwac.' })
    }
    return rows
  }
  ```

- [ ] **Krok 20: Zobacz, że pada na REALNYM Caddyfile'u.** `node --test scripts/security-headers.test.mjs` → `# tests 8`, `# pass 5`, `# fail 3`. Padają dokładnie trzy testy dotyczące realnego pliku (`brak bloku 'header' w infra/caddy/Caddyfile`) — trzy testy parsera na próbce i dwa testy `checkHeaderResponse` przechodzą. To jest czerwień na braku implementacji, nie na literówce.

- [ ] **Krok 21: Dodaj blok nagłówków do bramy.** W `infra/caddy/Caddyfile` zamień całą zawartość na (jedyna zmiana to blok `header`):
  ```
  # infra/caddy/Caddyfile — jeden publiczny origin. Dev: http na :8080.
  # Całość ruchu do frontu Next (apps/web), który sam proxy'uje /api/* do tenant-runtime po stronie
  # serwera (BFF), trzymając tokeny httpOnly. Bezpośredni routing /cp→control-plane / /auth→keycloak
  # dodamy dopiero, gdy będzie potrzebny publicznie (Faza B).
  #
  # [M3 g] Nagłówki bezpieczeństwa. Kontrakt i uzasadnienie każdego z nich: scripts/lib/security-headers.mjs;
  # regresję pilnuje scripts/security-headers.test.mjs, a realne wartości mierzy `pnpm test:security`.
  # `defer` jest KONIECZNE: bez niego usunięcie X-Powered-By nie zadziała, bo upstream ustawia ten
  # nagłówek dopiero po tym, jak Caddy przetworzy dyrektywę.
  :8080 {
  	encode gzip

  	header {
  		defer
  		X-Frame-Options "DENY"
  		Content-Security-Policy "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  		X-Content-Type-Options "nosniff"
  		Referrer-Policy "strict-origin-when-cross-origin"
  		Permissions-Policy "camera=(), geolocation=(), payment=(), microphone=(self)"
  		-X-Powered-By
  	}

  	reverse_proxy web:3000
  }
  ```

- [ ] **Krok 22: Zobacz zielone testy.** `node --test scripts/security-headers.test.mjs` → `# tests 8`, `# pass 8`, `# fail 0`.

- [ ] **Krok 23: Wgraj konfigurację do bramy i zmierz efekt na żywo.**
  ```powershell
  docker exec hrobot-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  docker exec hrobot-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  node -e "(async()=>{for(const u of ['/login','/dashboard','/api/employees']){const r=await fetch('http://localhost:8080'+u,{redirect:'manual'});console.log('===',u,r.status);for(const [k,v] of r.headers)console.log('   ',k,':',v)}})()"
  ```
  Oczekiwane: `Valid configuration`, restart bez utraty zdrowia (`docker ps` nadal `healthy`), a w sondzie na **każdej** z trzech ścieżek (200 / 307 / 401) komplet: `content-security-policy`, `permissions-policy`, `referrer-policy`, `x-content-type-options`, `x-frame-options` — i **brak** `x-powered-by`. Ten wariant został zweryfikowany na kontenerze-sondzie przed napisaniem planu, więc oczekiwanie jest zmierzone, a nie założone.

- [ ] **Krok 24: Weryfikacja negatywna bramy.** Usuń tymczasowo cały blok `header { … }` z `infra/caddy/Caddyfile`, przeładuj i zmierz:
  ```powershell
  node -e "const fs=require('fs');const p='infra/caddy/Caddyfile';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/\theader \{[\s\S]*?\n\t\}\n\n/,''));"
  docker exec hrobot-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  node --test scripts/security-headers.test.mjs
  node -e "(async()=>{const r=await fetch('http://localhost:8080/login');console.log('xfo=',r.headers.get('x-frame-options'),'xpb=',r.headers.get('x-powered-by'))})()"
  git checkout -- infra/caddy/Caddyfile
  docker exec hrobot-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  ```
  Oczekiwane w środku: `# fail 3` z testu i `xfo= null xpb= Next.js` z sondy. Po `git checkout` + reload sonda znów pokazuje `xfo= DENY xpb= null`. Bez tego kroku zielony test nie dowodzi, że cokolwiek egzekwuje.
  (Uwaga: `git checkout -- infra/caddy/Caddyfile` przywraca stan z HEAD, więc **wykonaj Krok 25 przed** tą weryfikacją albo zamiast `git checkout` odtwórz plik ręcznie. Bezpieczna kolejność: Krok 25 → Krok 24.)

- [ ] **Krok 25: Commit.** `git add scripts/lib/security-headers.mjs scripts/security-headers.test.mjs infra/caddy/Caddyfile; git commit -m "feat(km3-a): naglowki bezpieczenstwa na bramie + test kontraktu i sonda"`

---

### Zadanie 5 (A-5): `pnpm test:security` — jedna komenda zbierająca wszystkie pakiety

**Pliki:**
- Utwórz: `scripts/lib/security-suites.mjs`, `scripts/lib/bff-routes.mjs`
- Test: `scripts/security-suites.test.mjs`, `scripts/bff-routes.test.mjs`
- Utwórz: `scripts/security-suite.mjs`
- Utwórz (wynik przebiegu): `docs/raport-km3/build/security-run.json`
- Zmień: `package.json` (skrypty `test:scripts`, `test:security`)

- [ ] **Krok 26: Napisz czerwony test katalogu i parsera.** Utwórz `scripts/security-suites.test.mjs`:
  ```js
  // Parser liczby zdanych testow z realnego wyjscia czterech biegaczy. Napisy ponizej sa DOSLOWNIE
  // przepisane z przebiegow na tym repo (vitest 2.1.9, jest 29.7.0, pytest, node --test 22.12).
  import { test } from 'node:test'
  import assert from 'node:assert/strict'
  import { SECURITY_SUITES, RUNNERS, parsePassCount, stripAnsi } from './lib/security-suites.mjs'

  test('vitest — liczba z wiersza podsumowania, mimo kodow ANSI', () => {
    const out = '\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m19 passed\u001b[39m\u001b[22m\u001b[90m (19)\u001b[39m\n'
    assert.equal(parsePassCount('vitest', out), 19)
  })

  test('jest — liczba z wiersza "Tests:"', () => {
    const out = 'Test Suites: 7 passed, 7 total\nTests:       37 passed, 37 total\nSnapshots:   0 total\n'
    assert.equal(parsePassCount('jest', out), 37)
  })

  test('jest — liczba zdanych takze gdy sa przegrane', () => {
    assert.equal(parsePassCount('jest', 'Tests:       2 failed, 35 passed, 37 total\n'), 35)
  })

  test('pytest — liczba z wiersza koncowego', () => {
    assert.equal(parsePassCount('pytest', '18 passed, 1 warning in 3.91s\n'), 18)
  })

  test('node --test — liczba z wiersza "# pass"', () => {
    assert.equal(parsePassCount('node', '1..4\n# tests 8\n# suites 0\n# pass 8\n# fail 0\n'), 8)
  })

  test('nieodczytane wyjscie daje null, a nie zmyslone zero', () => {
    assert.equal(parsePassCount('vitest', 'zupelnie inny tekst'), null)
  })

  test('stripAnsi usuwa sekwencje SGR', () => {
    assert.equal(stripAnsi('\u001b[32mzielone\u001b[39m'), 'zielone')
  })

  test('SECURITY_SUITES ma co najmniej 6 zestawow i unikalne identyfikatory', () => {
    assert.ok(SECURITY_SUITES.length >= 6, `oczekiwano >= 6, jest ${SECURITY_SUITES.length}`)
    assert.equal(new Set(SECURITY_SUITES.map((s) => s.id)).size, SECURITY_SUITES.length)
  })

  test('kazdy zestaw deklaruje znanego biegacza, katalog roboczy, argumenty i uzasadnienie', () => {
    for (const suite of SECURITY_SUITES) {
      assert.ok(RUNNERS.includes(suite.runner), `${suite.id}: nieznany biegacz ${suite.runner}`)
      assert.equal(typeof suite.cwd, 'string')
      assert.ok(Array.isArray(suite.args) && suite.args.length > 0, `${suite.id}: brak argumentow`)
      assert.ok(suite.why.length > 20, `${suite.id}: uzasadnienie za krotkie`)
    }
  })
  ```

- [ ] **Krok 27: Zobacz, że pada.** `node --test scripts/security-suites.test.mjs` → `Cannot find module '…\scripts\lib\security-suites.mjs'`, `# tests 1`, `# fail 1`.

- [ ] **Krok 28: Napisz katalog zestawów i parser.** Utwórz `scripts/lib/security-suites.mjs`:
  ```js
  // [M3 g] Katalog ISTNIEJACYCH testow bezpieczenstwa platformy. Blok A pisze od nowa tylko dwa
  // (przemiatarka tras BFF i kontrakt naglowkow) — reszte ZBIERA pod jedna komenda i zapisuje realny
  // wynik, zeby raport koncowy mial dowod, a nie deklaracje. Kazdy wpis mowi, CO dokladnie pilnuje,
  // bo lista bez uzasadnien zgnije w kwartal.

  /** Biegacze, ktorych umie uruchomic scripts/security-suite.mjs i odczytac parsePassCount. */
  export const RUNNERS = ['vitest', 'jest', 'pytest', 'node']

  export const SECURITY_SUITES = [
    {
      id: 'bff-gate-policy',
      title: 'Polityka bramki BFF (parytet app/api ↔ PUBLICZNE_API)',
      runner: 'vitest',
      cwd: 'apps/web',
      args: ['run', 'lib/api-gate.test.ts'],
      why: 'Pilnuje, ze lista tras zwolnionych z sesji odpowiada DOKLADNIE trasom istniejacym na dysku — w obie strony.',
    },
    {
      id: 'bff-middleware',
      title: 'Middleware: 401 na /api, przekierowanie na ekranach',
      runner: 'vitest',
      cwd: 'apps/web',
      args: ['run', 'lib/middleware-api-gate.test.ts', 'lib/middleware-matcher.test.ts'],
      why: 'Uruchamia REALNY eksport middleware() i sprawdza, ze anonim nie dociera do handlera ani do ekranu najemcy.',
    },
    {
      id: 'bff-ambient-token',
      title: 'Zakaz pozyczania wlasnych powiadczen serwera',
      runner: 'vitest',
      cwd: 'apps/web',
      args: ['run', 'lib/tenant-runtime.test.ts'],
      why: 'Druga linia obrony: bez powiadczenia wolajacego proxy odmawia zamiast siegnac po token serwisowy, takze przy NODE_ENV=production.',
    },
    {
      id: 'bff-route-sweep',
      title: 'Przemiatanie wszystkich tras BFF odkrytych z dysku',
      runner: 'vitest',
      cwd: 'apps/web',
      args: ['run', 'lib/api-gate.security.test.ts'],
      why: 'Kazda bramkowana trasa pod app/api/ odmawia anonimowi na GET/POST/PATCH/DELETE; trasy publiczne przypiete co do liczby i nazwy.',
    },
    {
      id: 'edge-security-headers',
      title: 'Kontrakt naglowkow bezpieczenstwa na bramie',
      runner: 'node',
      cwd: '.',
      args: ['scripts/security-headers.test.mjs'],
      why: 'Brama musi ustawiac XFO, CSP, nosniff, Referrer-Policy i Permissions-Policy oraz usuwac X-Powered-By — regresja w Caddyfile zapala ten zestaw.',
    },
    {
      id: 'runtime-authz',
      title: 'RBAC, weryfikacja JWT i kontekst najemcy w tenant-runtime',
      runner: 'jest',
      cwd: 'apps/tenant-runtime',
      args: ['--testPathPattern', '(rbac|keycloak-jwt|tenant-context)'],
      why: 'Straznik rol, strategia tokenu Keycloak (zaufany issuer) i przypisanie zadania do najemcy — trzy zestawy.',
    },
    {
      id: 'runtime-audit',
      title: 'Sciezka audytowa (ids-only, bez PII)',
      runner: 'jest',
      cwd: 'apps/tenant-runtime',
      args: ['--testPathPattern', 'audit'],
      why: 'Interceptor i serwis audytu: kazda operacja zostawia wpis, a wpis nie zawiera danych osobowych.',
    },
    {
      id: 'runtime-write-boundary',
      title: 'Granice zapisu: art. 22 RODO i zakaz wysylki ZUS',
      runner: 'jest',
      cwd: 'apps/tenant-runtime',
      args: ['--testPathPattern', '(write-boundary|dokumenty-no-send)'],
      why: 'Strategic-brain rekomenduje i nigdy nie mutuje stanu kadrowego; modul Dokumenty nie ma ZADNEJ sciezki wysylki na zewnatrz.',
    },
    {
      id: 'crypto-pesel',
      title: 'Szyfrowanie PESEL (AES-256-GCM) i indeks slepy',
      runner: 'jest',
      cwd: 'packages/shared',
      args: ['src/encryption.test.ts'],
      why: 'Szyfr deterministyczny per klucz, odrzucenie klucza o zlej dlugosci, wykrycie manipulacji szyfrogramem.',
    },
    {
      id: 'agent-service-auth',
      title: 'Uwierzytelnianie i izolacja najemcow w agent-service',
      runner: 'pytest',
      cwd: 'agent-service',
      args: ['tests/test_auth.py', 'tests/test_auth_issuer.py', 'tests/test_demo_router_auth.py', 'tests/test_tenant_isolation.py'],
      why: 'Zaufany issuer JWKS, odrzucenie tokenu z obcego realmu, router demo za autoryzacja i brak przeciekow miedzy najemcami.',
    },
    {
      id: 'tenant-isolation-db',
      title: 'Izolacja najemcow na REALNYM Postgresie',
      runner: 'jest',
      cwd: 'apps/tenant-runtime',
      args: ['--config', 'jest.integration.config.cjs', '--testPathPattern', 'tenant-isolation'],
      requiresEnv: 'POSTGRES_SUPERUSER_URL',
      why: 'Dwie bazy, prawdziwe deszyfrowanie dbUrl i kontrola negatywna, ktora wykrywa przeciek gdy najemcy trafia na jedna baze.',
    },
    {
      id: 'stt-service-auth',
      title: 'Zaufany issuer w stt-service',
      runner: 'pytest',
      cwd: 'stt-service',
      args: ['tests/test_auth_issuer.py'],
      why: 'Usluga rozpoznawania mowy weryfikuje ten sam token co reszta platformy i odrzuca obcy realm.',
    },
  ]

  /** Usuwa sekwencje SGR, zeby regexy podsumowan trafialy w tekst, a nie w kolory. */
  export function stripAnsi(text) {
    // eslint-disable-next-line no-control-regex
    return String(text).replace(/\u001B\[[0-9;]*m/g, '')
  }

  /**
   * Liczba ZDANYCH testow z wyjscia biegacza, albo null gdy podsumowania nie da sie odczytac.
   * null jest celowe: raport ma napisac „nieodczytane", a nie wpisac zero, ktorego nikt nie zmierzyl.
   * O powodzeniu decyduje KOD WYJSCIA, nie ta liczba — ona sluzy wylacznie tabeli w Zal. 6.
   */
  export function parsePassCount(runner, output) {
    const text = stripAnsi(output)
    const pattern =
      runner === 'jest' ? /^Tests:\s+(?:\d+\s+\w+,\s+)*?(\d+)\s+passed/m
      : runner === 'vitest' ? /^\s*Tests\s+(\d+)\s+passed/m
      : runner === 'node' ? /^# pass (\d+)/m
      : /(\d+)\s+passed/
    const match = pattern.exec(text)
    return match ? Number(match[1]) : null
  }
  ```

- [ ] **Krok 29: Zobacz zielone.** `node --test scripts/security-suites.test.mjs` → `# tests 9`, `# pass 9`, `# fail 0`.

- [ ] **Krok 30: Napisz czerwony test odkrywania tras dla skryptów.** Utwórz `scripts/bff-routes.test.mjs`:
  ```js
  // Odkrywanie tras BFF po stronie skryptow. Ta implementacja jest CELOWO odrebna od tej
  // w apps/web/lib/api-gate.security.test.ts (tam TypeScript pod vitest, tu czysty ESM pod
  // node --test) — skrypt w korzeniu nie zaimportuje TypeScriptu z apps/web. Obie przypinaja te same
  // liczby (17 / 14 / 3), wiec rozjechanie sie zapala jedna z nich na czerwono.
  import { test } from 'node:test'
  import assert from 'node:assert/strict'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'
  import { discoverApiRoutes, materialiseRoute, PUBLIC_API_PREFIXES, isPublicApiPath } from './lib/bff-routes.mjs'

  const WEB_API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'app', 'api')

  test('odkrywa dokladnie 17 tras pod apps/web/app/api, kazda z wiodacym /api/', () => {
    const routes = discoverApiRoutes(WEB_API_DIR)
    assert.equal(routes.length, 17)
    for (const r of routes) assert.ok(r.startsWith('/api/'), `zla sciezka: ${r}`)
    assert.ok(routes.includes('/api/grafik/[...path]'), 'brak /api/grafik/[...path]')
    assert.ok(routes.includes('/api/voice/transcribe'), 'brak /api/voice/transcribe')
  })

  test('materialiseRoute podstawia segmenty dynamiczne', () => {
    assert.equal(materialiseRoute('/api/employees/[[...path]]'), '/api/employees')
    assert.equal(materialiseRoute('/api/grafik/[...path]'), '/api/grafik/sonda-path')
    assert.equal(materialiseRoute('/api/slugs/check/[slug]'), '/api/slugs/check/sonda-slug')
    assert.equal(materialiseRoute('/api/voice/transcribe'), '/api/voice/transcribe')
  })

  test('prefiksy publiczne odpowiadaja PUBLICZNE_API z apps/web/lib/api-gate.ts', () => {
    assert.deepEqual(PUBLIC_API_PREFIXES, ['/api/auth/signup', '/api/slugs', '/api/provision'])
  })

  test('14 tras bramkowanych, 3 publiczne', () => {
    const urls = discoverApiRoutes(WEB_API_DIR).map(materialiseRoute)
    assert.equal(urls.filter((u) => !isPublicApiPath(u)).length, 14)
    assert.equal(urls.filter(isPublicApiPath).length, 3)
  })
  ```

- [ ] **Krok 31: Zobacz, że pada.** `node --test scripts/bff-routes.test.mjs` → `Cannot find module '…\scripts\lib\bff-routes.mjs'`, `# tests 1`, `# fail 1`.

- [ ] **Krok 32: Napisz moduł tras.** Utwórz `scripts/lib/bff-routes.mjs`:
  ```js
  // Odkrywanie powierzchni BFF dla skryptow raportowych. Lustro (w czystym ESM) logiki
  // z apps/web/lib/api-gate.ts + apps/web/lib/api-gate.security.test.ts.

  import { readdirSync } from 'node:fs'
  import path from 'node:path'

  /** Odpowiednik PUBLICZNE_API z apps/web/lib/api-gate.ts. */
  export const PUBLIC_API_PREFIXES = ['/api/auth/signup', '/api/slugs', '/api/provision']

  export function isPublicApiPath(pathname) {
    return PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  }

  /**
   * Kazdy `route.ts` pod podanym katalogiem app/api, jako sciezka URL ze wzorcami Next.
   *
   * UWAGA NA path.join: `path.join('', 'grafik')` zwraca 'grafik' BEZ wiodacego separatora, wiec
   * budowanie sciezki wzglednej przez path.join dawaloby '/apigrafik/...' zamiast '/api/grafik/...'.
   * Dlatego sciezke URL skladamy konkatenacja z ukosnikiem, a path.join uzywamy WYLACZNIE do
   * sciezki na dysku.
   */
  export function discoverApiRoutes(apiDir) {
    const found = []
    const walk = (relative) => {
      const onDisk = path.join(apiDir, ...relative.split('/').filter(Boolean))
      for (const entry of readdirSync(onDisk, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${relative}/${entry.name}`)
        else if (entry.name === 'route.ts') found.push(`/api${relative}`)
      }
    }
    walk('')
    return found.sort()
  }

  /** Wzorzec trasy → konkretny adres, ktory Next dopasuje do tej samej trasy. */
  export function materialiseRoute(routePath) {
    const segments = routePath
      .split('/')
      .filter(Boolean)
      .flatMap((segment) => {
        if (/^\[\[\.\.\..+\]\]$/.test(segment)) return []
        const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment)
        if (catchAll) return [`sonda-${catchAll[1]}`]
        const dynamic = /^\[(.+)\]$/.exec(segment)
        if (dynamic) return [`sonda-${dynamic[1]}`]
        return [segment]
      })
    return `/${segments.join('/')}`
  }
  ```

- [ ] **Krok 33: Zobacz zielone i potwierdź spójność z Zadaniem 3.** `node --test scripts/bff-routes.test.mjs` → `# tests 4`, `# pass 4`. Liczby 17/14/3 są teraz przypięte w dwóch niezależnych implementacjach, a asercja `r.startsWith('/api/')` łapie dokładnie tę klasę błędu, która w pierwszej wersji tego modułu produkowała adresy `/apigrafik`.

- [ ] **Krok 34: Napisz biegacz zestawów.** Utwórz `scripts/security-suite.mjs`:
  ```js
  #!/usr/bin/env node
  // [M3 g] `pnpm test:security` — jedna komenda uruchamiajaca WSZYSTKIE testy bezpieczenstwa
  // platformy plus dwie sondy na zywo, z zapisem realnego wyniku do JSON-a, z ktorego generuje sie
  // Zal. 6 raportu KM3.
  //
  // ZESTAW POMINIETY TO NIE ZESTAW ZALICZONY. Dwie pozycje maja warunek srodowiskowy (izolacja
  // najemcow potrzebuje POSTGRES_SUPERUSER_URL, stt-service wlasnego .venv). Gdy warunek nie jest
  // spelniony, wpis dostaje status POMINIETY z powodem — i taki trafia do raportu.
  //
  // SONDA POMINIETA TEZ NIE JEST SONDA ZALICZONA. Gdy stos nie odpowiada, sekcje sond dostaja status
  // POMINIETA, skrypt mowi o tym glosno na stderr i konczy sie kodem 1. Cicha zielen przy
  // niedostepnym stosie bylaby najgorszym mozliwym wynikiem dla dokumentu odbiorczego.

  import { spawnSync } from 'node:child_process'
  import fs from 'node:fs'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'
  import { SECURITY_SUITES, parsePassCount, stripAnsi } from './lib/security-suites.mjs'
  import { discoverApiRoutes, materialiseRoute, isPublicApiPath } from './lib/bff-routes.mjs'
  import { checkHeaderResponse } from './lib/security-headers.mjs'

  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const OUT = path.join(ROOT, 'docs', 'raport-km3', 'build', 'security-run.json')
  const API_DIR = path.join(ROOT, 'apps', 'web', 'app', 'api')
  const BASE_URL = (process.env.PERF_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '')
  const HEADER_PATHS = ['/login', '/dashboard', '/api/employees']

  /** Pola opisowe zestawu przepisywane do raportu (bez pol sterujacych uruchomieniem). */
  function describeSuite(suite) {
    return { id: suite.id, title: suite.title, runner: suite.runner, cwd: suite.cwd, args: suite.args, why: suite.why }
  }

  function lastLines(text, count) {
    return stripAnsi(text).trimEnd().split('\n').slice(-count).join('\n')
  }

  /**
   * Komenda dla zestawu albo `{ missing: <powod> }`. Sciezki entrypointow sa WPISANE, nie zgadywane:
   *   apps/web/node_modules/vitest/vitest.mjs            (pole `bin` pakietu vitest)
   *   <cwd>/node_modules/jest/bin/jest.js                (pole `bin` pakietu jest)
   * Wszystkie trzy istnieja na dysku tego repo — sprawdzone przed napisaniem tego kodu. Nie
   * uruchamiamy shimow `.cmd` z node_modules/.bin, bo Node 22 odmawia spawnowania `.cmd` bez powloki.
   */
  function commandFor(suite) {
    const cwd = path.join(ROOT, suite.cwd)
    if (suite.runner === 'node') return { file: process.execPath, argv: ['--test', ...suite.args], cwd }
    if (suite.runner === 'pytest') {
      const win = path.join(cwd, '.venv', 'Scripts', 'python.exe')
      const nix = path.join(cwd, '.venv', 'bin', 'python')
      const python = fs.existsSync(win) ? win : fs.existsSync(nix) ? nix : null
      if (!python) return { missing: `brak wirtualnego srodowiska ${suite.cwd}/.venv` }
      return { file: python, argv: ['-m', 'pytest', ...suite.args, '-q'], cwd }
    }
    const entry =
      suite.runner === 'vitest'
        ? path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs')
        : path.join(cwd, 'node_modules', 'jest', 'bin', 'jest.js')
    if (!fs.existsSync(entry)) return { missing: `brak ${path.relative(ROOT, entry)} — uruchom pnpm install` }
    return { file: process.execPath, argv: [entry, ...suite.args], cwd }
  }

  const results = []
  for (const suite of SECURITY_SUITES) {
    if (suite.requiresEnv && !process.env[suite.requiresEnv]) {
      results.push({ ...describeSuite(suite), status: 'POMINIETY', passed: null, ms: 0, reason: `brak zmiennej srodowiskowej ${suite.requiresEnv}` })
      process.stdout.write(`[sec] POMINIETY  ${suite.id} — brak ${suite.requiresEnv}\n`)
      continue
    }
    const command = commandFor(suite)
    if (command.missing) {
      results.push({ ...describeSuite(suite), status: 'POMINIETY', passed: null, ms: 0, reason: command.missing })
      process.stdout.write(`[sec] POMINIETY  ${suite.id} — ${command.missing}\n`)
      continue
    }
    const started = Date.now()
    const r = spawnSync(command.file, command.argv, { cwd: command.cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
    const passed = parsePassCount(suite.runner, output)
    const status = r.status === 0 ? 'ZIELONY' : 'CZERWONY'
    results.push({ ...describeSuite(suite), status, passed, ms: Date.now() - started, reason: status === 'CZERWONY' ? lastLines(output, 8) : null })
    process.stdout.write(`[sec] ${status.padEnd(9)} ${suite.id} — ${passed ?? '?'} testow\n`)
  }

  // --- sonda 1: 17 tras BFF bez ciasteczka sesji -------------------------------------------------
  const routes = discoverApiRoutes(API_DIR).map((route) => ({ route, url: materialiseRoute(route) }))
  const liveSweep = { baseUrl: BASE_URL, status: 'WYKONANA', probes: [] }
  for (const { route, url } of routes) {
    const expectation = isPublicApiPath(url) ? 'PUBLICZNA' : 'BRAMKOWANA'
    try {
      const res = await fetch(`${BASE_URL}${url}`, { redirect: 'manual', headers: { accept: 'application/json' } })
      const ok = expectation === 'BRAMKOWANA' ? res.status === 401 || res.status === 403 : res.status < 500
      liveSweep.probes.push({ route, url, expectation, status: res.status, ok })
    } catch (err) {
      liveSweep.status = 'POMINIETA'
      liveSweep.probes.push({ route, url, expectation, status: null, ok: false, error: String(err.message ?? err) })
    }
  }

  // --- sonda 2: naglowki bezpieczenstwa na bramie ------------------------------------------------
  const headerSweep = { baseUrl: BASE_URL, status: 'WYKONANA', probes: [] }
  for (const p of HEADER_PATHS) {
    try {
      const res = await fetch(`${BASE_URL}${p}`, { redirect: 'manual' })
      headerSweep.probes.push({ path: p, status: res.status, headers: checkHeaderResponse(res.headers) })
    } catch (err) {
      headerSweep.status = 'POMINIETA'
      headerSweep.probes.push({ path: p, status: null, headers: [], error: String(err.message ?? err) })
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    suites: results,
    totals: {
      declared: results.length,
      green: results.filter((s) => s.status === 'ZIELONY').length,
      red: results.filter((s) => s.status === 'CZERWONY').length,
      skipped: results.filter((s) => s.status === 'POMINIETY').length,
      testsPassed: results.reduce((sum, s) => sum + (s.passed ?? 0), 0),
    },
    liveSweep,
    headerSweep,
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`[sec] ZAPISANO ${OUT}\n`)
  process.stdout.write(`[sec] ${report.totals.green}/${report.totals.declared} zestawow zielonych, ${report.totals.testsPassed} testow, ${report.totals.skipped} pominietych\n`)

  const gatedFailures = liveSweep.probes.filter((p) => p.expectation === 'BRAMKOWANA' && !p.ok)
  const headerFailures = headerSweep.probes.flatMap((p) => p.headers.filter((h) => !h.ok).map((h) => `${p.path}:${h.name}`))
  if (gatedFailures.length > 0) process.stderr.write(`[sec] TRASY BEZ BRAMKI: ${gatedFailures.map((p) => `${p.url}=${p.status}`).join(', ')}\n`)
  if (headerFailures.length > 0) process.stderr.write(`[sec] NAGLOWKI NIEZGODNE: ${headerFailures.join(', ')}\n`)
  if (liveSweep.status === 'POMINIETA' || headerSweep.status === 'POMINIETA') {
    process.stderr.write('[sec] SONDY NA ZYWO POMINIETE — stos nie odpowiada. Wynik NIE jest dowodem; podnies stos i powtorz.\n')
  }

  const sondyOk = liveSweep.status === 'WYKONANA' && headerSweep.status === 'WYKONANA' && gatedFailures.length === 0 && headerFailures.length === 0
  process.exit(report.totals.red === 0 && sondyOk ? 0 : 1)
  ```

- [ ] **Krok 35: Dodaj `test:scripts` i `test:security` do korzenia.** W `package.json`, w `"scripts"`, zaraz po `"test:perf"`, wstaw:
  ```json
    "test:scripts": "node --test scripts/perf-budget.test.mjs scripts/security-headers.test.mjs scripts/security-suites.test.mjs scripts/bff-routes.test.mjs",
    "test:security": "node scripts/security-suite.mjs",
  ```
  (`node --test` **nie przyjmuje katalogu** na Node 22.12 — sprawdzone: `node --test scripts` kończy się `Cannot find module '…\scripts'`. Dlatego pliki wymieniamy wprost.)

- [ ] **Krok 36: Uruchom testy skryptów.** `pnpm test:scripts` → `# tests 26`, `# pass 26`, `# fail 0` (5 + 8 + 9 + 4).

- [ ] **Krok 37: Uruchom pełny zestaw bezpieczeństwa.** `pnpm test:security`.
  Oczekiwane:
  - dziesięć wierszy `[sec] ZIELONY …` z liczbami: `bff-gate-policy — 19`, `bff-middleware — 49`, `bff-ambient-token — 27`, `bff-route-sweep — 94`, `edge-security-headers — 8`, `runtime-authz — 26`, `runtime-audit — 5`, `runtime-write-boundary — 6`, `crypto-pesel — 13`, `agent-service-auth — 18`;
  - dwa wiersze `[sec] POMINIETY …`: `tenant-isolation-db — brak POSTGRES_SUPERUSER_URL`, `stt-service-auth — brak wirtualnego srodowiska stt-service/.venv`;
  - `[sec] 10/12 zestawow zielonych, 265 testow, 2 pominietych`;
  - brak wierszy `TRASY BEZ BRAMKI` i `NAGLOWKI NIEZGODNE`, kod wyjścia **0**.
  Kryterium akceptacji A1 (≥ 6 zestawów, kod 0) spełnione z zapasem.

- [ ] **Krok 38: Weryfikacja negatywna biegacza.** W `apps/web/lib/api-gate.ts` zamień `PUBLICZNE_API` na `['/api/auth/signup', '/api/slugs', '/api/provision', '/api/employees'] as const`, uruchom `pnpm test:security`.
  Oczekiwane: `[sec] CZERWONY bff-gate-policy` (strażnik parytetu widzi cztery trasy publiczne zamiast trzech), `[sec] CZERWONY bff-route-sweep` (inwentarz 14/3), `[sec] CZERWONY bff-middleware` (`/api/employees` jest na liście `CHRONIONE` i miało dać 401), kod wyjścia **1**.
  **Sonda na żywo pozostanie zielona i tak ma być** — kontener `hrobot-web-1` serwuje ze zbudowanego obrazu, więc edycja źródła go nie dotyczy, a klasyfikację sondy robi niezależne lustro `scripts/lib/bff-routes.mjs`. Dowodem po stronie sondy jest weryfikacja negatywna z Kroku 24, gdzie zmiana faktycznie wchodzi do bramy przez `caddy reload`.
  Cofnij: `git checkout -- apps/web/lib/api-gate.ts`, uruchom `pnpm test:security` ponownie → kod 0.

- [ ] **Krok 39: Commit.**
  ```powershell
  git add scripts/lib/security-suites.mjs scripts/lib/bff-routes.mjs scripts/security-suites.test.mjs scripts/bff-routes.test.mjs scripts/security-suite.mjs package.json docs/raport-km3/build/security-run.json
  git commit -m "feat(km3-a): pnpm test:security — 12 zestawow + sonda 17 tras i sonda naglowkow"
  ```

---

### Zadanie 6 (A-6): Zał. 6 — `docs/raport-km3/testy-koncowe.md` z realnego przebiegu + PDF + korekty raportu głównego

**Pliki:**
- Utwórz: `scripts/raport-testy-koncowe.mjs`, `docs/raport-km3/build/make-report-html.mjs`, `docs/raport-km3/build/print-testy-koncowe.mjs`
- Utwórz (wynik): `docs/raport-km3/testy-koncowe.md`, `docs/raport-km3/testy-koncowe.html`, `docs/raport-km3/Zal_6_Testy_koncowe.pdf`
- Zmień: `package.json` (skrypt `raport:testy`), `docs/raport-km3/Raport_KM3_HRobot.md` (§3.1 wiersz 227, §5 wiersz 406 + dwie nowe pozycje, §8 tabela załączników)

- [ ] **Krok 40: Napisz generator raportu.** Utwórz `scripts/raport-testy-koncowe.mjs`:
  ```js
  #!/usr/bin/env node
  // [M3 g] Zal. 6 — generator dokumentu „Testy wydajnosci i bezpieczenstwa".
  //
  // KAZDA LICZBA W WYJSCIU POCHODZI Z PLIKU POMIAROWEGO. Skrypt nie zna zadnego wyniku z gory:
  // brak perf-smoke.json albo security-run.json = twardy blad, nie „raport z pustymi polami".
  // To jest cala roznica miedzy dokumentem a deklaracja.

  import fs from 'node:fs'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'

  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const BUILD = path.join(ROOT, 'docs', 'raport-km3', 'build')
  const OUT = path.join(ROOT, 'docs', 'raport-km3', 'testy-koncowe.md')

  function readRun(name) {
    const file = path.join(BUILD, name)
    if (!fs.existsSync(file)) {
      process.stderr.write(`BRAK ${file}\nUruchom najpierw: pnpm test:perf oraz pnpm test:security\n`)
      process.exit(1)
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }

  const perf = readRun('perf-smoke.json')
  const sec = readRun('security-run.json')

  const dateOnly = (iso) => iso.slice(0, 10)
  const shortSha = (sha) => (sha ? sha.replace(/^sha256:/, '').slice(0, 12) : 'nieustalone')
  const cell = (v) => (v === null || v === undefined ? 'nieodczytane' : String(v))

  /**
   * Luki harmonogramu PARP, ktorych blok A NIE ZAMYKA. Wymienione tu, a nie przemilczane, bo
   * recenzent porownujacy zalacznik z harmonogramem ma zobaczyc je od nas, a nie znalezc sam.
   */
  const LUKI = [
    ['M1 j) powiadomienia push', 'Kanal e-mail dostarcza Blok D; kanal push pozostaje poza zakresem etapu demonstracyjnego.', 'Blok D / §5'],
    ['M1 j) kalendarze Google/MS', 'Blok E dostarcza eksport i subskrypcje ICS (RFC 5545). To NIE jest integracja OAuth z Google/MS i tak jest nazwane.', 'Blok E / §5'],
    ['M1 i) konektor systemu HR', 'System zrodlowy po stronie Odbiorcy nie zostal wskazany; bez tej informacji powstanie import CSV, nie integracja.', '§5 + pytanie do Odbiorcy'],
    ['M2 b) reinforced learning', 'Prognozowanie dziala (agent-service/app/forecast.py); sciezka serwujaca jest wolna od stable_baselines3/torch/gymnasium, co dowodzi test tests/test_serving_path_purity.py.', '§5'],
    ['M3 a) wysylka do Platnika ZUS', 'Szkielet KEDU (XML DRA/RCA/RSA + PDF) ze znakiem wodnym i <demo>true</demo>; brak podpisu i brak sciezki wysylki.', '§5 (juz zgloszone)'],
    ['M3 b) ankiety i analiza dobrostanu', 'Dostarcza Blok F; dobrostan celowo NIE wchodzi do compositeScore, zeby nie zmienic liczb rozliczanych w macierzy AN-1..AN-13.', 'Blok F'],
    ['M3 c) personalizacja komunikacji', 'Dostarcza Blok C, deterministycznie, bez modelu jezykowego.', 'Blok C'],
    ['M3 i) audyt powdrozeniowy', 'Dostarcza Blok B jako Zal. 7.', 'Blok B / Zal. 7'],
  ]

  const lines = []
  const w = (line = '') => lines.push(line)

  w('# Załącznik 6 — Testy wydajności i bezpieczeństwa oraz raport końcowy (M3 g)')
  w()
  w('Dokument powstał z **wyjścia realnych przebiegów** narzędzi pomiarowych, zapisanych w')
  w('`docs/raport-km3/build/perf-smoke.json` i `docs/raport-km3/build/security-run.json`.')
  w('Żadna liczba poniżej nie została przepisana ręcznie — generator (`scripts/raport-testy-koncowe.mjs`)')
  w('odmawia zbudowania dokumentu, gdy któregokolwiek z tych plików brakuje.')
  w()
  w('## 1. Metryka przebiegu')
  w()
  w('| Pozycja | Wartość |')
  w('|---|---|')
  w(`| Data pomiaru wydajności | ${dateOnly(perf.generatedAt)} |`)
  w(`| Data przebiegu bezpieczeństwa | ${dateOnly(sec.generatedAt)} |`)
  w(`| Rewizja kodu (git) | \`${perf.gitSha ?? 'nieustalone'}\` |`)
  w(`| Obraz \`web\` | \`${shortSha(perf.images.web)}\` |`)
  w(`| Obraz \`tenant-runtime\` | \`${shortSha(perf.images.tenantRuntime)}\` |`)
  w(`| Punkt wejścia | \`${perf.baseUrl}\` |`)
  w(`| Narzędzie wydajnościowe | ${perf.tool} |`)
  w()
  w('## 2. Wydajność')
  w()
  w('| Ścieżka | Poł. | Czas [s] | p50 [ms] | p90 [ms] | p97,5 [ms] | p99 [ms] | żąd./s | 2xx | poza 2xx | Budżet p97,5 | Werdykt |')
  w('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const r of perf.runs) {
    w(`| \`${r.label}\` | ${r.connections} | ${r.durationSec} | ${r.p50} | ${r.p90} | ${r.p97_5} | ${r.p99} | ${r.rps} | ${r.requests2xx} | ${r.nonOk} | ${r.budgetMs} | ${r.verdict} |`)
  }
  w()
  w(`[Dlaczego p97,5, a nie p95.]{.lbl} ${perf.percentileNote} Próg spełniony na p97,5 jest spełniony`)
  w('również na p95, więc rozliczenie jest **ostrzejsze** od zapisu harmonogramu, a nie łagodniejsze.')
  w()
  w('[Progi są wstępne.]{.lbl} Pierwszy przebieg je kalibruje. Gdy pomiar wypada gorzej od budżetu,')
  w('do dokumentu trafia zmierzona liczba i werdykt `PRZEKROCZONY` — nie poprawiony próg.')
  w()
  w('## 3. Bezpieczeństwo — zebrane pakiety testów')
  w()
  w(`Jedna komenda: \`pnpm test:security\`. Zadeklarowanych zestawów: **${sec.totals.declared}**,`)
  w(`zielonych: **${sec.totals.green}**, czerwonych: **${sec.totals.red}**, pominiętych: **${sec.totals.skipped}**.`)
  w(`Łączna liczba zdanych testów w tym przebiegu: **${sec.totals.testsPassed}**.`)
  w()
  w('| Zestaw | Biegacz | Pakiet | Zdane | Status | Co pilnuje |')
  w('|---|---|---|---:|---|---|')
  for (const s of sec.suites) {
    w(`| ${s.title} | ${s.runner} | \`${s.cwd}\` | ${cell(s.passed)} | ${s.status} | ${s.why} |`)
  }
  w()
  const skipped = sec.suites.filter((s) => s.status === 'POMINIETY')
  if (skipped.length > 0) {
    w('[Zestaw pominięty to nie zestaw zaliczony.]{.lbl} W tym przebiegu nie uruchomiono:')
    for (const s of skipped) w(`- **${s.title}** — ${s.reason}.`)
    w()
  }
  w('## 4. Przemiatanie powierzchni BFF')
  w()
  w(`Sonda na żywo pod \`${sec.liveSweep.baseUrl}\` (status: **${sec.liveSweep.status}**), każde żądanie`)
  w('**bez ciasteczka sesji i bez nagłówka `Authorization`**. Trasy odkrywane z dysku')
  w('(`apps/web/app/api/**/route.ts`), nie z listy w kodzie — nowa trasa jest obejmowana automatycznie.')
  w('Bramkę egzekwuje `apps/web/middleware.ts`; regresję pilnuje `apps/web/lib/api-gate.security.test.ts`,')
  w('który uruchamia realny `middleware()` po wszystkich odkrytych trasach i po metodach')
  w('GET / POST / PATCH / DELETE.')
  w()
  w('| Trasa | Adres sondy | Oczekiwanie | Kod HTTP | Wynik |')
  w('|---|---|---|---:|---|')
  for (const p of sec.liveSweep.probes) {
    w(`| \`${p.route}\` | \`${p.url}\` | ${p.expectation} | ${cell(p.status)} | ${p.ok ? 'zgodny' : 'NIEZGODNY'} |`)
  }
  w()
  const gated = sec.liveSweep.probes.filter((p) => p.expectation === 'BRAMKOWANA')
  const publiczne = sec.liveSweep.probes.filter((p) => p.expectation === 'PUBLICZNA')
  w(`[Trzy trasy są publiczne celowo.]{.lbl} Z ${sec.liveSweep.probes.length} tras BFF **${gated.length}**`)
  w(`odmawia anonimowi (401), a **${publiczne.length}** pozostaje otwartych: to kroki wykonywane PRZED`)
  w('powstaniem jakiejkolwiek sesji (rejestracja: sprawdzenie dostępności adresu, zgłoszenie, status')
  w('udostępniania). Żadna z nich nie sięga do `tenant-runtime` ani nie dotyka danych osobowych.')
  w('Ich lista jest przypięta co do liczby i nazwy w `apps/web/lib/api-gate.ts` (`PUBLICZNE_API`),')
  w('więc czwarta trasa publiczna nie powstanie po cichu.')
  w()
  w('## 5. Nagłówki bezpieczeństwa na bramie')
  w()
  w(`Sonda na żywo pod \`${sec.headerSweep.baseUrl}\` (status: **${sec.headerSweep.status}**). Nagłówki`)
  w('ustawia jeden publiczny origin (`infra/caddy/Caddyfile`), więc obejmują jednakowo ekran SSR,')
  w('przekierowanie z bramki sesji i odmowę BFF. Kontrakt i uzasadnienie każdego nagłówka:')
  w('`scripts/lib/security-headers.mjs`; regresję pilnuje `scripts/security-headers.test.mjs`.')
  w()
  w('| Ścieżka | Kod | Nagłówek | Oczekiwano | Zmierzono | Wynik |')
  w('|---|---:|---|---|---|---|')
  for (const p of sec.headerSweep.probes) {
    for (const h of p.headers) {
      w(`| \`${p.path}\` | ${cell(p.status)} | \`${h.name}\` | \`${h.expected}\` | \`${h.actual ?? '(brak)'}\` | ${h.ok ? 'zgodny' : 'NIEZGODNY'} |`)
    }
  }
  w()
  w('[Zakres CSP jest świadomie wąski.]{.lbl} Polityka obejmuje `frame-ancestors`, `base-uri`')
  w('i `form-action` — dyrektywy bezpieczne dla Next.js bez zmian w aplikacji. Pełne `script-src`')
  w('wymagałoby nonców w każdym skrypcie hydracji i jest **poza zakresem M3 g**. Nagłówka HSTS')
  w('nie ustawiamy, bo origin demonstracyjny działa po czystym HTTP — byłaby to deklaracja bez pokrycia.')
  w()
  w('## 6. Luki niezamknięte w tym bloku')
  w()
  w('| Zapis harmonogramu | Stan faktyczny | Gdzie zgłoszone |')
  w('|---|---|---|')
  for (const [zapis, stan, gdzie] of LUKI) w(`| ${zapis} | ${stan} | ${gdzie} |`)
  w()
  w('::: keep')
  w('Dokument wygenerowany automatycznie z plików pomiarowych.')
  w()
  w('**Tomasz Wilk**\\')
  w('CTO\\')
  w('APP PRO sp. z o.o.')
  w(':::')
  w()

  fs.writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8')
  process.stdout.write(`ZAPISANO ${OUT} (${lines.length} wierszy)\n`)
  ```

- [ ] **Krok 41: Wygeneruj dokument i przeczytaj go.** `node scripts/raport-testy-koncowe.mjs` → `ZAPISANO …\testy-koncowe.md`. Otwórz plik i sprawdź cztery rzeczy: tabela §2 ma **3** wiersze ze zmierzonymi milisekundami, tabela §3 ma **12** wierszy, tabela §4 ma **17** wierszy, tabela §5 ma **18** wierszy (3 ścieżki × 6 nagłówków: pięć wymaganych + `x-powered-by`). Jeśli którakolwiek komórka mówi `nieodczytane` — to błąd w JSON-ie, nie w szablonie.

- [ ] **Krok 42: Weryfikacja negatywna generatora.** W PowerShellu:
  ```powershell
  Move-Item docs/raport-km3/build/perf-smoke.json docs/raport-km3/build/perf-smoke.json.bak
  node scripts/raport-testy-koncowe.mjs
  Write-Host "EXIT=$LASTEXITCODE"
  Move-Item docs/raport-km3/build/perf-smoke.json.bak docs/raport-km3/build/perf-smoke.json
  ```
  Oczekiwane: `BRAK …perf-smoke.json`, `Uruchom najpierw: pnpm test:perf oraz pnpm test:security`, `EXIT=1` i **nienadpisany** `testy-koncowe.md`. Generator nie umie wyprodukować raportu bez pomiaru — o to chodzi.

- [ ] **Krok 43: Wyodrębnij składanie `report.html` do skryptu i udowodnij, że formuła jest dokładna.** Utwórz `docs/raport-km3/build/make-report-html.mjs`:
  ```js
  // Sklada docs/raport-km3/report.html z build/style.html + build/body.html.
  // Formula odtworzona BAJT W BAJT z istniejacego report.html (31 671 B) — patrz weryfikacja ponizej.
  // Istnieje po to, zeby przebudowa raportu byla JEDNA komenda, a nie recznym sklejaniem w powloce.
  import fs from 'node:fs'
  import path from 'node:path'

  const HERE = import.meta.dirname
  const ROOT = path.join(HERE, '..')
  const TITLE = 'Raport z realizacji Kamienia Milowego 3 — HRobot.AI'
  const OUT = path.join(ROOT, 'report.html')

  const head = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${TITLE}</title>\n`
  const style = fs.readFileSync(path.join(HERE, 'style.html'), 'utf8')
  const body = fs.readFileSync(path.join(HERE, 'body.html'), 'utf8')

  fs.writeFileSync(OUT, `${head}${style}</head><body>\n${body}</body></html>\n`, 'utf8')
  console.log('WROTE', OUT, fs.statSync(OUT).size + 'B')
  ```
  Uruchom go **przed** jakąkolwiek zmianą w `Raport_KM3_HRobot.md` i sprawdź:
  ```powershell
  node docs/raport-km3/build/make-report-html.mjs
  git diff --stat docs/raport-km3/report.html
  ```
  Oczekiwane: `git diff --stat` **pusty**. To dowodzi, że skrypt odtwarza istniejący plik co do bajtu, więc dalsze przebudowy nie zmienią szaty raportu przez przypadek.

- [ ] **Krok 44: Napisz drukarkę PDF dla Zał. 6.** Utwórz `docs/raport-km3/build/print-testy-koncowe.mjs`:
  ```js
  // Zal. 6 → PDF. Sklada `testy-koncowe.md` przez pandoc w `testy-koncowe.html` (ten sam arkusz
  // stylu co raport glowny: build/style.html, ta sama formula sklejania co make-report-html.mjs)
  // i drukuje przez Chrome DevTools Protocol.
  //
  // MECHANIKA DRUKOWANIA jest przepisana z print-km3.mjs (to samo logo w naglowku, ta sama stopka
  // z numeracja stron, ten sam A4 i te same marginesy). RUZNICA: print-km3.mjs NIE uruchamia pandoca
  // ani nie sklada HTML-a — dostaje gotowy report.html. Tutaj oba kroki sa w jednym pliku, bo Zal. 6
  // powstaje z markdowna generowanego przy kazdym przebiegu.
  import { spawn, spawnSync } from 'node:child_process';
  import fs from 'node:fs';
  import path from 'node:path';

  const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const HERE = import.meta.dirname;
  const ROOT = path.join(HERE, '..');
  const MD = path.join(ROOT, 'testy-koncowe.md');
  const HTML_FILE = path.join(ROOT, 'testy-koncowe.html');
  const OUT = path.join(ROOT, 'Zal_6_Testy_koncowe.pdf');
  const LOGO = fs.readFileSync(path.join(ROOT, 'assets', 'logo-bar.png')).toString('base64');
  const PORT = 9338;
  const TITLE = 'Zał. 6 — Testy wydajności i bezpieczeństwa — HRobot.AI';

  // 1) markdown → body HTML. Pandoc 3.9 z domyslnymi rozszerzeniami produkuje dokladnie te znaczniki,
  //    ktorych uzywa build/body.html raportu glownego: `[x]{.lbl}` → <span class="lbl">,
  //    `::: keep` → <div class="keep">, `\` na koncu wiersza → <br />. Sprawdzone przebiegiem.
  const pandoc = spawnSync('pandoc', ['-f', 'markdown', '-t', 'html', '--wrap=none', MD], { encoding: 'utf8' });
  if (pandoc.status !== 0) throw new Error(`pandoc zakonczyl sie kodem ${pandoc.status}: ${pandoc.stderr}`);

  // 2) sklejenie dokumentu ta sama formula co report.html raportu glownego.
  const style = fs.readFileSync(path.join(HERE, 'style.html'), 'utf8');
  const head = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${TITLE}</title>\n`;
  fs.writeFileSync(HTML_FILE, `${head}${style}</head><body>\n${pandoc.stdout}</body></html>\n`, 'utf8');

  const HTML = 'file:///' + HTML_FILE.replace(/\\/g, '/');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--hide-scrollbars', '--disable-application-cache', '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\hr-km3-zal6-${Date.now()}`, HTML,
  ], { stdio: 'ignore' });

  async function getPageWS() {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json`);
        const list = await r.json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      } catch {}
      await sleep(300);
    }
    throw new Error('DevTools endpoint not ready');
  }

  function rpc(ws, id, method, params) {
    return new Promise((resolve, reject) => {
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === id) { ws.removeEventListener('message', onMsg); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  const wsUrl = await getPageWS();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  await rpc(ws, 1, 'Page.enable', {});
  await sleep(2500);

  const header = `<div style="width:100%; text-align:center; margin:0; padding:0;">
    <img src="data:image/png;base64,${LOGO}" style="height:34px;"></div>`;
  const footer = `<div style="width:100%; font-size:8px; color:#666; text-align:center; padding:0 12mm;">
    HRobot.AI · App Pro sp. z o.o. — Zał. 6 do Raportu KM3: testy wydajności i bezpieczeństwa · Poufne · Strona <span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

  const result = await rpc(ws, 2, 'Page.printToPDF', {
    landscape: false,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: header,
    footerTemplate: footer,
    paperWidth: 8.27, paperHeight: 11.69,
    marginTop: 0.72, marginBottom: 0.55, marginLeft: 0.63, marginRight: 0.63,
    preferCSSPageSize: false,
  });

  fs.writeFileSync(OUT, Buffer.from(result.data, 'base64'));
  console.log('WROTE', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
  ws.close();
  chrome.kill();
  process.exit(0);
  ```

- [ ] **Krok 45: Dodaj komendę `raport:testy` do korzenia.** W `package.json`, w `"scripts"`, po `"test:security"`, wstaw:
  ```json
    "raport:testy": "node scripts/raport-testy-koncowe.mjs && node docs/raport-km3/build/print-testy-koncowe.mjs",
  ```

- [ ] **Krok 46: Zbuduj PDF jedną komendą.** `pnpm raport:testy`. Oczekiwane: `ZAPISANO …\testy-koncowe.md`, potem `WROTE …\Zal_6_Testy_koncowe.pdf <rozmiar>KB`. Otwórz PDF i sprawdź nagłówek z logo oraz stopkę `Strona n / N` — ta sama szata co `Raport_KM3_HRobot.pdf` (kryterium A5).

- [ ] **Krok 47: Skoryguj nieaktualne kotwice demo w raporcie głównym.** `docs/raport-km3/Raport_KM3_HRobot.md:227` i `:406` podają „36 pracowników, 832 zmiany”; żywy stos zwraca 39 i 1558 (policzone z `/api/employees` → 39 rekordów i `/api/grafik/shifts` → 1558 rekordów), zgodnie z kotwicami w `docs/demo/2026-08-10-demo-4mobility-parp.md:48`. Pozostawienie rozjazdu w jednym pakiecie dla PARP jest gorsze niż korekta dwóch liczb. Wykonaj:
  ```powershell
  (Get-Content docs/raport-km3/Raport_KM3_HRobot.md -Raw) -replace '36 pracowników, 832 zmiany', '39 pracowników, 1558 zmian' | Set-Content docs/raport-km3/Raport_KM3_HRobot.md -Encoding utf8
  Select-String -Path docs/raport-km3/Raport_KM3_HRobot.md -Pattern '39 pracowników, 1558 zmian'
  ```
  Oczekiwane: **dwa** trafienia (wiersze 227 i 406). To jedyna zmiana **wartości** w §5 — cztery istniejące deklaracje ograniczeń zostają nietknięte co do treści.

- [ ] **Krok 48: Dopisz dwie pozycje do §5 (nie przepisuj sekcji).** W `docs/raport-km3/Raport_KM3_HRobot.md`, na końcu listy w sekcji `# 5. Ograniczenia realizacji demonstracyjnej (uczciwość)` — bezpośrednio po punkcie `[Dane syntetyczne.]{.lbl}` i przed nagłówkiem `# 6.` — wstaw, dokładnie wzorcem czterech istniejących (`[Etykieta.]{.lbl}` + fakt + odsyłacz do dowodu):
  ```markdown
  - [Pomiar wydajności jest demonstracyjny.]{.lbl} Czasy odpowiedzi (p50/p90/p97,5/p99)
    zmierzono narzędziem `autocannon` na środowisku demonstracyjnym --- jeden host, usługi
    w `docker compose`, dane syntetyczne --- a nie na środowisku produkcyjnym o docelowej
    skali. Wartości są punktem odniesienia dla dalszej optymalizacji, **nie deklaracją SLA**.
    `autocannon` nie publikuje percentyla p95, więc próg rozliczono na p97,5, czyli wartości
    ostrzejszej. Dowód: Zał. 6 (`docs/raport-km3/testy-koncowe.md`).
  - [Nagłówki bezpieczeństwa w zakresie podstawowym.]{.lbl} Brama publiczna ustawia
    `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`
    oraz `Content-Security-Policy` ograniczoną do `frame-ancestors`/`base-uri`/`form-action`.
    Pełna polityka `script-src` (noncе dla skryptów hydracji Next.js) i `Strict-Transport-Security`
    **nie zostały wdrożone** --- ta druga świadomie, bo origin demonstracyjny działa po HTTP.
    Dowód i pomiar: Zał. 6 §5.
  ```

- [ ] **Krok 49: Dopisz Zał. 6 do wykazu w §8.** W `docs/raport-km3/Raport_KM3_HRobot.md`, w tabeli sekcji `# 8. Wykaz załączników`, bezpośrednio pod wierszem zaczynającym się `  **Zał. 5**`, wstaw wiersz w tym samym formacie (dwa wiodące spacje, trzy spacje po numerze, bez zmiany linii z myślnikami wyznaczającej szerokości kolumn):
  ```markdown
    **Zał. 6**   Testy wydajności i bezpieczeństwa oraz raport końcowy (M3 g) --- `docs/raport-km3/testy-koncowe.md`
  ```
  Uwaga na kolejność z Blokiem B: Blok B dopisuje `**Zał. 7**` pod tym wierszem. Zmiany są rozłączne i sekwencyjne — konfliktu scalania nie będzie.

- [ ] **Krok 50: Przebuduj PDF raportu głównego, żeby wchłonął §5 i §8.**
  ```powershell
  pandoc -f markdown -t html --wrap=none docs/raport-km3/Raport_KM3_HRobot.md -o docs/raport-km3/build/body.html
  node docs/raport-km3/build/make-report-html.mjs
  node docs/raport-km3/build/print-km3.mjs
  ```
  Oczekiwane: `WROTE …\report.html <rozmiar>B`, potem `WROTE …\Raport_KM3_HRobot.pdf <rozmiar>KB`. Sprawdź w PDF, że §5 ma **sześć** punktów (cztery istniejące + dwa z Kroku 48), a §8 **sześć** wierszy.

- [ ] **Krok 51: Bramka końcowa — wszystko zielone jedną serią.** Uruchom po kolei i zapisz wyniki:
  ```powershell
  pnpm test:scripts                     # → # pass 26, # fail 0
  pnpm test:security                    # → kod 0, 10/12 zestawow zielonych, 265 testow
  npx turbo run test --force            # → wszystkie pakiety zielone
  ```
  `--force` jest konieczne: turbo potrafi odtworzyć zielony log z pamięci podręcznej i wtedy nowy plik `api-gate.security.test.ts` nigdy się nie uruchomi. Po przebiegu sprawdź w logu pakietu `@hrobot/web` obecność wiersza `lib/api-gate.security.test.ts`. Kryteria A1–A5 spełnione dowodem z przebiegu, nie deklaracją.

- [ ] **Krok 52: Commit.**
  ```powershell
  git add scripts/raport-testy-koncowe.mjs docs/raport-km3/build/make-report-html.mjs docs/raport-km3/build/print-testy-koncowe.mjs docs/raport-km3/testy-koncowe.md docs/raport-km3/testy-koncowe.html docs/raport-km3/Zal_6_Testy_koncowe.pdf docs/raport-km3/Raport_KM3_HRobot.md docs/raport-km3/build/body.html docs/raport-km3/report.html docs/raport-km3/Raport_KM3_HRobot.pdf package.json
  git commit -m "docs(km3-a): Zal. 6 — testy wydajnosci i bezpieczenstwa z realnego przebiegu + §5/§8 raportu"
  ```

---

**Ryzyka bloku A:**

- **Pomiar zależy od stanu maszyny.** `perf-smoke.mjs` mierzy jeden host z dziesięcioma kontenerami; przebieg puszczony obok kompilacji da inne liczby. Łagodzenie: `perf-smoke.json` zapisuje `gitSha` i identyfikatory obrazów, więc każdy wynik da się przypisać do konkretnego stanu; raport nazywa pomiar demonstracyjnym (§5, Krok 48).
- **Token demo jest widoczny w liście procesów.** `perf-smoke.mjs` przekazuje token do `autocannon` przez `argv` (`-H authorization=Bearer …`), więc przez czas przebiegu widać go w `tasklist`/`ps`. Do stdout skryptu ani do JSON-a nie trafia. To konto demonstracyjne, hasło `demo-staging-2026` jest tym samym, które `docker-compose.yml` podaje jako `KEYCLOAK_DEMO_PASSWORD`. Na innym środowisku podaj `PERF_PASSWORD` i traktuj host pomiarowy jak zaufany.
- **Zmiana w bramie dotyka każdej odpowiedzi produktu.** Blok nagłówków w `infra/caddy/Caddyfile` zmienia wszystkie odpowiedzi HTTP. Ryzyko funkcjonalne jest niskie i zmierzone: `frame-ancestors 'none'` blokuje wyłącznie osadzanie w ramce (produkt tego nie używa), `form-action 'self'` nie dotyka logowania, bo login jest **akcją serwerową** na tym samym originie (`apps/web/lib/auth-actions.ts`, `<form action={formAction}>`), a `microphone=(self)` zostawia mikrofon Agentowi Głosowemu. Wycofanie to `git checkout -- infra/caddy/Caddyfile` + `caddy reload` — sekundy, bez przebudowy obrazu.
- **`--testPathPattern` jest przestarzałe w Jest 30.** Repo stoi na 29.7.0, gdzie flaga działa bez ostrzeżenia (zweryfikowane przebiegiem). Podbicie Jesta do 30 zapali zestawy `runtime-*` na czerwono z czytelnym komunikatem — zamiana na `--testPathPatterns` jest wtedy jednowierszowa w `scripts/lib/security-suites.mjs`.
- **Dwie kopie logiki odkrywania tras** (`apps/web/lib/api-gate.security.test.ts` w TS i `scripts/lib/bff-routes.mjs` w ESM) — skrypt w korzeniu nie zaimportuje TypeScriptu z `apps/web`. Obie przypinają te same liczby (17 / 14 / 3), więc rozjechanie się zapala jedną z nich. Pierwsza wersja mirrora miała w tym miejscu realny błąd (`path.join('', x)` gubi wiodący ukośnik → adresy typu `/apiemployees`, wszystkie sondy 404); test z Kroku 30 zawiera teraz asercję `startsWith('/api/')`, która łapie dokładnie tę klasę pomyłki.
- **`stt-service` bez `.venv` i izolacja najemców bez `POSTGRES_SUPERUSER_URL`** — dwa zestawy raportowane jako `POMINIETY`. Ryzyko wizerunkowe wobec recenzenta jest realne, ale mniejsze niż udawanie, że przeszły. Można je zdjąć: `python -m venv stt-service/.venv; stt-service/.venv/Scripts/pip install -r stt-service/requirements.txt` oraz ustawienie `POSTGRES_SUPERUSER_URL` (kontener `hrobot-postgres-1`) przed `pnpm test:security`.
- **Kotwice 36/832 występują też poza raportem KM3.** Pełna lista wystąpień: `docs/HRobotDocs/m-zgodnosc-eu-ai-act.md:142`, `docs/raport-km3/macierz-pokrycia-dokumenty.md:22`, `docs/demo/M2-demo-walkthrough.md:5` i `:29`, `data/m2-evidence/rodo-security-checklist.md:6` (wariant „~36 pracowników”) oraz 11 plików w `docs/superpowers/`. Krok 47 poprawia **wyłącznie** `Raport_KM3_HRobot.md`, bo tylko ten dokument trafia do PARP w jednym pakiecie z Zał. 6. Pozostałe zostają do osobnej decyzji.
- **Blok A nie dotyka `compositeScore`.** Żaden plik z tego bloku nie wchodzi do `apps/tenant-runtime/src/strategic-brain/`; jedyne odwołanie to wiersz w tabeli luk (§6 dokumentu Zał. 6), opisujący decyzję Bloku F. `scoring.util.ts:100` pozostaje nietknięty.

**Wycofanie bloku A:**

Blok dodaje skrypty, dwa testy i dokumenty oraz zmienia **jedną** rzecz w ścieżce wykonania produktu: nagłówki HTTP ustawiane przez bramę.

1. **Pełne wycofanie:** `git revert` sześciu commitów (Zadania 1–6) w odwrotnej kolejności. Schemat bazy, dane demo i konfiguracja kontenerów poza `Caddyfile` są nietknięte; po rewercie wykonaj `docker exec hrobot-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`, żeby brama wróciła do konfiguracji sprzed bloku.
2. **Wycofanie samych nagłówków:** `git checkout <sha przed Zadaniem 4> -- infra/caddy/Caddyfile` + `caddy reload`. Test `scripts/security-headers.test.mjs` zapali się wtedy na czerwono i zestaw `edge-security-headers` będzie `CZERWONY` — to zamierzone: konfiguracja i jej strażnik cofa się razem albo wcale.
3. **Wycofanie artefaktów raportowych:** usuń `docs/raport-km3/testy-koncowe.md`, `…/testy-koncowe.html`, `…/Zal_6_Testy_koncowe.pdf`, `…/build/perf-smoke.json`, `…/build/security-run.json`, `…/build/print-testy-koncowe.mjs` i cofnij trzy edycje w `Raport_KM3_HRobot.md` (Kroki 47–49), po czym przebuduj PDF raportu głównego (Krok 50). Wpływ na produkt: zerowy.
4. **Wycofanie samego narzędzia, z zachowaniem raportu:** usuń skrypty korzenia (`perf-smoke.mjs`, `security-suite.mjs`, `raport-testy-koncowe.mjs`, `scripts/lib/**`) i wpisy `test:perf` / `test:scripts` / `test:security` / `raport:testy` z `package.json`. Wygenerowany Zał. 6 pozostaje ważnym zapisem przebiegu z konkretnej daty i rewizji.
5. **Nowy test `apps/web/lib/api-gate.security.test.ts`** można usunąć bez konsekwencji — `api-gate.test.ts` (polityka, trasy z dysku) i `middleware-api-gate.test.ts` (realny `middleware()`, lista adresów w kodzie, tylko GET) wracają wtedy do roli jedynych strażników, czyli do stanu sprzed bloku.

---

## Blok B — Audyt powdrożeniowy (M3 i)

*Zadania globalne 7–18. Kroki numerowane ciągiem 1–65 w obrębie bloku.*

**Ustalenia sprzeczne z założeniem:**

Dziewięć rzeczy w briefie i w pierwszej wersji planu nie zgadza się ze stanem repozytorium i żywego stosu (sprawdzone 2026-08-12 na `C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2`, gałąź `feat/demo-4mobility`). Plan poniżej realizuje wariant realny, nie założony.

1. **`docker compose` bez `-p hrobot` nie widzi niczego.** Katalog roboczy nazywa się `HRobot-m2`, więc Compose wylicza z niego projekt `hrobot-m2`. Zweryfikowane: `docker compose ps` zwraca pustą listę, `docker compose -p hrobot ps` zwraca 10 kontenerów. `.env` nie ustawia `COMPOSE_PROJECT_NAME`. **Każda komenda Compose w tym bloku ma jawne `-p hrobot`.**
2. **10 usług ≠ 11 usług z pliku.** `docker-compose.yml` definiuje 11 serwisów, ale `agent` siedzi za profilem `agent` i celowo nigdy nie startuje („RESERVED SLOT — RL agent"). Uruchomionych jest dokładnie 10: `postgres`, `redis`, `rabbitmq`, `keycloak`, `control-plane`, `tenant-runtime`, `optimizer`, `web`, `caddy`, `stt`. To ta dziesiątka jest audytowana.
3. **„Liczba zastosowanych migracji" jako 13/13 zapaliłaby czerwone na zdrowym stacku.** `packages/db/prisma/tenant/migrations/` ma 13 katalogów, a `_prisma_migrations` w bazie `hrobot_t_900d948b` ma **6 wpisów** (`20260527044143_init_tenant` … `20260710000000_employee_preferences`) — reszta weszła surowym SQL-em (`scripts/apply-m2-tenant-schema.sql`) z pominięciem rejestru Prismy. Bramką audytu jest więc **zgodność struktury**: 24 tabele z `@@map` w `packages/db/generated/tenant/schema.prisma` wobec 24 tabel w schemacie `public` (bez `_prisma_migrations`) — zweryfikowane, zero rozjazdu w obie strony. Liczba wpisów w rejestrze i liczba katalogów to wartości raportowane z notą wyjaśniającą.
4. **„Szyfrowanie PESEL" jako kontrola zero-jedynkowa też zapaliłaby czerwone.** Zmierzone: 39 pracowników, **0** PESEL-i w postaci jawnej (11 cyfr), **36** zaszyfrowanych AES-256-GCM (bajt wersji klucza = 1), **3** z literalną zaślepką `DEMO-PLACEHOLDER-UNENCRYPTED-PESEL-*` wstawioną przez `scripts/seed-demo-m2-modules.sql` i `scripts/seed-demo-strategic-brain.sql`, które omijają `encryptEmployeePesel()` (`packages/db/src/employeePii.ts`). Bramką (BŁĄD) jest zero PESEL-i jawnych; trzy zaślepki to status UWAGA i rekomendacja optymalizacyjna.
5. **Połowa obrazów nie ma wersji.** `caddy:2-alpine`, `postgres:16-alpine`, `redis:7-alpine`, `rabbitmq:3.13-management-alpine`, `quay.io/keycloak/keycloak:26.0` mają tagi; `hrobot-web`, `hrobot-tenant-runtime`, `hrobot-control-plane`, `hrobot-optimizer`, `hrobot-stt` są budowane lokalnie i nie mają żadnego tagu wersji. „Wersja obrazu" to zatem trójka: referencja obrazu + 12-znakowy skrót ID + data utworzenia kontenera. Brak tagów trafia do rekomendacji.
6. **`scripts/` nie ma runnera testów.** Katalog nie jest pakietem pnpm (`pnpm-workspace.yaml`: `apps/*`, `packages/*`, `agent`), więc nie obejmuje go ani jest, ani vitest. TDD prowadzę na wbudowanym `node --test` (Node 22.12 — zweryfikowane), zgodnie z zasadą z `scripts/golden-path-probe.mjs:31` („Deliberately dependency-free (node: builtins + fetch)…").
7. **`node --test` przy błędzie linkowania modułu raportuje `# fail 1`, nie tyle ile jest testów.** Zweryfikowane empirycznie: `node --test <plik>` traktuje CAŁY plik jako jeden podtest. `import` w ESM jest hoistowany, więc brakujący eksport wywala plik na etapie linkowania — żaden `test()` się nie uruchamia i wyjście to `# tests 1 / # pass 0 / # fail 1`. **Każdy krok „zobacz, że pada" w tym planie oczekuje `# fail 1` plus konkretnej treści błędu.** To jest poprawny czerwony stan dla tego runnera, nie obejście.
8. **Optimizer ma dwóch konsumentów, nie jednego.** Poza `POST /grafik/solve` (`apps/tenant-runtime/src/grafik/optimizer.client.ts`) solver wywołuje też bramka wykonalności zamiany zmian: `apps/tenant-runtime/src/shift-swap/optimizer-swap-feasibility.validator.ts` przez `apps/tenant-runtime/src/shift-swap/optimizer.client.ts` (`POST /solve` na `http://optimizer:8000`). Wybór `optimizer` do weryfikacji negatywnej pozostaje słuszny — audyt nie dotyka ŻADNEJ z tych dwóch ścieżek — ale ryzyko zatrzymania usługi obejmuje obie.
9. **Suma ustaleń na zdrowym stacku to 37 × OK, 1 × UWAGA, 0 × BŁĄD.** Zweryfikowane uruchomieniem gotowej implementacji: 38 kontroli (10 + 10 + 4 + 7 + 3 + 4), jedyna UWAGA to B4-06 (36 z 39 PESEL-i zaszyfrowanych), 5 rekomendacji.

Wartości odniesienia zmierzone przed napisaniem planu (żywy stos, 2026-08-12): RBAC `GET /api/grafik/shifts` → ADMIN 1558, MANAGER 531, PRACOWNIK 104. `GET /api/employees` (ADMIN) → 39 rekordów, dokładnie 9 pól `SAFE_SELECT` (`apps/tenant-runtime/src/employees/employees.service.ts:24`), zero PII. Wyzwalacze na `audit_log`: `audit_log_no_update_delete`, `audit_log_no_truncate`; próba `UPDATE` i `DELETE` odrzucana komunikatem `audit_log is append-only; UPDATE and DELETE are not permitted` (funkcja `prevent_audit_log_mutation()` z migracji `20260527044143_init_tenant`). Kotwice: 39 pracowników, 1558 zmian (1557 `AUTO` + 1 `MANUAL`), 4 jednostki.

---

### Zadanie 7 (B-1): Szkielet modułu czystych funkcji i model ustalenia

**Pliki:**
- Utwórz: `scripts/audyt/lib.mjs`
- Test: `scripts/audyt/lib.test.mjs`

- [ ] **Krok 1: Napisz czerwony test modelu ustalenia.** Utwórz `scripts/audyt/lib.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_ANCHORS, EXPECTED_SERVICES, exitCode, failedNames, finding } from './lib.mjs'

test('EXPECTED_SERVICES wymienia 10 usług uruchamianych w projekcie hrobot', () => {
  assert.equal(EXPECTED_SERVICES.length, 10)
  assert.ok(!EXPECTED_SERVICES.includes('agent'), 'usługa agent siedzi za profilem "agent" i nie startuje')
  assert.deepEqual(EXPECTED_SERVICES.slice(0, 4), ['postgres', 'redis', 'rabbitmq', 'keycloak'])
})

test('DEMO_ANCHORS trzyma kotwice rozliczane w KM3', () => {
  assert.deepEqual(DEMO_ANCHORS, { employees: 39, shifts: 1558, units: 4 })
})

test('exitCode zwraca 1 tylko wtedy, gdy istnieje ustalenie o statusie BLAD', () => {
  const ok = finding('B1-01', 'Wersje obrazów', 'redis', 'redis:7-alpine', 'running', 'OK')
  const uwaga = finding('B1-02', 'Wersje obrazów', 'web', 'RestartCount=3', 'RestartCount = 0', 'UWAGA')
  const blad = finding('B2-07', 'Healthchecki', 'optimizer', 'exited / brak sondy', 'running / healthy', 'BLAD')
  assert.equal(exitCode([ok, uwaga]), 0)
  assert.equal(exitCode([ok, uwaga, blad]), 1)
  assert.deepEqual(failedNames([ok, uwaga, blad]), ['Healthchecki/optimizer'])
})
```

- [ ] **Krok 2: Uruchom test i zobacz, że pada.** Komenda (PowerShell): `Set-Location C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2; node --test scripts/audyt/lib.test.mjs`. Oczekiwane wyjście zawiera linię `# Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\scripts\audyt\lib.mjs' imported from …lib.test.mjs`, a podsumowanie to `# tests 1`, `# pass 0`, `# fail 1`. Kod wyjścia 1. (Jeden „fail" zamiast trzech, bo `node --test` liczy cały plik jako jeden podtest — patrz ustalenie 7.)

- [ ] **Krok 3: Napisz minimalną implementację.** Utwórz `scripts/audyt/lib.mjs`:

```js
// Czyste funkcje audytu powdrożeniowego (zadanie M3 i harmonogramu PARP).
//
// ZERO wejścia/wyjścia: wszystkie dane wchodzą argumentem, więc każdą regułę da się sprawdzić
// testem bez Dockera, bazy i sieci. Warstwa I/O (docker, psql, HTTP) siedzi wyłącznie
// w scripts/audyt-powdrozeniowy.mjs. Bez zależności zewnętrznych — jak reszta scripts/.

/**
 * 10 usług faktycznie uruchamianych w projekcie compose `hrobot`.
 * `agent` z docker-compose.yml NIE jest tu wymieniony: siedzi za profilem "agent"
 * ("RESERVED SLOT — RL agent") i nie startuje ani przez `up -d`, ani przez `--profile full`.
 */
export const EXPECTED_SERVICES = [
  'postgres',
  'redis',
  'rabbitmq',
  'keycloak',
  'control-plane',
  'tenant-runtime',
  'optimizer',
  'web',
  'caddy',
  'stt',
]

/** Kotwice danych demo rozliczane w KM3. Zmiana którejkolwiek unieważnia raport. */
export const DEMO_ANCHORS = { employees: 39, shifts: 1558, units: 4 }

/** Jedno ustalenie audytu. `status`: 'OK' | 'UWAGA' | 'BLAD'. */
export function finding(id, kategoria, nazwa, zmierzone, oczekiwane, status) {
  return { id, kategoria, nazwa, zmierzone, oczekiwane, status }
}

/** Kod wyjścia procesu: 1, gdy choć jedno ustalenie ma status BLAD. */
export function exitCode(findings) {
  return findings.some((f) => f.status === 'BLAD') ? 1 : 0
}

/** Nazwy niezaliczonych kontroli — to one trafiają na stderr i do nagłówka raportu. */
export function failedNames(findings) {
  return findings.filter((f) => f.status === 'BLAD').map((f) => `${f.kategoria}/${f.nazwa}`)
}
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# tests 3`, `# pass 3`, `# fail 0`, kod wyjścia 0.

- [ ] **Krok 5: Commit.** `git add scripts/audyt; git commit -m "feat(audyt): model ustalenia i rejestr 10 usług projektu hrobot"`

---

### Zadanie 8 (B-2): Kategoria 1 i 2 — wersje obrazów, RestartCount, healthchecki

**Pliki:**
- Zmień: `scripts/audyt/lib.mjs`
- Test: `scripts/audyt/lib.test.mjs`

- [ ] **Krok 6: Dopisz czerwony test `evaluateServices` na realnym kształcie danych.** Dopisz na końcu `scripts/audyt/lib.test.mjs` (deklaracja `import` w ESM jest hoistowana, więc pozycja w pliku nie ma znaczenia dla wykonania — trzymamy ją przy testach, które jej używają):

```js
import { evaluateServices } from './lib.mjs'

/**
 * Kształt 1:1 z `docker compose -p hrobot ps -a --format json` (NDJSON, Compose v5.3.1).
 * Zweryfikowane klucze: Service, Name, State, Health, Image.
 */
const rosterFixture = (over = {}) =>
  EXPECTED_SERVICES.map((service) => ({
    Service: service,
    Name: `hrobot-${service}-1`,
    State: 'running',
    Health: 'healthy',
    Image: service === 'redis' ? 'redis:7-alpine' : `hrobot-${service}`,
    ...(over[service] ?? {}),
  }))

/** Kształt 1:1 z `docker inspect <nazwy>` (tablica JSON). Digest i data — realne, z hrobot-redis-1. */
const inspectedFixture = (over = {}) =>
  EXPECTED_SERVICES.map((service) => ({
    Name: `/hrobot-${service}-1`,
    Image: 'sha256:ee64a64eaab618d88051c3ade8f6352d11531fcf79d9a4818b9b183d8c1d18ba',
    Created: '2026-08-10T03:26:50.882967701Z',
    RestartCount: 0,
    ...(over[service] ?? {}),
  }))

test('evaluateServices zwraca po dwa ustalenia na usługę: wersja obrazu i healthcheck', () => {
  const out = evaluateServices(rosterFixture(), inspectedFixture())
  assert.equal(out.length, 20)
  assert.equal(out.filter((f) => f.kategoria === 'Wersje obrazów').length, 10)
  assert.equal(out.filter((f) => f.kategoria === 'Healthchecki').length, 10)
  assert.equal(exitCode(out), 0)
})

test('evaluateServices podaje zmierzoną wersję obrazu, skrót ID i RestartCount, nie słowo OK', () => {
  const redis = evaluateServices(rosterFixture(), inspectedFixture()).find((f) => f.id === 'B1-02')
  assert.equal(redis.nazwa, 'redis')
  assert.equal(
    redis.zmierzone,
    'redis:7-alpine · id ee64a64eaab6 · kontener z 2026-08-10 03:26:50 UTC · RestartCount=0',
  )
  assert.equal(redis.status, 'OK')
})

test('evaluateServices oznacza RestartCount > 0 jako UWAGA, nie jako awarię', () => {
  const out = evaluateServices(rosterFixture(), inspectedFixture({ web: { RestartCount: 4 } }))
  const web = out.find((f) => f.id === 'B1-08')
  assert.match(web.zmierzone, /RestartCount=4$/)
  assert.equal(web.status, 'UWAGA')
  assert.equal(exitCode(out), 0)
})

test('evaluateServices wskazuje z nazwy usługę zatrzymaną i zwraca kod wyjścia 1', () => {
  const out = evaluateServices(rosterFixture({ optimizer: { State: 'exited', Health: '' } }), inspectedFixture())
  assert.equal(exitCode(out), 1)
  assert.deepEqual(failedNames(out), ['Wersje obrazów/optimizer', 'Healthchecki/optimizer'])
  assert.equal(out.find((f) => f.id === 'B2-07').zmierzone, 'exited / brak sondy')
})

test('evaluateServices traktuje brak kontenera jako błąd, a nie jako pominięcie', () => {
  const bez = rosterFixture().filter((r) => r.Service !== 'stt')
  const out = evaluateServices(bez, inspectedFixture())
  assert.equal(exitCode(out), 1)
  assert.deepEqual(failedNames(out), ['Wersje obrazów/stt', 'Healthchecki/stt'])
  assert.equal(out.find((f) => f.id === 'B1-10').zmierzone, 'brak kontenera w projekcie compose')
})
```

- [ ] **Krok 7: Uruchom test i zobacz, że pada.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane wyjście zawiera `# SyntaxError: The requested module './lib.mjs' does not provide an export named 'evaluateServices'`, a podsumowanie to `# tests 1`, `# pass 0`, `# fail 1`.

- [ ] **Krok 8: Zaimplementuj `evaluateServices`.** Dopisz na końcu `scripts/audyt/lib.mjs`:

```js
/**
 * Kategoria 1 (wersje obrazów + RestartCount) i 2 (healthchecki).
 *
 * @param roster    wynik `docker compose -p hrobot ps -a --format json` (NDJSON → tablica obiektów)
 * @param inspected wynik `docker inspect <nazwy kontenerów>` (tablica JSON)
 *
 * Obrazy budowane lokalnie (hrobot-web, hrobot-tenant-runtime, hrobot-control-plane,
 * hrobot-optimizer, hrobot-stt) nie mają tagu wersji, dlatego wersją jest trójka:
 * referencja obrazu + 12-znakowy skrót ID + data utworzenia kontenera.
 *
 * KONTRAKT NA RestartCount: pole jest ZAWSZE łańcuchem `RestartCount=<liczba nieujemna>` albo
 * `RestartCount nieodczytany`. Nigdy liczbą ujemną-wartownikiem — buildRecommendations parsuje to
 * pole wyrażeniem /RestartCount=[1-9]\d*$/ i wartownik cicho by z niego wypadł.
 */
export function evaluateServices(roster, inspected) {
  const byService = new Map(roster.map((r) => [r.Service, r]))
  const byName = new Map(inspected.map((c) => [String(c.Name).replace(/^\//, ''), c]))
  const wersje = []
  const zdrowie = []

  EXPECTED_SERVICES.forEach((service, index) => {
    const nr = String(index + 1).padStart(2, '0')
    const row = byService.get(service)

    if (!row) {
      wersje.push(
        finding(`B1-${nr}`, 'Wersje obrazów', service, 'brak kontenera w projekcie compose', 'kontener istnieje', 'BLAD'),
      )
      zdrowie.push(
        finding(`B2-${nr}`, 'Healthchecki', service, 'brak kontenera w projekcie compose', 'running / healthy', 'BLAD'),
      )
      return
    }

    const container = byName.get(row.Name)
    const restarts = container ? `RestartCount=${container.RestartCount}` : 'RestartCount nieodczytany'
    const imageId = container ? String(container.Image).replace(/^sha256:/, '').slice(0, 12) : 'nieznany'
    const created = container ? String(container.Created).slice(0, 19).replace('T', ' ') : 'nieznana'
    const restartsOk = Boolean(container) && container.RestartCount === 0

    wersje.push(
      finding(
        `B1-${nr}`,
        'Wersje obrazów',
        service,
        `${row.Image} · id ${imageId} · kontener z ${created} UTC · ${restarts}`,
        'stan running, RestartCount = 0',
        row.State !== 'running' ? 'BLAD' : restartsOk ? 'OK' : 'UWAGA',
      ),
    )
    zdrowie.push(
      finding(
        `B2-${nr}`,
        'Healthchecki',
        service,
        `${row.State} / ${row.Health || 'brak sondy'}`,
        'running / healthy',
        row.State === 'running' && row.Health === 'healthy' ? 'OK' : 'BLAD',
      ),
    )
  })

  return [...wersje, ...zdrowie]
}
```

- [ ] **Krok 9: Uruchom test i zobacz zielone.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# tests 8`, `# pass 8`, `# fail 0`.

- [ ] **Krok 10: Commit.** `git add scripts/audyt; git commit -m "feat(audyt): kategorie 1-2 — wersje obrazów, RestartCount, healthchecki"`

---

### Zadanie 9 (B-3): Kategoria 3 — migracje i zgodność schematu

**Pliki:**
- Zmień: `scripts/audyt/lib.mjs`
- Test: `scripts/audyt/lib.test.mjs`

- [ ] **Krok 11: Dopisz czerwony test `evaluateSchema` z realnymi liczbami stacku.** Dopisz na końcu `scripts/audyt/lib.test.mjs`:

```js
import { evaluateSchema } from './lib.mjs'

const schemaWejscie = (over = {}) => ({
  registryRows: 6,
  migrationDirs: 13,
  expectedTables: ['audit_log', 'employees', 'shifts'],
  actualTables: ['audit_log', 'employees', 'shifts'],
  ...over,
})

test('evaluateSchema nie zapala czerwonego na rejestrze niepełnym względem katalogów', () => {
  const out = evaluateSchema(schemaWejscie())
  assert.equal(exitCode(out), 0)
  assert.equal(out.find((f) => f.id === 'B3-01').zmierzone, '6')
  assert.equal(out.find((f) => f.id === 'B3-02').zmierzone, '13')
  assert.equal(out.find((f) => f.id === 'B3-03').zmierzone, '3 z 3')
})

test('evaluateSchema zgłasza BLAD, gdy w bazie brakuje tabeli wymaganej przez schema.prisma', () => {
  const out = evaluateSchema(schemaWejscie({ actualTables: ['audit_log', 'shifts'] }))
  assert.equal(exitCode(out), 1)
  assert.equal(out.find((f) => f.id === 'B3-03').zmierzone, '2 z 3 (brakuje: employees)')
  assert.deepEqual(failedNames(out), ['Migracje/Tabele wymagane przez schema.prisma obecne w bazie'])
})

test('evaluateSchema zgłasza tabelę spoza schematu jako UWAGA, nie jako awarię', () => {
  const out = evaluateSchema(schemaWejscie({ actualTables: ['audit_log', 'employees', 'shifts', 'stara_tabela'] }))
  assert.equal(exitCode(out), 0)
  assert.equal(out.find((f) => f.id === 'B3-04').status, 'UWAGA')
  assert.equal(out.find((f) => f.id === 'B3-04').zmierzone, 'stara_tabela')
})

test('evaluateSchema zgłasza BLAD, gdy rejestr migracji jest pusty', () => {
  const out = evaluateSchema(schemaWejscie({ registryRows: 0 }))
  assert.equal(exitCode(out), 1)
  assert.equal(out.find((f) => f.id === 'B3-01').status, 'BLAD')
})
```

- [ ] **Krok 12: Uruchom test i zobacz, że pada.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# SyntaxError: The requested module './lib.mjs' does not provide an export named 'evaluateSchema'`, `# tests 1`, `# fail 1`.

- [ ] **Krok 13: Zaimplementuj `evaluateSchema`.** Dopisz na końcu `scripts/audyt/lib.mjs`:

```js
/**
 * Kategoria 3 — migracje i zgodność schematu.
 *
 * UWAGA METODOLOGICZNA. Rejestr `_prisma_migrations` w bazie demonstracyjnej ma 6 wpisów,
 * a repozytorium 13 katalogów migracji: część nałożono surowym SQL-em
 * (scripts/apply-m2-tenant-schema.sql) z pominięciem rejestru Prismy. Bramką (BLAD) jest
 * dlatego zgodność STRUKTURY — każda tabela wymagana przez @@map w schema.prisma istnieje
 * w bazie — a nie równość dwóch liczb, która na zdrowym stacku byłaby fałszywym alarmem.
 *
 * B3-04 celowo miesza jednostki: wartość zmierzona to LISTA NAZW tabel nadmiarowych (bo to ona
 * jest użyteczna dla czytelnika raportu), a wartość oczekiwana to LICZBA '0'. Kiedy nadmiarowych
 * nie ma, zmierzone też jest '0' i obie kolumny się zgadzają.
 */
export function evaluateSchema({ registryRows, migrationDirs, expectedTables, actualTables }) {
  const missing = expectedTables.filter((t) => !actualTables.includes(t))
  const extra = actualTables.filter((t) => !expectedTables.includes(t))
  const present = expectedTables.length - missing.length

  return [
    finding(
      'B3-01',
      'Migracje',
      'Wpisy w rejestrze _prisma_migrations',
      `${registryRows}`,
      '≥ 1 (rejestr niepełny — patrz nota w rozdziale 2 raportu)',
      registryRows >= 1 ? 'OK' : 'BLAD',
    ),
    finding(
      'B3-02',
      'Migracje',
      'Katalogi migracji w packages/db/prisma/tenant/migrations',
      `${migrationDirs}`,
      '13',
      migrationDirs === 13 ? 'OK' : 'UWAGA',
    ),
    finding(
      'B3-03',
      'Migracje',
      'Tabele wymagane przez schema.prisma obecne w bazie',
      `${present} z ${expectedTables.length}${missing.length ? ` (brakuje: ${missing.join(', ')})` : ''}`,
      `${expectedTables.length} z ${expectedTables.length}`,
      missing.length === 0 ? 'OK' : 'BLAD',
    ),
    finding(
      'B3-04',
      'Migracje',
      'Tabele w bazie spoza schema.prisma',
      extra.length ? extra.join(', ') : '0',
      '0',
      extra.length === 0 ? 'OK' : 'UWAGA',
    ),
  ]
}
```

- [ ] **Krok 14: Uruchom test i zobacz zielone.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# tests 12`, `# pass 12`, `# fail 0`.

- [ ] **Krok 15: Commit.** `git add scripts/audyt; git commit -m "feat(audyt): kategoria 3 — migracje i zgodnosc struktury schematu"`

---

### Zadanie 10 (B-4): Kategoria 4 — kontrole RODO (wyzwalacz, PESEL, SAFE_SELECT)

**Pliki:**
- Zmień: `scripts/audyt/lib.mjs`
- Test: `scripts/audyt/lib.test.mjs`

- [ ] **Krok 16: Dopisz czerwony test `evaluateRodo` na realnych wartościach stacku.** Dopisz na końcu `scripts/audyt/lib.test.mjs`:

```js
import { APPEND_ONLY_SENTINEL, PII_FORBIDDEN_KEYS, SAFE_SELECT_KEYS, evaluateRodo } from './lib.mjs'

const rodoWejscie = (over = {}) => ({
  triggerNames: ['audit_log_no_truncate', 'audit_log_no_update_delete'],
  updateProbeStderr: `ERROR:  ${APPEND_ONLY_SENTINEL}\n`,
  deleteProbeStderr: `ERROR:  ${APPEND_ONLY_SENTINEL}\n`,
  pesel: { total: 39, plaintext: 0, ciphertext: 36, placeholder: 3 },
  employeeApiKeys: [...SAFE_SELECT_KEYS],
  ...over,
})

test('SAFE_SELECT_KEYS odwzorowuje projekcję z employees.service.ts i nie zawiera PII', () => {
  assert.deepEqual(SAFE_SELECT_KEYS, [
    'id', 'firstName', 'lastName', 'position', 'employmentType', 'hiredAt', 'unitId', 'etat', 'qualifications',
  ])
  assert.deepEqual(PII_FORBIDDEN_KEYS, ['pesel', 'peselHash', 'homeAddress', 'homeLat', 'homeLng'])
})

test('evaluateRodo przechodzi na stanie żywego stacku, a 3 zaślepki PESEL to UWAGA', () => {
  const out = evaluateRodo(rodoWejscie())
  assert.equal(out.length, 7)
  assert.equal(exitCode(out), 0)
  assert.equal(out.find((f) => f.id === 'B4-05').zmierzone, '0 z 39')
  assert.equal(out.find((f) => f.id === 'B4-06').status, 'UWAGA')
  assert.match(out.find((f) => f.id === 'B4-06').zmierzone, /^36 z 39; 3 rekordów z zaślepką/)
})

test('evaluateRodo zgłasza BLAD, gdy UPDATE na audit_log przeszedł bez wyjątku', () => {
  const out = evaluateRodo(rodoWejscie({ updateProbeStderr: '' }))
  assert.equal(exitCode(out), 1)
  assert.equal(out.find((f) => f.id === 'B4-03').zmierzone, 'PRZESZEDŁ BEZ WYJĄTKU')
})

test('evaluateRodo zgłasza BLAD przy brakującym wyzwalaczu na audit_log', () => {
  const out = evaluateRodo(rodoWejscie({ triggerNames: ['audit_log_no_truncate'] }))
  assert.equal(exitCode(out), 1)
  assert.equal(out.find((f) => f.id === 'B4-01').zmierzone, 'BRAK')
})

test('evaluateRodo zgłasza BLAD, gdy PESEL leży w bazie jawnie', () => {
  const out = evaluateRodo(rodoWejscie({ pesel: { total: 39, plaintext: 2, ciphertext: 34, placeholder: 3 } }))
  assert.equal(exitCode(out), 1)
  assert.equal(out.find((f) => f.id === 'B4-05').status, 'BLAD')
})

test('evaluateRodo zgłasza BLAD, gdy projekcja API przepuszcza pole PII', () => {
  const out = evaluateRodo(rodoWejscie({ employeeApiKeys: [...SAFE_SELECT_KEYS, 'pesel'] }))
  assert.equal(exitCode(out), 1)
  assert.deepEqual(failedNames(out), ['Kontrole RODO/Projekcja SAFE_SELECT w GET /api/employees'])
})
```

- [ ] **Krok 17: Uruchom test i zobacz, że pada.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# SyntaxError: The requested module './lib.mjs' does not provide an export named 'APPEND_ONLY_SENTINEL'`, `# tests 1`, `# fail 1`.

- [ ] **Krok 18: Zaimplementuj `evaluateRodo`.** Dopisz na końcu `scripts/audyt/lib.mjs`:

```js
/** Projekcja SAFE_SELECT z apps/tenant-runtime/src/employees/employees.service.ts:24. */
export const SAFE_SELECT_KEYS = [
  'id',
  'firstName',
  'lastName',
  'position',
  'employmentType',
  'hiredAt',
  'unitId',
  'etat',
  'qualifications',
]

/** Pola PII modelu Employee, których projekcja NIE MOŻE przepuścić do odpowiedzi API. */
export const PII_FORBIDDEN_KEYS = ['pesel', 'peselHash', 'homeAddress', 'homeLat', 'homeLng']

/** Komunikat funkcji prevent_audit_log_mutation() z migracji 20260527044143_init_tenant. */
export const APPEND_ONLY_SENTINEL = 'audit_log is append-only; UPDATE and DELETE are not permitted'

/**
 * Kategoria 4 — kontrole RODO.
 *
 * Bramką dla PESEL-a jest ZERO wartości jawnych (11 cyfr). Trzy rekordy z literalną zaślepką
 * DEMO-PLACEHOLDER-UNENCRYPTED-PESEL, wstawione przez scripts/seed-demo-m2-modules.sql
 * i scripts/seed-demo-strategic-brain.sql z pominięciem encryptEmployeePesel(), to UWAGA:
 * nie ma tam danej osobowej do wycieku, ale ścieżka seedowania jest nieszczelna.
 */
export function evaluateRodo({ triggerNames, updateProbeStderr, deleteProbeStderr, pesel, employeeApiKeys }) {
  const hasTrigger = (name) => triggerNames.includes(name)
  const blocked = (stderr) => String(stderr).includes(APPEND_ONLY_SENTINEL)
  const leaked = PII_FORBIDDEN_KEYS.filter((k) => employeeApiKeys.includes(k))
  const missingSafe = SAFE_SELECT_KEYS.filter((k) => !employeeApiKeys.includes(k))

  return [
    finding(
      'B4-01', 'Kontrole RODO', 'Wyzwalacz audit_log_no_update_delete',
      hasTrigger('audit_log_no_update_delete') ? 'obecny na tabeli audit_log' : 'BRAK',
      'obecny na tabeli audit_log',
      hasTrigger('audit_log_no_update_delete') ? 'OK' : 'BLAD',
    ),
    finding(
      'B4-02', 'Kontrole RODO', 'Wyzwalacz audit_log_no_truncate',
      hasTrigger('audit_log_no_truncate') ? 'obecny na tabeli audit_log' : 'BRAK',
      'obecny na tabeli audit_log',
      hasTrigger('audit_log_no_truncate') ? 'OK' : 'BLAD',
    ),
    finding(
      'B4-03', 'Kontrole RODO', 'UPDATE na audit_log (próba w transakcji zakończonej ROLLBACK)',
      blocked(updateProbeStderr) ? `odrzucony: "${APPEND_ONLY_SENTINEL}"` : 'PRZESZEDŁ BEZ WYJĄTKU',
      'odrzucony przez wyzwalacz',
      blocked(updateProbeStderr) ? 'OK' : 'BLAD',
    ),
    finding(
      'B4-04', 'Kontrole RODO', 'DELETE na audit_log (próba w transakcji zakończonej ROLLBACK)',
      blocked(deleteProbeStderr) ? `odrzucony: "${APPEND_ONLY_SENTINEL}"` : 'PRZESZEDŁ BEZ WYJĄTKU',
      'odrzucony przez wyzwalacz',
      blocked(deleteProbeStderr) ? 'OK' : 'BLAD',
    ),
    finding(
      'B4-05', 'Kontrole RODO', 'PESEL w postaci jawnej (11 cyfr) w kolumnie employees.pesel',
      `${pesel.plaintext} z ${pesel.total}`,
      `0 z ${pesel.total}`,
      pesel.plaintext === 0 ? 'OK' : 'BLAD',
    ),
    finding(
      'B4-06', 'Kontrole RODO', 'PESEL zaszyfrowany AES-256-GCM (bajt wersji klucza = 1)',
      `${pesel.ciphertext} z ${pesel.total}; ${pesel.placeholder} rekordów z zaślepką DEMO-PLACEHOLDER-UNENCRYPTED-PESEL`,
      `${pesel.total} z ${pesel.total}`,
      pesel.ciphertext === pesel.total ? 'OK' : 'UWAGA',
    ),
    finding(
      'B4-07', 'Kontrole RODO', 'Projekcja SAFE_SELECT w GET /api/employees',
      `zwrócone pola: ${employeeApiKeys.join(', ')}`,
      `dokładnie: ${SAFE_SELECT_KEYS.join(', ')}`,
      leaked.length > 0 || missingSafe.length > 0 ? 'BLAD' : 'OK',
    ),
  ]
}
```

- [ ] **Krok 19: Uruchom test i zobacz zielone.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# tests 18`, `# pass 18`, `# fail 0`.

- [ ] **Krok 20: Commit.** `git add scripts/audyt; git commit -m "feat(audyt): kategoria 4 — wyzwalacz append-only, szyfrowanie PESEL, projekcja SAFE_SELECT"`

---

### Zadanie 11 (B-5): Kategoria 5 i 6 — próbka RBAC i integralność danych demo

**Pliki:**
- Zmień: `scripts/audyt/lib.mjs`
- Test: `scripts/audyt/lib.test.mjs`

- [ ] **Krok 21: Dopisz czerwony test `evaluateRbac` i `evaluateDemoData`.** Dopisz na końcu `scripts/audyt/lib.test.mjs`:

```js
import { evaluateDemoData, evaluateRbac } from './lib.mjs'

test('evaluateRbac przechodzi na zmierzonym rozkładzie ADMIN 1558 > MANAGER 531 > PRACOWNIK 104', () => {
  const out = evaluateRbac({ admin: 1558, manager: 531, pracownik: 104 })
  assert.equal(out.length, 3)
  assert.equal(exitCode(out), 0)
  assert.equal(out.find((f) => f.id === 'B5-03').zmierzone, '104 zmian')
})

test('evaluateRbac zgłasza BLAD, gdy PRACOWNIK widzi tyle samo zmian co ADMIN', () => {
  const out = evaluateRbac({ admin: 1558, manager: 1558, pracownik: 1558 })
  assert.equal(exitCode(out), 1)
  assert.deepEqual(failedNames(out), [
    'Próbka RBAC/GET /api/grafik/shifts jako MANAGER (manager.demo)',
    'Próbka RBAC/GET /api/grafik/shifts jako PRACOWNIK (pracownik.demo)',
  ])
})

test('evaluateRbac zgłasza BLAD, gdy PRACOWNIK nie widzi żadnej zmiany', () => {
  const out = evaluateRbac({ admin: 1558, manager: 531, pracownik: 0 })
  assert.equal(exitCode(out), 1)
  assert.equal(out.find((f) => f.id === 'B5-03').status, 'BLAD')
})

test('evaluateDemoData przechodzi na kotwicach 39 / 1558 / 4', () => {
  const out = evaluateDemoData({ employees: 39, shifts: 1558, units: 4, employeesApi: 39 })
  assert.equal(out.length, 4)
  assert.equal(exitCode(out), 0)
})

test('evaluateDemoData zgłasza BLAD przy naruszeniu kotwicy 1558 zmian', () => {
  const out = evaluateDemoData({ employees: 39, shifts: 1557, units: 4, employeesApi: 39 })
  assert.equal(exitCode(out), 1)
  assert.equal(out.find((f) => f.id === 'B6-02').zmierzone, '1557')
  assert.equal(out.find((f) => f.id === 'B6-02').oczekiwane, '1558')
})

test('evaluateDemoData zgłasza BLAD przy rozjeździe API względem bazy', () => {
  const out = evaluateDemoData({ employees: 39, shifts: 1558, units: 4, employeesApi: 37 })
  assert.equal(exitCode(out), 1)
  assert.equal(out.find((f) => f.id === 'B6-04').zmierzone, '37 przez API, 39 w bazie')
})
```

- [ ] **Krok 22: Uruchom test i zobacz, że pada.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# SyntaxError: The requested module './lib.mjs' does not provide an export named 'evaluateDemoData'`, `# tests 1`, `# fail 1`.

- [ ] **Krok 23: Zaimplementuj obie funkcje.** Dopisz na końcu `scripts/audyt/lib.mjs`:

```js
/**
 * Kategoria 5 — próbka RBAC.
 *
 * `GET /grafik/shifts` (apps/tenant-runtime/src/grafik/grafik.controller.ts:73) NIE przyjmuje
 * parametrów zakresu, więc każda rola dostaje pełny widoczny dla niej zbiór i liczby są
 * porównywalne wprost. Zakres wynika z GrafikService.listShifts: rola globalna widzi wszystko,
 * manager — jednostki, którymi zarządza, pracownik — wyłącznie własne zmiany.
 */
export function evaluateRbac({ admin, manager, pracownik }) {
  return [
    finding(
      'B5-01', 'Próbka RBAC', 'GET /api/grafik/shifts jako ADMIN_KLIENTA (demo)',
      `${admin} zmian`, `${DEMO_ANCHORS.shifts} zmian (pełny zbiór tenanta)`,
      admin === DEMO_ANCHORS.shifts ? 'OK' : 'BLAD',
    ),
    finding(
      'B5-02', 'Próbka RBAC', 'GET /api/grafik/shifts jako MANAGER (manager.demo)',
      `${manager} zmian`, `więcej niż 0 i mniej niż ${admin} (zakres: zarządzane jednostki)`,
      manager > 0 && manager < admin ? 'OK' : 'BLAD',
    ),
    finding(
      'B5-03', 'Próbka RBAC', 'GET /api/grafik/shifts jako PRACOWNIK (pracownik.demo)',
      `${pracownik} zmian`, `więcej niż 0 i mniej niż ${manager} (zakres: własne zmiany)`,
      pracownik > 0 && pracownik < manager ? 'OK' : 'BLAD',
    ),
  ]
}

/** Kategoria 6 — integralność danych demonstracyjnych rozliczanych w KM3. */
export function evaluateDemoData({ employees, shifts, units, employeesApi }) {
  return [
    finding(
      'B6-01', 'Integralność danych demo', 'Pracownicy w bazie tenanta',
      `${employees}`, `${DEMO_ANCHORS.employees}`,
      employees === DEMO_ANCHORS.employees ? 'OK' : 'BLAD',
    ),
    finding(
      'B6-02', 'Integralność danych demo', 'Zmiany grafikowe (shifts) w bazie tenanta',
      `${shifts}`, `${DEMO_ANCHORS.shifts}`,
      shifts === DEMO_ANCHORS.shifts ? 'OK' : 'BLAD',
    ),
    finding(
      'B6-03', 'Integralność danych demo', 'Jednostki organizacyjne',
      `${units}`, `${DEMO_ANCHORS.units}`,
      units === DEMO_ANCHORS.units ? 'OK' : 'BLAD',
    ),
    finding(
      'B6-04', 'Integralność danych demo', 'Pracownicy widziani przez API (ADMIN) wobec bazy',
      `${employeesApi} przez API, ${employees} w bazie`, 'obie liczby równe',
      employeesApi === employees ? 'OK' : 'BLAD',
    ),
  ]
}
```

- [ ] **Krok 24: Uruchom test i zobacz zielone.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# tests 24`, `# pass 24`, `# fail 0`.

- [ ] **Krok 25: Commit.** `git add scripts/audyt; git commit -m "feat(audyt): kategorie 5-6 — probka RBAC i integralnosc kotwic demo"`

---

### Zadanie 12 (B-6): Rekomendacje optymalizacyjne wyprowadzone z pomiarów

**Pliki:**
- Zmień: `scripts/audyt/lib.mjs`
- Test: `scripts/audyt/lib.test.mjs`

- [ ] **Krok 26: Dopisz czerwony test `buildRecommendations` oraz test kryterium B2 specyfikacji.** Dopisz na końcu `scripts/audyt/lib.test.mjs`:

```js
import { buildRecommendations } from './lib.mjs'

const pelnyZestaw = () => [
  ...evaluateServices(rosterFixture(), inspectedFixture()),
  ...evaluateSchema(schemaWejscie()),
  ...evaluateRodo(rodoWejscie()),
  ...evaluateRbac({ admin: 1558, manager: 531, pracownik: 104 }),
  ...evaluateDemoData({ employees: 39, shifts: 1558, units: 4, employeesApi: 39 }),
]

// Kryterium akceptacji B.2 ze specyfikacji: „Każda z 6 kategorii ma zmierzoną wartość, nie »OK«".
test('każde ustalenie niesie zmierzoną wartość, nie samo słowo OK (kryterium B2 specyfikacji)', () => {
  const findings = pelnyZestaw()
  assert.equal(findings.length, 38)
  assert.equal(new Set(findings.map((f) => f.kategoria)).size, 6)
  for (const f of findings) {
    assert.ok(f.zmierzone.length > 0, `${f.id} nie ma wartości zmierzonej`)
    assert.ok(f.oczekiwane.length > 0, `${f.id} nie ma wartości oczekiwanej`)
    assert.ok(!['OK', 'UWAGA', 'BLAD', 'BŁĄD'].includes(f.zmierzone), `${f.id} zamiast pomiaru ma status`)
  }
})

test('buildRecommendations zwraca co najmniej 3 rekomendacje na zdrowym stacku', () => {
  const rec = buildRecommendations(pelnyZestaw(), { peselPlaceholder: 3, registryRows: 6, migrationDirs: 13 })
  assert.ok(rec.length >= 3, `oczekiwano >= 3 rekomendacji, otrzymano ${rec.length}`)
  assert.ok(rec.every((r) => typeof r === 'string' && r.length > 40))
})

test('buildRecommendations wymienia z nazwy obrazy bez tagu wersji', () => {
  const rec = buildRecommendations(pelnyZestaw(), { peselPlaceholder: 3, registryRows: 6, migrationDirs: 13 })
  const tagi = rec.find((r) => r.includes('Otagować'))
  assert.ok(tagi, 'brak rekomendacji o tagowaniu obrazów')
  assert.ok(tagi.includes('web') && tagi.includes('tenant-runtime') && !tagi.includes('redis'))
})

test('buildRecommendations wskazuje rozjazd rejestru migracji liczbami', () => {
  const rec = buildRecommendations(pelnyZestaw(), { peselPlaceholder: 3, registryRows: 6, migrationDirs: 13 })
  assert.ok(rec.some((r) => r.includes('6 wpisów') && r.includes('13 katalogów')))
})

test('buildRecommendations wskazuje zaślepki PESEL i pliki, które je wstawiają', () => {
  const rec = buildRecommendations(pelnyZestaw(), { peselPlaceholder: 3, registryRows: 6, migrationDirs: 13 })
  const p = rec.find((r) => r.includes('zaślepk'))
  assert.ok(p)
  assert.ok(p.includes('seed-demo-strategic-brain.sql') && p.includes('encryptEmployeePesel'))
})

test('buildRecommendations wymienia usługi z niezerowym RestartCount', () => {
  const findings = evaluateServices(rosterFixture(), inspectedFixture({ stt: { RestartCount: 2 } }))
  const rec = buildRecommendations(findings, { peselPlaceholder: 0, registryRows: 13, migrationDirs: 13 })
  assert.ok(rec.some((r) => r.includes('restartów') && r.includes('stt')))
})
```

- [ ] **Krok 27: Uruchom test i zobacz, że pada.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# SyntaxError: The requested module './lib.mjs' does not provide an export named 'buildRecommendations'`, `# tests 1`, `# fail 1`.

- [ ] **Krok 28: Zaimplementuj `buildRecommendations`.** Dopisz na końcu `scripts/audyt/lib.mjs`:

```js
/**
 * Rekomendacje dalszej optymalizacji — harmonogram wymaga wprost „identyfikacji potencjalnych
 * obszarów dalszej optymalizacji". Każda rekomendacja wynika z konkretnego pomiaru, nie z listy
 * dobrych praktyk. Dwie ostatnie są bezwarunkowe, więc lista nigdy nie schodzi poniżej trzech.
 */
export function buildRecommendations(findings, { peselPlaceholder, registryRows, migrationDirs }) {
  const rec = []
  const wersje = findings.filter((f) => f.kategoria === 'Wersje obrazów')

  // Kontrakt pola: `RestartCount=<liczba>` na końcu wartości zmierzonej (patrz evaluateServices).
  const restartowane = wersje.filter((f) => /RestartCount=[1-9]\d*$/.test(f.zmierzone))
  if (restartowane.length > 0) {
    rec.push(
      `Zbadać przyczynę restartów usług: ${restartowane.map((f) => f.nazwa).join(', ')}. ` +
        'Niezerowy RestartCount oznacza, że proces albo healthcheck padł co najmniej raz od startu stosu, ' +
        'a polityka `restart: unless-stopped` podniosła kontener bez śladu w interfejsie użytkownika.',
    )
  }

  const bezTagu = wersje.filter(
    (f) => f.zmierzone !== 'brak kontenera w projekcie compose' && !f.zmierzone.split(' · ')[0].includes(':'),
  )
  if (bezTagu.length > 0) {
    rec.push(
      `Otagować wersjami obrazy budowane lokalnie: ${bezTagu.map((f) => f.nazwa).join(', ')}. ` +
        'Dziś jedynym identyfikatorem wydania jest 12-znakowy skrót ID obrazu, więc protokół odbioru ' +
        'nie ma czego zacytować. Minimalny krok: `docker tag <id> hrobot-<usługa>:km3` w procedurze wdrożeniowej.',
    )
  }

  if (registryRows < migrationDirs) {
    rec.push(
      `Uzgodnić rejestr migracji z repozytorium: ${registryRows} wpisów w \`_prisma_migrations\` wobec ` +
        `${migrationDirs} katalogów w \`packages/db/prisma/tenant/migrations\`. Struktura bazy jest zgodna ` +
        '(kontrola B3-03), a różnica bierze się z migracji nałożonych surowym SQL-em ' +
        '(`scripts/apply-m2-tenant-schema.sql`). Po odbiorze warto odtworzyć bazę przez `prisma migrate deploy`, ' +
        'żeby rejestr i repozytorium mówiły to samo.',
    )
  }

  if (peselPlaceholder > 0) {
    rec.push(
      `Przeseedować ${peselPlaceholder} rekordów z zaślepką \`DEMO-PLACEHOLDER-UNENCRYPTED-PESEL\` przez ` +
        '`encryptEmployeePesel()` (`packages/db/src/employeePii.ts`). Zaślepki wchodzą do bazy przez ' +
        '`scripts/seed-demo-m2-modules.sql` i `scripts/seed-demo-strategic-brain.sql`, które omijają warstwę ' +
        'szyfrującą. PESEL-i jawnych nie ma (kontrola B4-05), ale ścieżka seedowania jest nieszczelna i przy ' +
        'danych produkcyjnych zapisałaby PII bez szyfrowania.',
    )
  }

  rec.push(
    'Objąć tabelę `audit_log` polityką retencji i archiwizacji. Wyzwalacze blokują UPDATE, DELETE i TRUNCATE ' +
      '(kontrole B4-01..B4-04), więc tabela z definicji rośnie wyłącznie w górę i nie da się jej wyczyścić. ' +
      'W środowisku demonstracyjnym to nie problem, we wdrożeniu produkcyjnym potrzebne jest partycjonowanie ' +
      'po dacie i wynoszenie starych partycji do archiwum.',
  )

  rec.push(
    'Wpiąć sondę `GET /api/health/ready` tenant-runtime w monitoring zewnętrzny. Healthcheck w `docker-compose.yml` ' +
      'celowo odpytuje wyłącznie `/api/health/live`, żeby autoheal nie restartował aplikacji za awarię zależności — ' +
      'skutek uboczny jest taki, że utrata bazy albo Redisa nie zapala dziś żadnej lampki poza tym audytem.',
  )

  return rec
}
```

- [ ] **Krok 29: Uruchom test i zobacz zielone.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# tests 30`, `# pass 30`, `# fail 0`.

- [ ] **Krok 30: Commit.** `git add scripts/audyt; git commit -m "feat(audyt): rekomendacje optymalizacyjne wyprowadzone z pomiarow"`

---

### Zadanie 13 (B-7): Renderer raportu markdown

**Pliki:**
- Zmień: `scripts/audyt/lib.mjs`
- Test: `scripts/audyt/lib.test.mjs`

- [ ] **Krok 31: Dopisz czerwony test `renderMarkdown`.** Dopisz na końcu `scripts/audyt/lib.test.mjs`:

```js
import { renderMarkdown } from './lib.mjs'

const meta = () => ({
  timestamp: '2026-08-12 09:15:00 UTC',
  project: 'hrobot',
  database: 'hrobot_t_900d948b',
  api: 'http://localhost:3001/api',
})

test('renderMarkdown wypisuje wszystkie 6 kategorii jako osobne tabele', () => {
  const findings = pelnyZestaw()
  const md = renderMarkdown({ findings, recommendations: ['a'.repeat(50)], meta: meta() })
  for (const k of ['Wersje obrazów', 'Healthchecki', 'Migracje', 'Kontrole RODO', 'Próbka RBAC', 'Integralność danych demo']) {
    assert.ok(md.includes(`### ${k}`), `brak sekcji ${k}`)
  }
  assert.equal((md.match(/\| Nr \| Kontrola \| Wartość zmierzona \| Wartość oczekiwana \| Status \|/g) ?? []).length, 6)
})

test('renderMarkdown umieszcza w nagłówku parametry przebiegu i wynik zbiorczy', () => {
  const md = renderMarkdown({ findings: pelnyZestaw(), recommendations: ['x'.repeat(50)], meta: meta() })
  assert.ok(md.includes('| Data i godzina audytu | 2026-08-12 09:15:00 UTC |'))
  assert.ok(md.includes('| Baza danych tenanta | `hrobot_t_900d948b` |'))
  // 38 ustaleń fixture'owych: 37 OK, 1 UWAGA (B4-06 — 36 z 39 zaszyfrowanych PESEL-i), 0 BŁĄD.
  assert.ok(md.includes('37 × OK, 1 × UWAGA, 0 × BŁĄD'))
})

test('renderMarkdown wypisuje nazwy niezaliczonych kontroli w nagłówku sekcji Ustalenia', () => {
  const findings = evaluateServices(rosterFixture({ optimizer: { State: 'exited', Health: '' } }), inspectedFixture())
  const md = renderMarkdown({ findings, recommendations: ['y'.repeat(50)], meta: meta() })
  assert.ok(md.includes('**Przebieg zakończony błędem.**'))
  assert.ok(md.includes('Wersje obrazów/optimizer; Healthchecki/optimizer'))
})

test('renderMarkdown numeruje rekomendacje i zawiera notę o rejestrze migracji', () => {
  const md = renderMarkdown({ findings: pelnyZestaw(), recommendations: ['pierwsza'.repeat(8), 'druga'.repeat(12)], meta: meta() })
  assert.ok(md.includes('## 3. Rekomendacje dalszej optymalizacji'))
  assert.match(md, /\n1\. pierwsza/)
  assert.match(md, /\n2\. druga/)
  assert.ok(md.includes('## 2. Nota do liczby migracji'))
  assert.ok(md.includes('apply-m2-tenant-schema.sql'))
})
```

- [ ] **Krok 32: Uruchom test i zobacz, że pada.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# SyntaxError: The requested module './lib.mjs' does not provide an export named 'renderMarkdown'`, `# tests 1`, `# fail 1`.

- [ ] **Krok 33: Zaimplementuj `renderMarkdown`.** Dopisz na końcu `scripts/audyt/lib.mjs`:

```js
/** Kolejność kategorii w raporcie — odpowiada kolejności sześciu zakresów z zadania M3 i. */
const KATEGORIE = [
  'Wersje obrazów',
  'Healthchecki',
  'Migracje',
  'Kontrole RODO',
  'Próbka RBAC',
  'Integralność danych demo',
]

/** Raport w markdown gotowy dla pandoc → PDF (styl jak pozostałe załączniki KM3). */
export function renderMarkdown({ findings, recommendations, meta }) {
  const licz = (status) => findings.filter((f) => f.status === status).length
  const bledy = failedNames(findings)
  const out = []

  out.push('# Audyt powdrożeniowy środowiska demonstracyjnego HRobot.AI')
  out.push('')
  out.push('*Załącznik nr 7 do Raportu z realizacji Kamienia Milowego 3 — zadanie M3 i) harmonogramu indywidualnego programu akceleracji.*')
  out.push('')
  out.push('| Parametr przebiegu | Wartość |')
  out.push('|---|---|')
  out.push(`| Data i godzina audytu | ${meta.timestamp} |`)
  out.push(`| Projekt Docker Compose | \`${meta.project}\` |`)
  out.push(`| Baza danych tenanta | \`${meta.database}\` |`)
  out.push(`| Punkt wejścia API | \`${meta.api}\` |`)
  out.push('| Narzędzie | `scripts/audyt-powdrozeniowy.mjs` (`pnpm audyt`) |')
  out.push(`| Wynik zbiorczy | ${licz('OK')} × OK, ${licz('UWAGA')} × UWAGA, ${licz('BLAD')} × BŁĄD |`)
  out.push('')
  out.push('## 1. Ustalenia')

  if (bledy.length > 0) {
    out.push('')
    out.push(`**Przebieg zakończony błędem.** Kontrole niezaliczone: ${bledy.join('; ')}.`)
  }

  for (const kategoria of KATEGORIE) {
    const rows = findings.filter((f) => f.kategoria === kategoria)
    if (rows.length === 0) continue
    out.push('')
    out.push(`### ${kategoria}`)
    out.push('')
    out.push('| Nr | Kontrola | Wartość zmierzona | Wartość oczekiwana | Status |')
    out.push('|---|---|---|---|---|')
    for (const f of rows) {
      out.push(`| ${f.id} | ${f.nazwa} | ${f.zmierzone} | ${f.oczekiwane} | ${f.status === 'BLAD' ? 'BŁĄD' : f.status} |`)
    }
  }

  out.push('')
  out.push('## 2. Nota do liczby migracji')
  out.push('')
  out.push(
    'Rejestr `_prisma_migrations` w bazie tenanta zawiera mniej wpisów niż liczba katalogów migracji ' +
      'w repozytorium. Różnica jest znana i wynika z trybu wdrożenia środowiska demonstracyjnego: część ' +
      'migracji nałożono surowym SQL-em (`scripts/apply-m2-tenant-schema.sql`) z pominięciem rejestru Prismy. ' +
      'Kryterium zgodności jest dlatego struktura, a nie liczba wpisów — kontrola B3-03 sprawdza, że każda ' +
      'tabela wymagana przez `packages/db/generated/tenant/schema.prisma` istnieje w bazie, a kontrola B3-04, ' +
      'że w bazie nie ma tabel spoza schematu.',
  )
  out.push('')
  out.push('## 3. Rekomendacje dalszej optymalizacji')
  out.push('')
  recommendations.forEach((r, i) => out.push(`${i + 1}. ${r}`))
  out.push('')
  out.push('## 4. Metoda i powtarzalność')
  out.push('')
  out.push(
    'Audyt wykonuje skrypt `scripts/audyt-powdrozeniowy.mjs`, uruchamiany jedną komendą `pnpm audyt`. ' +
      'Stan odczytywany jest wyłącznie do odczytu: `docker compose -p hrobot ps -a` i `docker inspect` dla ' +
      'warstwy uruchomieniowej, zapytania `SELECT` do bazy tenanta oraz uwierzytelnione żądania `GET` do API ' +
      'na trzech kontach o różnych rolach.',
  )
  out.push('')
  out.push(
    'Dwa wyjątki od zasady „tylko odczyt" są celowe: próby `UPDATE` i `DELETE` na tabeli `audit_log` ' +
      'wykonywane w transakcji zakończonej `ROLLBACK`. Ich zadaniem jest sprawdzić, że wyzwalacz ' +
      '`prevent_audit_log_mutation()` rzeczywiście blokuje modyfikację śladu audytowego. Transakcja jest ' +
      'wycofywana niezależnie od wyniku, więc kontrola nie zmienia zawartości tabeli nawet w razie awarii wyzwalacza.',
  )
  out.push('')
  out.push(
    'Skrypt kończy się kodem wyjścia `0` wyłącznie wtedy, gdy żadne ustalenie nie ma statusu BŁĄD. ' +
      'Weryfikację negatywną — przebieg przy celowo zatrzymanej usłudze — udokumentowano w pliku ' +
      '`audyt-weryfikacja-negatywna.md` w tym samym katalogu.',
  )
  out.push('')

  return out.join('\n')
}
```

- [ ] **Krok 34: Uruchom test i zobacz zielone.** Komenda: `node --test scripts/audyt/lib.test.mjs`. Oczekiwane: `# tests 34`, `# pass 34`, `# fail 0`, kod wyjścia 0. Liczba `37 × OK, 1 × UWAGA, 0 × BŁĄD` jest wyliczona z fixture'ów (38 ustaleń, jedyna UWAGA to B4-06) i została potwierdzona uruchomieniem — jeśli test na niej pada, błąd jest w implementacji, nie w asercji.

- [ ] **Krok 35: Commit.** `git add scripts/audyt; git commit -m "feat(audyt): renderer raportu markdown z tabelami ustalen i nota metodologiczna"`

---

### Zadanie 14 (B-8): Runner — warstwa I/O zbierająca sześć kategorii

**Pliki:**
- Utwórz: `scripts/audyt-powdrozeniowy.mjs`
- Zmień: `package.json`

- [ ] **Krok 36: Utwórz runner.** Utwórz `scripts/audyt-powdrozeniowy.mjs`:

```js
#!/usr/bin/env node
// Audyt powdrożeniowy środowiska demonstracyjnego — zadanie M3 i) harmonogramu PARP.
//
// Zbiera SZEŚĆ kategorii DO PLIKU (domyślnie docs/raport-km3/audyt-powdrozeniowy.md):
//   1. wersje obrazów 10 usług + RestartCount
//   2. stan healthchecków
//   3. liczba zastosowanych migracji i zgodność struktury schematu
//   4. kontrole RODO: wyzwalacz append-only na audit_log, szyfrowanie PESEL, projekcja SAFE_SELECT
//   5. próbka RBAC: ADMIN > MANAGER > PRACOWNIK na GET /grafik/shifts
//   6. integralność kotwic danych demo (39 pracowników, 1558 zmian, 4 jednostki)
//
// Kończy się kodem 1, gdy choć jedna kontrola ma status BŁĄD, i wypisuje na stderr, która.
//
// PROJEKT COMPOSE NAZYWA SIĘ `hrobot`, a katalog roboczy `HRobot-m2`, więc każde wywołanie
// Compose MUSI mieć `-p hrobot` — bez tego `docker compose ps` zwraca pustą listę.
//
// Bez zależności zewnętrznych (node: builtins + fetch + docker CLI) — jak reszta scripts/.
//
// Użycie:
//   pnpm audyt
//   node scripts/audyt-powdrozeniowy.mjs --out docs/raport-km3/audyt-weryfikacja-negatywna.md
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildRecommendations,
  evaluateDemoData,
  evaluateRbac,
  evaluateRodo,
  evaluateSchema,
  evaluateServices,
  exitCode,
  failedNames,
  renderMarkdown,
} from './audyt/lib.mjs'

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const i = args.indexOf(name)
  if (i >= 0 && !args[i + 1]) throw new Error(`brak wartości dla przełącznika ${name}`)
  return i >= 0 ? args[i + 1] : fallback
}

const ROOT = path.join(import.meta.dirname, '..')
const PROJECT = process.env.AUDYT_COMPOSE_PROJECT ?? 'hrobot'
const PG_CONTAINER = process.env.AUDYT_PG_CONTAINER ?? 'hrobot-postgres-1'
const TENANT_DB = process.env.AUDYT_TENANT_DB ?? 'hrobot_t_900d948b'
const API = (process.env.TENANT_RUNTIME_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '')
// Keycloak jest wystawiony na hoście na 8081 (mapowanie 8081:8080 w docker-compose.yml).
const TOKEN_URL =
  process.env.KEYCLOAK_TOKEN_URL ?? 'http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token'
const CLIENT_ID = process.env.AUDYT_KEYCLOAK_CLIENT_ID ?? 'hrobot-web'
const OUT = path.resolve(ROOT, argValue('--out', 'docs/raport-km3/audyt-powdrozeniowy.md'))

// Hasła kont demonstracyjnych. `demo` jest jedynym kontem, którego hasła nie ma w repozytorium
// (scripts/seed-keycloak-demo.mjs czyta je z DEMO_ADMIN_PASSWORD); fallback zgadza się z domyślną
// wartością KEYCLOAK_DEMO_PASSWORD z docker-compose.yml:218. Żadne hasło nie jest nigdzie wypisywane.
const ACCOUNTS = {
  admin: [process.env.AUDYT_ADMIN_USER ?? 'demo', process.env.KEYCLOAK_DEMO_PASSWORD ?? 'demo-staging-2026'],
  manager: [process.env.AUDYT_MANAGER_USER ?? 'manager.demo', process.env.AUDYT_MANAGER_PASSWORD ?? 'Manager!2026'],
  pracownik: [process.env.AUDYT_EMPLOYEE_USER ?? 'pracownik.demo', process.env.AUDYT_EMPLOYEE_PASSWORD ?? 'Pracownik!2026'],
}

function docker(argv) {
  return execFileSync('docker', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/**
 * psql w trybie nieozdobnym: bez nagłówków, bez wyrównania, kolumny rozdzielone `|`.
 * ON_ERROR_STOP=1 jest KONIECZNE: bez niego psql kończy się kodem 0 mimo błędu SQL, a runner
 * odczytałby pusty łańcuch jako liczbę 0 i zapalił fałszywy BŁĄD zamiast przerwać zbieranie.
 */
function psql(sql) {
  return docker([
    'exec', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', TENANT_DB,
    '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '|', '-c', sql,
  ]).trim()
}

/**
 * Sonda naruszenia niezmienności audit_log. Zwraca stderr psql-a; pusty łańcuch oznacza,
 * że zapytanie PRZESZŁO — czyli wyzwalacz nie zadziałał. Zapytanie jest opakowane
 * w BEGIN/ROLLBACK, więc nawet przy martwym wyzwalaczu tabela nie zmienia zawartości.
 */
function psqlProbe(sql) {
  try {
    execFileSync(
      'docker',
      ['exec', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', TENANT_DB, '-v', 'ON_ERROR_STOP=1', '-c', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return ''
  } catch (err) {
    return String(err.stderr ?? '')
  }
}

async function token(role) {
  const [username, password] = ACCOUNTS[role]
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT_ID, username, password }),
  })
  if (!res.ok) throw new Error(`Keycloak zwrócił HTTP ${res.status} dla konta ${username}`)
  const json = await res.json()
  if (!json.access_token) throw new Error(`brak access_token dla konta ${username}`)
  return json.access_token
}

async function getJson(pathname, jwt) {
  const res = await fetch(`${API}${pathname}`, { headers: { authorization: `Bearer ${jwt}` } })
  if (!res.ok) throw new Error(`GET ${pathname} → HTTP ${res.status}`)
  return res.json()
}

/** Compose v2.21+ emituje NDJSON; starsze wersje tablicę JSON. Obsłuż oba kształty. */
function parseComposePs(raw) {
  const text = raw.trim()
  if (text.startsWith('[')) return JSON.parse(text)
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

async function main() {
  // --- kategorie 1 i 2: warstwa uruchomieniowa ---------------------------------------------------
  const roster = parseComposePs(docker(['compose', '-p', PROJECT, 'ps', '-a', '--format', 'json']))
  const names = roster.map((r) => r.Name)
  const inspected = names.length > 0 ? JSON.parse(docker(['inspect', ...names])) : []

  // --- kategoria 3: migracje i struktura ---------------------------------------------------------
  const registryRows = Number(
    psql('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'),
  )
  const migrationDirs = fs
    .readdirSync(path.join(ROOT, 'packages/db/prisma/tenant/migrations'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).length
  const prismaSchema = fs.readFileSync(path.join(ROOT, 'packages/db/generated/tenant/schema.prisma'), 'utf8')
  // Wszystkie 24 modele tenant-schema mają @@map, a każda nazwa jest [a-z_]+ (zweryfikowane).
  const expectedTables = [...prismaSchema.matchAll(/@@map\("([a-z_]+)"\)/g)].map((m) => m[1]).sort()
  const actualTables = psql(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY 1;",
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .sort()

  // --- kategoria 4: kontrole RODO ----------------------------------------------------------------
  const triggerNames = psql(
    "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'audit_log'::regclass ORDER BY 1;",
  )
    .split(/\r?\n/)
    .filter(Boolean)
  const updateProbeStderr = psqlProbe(
    "BEGIN; UPDATE audit_log SET action = 'AUDYT-PROBE' WHERE id IN (SELECT id FROM audit_log LIMIT 1); ROLLBACK;",
  )
  const deleteProbeStderr = psqlProbe(
    'BEGIN; DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log LIMIT 1); ROLLBACK;',
  )
  // CASE, nie AND: PostgreSQL nie gwarantuje skracania oceny AND, więc decode() na zaślepce
  // DEMO-PLACEHOLDER-... wywaliłoby całe zapytanie na "invalid symbol - in base64 sequence".
  const [peselTotal, peselPlaintext, peselCiphertext, peselPlaceholder] = psql(
    'SELECT count(*), ' +
      "count(*) FILTER (WHERE pesel ~ '^[0-9]{11}$'), " +
      'count(*) FILTER (WHERE ver = 1 AND len >= 29), ' +
      "count(*) FILTER (WHERE pesel LIKE 'DEMO-PLACEHOLDER-UNENCRYPTED-PESEL%') " +
      'FROM (SELECT pesel, ' +
      "CASE WHEN pesel ~ '^[A-Za-z0-9+/]+={0,2}$' AND length(pesel) % 4 = 0 THEN get_byte(decode(pesel,'base64'),0) ELSE NULL END AS ver, " +
      "CASE WHEN pesel ~ '^[A-Za-z0-9+/]+={0,2}$' AND length(pesel) % 4 = 0 THEN octet_length(decode(pesel,'base64')) ELSE NULL END AS len " +
      'FROM employees) t;',
  )
    .split('|')
    .map(Number)

  // --- kategoria 5: próbka RBAC ------------------------------------------------------------------
  const jwt = {
    admin: await token('admin'),
    manager: await token('manager'),
    pracownik: await token('pracownik'),
  }
  const rbac = {
    admin: (await getJson('/grafik/shifts', jwt.admin)).length,
    manager: (await getJson('/grafik/shifts', jwt.manager)).length,
    pracownik: (await getJson('/grafik/shifts', jwt.pracownik)).length,
  }
  const employeesApiRows = await getJson('/employees', jwt.admin)
  const employeeApiKeys = employeesApiRows.length > 0 ? Object.keys(employeesApiRows[0]) : []

  // --- kategoria 6: kotwice danych demo -----------------------------------------------------------
  const [employees, shifts, units] = psql(
    'SELECT (SELECT count(*) FROM employees), (SELECT count(*) FROM shifts), (SELECT count(*) FROM organizational_units);',
  )
    .split('|')
    .map(Number)

  const findings = [
    ...evaluateServices(roster, inspected),
    ...evaluateSchema({ registryRows, migrationDirs, expectedTables, actualTables }),
    ...evaluateRodo({
      triggerNames,
      updateProbeStderr,
      deleteProbeStderr,
      pesel: { total: peselTotal, plaintext: peselPlaintext, ciphertext: peselCiphertext, placeholder: peselPlaceholder },
      employeeApiKeys,
    }),
    ...evaluateRbac(rbac),
    ...evaluateDemoData({ employees, shifts, units, employeesApi: employeesApiRows.length }),
  ]

  const recommendations = buildRecommendations(findings, { peselPlaceholder, registryRows, migrationDirs })
  const markdown = renderMarkdown({
    findings,
    recommendations,
    meta: {
      timestamp: `${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`,
      project: PROJECT,
      database: TENANT_DB,
      api: API,
    },
  })

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, markdown, 'utf8')

  const code = exitCode(findings)
  console.log(`Audyt powdrozeniowy: ${findings.length} kontroli, ${recommendations.length} rekomendacji -> ${OUT}`)
  if (code !== 0) console.error(`BLAD - kontrole niezaliczone: ${failedNames(findings).join('; ')}`)
  return code
}

try {
  process.exit(await main())
} catch (err) {
  console.error(`BLAD audytu (przerwane zbieranie danych): ${err.message}`)
  process.exit(1)
}
```

(Komunikaty konsoli są bez polskich znaków diakrytycznych celowo: konsola PowerShell 5.1 na tej maszynie nie jest w UTF-8 i psułaby je na ekranie. Sam raport w pliku jest zapisywany w UTF-8 z pełną polszczyzną.)

- [ ] **Krok 37: Dodaj komendy do `package.json`.** W `C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\package.json`, w sekcji `"scripts"`, tuż pod linią `"test:e2e:smoke": "node scripts/e2e-smoke.mjs",` dopisz:

```json
    "audyt": "node scripts/audyt-powdrozeniowy.mjs",
    "test:audyt": "node --test scripts/audyt/lib.test.mjs",
```

- [ ] **Krok 38: Sprawdź, że komenda pnpm działa.** Komenda: `pnpm test:audyt`. Oczekiwane: `# tests 34`, `# pass 34`, `# fail 0`, kod wyjścia 0.

- [ ] **Krok 39: Commit.** `git add scripts/audyt-powdrozeniowy.mjs package.json; git commit -m "feat(audyt): runner zbierajacy 6 kategorii do pliku + komendy pnpm audyt / test:audyt"`

---

### Zadanie 15 (B-9): Pierwszy przebieg na żywym stosie

**Pliki:**
- Utwórz: `docs/raport-km3/audyt-powdrozeniowy.md` (generowany)

- [ ] **Krok 40: Potwierdź, że stos stoi.** Komenda: `docker compose -p hrobot ps --format "{{.Service}} {{.State}} {{.Health}}" | Sort-Object`. Oczekiwane 10 wierszy, każdy `running healthy`: `caddy`, `control-plane`, `keycloak`, `optimizer`, `postgres`, `rabbitmq`, `redis`, `stt`, `tenant-runtime`, `web`. Jeśli któraś usługa nie stoi: `docker compose -p hrobot --profile full up -d`.

- [ ] **Krok 41: Uruchom audyt.** Komenda: `Set-Location C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2; pnpm audyt; Write-Host "kod wyjscia=$LASTEXITCODE"`. Oczekiwane (poza wierszami nagłówka pnpm):
```
Audyt powdrozeniowy: 38 kontroli, 5 rekomendacji -> C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\docs\raport-km3\audyt-powdrozeniowy.md
kod wyjscia=0
```
(38 kontroli = 10 + 10 + 4 + 7 + 3 + 4. Rekomendacji jest 5, bo gałąź „restarty" nie odpala przy `RestartCount = 0` na wszystkich dziesięciu usługach — zweryfikowane: wszystkie dziesięć mają 0.)

- [ ] **Krok 42: Sprawdź, że każde ustalenie ma wartość zmierzoną, a nie sam status (kryterium B2 i B4 specyfikacji).** Komenda:
```powershell
node -e "const fs=require('fs');const md=fs.readFileSync('docs/raport-km3/audyt-powdrozeniowy.md','utf8');const rows=md.split(/\r?\n/).filter(l=>/^\| B[1-6]-\d\d \|/.test(l)).map(l=>l.split('|').map(s=>s.trim()));console.log('ustalen:',rows.length);console.log('kategorii:',(md.match(/^### /gm)||[]).length);console.log('bez wartosci zmierzonej:',rows.filter(r=>['OK','UWAGA','BLAD','BLAD','']. includes(r[3])).length);console.log('rekomendacji:',(md.split('## 3. Rekomendacje dalszej optymalizacji')[1]||'').split(/\r?\n/).filter(l=>/^\d+\. /.test(l)).length)"
```
Oczekiwane:
```
ustalen: 38
kategorii: 6
bez wartosci zmierzonej: 0
rekomendacji: 5
```

- [ ] **Krok 43: Sprawdź konkretne liczby w raporcie.** Komenda: `Select-String -Path docs\raport-km3\audyt-powdrozeniowy.md -Pattern 'B3-03|B4-05|B4-06|B5-03|B6-02' | ForEach-Object { $_.Line }`. Oczekiwane (wartości zmierzone na żywym stosie 2026-08-12): `| B3-03 | ... | 24 z 24 | 24 z 24 | OK |`; `| B4-05 | ... | 0 z 39 | 0 z 39 | OK |`; `| B4-06 | ... | 36 z 39; 3 rekordów z zaślepką DEMO-PLACEHOLDER-UNENCRYPTED-PESEL | 39 z 39 | UWAGA |`; `| B5-03 | ... | 104 zmian | ... | OK |`; `| B6-02 | ... | 1558 | 1558 | OK |`.

- [ ] **Krok 44: Sprawdź, że audit_log nie ucierpiał od sond.** Komenda: `docker exec hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -t -A -c "SELECT count(*) FROM audit_log WHERE action = 'AUDYT-PROBE';"`. Oczekiwane: `0`.

- [ ] **Krok 45: Commit.** `git add docs/raport-km3/audyt-powdrozeniowy.md; git commit -m "docs(km3): pierwszy przebieg audytu powdrozeniowego na zywym stosie"`

---

### Zadanie 16 (B-10): Weryfikacja negatywna — celowo zatrzymana usługa

**Pliki:**
- Utwórz: `docs/raport-km3/audyt-weryfikacja-negatywna.md` (generowany)

Usługą wyłączaną jest **`optimizer`**, i to nie jest wybór przypadkowy: audyt nie dotyka ŻADNEJ ze ścieżek, które solver obsługuje — ani `POST /grafik/solve` (`apps/tenant-runtime/src/grafik/optimizer.client.ts`), ani bramki wykonalności zamiany zmian (`apps/tenant-runtime/src/shift-swap/optimizer-swap-feasibility.validator.ts`). Pozostałe pięć kategorii zbierze się więc normalnie i raport pokaże jedną, konkretną awarię zamiast kaskady. Wyłączenie `postgres`, `keycloak` albo `tenant-runtime` przerwałoby zbieranie danych i skrypt wyszedłby ścieżką awaryjną, a nie przez ustalenia. `restart: unless-stopped` nie podnosi kontenera zatrzymanego ręcznie, a w stosie nie ma osobnego kontenera autoheal (słowo „autoheal" występuje w `docker-compose.yml` wyłącznie w komentarzu), więc usługa zostanie wyłączona tak długo, jak trzeba.

- [ ] **Krok 46: Zapisz stan wyjściowy do porównania.** Komenda: `docker compose -p hrobot ps -a --format "{{.Service}} {{.State}} {{.Health}}" | Select-String optimizer`. Oczekiwane: `optimizer running healthy`.

- [ ] **Krok 47: Zatrzymaj usługę `optimizer`.** Komenda: `docker compose -p hrobot --profile full stop optimizer`. Oczekiwane wyjście (na stderr): `✔ Container hrobot-optimizer-1  Stopped`. (`-p hrobot` jest konieczne, bo katalog nazywa się `HRobot-m2`; `--profile full` — bo usługa jest za profilem.)

- [ ] **Krok 48: Potwierdź, że usługa faktycznie stoi.** Komenda: `docker compose -p hrobot ps -a --format "{{.Service}} {{.State}} {{.Health}}" | Select-String optimizer`. Oczekiwane: `optimizer exited` (kolumna Health pusta).

- [ ] **Krok 49: Uruchom audyt do osobnego pliku i zobacz kod ≠ 0.** Komenda: `node scripts/audyt-powdrozeniowy.mjs --out docs/raport-km3/audyt-weryfikacja-negatywna.md; Write-Host "kod wyjscia=$LASTEXITCODE"`. Oczekiwane wyjście:
```
Audyt powdrozeniowy: 38 kontroli, 5 rekomendacji -> C:\...\docs\raport-km3\audyt-weryfikacja-negatywna.md
BLAD - kontrole niezaliczone: Wersje obrazów/optimizer; Healthchecki/optimizer
kod wyjscia=1
```
To jest wymóg krytyczny bloku (kryterium akceptacji B.3): kod wyjścia ≠ 0 **i** wskazanie usługi z nazwy.

- [ ] **Krok 50: Potwierdź, że plik raportu też wskazuje usługę.** Komenda: `Select-String -Path docs\raport-km3\audyt-weryfikacja-negatywna.md -Pattern 'Przebieg zakończony błędem|B2-07' | ForEach-Object { $_.Line }`. Oczekiwane dwa wiersze: `**Przebieg zakończony błędem.** Kontrole niezaliczone: Wersje obrazów/optimizer; Healthchecki/optimizer.` oraz `| B2-07 | optimizer | exited / brak sondy | running / healthy | BŁĄD |`.

- [ ] **Krok 51: Przywróć usługę.** Komenda: `docker compose -p hrobot --profile full start optimizer`. Oczekiwane: `✔ Container hrobot-optimizer-1  Started`.

- [ ] **Krok 52: Poczekaj, aż healthcheck wróci na zielone.** Healthcheck `optimizer` ma `start_period: 15s` i `interval: 10s`, więc przez pierwsze kilkanaście sekund stan to `starting`. Komenda (pętla `for`, nie `ForEach-Object` — `break` w bloku potoku ubija cały potok, nie iterację):
```powershell
for ($i = 1; $i -le 12; $i++) { $h = docker inspect hrobot-optimizer-1 --format '{{.State.Health.Status}}'; Write-Host "$i $h"; if ($h -eq 'healthy') { break }; Start-Sleep -Seconds 5 }
```
Oczekiwane: pętla kończy się wierszem zawierającym `healthy` (zwykle w 3.–5. iteracji).

- [ ] **Krok 53: Uruchom audyt ponownie i zobacz powrót do zera.** Komenda: `pnpm audyt; Write-Host "kod wyjscia=$LASTEXITCODE"`. Oczekiwane: `kod wyjscia=0` oraz brak wiersza `BLAD -` na stderr. To dowód, że kod 1 z kroku 49 pochodził od zatrzymanej usługi, a nie od trwałej wady skryptu.

- [ ] **Krok 54: Commit dowodu weryfikacji negatywnej.** `git add docs/raport-km3/audyt-weryfikacja-negatywna.md docs/raport-km3/audyt-powdrozeniowy.md; git commit -m "docs(km3): weryfikacja negatywna audytu — zatrzymany optimizer daje kod 1 i wskazuje usluge"`

---

### Zadanie 17 (B-11): PDF załącznika

**Pliki:**
- Utwórz: `docs/raport-km3/build/print-audyt.mjs`
- Zmień: `package.json`

- [ ] **Krok 55: Utwórz skrypt drukujący.** Utwórz `docs/raport-km3/build/print-audyt.mjs`:

```js
// docs/raport-km3/audyt-powdrozeniowy.md -> Audyt_powdrozeniowy_KM3.pdf
// Pandoc na fragment HTML + arkusz stylów wspólny z raportem KM3 + druk przez Chrome DevTools
// Protocol. Adaptacja print-km3.mjs; różnice: źródłem jest markdown (nie gotowy report.html),
// a stopka niesie numer i tytuł załącznika. Wywołanie pandoc jest identyczne jak dla raportu
// głównego (bez --wrap=none), żeby oba załączniki powstawały tym samym poleceniem.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.join(import.meta.dirname, '..');
const MD = path.join(ROOT, 'audyt-powdrozeniowy.md');
const HTML_FILE = path.join(ROOT, 'audyt.html');
const OUT = path.join(ROOT, 'Audyt_powdrozeniowy_KM3.pdf');
const LOGO = fs.readFileSync(path.join(ROOT, 'assets', 'logo-bar.png')).toString('base64');
const PORT = 9338;

const style = fs.readFileSync(path.join(ROOT, 'build', 'style.html'), 'utf8');
const body = execFileSync('pandoc', ['-f', 'markdown', '-t', 'html5', MD], { encoding: 'utf8' });
fs.writeFileSync(
  HTML_FILE,
  '<!doctype html><html lang="pl"><head><meta charset="utf-8">' +
    '<title>Załącznik nr 7 — Audyt powdrożeniowy — HRobot.AI</title>\n' +
    style +
    '</head><body>\n' +
    body +
    '</body></html>\n',
  'utf8',
);

const HTML = 'file:///' + HTML_FILE.replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--hide-scrollbars', '--disable-application-cache', '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.TEMP}\\hr-audyt-${Date.now()}`, HTML,
], { stdio: 'ignore' });

async function getPageWS() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error('DevTools endpoint not ready');
}

function rpc(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener('message', onMsg); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const wsUrl = await getPageWS();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

await rpc(ws, 1, 'Page.enable', {});
await sleep(2000);

const header = `<div style="width:100%; text-align:center; margin:0; padding:0;">
  <img src="data:image/png;base64,${LOGO}" style="height:34px;"></div>`;
const footer = `<div style="width:100%; font-size:8px; color:#666; text-align:center; padding:0 12mm;">
  HRobot.AI · App Pro sp. z o.o. — Załącznik nr 7 do Raportu KM3: audyt powdrożeniowy · Poufne · Strona <span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

const result = await rpc(ws, 2, 'Page.printToPDF', {
  landscape: false,
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: header,
  footerTemplate: footer,
  paperWidth: 8.27, paperHeight: 11.69,
  marginTop: 0.72, marginBottom: 0.55, marginLeft: 0.63, marginRight: 0.63,
  preferCSSPageSize: false,
});

fs.writeFileSync(OUT, Buffer.from(result.data, 'base64'));
console.log('WROTE', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
ws.close();
chrome.kill();
process.exit(0);
```

- [ ] **Krok 56: Dodaj komendę do `package.json`.** W sekcji `"scripts"`, pod dopisaną wcześniej linią `"test:audyt": ...`, dopisz:

```json
    "audyt:pdf": "node docs/raport-km3/build/print-audyt.mjs",
```

- [ ] **Krok 57: Zbuduj PDF jedną komendą.** Komenda: `pnpm audyt:pdf`. Oczekiwane wyjście: `WROTE C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\docs\raport-km3\Audyt_powdrozeniowy_KM3.pdf <N>KB`, gdzie `<N>` mieści się w przedziale 130–220 (samo logo w nagłówku to 105 KB PNG-a osadzonego jako data URI). Kod wyjścia 0.

- [ ] **Krok 58: Otwórz PDF i sprawdź nagłówek oraz stopkę.** Komenda: `Start-Process docs\raport-km3\Audyt_powdrozeniowy_KM3.pdf`. Sprawdź na stronie 1: pasek z logo u góry (jak w `Raport_KM3_HRobot.pdf`), stopka `Załącznik nr 7 do Raportu KM3: audyt powdrożeniowy · Poufne · Strona 1 / N`, sześć tabel ustaleń bez rozerwanych wierszy.

- [ ] **Krok 59: Commit.** `git add docs/raport-km3/build/print-audyt.mjs docs/raport-km3/audyt.html docs/raport-km3/Audyt_powdrozeniowy_KM3.pdf package.json; git commit -m "docs(km3): PDF zalacznika nr 7 — audyt powdrozeniowy (pandoc + CDP)"`

---

### Zadanie 18 (B-12): Wpięcie załącznika nr 7 do raportu KM3

**Pliki:**
- Utwórz: `docs/raport-km3/build/build-report-html.mjs`
- Zmień: `docs/raport-km3/Raport_KM3_HRobot.md`

Sekcja 5 raportu (wiersz 378, „Ograniczenia realizacji demonstracyjnej") **nie jest tu ruszana** — blok B niczego do niej nie dopisuje, bo audyt powdrożeniowy nie jest ograniczeniem, tylko dostarczonym zadaniem. Zmiana dotyczy wyłącznie wykazu załączników w sekcji 8 (nagłówek `# 8. Wykaz załączników` w wierszu 443, tabela od wiersza 445) i jest dopisaniem wiersza, nie przepisaniem tabeli.

- [ ] **Krok 60: Sprawdź, że Zał. 6 jest już zajęty przez blok A.** Komenda: `Select-String -Path docs\raport-km3\Raport_KM3_HRobot.md -Pattern '^\s+\*\*Zał\. [0-9]+\*\*' | ForEach-Object { $_.Line }`. Oczekiwane: wiersze Zał. 1 … Zał. 5, a po wykonaniu bloku A — także Zał. 6. **Jeśli Zał. 6 nie ma na liście, blok A jeszcze nie wylądował: przerwij Zadanie 12 tutaj i wróć do niego po bloku A.** Zadania 1–11 są wtedy kompletne, zacommitowane i samodzielnie użyteczne (raport + PDF istnieją), a numeracja załączników nie rozjedzie się między dwiema równoległymi zmianami tej samej tabeli.

- [ ] **Krok 61: Dopisz wiersz Zał. 7.** W `docs/raport-km3/Raport_KM3_HRobot.md`, w tabeli sekcji 8, bezpośrednio pod wierszem zaczynającym się od `  **Zał. 6**` dopisz dokładnie ten wiersz (dwie spacje wcięcia, `**Zał. 7**`, trzy spacje, potem treść — to siatka kolumn prostej tabeli pandoc: kolumna „Nr" ma 12 znaków, druga zaczyna się na offsecie 15):

```
  **Zał. 7**   Audyt powdrożeniowy środowiska demonstracyjnego (10 usług, healthchecki, migracje, kontrole RODO, próbka RBAC, integralność danych) --- `docs/raport-km3/audyt-powdrozeniowy.md`, przebieg negatywny `audyt-weryfikacja-negatywna.md`
```

- [ ] **Krok 62: Utwórz skrypt przebudowy `report.html`.** Dotąd `report.html` powstawał ręcznym sklejeniem i nie było tego czym powtórzyć. Utwórz `docs/raport-km3/build/build-report-html.mjs`:

```js
// docs/raport-km3/Raport_KM3_HRobot.md -> build/body.html -> report.html
// print-km3.mjs czyta gotowy report.html, więc po każdej zmianie markdownu raportu głównego
// trzeba go najpierw odtworzyć. Wywołanie pandoc i szablon HTML są dobrane tak, żeby na
// niezmienionym markdownie odtworzyć obecny report.html co do bajtu (zweryfikowane, pandoc 3.9).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const BODY = path.join(ROOT, 'build', 'body.html');
const OUT = path.join(ROOT, 'report.html');

const body = execFileSync('pandoc', ['-f', 'markdown', '-t', 'html5', path.join(ROOT, 'Raport_KM3_HRobot.md')], {
  encoding: 'utf8',
});
fs.writeFileSync(BODY, body, 'utf8');

const style = fs.readFileSync(path.join(ROOT, 'build', 'style.html'), 'utf8');
fs.writeFileSync(
  OUT,
  '<!doctype html><html lang="pl"><head><meta charset="utf-8">' +
    '<title>Raport z realizacji Kamienia Milowego 3 — HRobot.AI</title>\n' +
    style +
    '</head><body>\n' +
    body +
    '</body></html>\n',
  'utf8',
);
console.log('WROTE', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
```

- [ ] **Krok 63: Przebuduj `report.html` i PDF raportu głównego.** Komendy: `node docs/raport-km3/build/build-report-html.mjs; node docs/raport-km3/build/print-km3.mjs`. Oczekiwane wyjście: `WROTE …\report.html 32KB` (o ~0,3 KB więcej niż przed dopisaniem wiersza), a potem `WROTE …\Raport_KM3_HRobot.pdf …KB`. Otwórz PDF na ostatniej stronie (`Start-Process docs\raport-km3\Raport_KM3_HRobot.pdf`) i sprawdź, że wykaz ma siedem wierszy, a blok „Raport sporządził" nie został rozerwany na dwie strony.

- [ ] **Krok 64: Uruchom pełny zestaw testów bloku ostatni raz.** Komenda: `pnpm test:audyt; Write-Host "kod=$LASTEXITCODE"`. Oczekiwane: `# tests 34`, `# pass 34`, `# fail 0`, `kod=0`.

- [ ] **Krok 65: Commit.** `git add docs/raport-km3 package.json; git commit -m "docs(km3): zalacznik nr 7 w wykazie sekcji 8 — audyt powdrozeniowy"`

---

**Ryzyka bloku B:**

1. **Numeracja załączników zderza się z blokiem A.** Blok A dopisuje Zał. 6, blok B Zał. 7, oba w tej samej tabeli sekcji 8. Wykonane równolegle dadzą konflikt merge'a albo dwa razy „Zał. 6". Mitygacja: krok 60 to jawna bramka — blok B nie tyka raportu, dopóki Zał. 6 nie istnieje, a Zadania 1–11 są do tego momentu kompletnym, zacommitowanym produktem.
2. **Hasło konta `demo` nie jest w repozytorium.** `scripts/seed-keycloak-demo.mjs:29` czyta je z `DEMO_ADMIN_PASSWORD`, a runner z `KEYCLOAK_DEMO_PASSWORD` z fallbackiem na `demo-staging-2026` (domyślna wartość z `docker-compose.yml:218` — zweryfikowana). Jeśli realm postawiono z innym hasłem, audyt padnie na `BLAD audytu (przerwane zbieranie danych): Keycloak zwrócił HTTP 401 dla konta demo` i wyjdzie kodem 1 — czyli fałszywy alarm. Mitygacja: przed przebiegiem `$env:KEYCLOAK_DEMO_PASSWORD = '<hasło>'`; komunikat błędu nazywa konto, więc diagnoza jest natychmiastowa.
3. **Sondy `UPDATE`/`DELETE` na `audit_log` przy martwym wyzwalaczu.** Gdyby wyzwalacz zniknął, samo zapytanie by przeszło. Mitygacja wbudowana: oba zapytania są opakowane w `BEGIN … ROLLBACK`, więc tabela nie zmienia zawartości niezależnie od wyniku; krok 44 sprawdza to liczbowo (`SELECT count(*) … 'AUDYT-PROBE'` = 0). Zweryfikowane na żywej bazie: `audit_log` przed i po przebiegu miał tę samą liczbę wierszy i zero wpisów sondy.
4. **Weryfikacja negatywna zostawia `optimizer` zatrzymany.** Gdyby przerwać zadanie 10 między krokiem 47 a 51, przestaną działać DWIE ścieżki produktu: `POST /grafik/solve` (Grafik AI) oraz bramka wykonalności zamiany zmian (`shift-swap`, `optimizer-swap-feasibility.validator.ts`) — a do odbioru M3 zostało 8 dni. Mitygacja: kroki 51 i 52 to osobne, jawne kroki z komendą i pętlą oczekiwania na `healthy`; krok 53 jest niezależnym potwierdzeniem powrotu do zera.
5. **Kotwice demo mogą się przesunąć od innego bloku.** `POST /grafik/solve` zapisuje `Shift(source=AUTO)` — 1557 z 1558 zmian już tak powstało (zweryfikowane: `AUTO` 1557, `MANUAL` 1). Jeśli ktoś uruchomi solver albo `golden-path-probe.mjs --include-solve`, kontrola B6-02 zapali się na czerwono. To zachowanie zamierzone: audyt ma wykryć naruszenie kotwicy, a nie je przemilczeć.
6. **Chrome/pandoc jako zależności hosta.** `print-audyt.mjs` i `build-report-html.mjs` zakładają Chrome pod `C:\Program Files\Google\Chrome\Application\chrome.exe` i `pandoc` w PATH (oba zweryfikowane: pandoc 3.9, Chrome obecny; `execFileSync('pandoc', …)` działa na Windows bez powłoki). Na innej maszynie kroki 57 i 63 padną natychmiast i jednoznacznie; markdown z zadania 9 jest wtedy nadal kompletnym produktem, brakuje tylko PDF-a.
7. **`compositeScore` — nietknięty.** Blok nie importuje `apps/tenant-runtime/src/strategic-brain/scoring.util.ts:100`, nie zmienia żadnego pliku w `apps/`, `packages/` ani `agent-service/` i nie wykonuje ani jednego zapytania zapisującego (dwie sondy `audit_log` kończą się `ROLLBACK`). Jedyny plik produktowy dotknięty przez blok to `package.json` (trzy nowe wpisy w `scripts`).
8. **Rozjazd `report.html` wobec markdownu raportu głównego.** `print-km3.mjs` drukuje z `report.html`, nie z markdownu — dopisanie wiersza Zał. 7 bez przebudowy HTML dałoby PDF bez tego wiersza. Mitygacja: krok 62 dodaje `build-report-html.mjs`, który odtwarza `report.html` z markdownu (na niezmienionym wejściu daje obecny plik co do bajtu — zweryfikowane), i krok 63 uruchamia go przed drukiem.

**Wycofanie bloku B:**

Blok nie zmienia schematu bazy, danych ani kodu produktu, więc wycofanie jest zupełne i bezstratne:

```
git rm -r scripts/audyt
git rm scripts/audyt-powdrozeniowy.mjs
git rm docs/raport-km3/audyt-powdrozeniowy.md docs/raport-km3/audyt-weryfikacja-negatywna.md
git rm docs/raport-km3/audyt.html docs/raport-km3/Audyt_powdrozeniowy_KM3.pdf
git rm docs/raport-km3/build/print-audyt.mjs docs/raport-km3/build/build-report-html.mjs
git checkout -- package.json docs/raport-km3/Raport_KM3_HRobot.md docs/raport-km3/report.html docs/raport-km3/build/body.html docs/raport-km3/Raport_KM3_HRobot.pdf
```

`git checkout` przywraca `report.html`, `build/body.html` i PDF raportu głównego z ostatniego commitu, więc po wycofaniu nic nie trzeba przebudowywać. Jeśli wycofanie następuje w trakcie zadania 10, przed czymkolwiek innym uruchom `docker compose -p hrobot --profile full start optimizer` — to jedyna zmiana stanu, jaką blok wprowadza poza plikami.

---

## Blok C — Personalizacja komunikacji asystenta (M3 c)

*Zadania globalne 19–28. Kroki numerowane osobno w każdym zadaniu (tak jak w planie źródłowym).*

**Powłoka i katalogi.** Wszystkie komendy w tym planie uruchamiaj w narzędziu **Bash (Git Bash)**, nie w PowerShellu — używają `&&`, prefiksów `ZMIENNA=wartość komenda` i `/dev/null`, których Windows PowerShell 5.1 na tej maszynie nie parsuje. Korzeń repo to `C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2` = `/c/Users/Wilk/Documents/WORKSPACE/HRobot-m2`, gałąź `feat/demo-4mobility`. Wszystkie ścieżki plików podaję względem korzenia repo.

**Ustalenia sprzeczne z założeniem (zweryfikowane w kodzie 2026-08-12):**

1. **Pola „limit urlopowy" NIE MA w modelu danych.** `packages/db/generated/tenant/schema.prisma` — model `Employee` (linie **147–195**) nie zawiera żadnego pola wymiaru/limitu/salda urlopu; `LeaveRequest` (linie 333–352) ma tylko `startDate`/`endDate`/`status`/`type`.
2. **ALE saldo istnieje jako wielkość WYLICZANA i już zaimplementowana.** Backend ma intencję `SALDO_URLOPU` (`apps/tenant-runtime/src/agent-glosowy/intent.util.ts:50`), a `apps/tenant-runtime/src/agent-glosowy/voice-command.service.ts:630-664` liczy ją jako **płaski wymiar ustawowy `WYMIAR_URLOPU_DNI = 20`** (KP art. 154 §1, linia 18) minus suma dni kalendarzowych zatwierdzonych urlopów sklasyfikowanych jako `WYPOCZYNKOWY` (predykat `drawsDownAnnualEntitlement`, `apps/tenant-runtime/src/common/leave-type.ts:77`). Zwraca `{ wymiarDni, wykorzystaneDni, pozostaleDni }` (linie 641–645). **Plan reużywa tę liczbę, nie wymyśla własnej.**
3. **Pułapka liczbowa dla konta bez kartoteki.** `apps/tenant-runtime/src/leave/leave.service.ts:143-148` — przy `mine: true` brak kartoteki daje `return []`, więc backend policzy `pozostało 20 z 20 dni` dla kogoś, kto nie ma w systemie ani jednego dnia urlopu. To dokładnie ta klasa błędu, która wywaliła `/moj-tydzien` (`apps/web/components/moj-tydzien/mobile-week.tsx:128-148`). Web MUSI zablokować pokazanie salda przy `404` z `/api/employees/me`.
4. **Typ `AgentIntent` w web jest zdryfowany.** `apps/web/lib/agent-glosowy.ts:22` zna 4 intencje; backend zna 13 (`intent.util.ts:20-33`). Skutek dziś widoczny na ekranie: `intentLabel('SALDO_URLOPU')` zwraca surowy enum (`agent-glosowy.ts:154-156` — `INTENT_LABEL[intent] ?? intent`), więc badge karty odpowiedzi w stanie `done` (`asystent-screen.tsx:565`) pokaże `SALDO_URLOPU`. Zadanie 1 to naprawia — bez tego nie da się też typowo wywołać `execute({ intent: 'SALDO_URLOPU' })` (`ExecuteInput.intent: AgentIntent`, `agent-glosowy.ts:62`).
5. **Nazwy jednostki nie ma w `/api/employees/me`.** Projekcja `SAFE_SELECT` (`apps/tenant-runtime/src/employees/employees.service.ts:24-34`) zwraca `unitId`, nie `name`. Nazwę bierzemy z `GET /api/grafik/units` (`grafik.controller.ts:96`, `grafik.service.ts:135-136` → `select: { id, name }`), dostępnego dla `PRACOWNIK` (`READ_ROLES`, linia 27) i pozbawionego PII.
6. **Ekran nie da się przetestować jednostkowo.** `apps/web/vitest.config.ts` → `environment: 'node'`, `include: ['lib/**/*.test.ts', 'components/**/*.test.ts']` — brak jsdom i `@testing-library/react`. Dlatego CAŁA logika idzie do `lib/personalizacja.ts` (vitest), a wpięcie w komponent bramkuje `tsc --noEmit` + `eslint` + Playwright.
7. **Kontrakt `/api/employees/me` ma pola WYMAGANE, nie opcjonalne.** `Employee.unitId` jest w schemacie NOT NULL (`schema.prisma:160`), a `SAFE_SELECT` zawsze wybiera `firstName` i `unitId`. Istniejący typ tej odpowiedzi w repo — `apps/web/components/dashboard/pracownik-board.tsx:30-36` — deklaruje `firstName: string` i `unitId: string`. Nasz `MeResponse` musi mieć ten sam kształt; nie wolno testować stanu „kartoteka bez jednostki", bo taki nie może wyjść z API. Realny brak nazwy jednostki wynika z czego innego: `GET /api/grafik/units` może nie odpowiedzieć.
8. **`no-unused-vars` jest błędem, nie ostrzeżeniem.** `packages/config/eslint.config.mjs` ustawia `@typescript-eslint/no-unused-vars: ["error", …]`, a `apps/web/eslint.config.mjs` go dziedziczy. Żaden import nie może wyprzedzić swojego użycia o całe zadanie.
9. **Hasło konta `demo` nie jest faktem z repo.** `scripts/demo-up.mjs:22-32` wymaga `DEMO_ADMIN_PASSWORD` ze środowiska i wprost mówi, że `demo-staging-2026` zostało zrotowane, bo jest w historii gita. Nowy spec e2e czyta hasło ze zmiennej środowiskowej i głośno pada, gdy jej nie ma.
10. **Baseline zmierzony przed rozpoczęciem:** `cd apps/web && npx tsc --noEmit` → kod wyjścia 0, brak wyjścia. `npx vitest run lib/agent-glosowy.test.ts` → `18 passed (18)`. `grep -cF "{.lbl}" docs/raport-km3/Raport_KM3_HRobot.md` → `12`.
11. **Odstępstwo od specu, świadome.** Spec §Pliki wskazuje `apps/web/lib/agent-glosowy.ts:185` jako miejsce na podpowiedzi wg roli. Wkładamy je do NOWEGO `apps/web/lib/personalizacja.ts`, bo `agent-glosowy.ts` jest lustrem kontraktu backendu („hand-kept in sync", nagłówek pliku, linia 16) i dokładanie tam logiki produktowej rozmyłoby jedyną zasadę, która trzyma ten plik w zgodzie z NestJS-em. Odstępstwo odnotowane tutaj i w commicie zadania 4.
12. **Obserwacja poboczna, POZA zakresem bloku C:** `docs/raport-km3/Raport_KM3_HRobot.md:406` deklaruje kotwice „36 pracowników, 832 zmiany", a kotwice z briefu to 39 / 1558. To rozjazd w dokumencie, nie w kodzie, i dotyczy zdania, którego blok C nie dotyka. Blok C go **nie naprawia i nie zgłasza jako swojego zadania** — mierzy jedynie, że po jego przebiegu prawdziwe liczby w bazie to nadal 39 i 1558 (zadanie 10, krok 6).

---

### Zadanie 19 (C-1): Wyrównanie `AgentIntent` w web do 13 intencji backendu

**Pliki:**
- Zmień: `apps/web/lib/agent-glosowy.ts`
- Test: `apps/web/lib/agent-glosowy.test.ts`

- [ ] **Krok 0: Oznacz punkt wyjścia bloku, żeby dało się na końcu udowodnić, czego nie ruszono.**

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2 && git tag -f blok-c-baza && git rev-parse --short blok-c-baza
```

Oczekiwane: jeden 7-znakowy SHA. Tag jest lokalny i kasowany w zadaniu 10.

- [ ] **Krok 1: Dopisz czerwone przypadki dla brakujących etykiet.** Na końcu bloku `describe('intentLabel', ...)` w `apps/web/lib/agent-glosowy.test.ts` (przed zamykającym `})` tego describe, tj. po teście `echoes an unknown value rather than throwing`) dodaj:

```ts
  it('nazywa po polsku KAŻDĄ z 13 intencji backendu — dziś SALDO_URLOPU wyciekało na ekran jako surowy enum', () => {
    expect(intentLabel('SALDO_URLOPU')).toBe('Saldo urlopu')
    expect(intentLabel('STATUS_WNIOSKU')).toBe('Status wniosku')
    expect(intentLabel('POMOC')).toBe('Lista poleceń')
    expect(intentLabel('KTO_PRACUJE')).toBe('Kto pracuje')
    expect(intentLabel('NASTEPNA_ZMIANA')).toBe('Najbliższa zmiana')
    expect(intentLabel('MOJA_EWIDENCJA')).toBe('Moja ewidencja czasu pracy')
    expect(intentLabel('ANULUJ_WNIOSEK')).toBe('Anulowanie wniosku')
    expect(intentLabel('ZAMIANA_ZMIANY')).toBe('Zamiana zmiany')
    expect(intentLabel('ZNAJDZ_ZASTEPSTWO')).toBe('Poszukiwanie zastępstwa')
  })
```

- [ ] **Krok 2: Uruchom i ZOBACZ czerwień.**

```
cd apps/web && npx vitest run lib/agent-glosowy.test.ts
```

Oczekiwane: `FAIL lib/agent-glosowy.test.ts` z `AssertionError: expected 'SALDO_URLOPU' to be 'Saldo urlopu'`, `Tests 1 failed | 18 passed (19)`. Uwaga: vitest transpiluje przez esbuild **bez sprawdzania typów**, więc w tym wyjściu NIE zobaczysz błędu, że `'SALDO_URLOPU'` nie należy do `AgentIntent` — ten pojawi się dopiero w `tsc` (krok 7).

- [ ] **Krok 3: Rozszerz unię `AgentIntent`.** W `apps/web/lib/agent-glosowy.ts` zastąp linie 21–22 (komentarz + `export type AgentIntent = ...`):

```ts
/**
 * Zbiór komend, 1:1 z `AgentIntent` w apps/tenant-runtime/src/agent-glosowy/intent.util.ts:20-33
 * (12 pozycji `INTENT_CATALOG` + wartownik `NIEZNANE`). Kopiowany ręcznie — te dwie aplikacje nie
 * dzielą granicy pakietu; ta sama konwencja co `CONFIDENCE_THRESHOLD` niżej. Do 2026-08-12 unia
 * znała 4 z 13 wartości, przez co `intentLabel` echował surowy enum (`SALDO_URLOPU`) wprost na
 * kartę odpowiedzi asystenta.
 */
export type AgentIntent =
  | 'URLOP'
  | 'L4'
  | 'MOJ_GRAFIK'
  | 'SALDO_URLOPU'
  | 'STATUS_WNIOSKU'
  | 'POMOC'
  | 'KTO_PRACUJE'
  | 'NASTEPNA_ZMIANA'
  | 'MOJA_EWIDENCJA'
  | 'ANULUJ_WNIOSEK'
  | 'ZAMIANA_ZMIANY'
  | 'ZNAJDZ_ZASTEPSTWO'
  | 'NIEZNANE'
```

- [ ] **Krok 4: Uzupełnij mapę etykiet.** W tym samym pliku zastąp cały literał `const INTENT_LABEL: Record<AgentIntent, string> = { ... }` (linie 145–150):

```ts
const INTENT_LABEL: Record<AgentIntent, string> = {
  URLOP: 'Wniosek urlopowy',
  L4: 'Zwolnienie lekarskie (L4)',
  MOJ_GRAFIK: 'Mój grafik',
  SALDO_URLOPU: 'Saldo urlopu',
  STATUS_WNIOSKU: 'Status wniosku',
  POMOC: 'Lista poleceń',
  KTO_PRACUJE: 'Kto pracuje',
  NASTEPNA_ZMIANA: 'Najbliższa zmiana',
  MOJA_EWIDENCJA: 'Moja ewidencja czasu pracy',
  ANULUJ_WNIOSEK: 'Anulowanie wniosku',
  ZAMIANA_ZMIANY: 'Zamiana zmiany',
  ZNAJDZ_ZASTEPSTWO: 'Poszukiwanie zastępstwa',
  NIEZNANE: 'Nierozpoznane polecenie',
}
```

- [ ] **Krok 5: Uzupełnij mapę linków fallbacku.** Zastąp cały literał `const FALLBACK_LINK_BY_INTENT: Record<AgentIntent, FallbackLink> = { ... }` (linie 211–216):

```ts
const FALLBACK_LINK_BY_INTENT: Record<AgentIntent, FallbackLink> = {
  URLOP: { label: 'Przejdź do formularza wniosków', href: '/wnioski' },
  L4: { label: 'Przejdź do formularza wniosków', href: '/wnioski' },
  SALDO_URLOPU: { label: 'Przejdź do formularza wniosków', href: '/wnioski' },
  STATUS_WNIOSKU: { label: 'Przejdź do formularza wniosków', href: '/wnioski' },
  ANULUJ_WNIOSEK: { label: 'Przejdź do formularza wniosków', href: '/wnioski' },
  POMOC: { label: 'Przejdź do formularza wniosków', href: '/wnioski' },
  MOJ_GRAFIK: { label: 'Przejdź do grafiku', href: '/grafik' },
  KTO_PRACUJE: { label: 'Przejdź do grafiku', href: '/grafik' },
  NASTEPNA_ZMIANA: { label: 'Przejdź do grafiku', href: '/grafik' },
  MOJA_EWIDENCJA: { label: 'Przejdź do grafiku', href: '/grafik' },
  ZAMIANA_ZMIANY: { label: 'Przejdź do zamian zmian', href: '/zamiany' },
  ZNAJDZ_ZASTEPSTWO: { label: 'Przejdź do zamian zmian', href: '/zamiany' },
  NIEZNANE: { label: 'Przejdź do formularza wniosków', href: '/wnioski' },
}
```

- [ ] **Krok 6: Uruchom i ZOBACZ zieleń.**

```
cd apps/web && npx vitest run lib/agent-glosowy.test.ts
```

Oczekiwane: `Test Files 1 passed (1)`, `Tests 19 passed (19)` (baseline: 18).

- [ ] **Krok 7: Sprawdź, że rozszerzenie unii nic nie zepsuło w typach.**

```
cd apps/web && npx tsc --noEmit
```

Oczekiwane: brak wyjścia, kod wyjścia 0. (`komunikatWykonania` w `asystent-screen.tsx:120-130` ma gałąź `default`, więc szersza unia jej nie łamie.)

- [ ] **Krok 8: Commit.**

```
git add apps/web/lib/agent-glosowy.ts apps/web/lib/agent-glosowy.test.ts && git commit -m "fix(web): AgentIntent 1:1 z backendem (13 intencji) — koniec surowych enumow na karcie asystenta"
```

---

### Zadanie 20 (C-2): Odczyt salda urlopu z `ExecuteResult.result`

**Pliki:**
- Zmień: `apps/web/lib/agent-glosowy.ts`
- Test: `apps/web/lib/agent-glosowy.test.ts`

- [ ] **Krok 1: Napisz czerwony test.** Dopisz na końcu `apps/web/lib/agent-glosowy.test.ts`:

```ts
describe('czytajSaldoUrlopu', () => {
  it('czyta saldo z nietypowanego result (kształt z voice-command.service.ts:641-645)', () => {
    expect(czytajSaldoUrlopu({ wymiarDni: 20, wykorzystaneDni: 8, pozostaleDni: 12 })).toEqual({
      wymiarDni: 20,
      wykorzystaneDni: 8,
      pozostaleDni: 12,
    })
  })

  it('zwraca null dla braku wyniku, wyniku innego kształtu i pola nieliczbowego — nigdy nie udaje zera', () => {
    expect(czytajSaldoUrlopu(undefined)).toBeNull()
    expect(czytajSaldoUrlopu(null)).toBeNull()
    expect(czytajSaldoUrlopu('20')).toBeNull()
    expect(czytajSaldoUrlopu({ status: 'PENDING' })).toBeNull()
    expect(czytajSaldoUrlopu({ wymiarDni: 20, wykorzystaneDni: 8, pozostaleDni: '12' })).toBeNull()
  })

  it('kopiuje wyłącznie trzy znane pola — nic więcej nie przechodzi do UI', () => {
    const saldo = czytajSaldoUrlopu({
      wymiarDni: 20,
      wykorzystaneDni: 8,
      pozostaleDni: 12,
      employeeId: 'aaaa-bbbb',
      lastName: 'Kowalska',
    })
    expect(Object.keys(saldo ?? {}).sort()).toEqual(['pozostaleDni', 'wykorzystaneDni', 'wymiarDni'])
  })
})
```

Do listy importów na górze pliku (blok `from './agent-glosowy'`) dodaj `czytajSaldoUrlopu,`.

- [ ] **Krok 2: Uruchom i ZOBACZ czerwień.**

```
cd apps/web && npx vitest run lib/agent-glosowy.test.ts
```

Oczekiwane: `FAIL` z `SyntaxError: The requested module './agent-glosowy' does not provide an export named 'czytajSaldoUrlopu'`.

- [ ] **Krok 3: Dopisz typ i parser.** Na końcu `apps/web/lib/agent-glosowy.ts`, pod stałą `FALLBACK_MESSAGE`:

```ts
// --- saldo urlopu (personalizacja M3 c) ----------------------------------------------------------

/**
 * Saldo urlopu wypoczynkowego zwracane w `ExecuteResult.result` dla intencji `SALDO_URLOPU`
 * (apps/tenant-runtime/src/agent-glosowy/voice-command.service.ts:641-645).
 *
 * UWAGA CO DO ZNACZENIA: `wymiarDni` to PŁASKI WYMIAR USTAWOWY (Kodeks pracy art. 154 §1, stała
 * `WYMIAR_URLOPU_DNI = 20` po stronie backendu, voice-command.service.ts:18), a NIE indywidualny
 * limit z kartoteki — takiego pola model `Employee` nie ma (packages/db/generated/tenant/
 * schema.prisma:147-195). `wykorzystaneDni` to suma dni kalendarzowych zatwierdzonych urlopów
 * zaklasyfikowanych jako WYPOCZYNKOWY (`drawsDownAnnualEntitlement`,
 * apps/tenant-runtime/src/common/leave-type.ts:77). Ograniczenie zgłoszone w KM3 §5.
 */
export interface SaldoUrlopu {
  wymiarDni: number
  wykorzystaneDni: number
  pozostaleDni: number
}

/**
 * Bezpieczny odczyt {@link SaldoUrlopu} z nietypowanego `ExecuteResult.result`. Zwraca `null` dla
 * czegokolwiek innego niż komplet trzech liczb — UI ma wtedy powiedzieć „nie znam salda", nigdy
 * pokazać zera. Kopiuje WYŁĄCZNIE trzy znane pola, więc żadne dodatkowe pole z backendu (RODO) nie
 * przecieknie do widoku.
 */
export function czytajSaldoUrlopu(result: unknown): SaldoUrlopu | null {
  if (result == null || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  if (
    typeof r.wymiarDni !== 'number' ||
    typeof r.wykorzystaneDni !== 'number' ||
    typeof r.pozostaleDni !== 'number'
  ) {
    return null
  }
  return { wymiarDni: r.wymiarDni, wykorzystaneDni: r.wykorzystaneDni, pozostaleDni: r.pozostaleDni }
}
```

- [ ] **Krok 4: Uruchom i ZOBACZ zieleń.**

```
cd apps/web && npx vitest run lib/agent-glosowy.test.ts
```

Oczekiwane: `Tests 22 passed (22)`.

- [ ] **Krok 5: Commit.**

```
git add apps/web/lib/agent-glosowy.ts apps/web/lib/agent-glosowy.test.ts && git commit -m "feat(web): czytajSaldoUrlopu — typowany odczyt salda z ExecuteResult.result"
```

---

### Zadanie 21 (C-3): `lib/personalizacja.ts` — profil pracownika i powitanie

**Pliki:**
- Utwórz: `apps/web/lib/personalizacja.ts`
- Test: `apps/web/lib/personalizacja.test.ts` (nowy)

- [ ] **Krok 1: Napisz czerwony test.** Utwórz `apps/web/lib/personalizacja.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { etykietaRoli, powitanie, podtytulProfilu, zbudujProfil } from './personalizacja'

// vitest.config.ts uruchamia lib/**/*.test.ts w środowisku 'node' — to są czyste funkcje, bez sieci
// i bez modelu językowego (M3 c: personalizacja deterministyczna).

const CENTRUM_ID = '053774f2-63fb-565c-b142-77b17f456ec7'
const POLNOC_ID = '11111111-1111-4111-8111-111111111111'

const JEDNOSTKI = {
  [CENTRUM_ID]: 'Region Centrum',
  [POLNOC_ID]: 'Region Północ',
}

describe('etykietaRoli', () => {
  it('wybiera rolę najwyżej uprzywilejowaną', () => {
    expect(etykietaRoli(['PRACOWNIK', 'MANAGER'])).toBe('Menedżer')
    expect(etykietaRoli(['MANAGER', 'ADMIN_KLIENTA'])).toBe('Admin klienta')
    expect(etykietaRoli(['PRACOWNIK'])).toBe('Pracownik')
    expect(etykietaRoli(['HR'])).toBe('HR')
  })

  it('dla pustej listy ról nie zgaduje', () => {
    expect(etykietaRoli([])).toBe('Użytkownik')
  })
})

describe('zbudujProfil', () => {
  it('bierze imię z kartoteki, nie z tokenu, gdy kartoteka jest', () => {
    const profil = zbudujProfil({
      imieZSesji: 'anna.kowalska',
      roles: ['PRACOWNIK'],
      odczyt: { stan: 'jest', dane: { firstName: 'Anna', unitId: CENTRUM_ID } },
      nazwyJednostek: JEDNOSTKI,
    })
    expect(profil).toEqual({
      imie: 'Anna',
      rolaEtykieta: 'Pracownik',
      jednostka: 'Region Centrum',
      kartoteka: 'jest',
    })
  })

  it('spada na imię z sesji, gdy konto NIE MA kartoteki pracownika (404)', () => {
    const profil = zbudujProfil({
      imieZSesji: 'Marek',
      roles: ['MANAGER'],
      odczyt: { stan: 'brak' },
      nazwyJednostek: JEDNOSTKI,
    })
    expect(profil).toEqual({ imie: 'Marek', rolaEtykieta: 'Menedżer', jednostka: null, kartoteka: 'brak' })
  })

  it('odróżnia brak kartoteki od nieudanego odczytu (sieć/5xx)', () => {
    const profil = zbudujProfil({
      imieZSesji: 'Marek',
      roles: ['MANAGER'],
      odczyt: { stan: 'blad' },
      nazwyJednostek: JEDNOSTKI,
    })
    expect(profil.kartoteka).toBe('blad')
  })

  it('nie wymyśla nazwy jednostki, gdy katalog jej nie zna', () => {
    const profil = zbudujProfil({
      imieZSesji: 'Anna',
      roles: ['PRACOWNIK'],
      odczyt: { stan: 'jest', dane: { firstName: 'Anna', unitId: 'e2f3a4b5-0000-4000-8000-000000000000' } },
      nazwyJednostek: JEDNOSTKI,
    })
    expect(profil.jednostka).toBeNull()
  })

  it('nigdy nie zwraca pustego imienia — nawet gdy oba źródła są puste', () => {
    const profil = zbudujProfil({
      imieZSesji: '   ',
      roles: [],
      odczyt: { stan: 'jest', dane: { firstName: '  ', unitId: CENTRUM_ID } },
      nazwyJednostek: JEDNOSTKI,
    })
    expect(profil.imie).toBe('Użytkowniku')
  })
})

describe('powitanie / podtytulProfilu', () => {
  it('wita imieniem, a podtytuł podaje rolę i jednostkę', () => {
    const profil = zbudujProfil({
      imieZSesji: 'anna.kowalska',
      roles: ['PRACOWNIK'],
      odczyt: { stan: 'jest', dane: { firstName: 'Anna', unitId: CENTRUM_ID } },
      nazwyJednostek: JEDNOSTKI,
    })
    expect(powitanie(profil)).toBe('Cześć, Anna.')
    expect(podtytulProfilu(profil)).toBe('Pracownik · Region Centrum')
  })

  it('konto bez kartoteki dostaje powitanie i JAWNY komunikat, że nie ma danych „o mnie”', () => {
    const profil = zbudujProfil({
      imieZSesji: 'Marek',
      roles: ['MANAGER'],
      odczyt: { stan: 'brak' },
      nazwyJednostek: JEDNOSTKI,
    })
    expect(powitanie(profil)).toBe('Cześć, Marek.')
    expect(podtytulProfilu(profil)).toBe(
      'Menedżer · to konto nie ma kartoteki pracownika, więc pytania o własny grafik i urlop nie mają tu danych.',
    )
  })

  it('nieudany odczyt kartoteki mówi o awarii odczytu, a nie o braku kartoteki', () => {
    const profil = zbudujProfil({
      imieZSesji: 'Anna',
      roles: ['PRACOWNIK'],
      odczyt: { stan: 'blad' },
      nazwyJednostek: JEDNOSTKI,
    })
    expect(podtytulProfilu(profil)).toBe('Pracownik · nie udało się odczytać Twojej kartoteki pracownika.')
  })

  it('gdy katalog jednostek nie odpowiedział, podtytuł to SAMA rola — bez zmyślonego zdania o jednostce', () => {
    const profil = zbudujProfil({
      imieZSesji: 'Anna',
      roles: ['PRACOWNIK'],
      odczyt: { stan: 'jest', dane: { firstName: 'Anna', unitId: CENTRUM_ID } },
      nazwyJednostek: {},
    })
    expect(podtytulProfilu(profil)).toBe('Pracownik')
  })
})
```

- [ ] **Krok 2: Uruchom i ZOBACZ czerwień.**

```
cd apps/web && npx vitest run lib/personalizacja.test.ts
```

Oczekiwane: `FAIL lib/personalizacja.test.ts` z `Error: Failed to load url ./personalizacja ... Does the file exist?`.

- [ ] **Krok 3: Utwórz moduł z profilem i powitaniem.** Utwórz `apps/web/lib/personalizacja.ts`:

```ts
/**
 * Personalizacja komunikacji asystenta (M3 c) — CZYSTE funkcje: zero sieci, zero PII poza danymi
 * SAMEGO zalogowanego, zero modelu językowego. Cała treść jest wyliczana regułowo z profilu, spójnie
 * z decyzją architektoniczną modułu Agent Głosowy (parser intencji też jest regułowy, `intent.util.ts`).
 *
 * DLACZEGO OSOBNY PLIK: apps/web/vitest.config.ts uruchamia wyłącznie `lib/**\/*.test.ts` i
 * `components/**\/*.test.ts` w środowisku `node` — bez jsdom i bez @testing-library/react. Logika w
 * komponencie byłaby nietestowalna, więc komponent (components/asystent/asystent-screen.tsx) ma tylko
 * pobrać dane i wyrenderować to, co wyliczy ten moduł.
 *
 * DLACZEGO NIE W lib/agent-glosowy.ts (spec §Pliki wskazywał tamten plik): agent-glosowy.ts jest
 * lustrem kontraktu backendu, trzymanym w zgodzie ręcznie („hand-kept in sync", nagłówek pliku).
 * Dołożenie tam logiki produktowej rozmyłoby jedyną zasadę, która ten plik pilnuje.
 */

import type { Role } from './nav'

/**
 * Kształt odpowiedzi `GET /api/employees/me` w zakresie, którego potrzebuje personalizacja — podzbiór
 * projekcji SAFE_SELECT (apps/tenant-runtime/src/employees/employees.service.ts:24-34). Oba pola są
 * WYMAGANE, bo `Employee.unitId` jest w schemacie NOT NULL (schema.prisma:160), a `SAFE_SELECT`
 * zawsze wybiera `firstName` i `unitId` — ten sam kształt deklaruje już
 * components/dashboard/pracownik-board.tsx:30-36 dla tego samego endpointu. Nazwy jednostki tam NIE
 * MA, jest tylko `unitId`; nazwa przychodzi z `GET /api/grafik/units`.
 */
export interface MeResponse {
  firstName: string
  unitId: string
}

/** Trzy stany odczytu własnej kartoteki. `brak` (HTTP 404) i `blad` (sieć/5xx) MUSZĄ być rozdzielone:
 *  pierwszy to trwała cecha konta (ADMIN_KLIENTA/HR to login, nie osoba w grafiku), drugi to awaria.
 *  Zlanie ich w jedno dało na /moj-tydzien komunikat „Brak połączenia. Sprawdź internet." przy
 *  sprawnej sieci — patrz components/moj-tydzien/mobile-week.tsx:35-48. */
export type OdczytKartoteki =
  | { stan: 'jest'; dane: MeResponse }
  | { stan: 'brak' }
  | { stan: 'blad' }

export type StanKartoteki = OdczytKartoteki['stan']

export interface ProfilAsystenta {
  /** Imię do powitania — z kartoteki, a gdy jej nie ma, z tokenu sesji. Nigdy puste. */
  imie: string
  /** Polska etykieta najwyższej roli, jaką ma użytkownik. */
  rolaEtykieta: string
  /** NAZWA jednostki organizacyjnej albo `null`, gdy nieznana (katalog nie odpowiedział albo nie zna
   *  tego id). `null` znaczy „nie znam nazwy", nigdy „pracownik nie ma jednostki" — jednostka jest
   *  w modelu danych obowiązkowa. */
  jednostka: string | null
  kartoteka: StanKartoteki
}

/** Kopia mapy etykiet z lib/session.ts:39-44. Kopia, NIE import: session.ts jest server-only
 *  („Keep this module server-only — the token must never reach a client bundle"), a ten moduł
 *  konsumuje komponent kliencki. Etykiety trzymamy identyczne, żeby topbar i asystent nie nazywały
 *  tej samej roli dwoma słowami. */
const ROLA_ETYKIETA: Record<Role, string> = {
  ADMIN_KLIENTA: 'Admin klienta',
  HR: 'HR',
  MANAGER: 'Menedżer',
  PRACOWNIK: 'Pracownik',
}

/** Od najwyżej uprzywilejowanej — ta sama kolejność co `ROLE_PRIORITY` w lib/session.ts:47. */
const KOLEJNOSC_ROL: readonly Role[] = ['ADMIN_KLIENTA', 'HR', 'MANAGER', 'PRACOWNIK']

/** Polska etykieta najwyższej roli użytkownika; `'Użytkownik'` gdy nie ma żadnej znanej. */
export function etykietaRoli(roles: readonly Role[]): string {
  const najwyzsza = KOLEJNOSC_ROL.find((r) => roles.includes(r))
  return najwyzsza ? ROLA_ETYKIETA[najwyzsza] : 'Użytkownik'
}

export interface WejscieProfilu {
  /** Imię wyliczone z tokenu przez stronę serwerową (app/(tenant)/asystent/page.tsx:23). */
  imieZSesji: string
  roles: readonly Role[]
  odczyt: OdczytKartoteki
  /** Katalog id→nazwa z `GET /api/grafik/units` (lib/locations.ts `fetchUnitNames`). Pusty obiekt =
   *  katalog nie odpowiedział; wtedy nazwy jednostki po prostu nie znamy. */
  nazwyJednostek: Readonly<Record<string, string | undefined>>
}

/**
 * Złożenie profilu z trzech niezależnych źródeł. Imię z kartoteki ma pierwszeństwo przed imieniem z
 * tokenu (kartoteka to dane kadrowe, token to nazwa konta w Keycloaku). Brak jakiejkolwiek nazwy
 * kończy się neutralnym „Użytkowniku" — pusty string w powitaniu wyglądałby jak usterka.
 */
export function zbudujProfil({ imieZSesji, roles, odczyt, nazwyJednostek }: WejscieProfilu): ProfilAsystenta {
  const zKartoteki = odczyt.stan === 'jest' ? (odczyt.dane.firstName ?? '').trim() : ''
  const imie = zKartoteki || imieZSesji.trim() || 'Użytkowniku'
  const unitId = odczyt.stan === 'jest' ? odczyt.dane.unitId : undefined
  const jednostka = unitId ? nazwyJednostek[unitId] ?? null : null
  return { imie, rolaEtykieta: etykietaRoli(roles), jednostka, kartoteka: odczyt.stan }
}

/** Powitanie po imieniu — jedno zdanie, bez wykrzykników i bez udawania rozmowy. */
export function powitanie(profil: ProfilAsystenta): string {
  return `Cześć, ${profil.imie}.`
}

/**
 * Druga linia karty powitania. Przy sprawnym odczycie: rola i — jeśli ją znamy — nazwa jednostki.
 * Gdy nazwy nie znamy, zostaje SAMA rola; dopisek w rodzaju „jednostka nieprzypisana" byłby
 * twierdzeniem o danych kadrowych, którego nie mamy prawa postawić (jednostka jest w modelu
 * obowiązkowa — schema.prisma:160 — więc jej brak zawsze oznacza nieudany odczyt katalogu, nie brak
 * przypisania). Przy braku kartoteki i przy awarii odczytu — powód, dla którego pytania „o mnie" nie
 * mają tu danych, rozdzielony na dwa różne zdania.
 */
export function podtytulProfilu(profil: ProfilAsystenta): string {
  if (profil.kartoteka === 'brak') {
    return `${profil.rolaEtykieta} · to konto nie ma kartoteki pracownika, więc pytania o własny grafik i urlop nie mają tu danych.`
  }
  if (profil.kartoteka === 'blad') {
    return `${profil.rolaEtykieta} · nie udało się odczytać Twojej kartoteki pracownika.`
  }
  return profil.jednostka ? `${profil.rolaEtykieta} · ${profil.jednostka}` : profil.rolaEtykieta
}
```

- [ ] **Krok 4: Uruchom i ZOBACZ zieleń.**

```
cd apps/web && npx vitest run lib/personalizacja.test.ts
```

Oczekiwane: `Test Files 1 passed (1)`, `Tests 11 passed (11)`.

- [ ] **Krok 5: Sprawdź lint nowego pliku (żaden import nie może wyprzedzać użycia — `no-unused-vars` jest tu błędem).**

```
cd apps/web && npx eslint lib/personalizacja.ts lib/personalizacja.test.ts
```

Oczekiwane: brak wyjścia, kod wyjścia 0.

- [ ] **Krok 6: Commit.**

```
git add apps/web/lib/personalizacja.ts apps/web/lib/personalizacja.test.ts && git commit -m "feat(web): profil asystenta — imie z kartoteki, rola, jednostka, trzy stany kartoteki"
```

---

### Zadanie 22 (C-4): Podpowiedzi komend różne dla PRACOWNIKA i roli kadrowej

**Pliki:**
- Zmień: `apps/web/lib/personalizacja.ts`
- Test: `apps/web/lib/personalizacja.test.ts`

- [ ] **Krok 1: Napisz czerwony test.** Dopisz na końcu `apps/web/lib/personalizacja.test.ts`:

```ts
describe('podpowiedziDlaRoli', () => {
  it('PRACOWNIK dostaje dwie komendy o SOBIE', () => {
    expect(podpowiedziDlaRoli(['PRACOWNIK'])).toEqual([
      'ile mam dni urlopu',
      'kiedy mam następną zmianę',
    ])
  })

  it('MANAGER dostaje dwie komendy o ZESPOLE', () => {
    expect(podpowiedziDlaRoli(['MANAGER'])).toEqual([
      'kto dzisiaj pracuje',
      'potrzebuję zastępstwa na moją zmianę w piątek',
    ])
  })

  it('podpowiedzi PRACOWNIKA i MANAGERA są ROZŁĄCZNE — to jest sedno kryterium C3', () => {
    const pracownik = podpowiedziDlaRoli(['PRACOWNIK'])
    const manager = podpowiedziDlaRoli(['MANAGER'])
    expect(pracownik.some((p) => manager.includes(p))).toBe(false)
  })

  it('HR i ADMIN_KLIENTA idą ścieżką kadrową (ZNAJDZ_ZASTEPSTWO wymaga roli kadrowej)', () => {
    expect(podpowiedziDlaRoli(['HR'])).toEqual(PODPOWIEDZI_KADROWE)
    expect(podpowiedziDlaRoli(['ADMIN_KLIENTA'])).toEqual(PODPOWIEDZI_KADROWE)
  })

  it('konto łączące role dostaje wariant kadrowy, a konto bez ról — pracowniczy', () => {
    expect(podpowiedziDlaRoli(['PRACOWNIK', 'MANAGER'])).toEqual(PODPOWIEDZI_KADROWE)
    expect(podpowiedziDlaRoli([])).toEqual(PODPOWIEDZI_PRACOWNIK)
  })

  it('każdy wariant ma dokładnie dwie podpowiedzi', () => {
    expect(PODPOWIEDZI_PRACOWNIK).toHaveLength(2)
    expect(PODPOWIEDZI_KADROWE).toHaveLength(2)
  })
})
```

W imporcie na górze pliku zmień listę na:

```ts
import {
  PODPOWIEDZI_KADROWE,
  PODPOWIEDZI_PRACOWNIK,
  etykietaRoli,
  podpowiedziDlaRoli,
  powitanie,
  podtytulProfilu,
  zbudujProfil,
} from './personalizacja'
```

- [ ] **Krok 2: Uruchom i ZOBACZ czerwień.**

```
cd apps/web && npx vitest run lib/personalizacja.test.ts
```

Oczekiwane: `FAIL` z `SyntaxError: The requested module './personalizacja' does not provide an export named 'PODPOWIEDZI_KADROWE'`.

- [ ] **Krok 3: Dopisz podpowiedzi.** Na końcu `apps/web/lib/personalizacja.ts`:

```ts
// --- podpowiedzi po nierozpoznanej intencji ------------------------------------------------------
//
// Obie pary to DOSŁOWNE `przyklad` z INTENT_CATALOG backendu
// (apps/tenant-runtime/src/agent-glosowy/intent.util.ts:46-83), więc każda podpowiedź jest komendą,
// którą parser naprawdę rozpoznaje — pilnuje tego e2e/km3-personalizacja-asystenta.spec.ts (przypadek
// C3b), wpisując je do asystenta i sprawdzając, że karta odpowiedzi pokazuje etykietę rozpoznanej
// intencji zamiast fallbacku. Kopiowane ręcznie: web i tenant-runtime nie dzielą granicy pakietu
// (ta sama konwencja co CONFIDENCE_THRESHOLD w lib/agent-glosowy.ts).

/** Pracownik pyta o SIEBIE — SALDO_URLOPU i NASTEPNA_ZMIANA działają w zakresie własnym. */
export const PODPOWIEDZI_PRACOWNIK: readonly [string, string] = [
  'ile mam dni urlopu',
  'kiedy mam następną zmianę',
]

/**
 * Rola kadrowa pyta o ZESPÓŁ. `KTO_PRACUJE` zwraca zakres zależny od roli (managerowi — jego
 * jednostkę), a `ZNAJDZ_ZASTEPSTWO` jest twardo zarezerwowane dla MANAGER/HR/ADMIN_KLIENTA
 * (voice-command.service.ts:516-520) — pracownikowi podpowiedź o zastępstwie skończyłaby się 403.
 */
export const PODPOWIEDZI_KADROWE: readonly [string, string] = [
  'kto dzisiaj pracuje',
  'potrzebuję zastępstwa na moją zmianę w piątek',
]

const ROLE_KADROWE: readonly Role[] = ['MANAGER', 'HR', 'ADMIN_KLIENTA']

/** Dwie podpowiedzi dopasowane do roli. Konto łączące role dostaje wariant kadrowy (szersze
 *  uprawnienia); konto bez znanej roli — pracowniczy, bo tylko on na pewno nie skończy się 403. */
export function podpowiedziDlaRoli(roles: readonly Role[]): readonly [string, string] {
  return roles.some((r) => ROLE_KADROWE.includes(r)) ? PODPOWIEDZI_KADROWE : PODPOWIEDZI_PRACOWNIK
}
```

- [ ] **Krok 4: Uruchom i ZOBACZ zieleń.**

```
cd apps/web && npx vitest run lib/personalizacja.test.ts
```

Oczekiwane: `Tests 17 passed (17)`.

- [ ] **Krok 5: Commit.**

```
git add apps/web/lib/personalizacja.ts apps/web/lib/personalizacja.test.ts && git commit -m "feat(web): podpowiedzi komend rozlaczne dla PRACOWNIKA i roli kadrowej (odstepstwo od spec: lib/personalizacja.ts zamiast lib/agent-glosowy.ts)"
```

---

### Zadanie 23 (C-5): Zdanie o saldzie urlopu (w tym wariant „nie znam")

**Pliki:**
- Zmień: `apps/web/lib/personalizacja.ts`
- Test: `apps/web/lib/personalizacja.test.ts`

- [ ] **Krok 1: Napisz czerwony test.** Dopisz na końcu `apps/web/lib/personalizacja.test.ts`:

```ts
describe('zdanieOSaldzie', () => {
  it('podaje pozostały limit, wymiar i wykorzystanie', () => {
    expect(zdanieOSaldzie({ wymiarDni: 20, wykorzystaneDni: 8, pozostaleDni: 12 })).toBe(
      'Twój urlop wypoczynkowy: pozostało 12 z 20 dni (wykorzystano 8).',
    )
  })

  it('gdy limit NIEZNANY, mówi to wprost i nie pokazuje żadnej liczby (kryterium C2)', () => {
    const zdanie = zdanieOSaldzie(null)
    expect(zdanie).toBe(
      'Nie znam Twojego salda urlopu — nie pokazuję liczby, której nie mogę potwierdzić.',
    )
    expect(/\d/.test(zdanie)).toBe(false)
  })

  it('saldo wyzerowane pokazuje prawdziwe zero, a nie komunikat o braku wiedzy', () => {
    expect(zdanieOSaldzie({ wymiarDni: 20, wykorzystaneDni: 20, pozostaleDni: 0 })).toBe(
      'Twój urlop wypoczynkowy: pozostało 0 z 20 dni (wykorzystano 20).',
    )
  })

  it('nie zawiera imienia, nazwiska ani identyfikatora — treść jest wyłącznie liczbowa (kryterium C4)', () => {
    const zdanie = zdanieOSaldzie({ wymiarDni: 20, wykorzystaneDni: 8, pozostaleDni: 12 })
    expect(zdanie).not.toMatch(/Kowalsk|Nowak|[0-9a-f]{8}-/i)
  })
})
```

W imporcie z `./personalizacja` dopisz `zdanieOSaldzie,` (lista pozostaje alfabetyczna po stałych: `PODPOWIEDZI_KADROWE, PODPOWIEDZI_PRACOWNIK, etykietaRoli, podpowiedziDlaRoli, powitanie, podtytulProfilu, zbudujProfil, zdanieOSaldzie`).

- [ ] **Krok 2: Uruchom i ZOBACZ czerwień.**

```
cd apps/web && npx vitest run lib/personalizacja.test.ts
```

Oczekiwane: `FAIL` z `SyntaxError: The requested module './personalizacja' does not provide an export named 'zdanieOSaldzie'`.

- [ ] **Krok 3: Dopisz import typu i funkcję.** W `apps/web/lib/personalizacja.ts` pod istniejącą linią `import type { Role } from './nav'` dodaj:

```ts
import type { SaldoUrlopu } from './agent-glosowy'
```

Następnie na końcu tego samego pliku dodaj:

```ts
// --- saldo urlopu w karcie potwierdzenia ---------------------------------------------------------

/**
 * Zdanie o saldzie urlopu wypoczynkowego, doklejane do karty potwierdzenia wniosku urlopowego.
 *
 * `null` (konto bez kartoteki albo nieudany odczyt) daje JAWNY komunikat o niewiedzy, nie zero:
 * `LeaveService.list({ mine: true })` zwraca dla konta bez kartoteki pustą listę
 * (apps/tenant-runtime/src/leave/leave.service.ts:143-148), więc backend policzyłby „pozostało 20 z
 * 20 dni" komuś, kto nie ma w systemie ani jednego dnia urlopu. Pokazanie takiej liczby byłoby
 * dokładnie tą klasą błędu, która wywaliła /moj-tydzien.
 *
 * Zdanie NIE prognozuje stanu po zatwierdzeniu wniosku — podaje wyłącznie stan bieżący, ten sam,
 * który agent zwraca na komendę „ile mam dni urlopu" (intencja SALDO_URLOPU). Dzięki temu dwa ekrany
 * nie mogą podać dwóch różnych liczb.
 */
export function zdanieOSaldzie(saldo: SaldoUrlopu | null): string {
  if (saldo === null) {
    return 'Nie znam Twojego salda urlopu — nie pokazuję liczby, której nie mogę potwierdzić.'
  }
  return `Twój urlop wypoczynkowy: pozostało ${saldo.pozostaleDni} z ${saldo.wymiarDni} dni (wykorzystano ${saldo.wykorzystaneDni}).`
}
```

- [ ] **Krok 4: Uruchom i ZOBACZ zieleń.**

```
cd apps/web && npx vitest run lib/personalizacja.test.ts
```

Oczekiwane: `Tests 21 passed (21)`.

- [ ] **Krok 5: Sprawdź lint i typy (import typu doszedł dopiero teraz, razem z użyciem).**

```
cd apps/web && npx eslint lib/personalizacja.ts lib/personalizacja.test.ts && npx tsc --noEmit
```

Oczekiwane: obie komendy bez wyjścia, kod wyjścia 0.

- [ ] **Krok 6: Commit.**

```
git add apps/web/lib/personalizacja.ts apps/web/lib/personalizacja.test.ts && git commit -m "feat(web): zdanie o saldzie urlopu — jawna niewiedza zamiast zmyslonego zera"
```

---

### Zadanie 24 (C-6): Wpięcie profilu i karty powitania w ekran asystenta

**Pliki:**
- Zmień: `apps/web/app/(tenant)/asystent/page.tsx`
- Zmień: `apps/web/components/asystent/asystent-screen.tsx`
- Bramki tego zadania: `npx tsc --noEmit` (czerwień → zieleń) oraz `npx eslint` na obu plikach. Vitest nie renderuje komponentów (Ustalenie 6), więc zachowanie na żywym stosie sprawdza dopiero zadanie 9.

- [ ] **Krok 1: Wywołaj czerwień typów — przekaż propsy, których komponent jeszcze nie przyjmuje.** W `apps/web/app/(tenant)/asystent/page.tsx` zamień linię 41 (`<AsystentScreen />`) na:

```tsx
          <AsystentScreen imieZSesji={firstName} roles={roles} />
```

(`firstName` jest już wyliczone w linii 23, `roles` w linii 22 — nic więcej na tej stronie nie dochodzi.)

- [ ] **Krok 2: Uruchom i ZOBACZ czerwień.**

```
cd apps/web && npx tsc --noEmit
```

Oczekiwane: niezerowy kod wyjścia i błąd wskazujący `app/(tenant)/asystent/page.tsx(41,…)`, w brzmieniu `error TS2322: Type '{ imieZSesji: string; roles: Role[]; }' is not assignable to type 'IntrinsicAttributes'. Property 'imieZSesji' does not exist on type 'IntrinsicAttributes'.`

- [ ] **Krok 3: Dodaj importy do komponentu.** W `apps/web/components/asystent/asystent-screen.tsx` po bloku importu z `@/lib/voice-capture` (kończy się linią 35 `} from '@/lib/voice-capture'`) dodaj:

```tsx
import type { Role } from '@/lib/nav'
import { fetchUnitNames, type NamedCatalog } from '@/lib/locations'
import {
  podtytulProfilu,
  powitanie,
  zbudujProfil,
  type MeResponse,
  type OdczytKartoteki,
  type ProfilAsystenta,
} from '@/lib/personalizacja'
```

Importujemy WYŁĄCZNIE to, czego to zadanie używa — `podpowiedziDlaRoli` dochodzi w zadaniu 7, a `czytajSaldoUrlopu`/`zdanieOSaldzie`/`SaldoUrlopu` w zadaniu 8. `@typescript-eslint/no-unused-vars` jest w tym repo błędem (`packages/config/eslint.config.mjs`), więc import wyprzedzający użycie zapaliłby krok 9.

- [ ] **Krok 4: Dodaj odczyt kartoteki i kartę powitania.** W tym samym pliku, tuż pod funkcją `actionErrorMessage` (po linii 42), dodaj:

```tsx
/**
 * `GET /api/employees/me` z ROZDZIELENIEM 404 („to konto nie ma kartoteki") od awarii odczytu —
 * dokładnie ten sam wzorzec co `getJsonOrNull` w components/moj-tydzien/mobile-week.tsx:43-48.
 * Konto ADMIN_KLIENTA/HR to login, nie osoba na liście płac; bez tej gałęzi ekran pokazywałby błąd
 * połączenia przy sprawnej sieci — i to na tej samej klasie błędu wyłożył się `/moj-tydzien`.
 */
async function odczytajKartoteke(): Promise<OdczytKartoteki> {
  try {
    const res = await fetch('/api/employees/me', { cache: 'no-store' })
    if (res.status === 404) return { stan: 'brak' }
    if (!res.ok) return { stan: 'blad' }
    return { stan: 'jest', dane: (await res.json()) as MeResponse }
  } catch {
    return { stan: 'blad' }
  }
}

/** Karta powitania — imię, rola, jednostka. Renderowana dopiero, gdy profil jest znany, żeby nie
 *  mrugnąć najpierw wersją bezosobową. */
function KartaPowitania({ profil }: { profil: ProfilAsystenta }) {
  return (
    <Card className="mb-4 p-4" data-personalizacja="powitanie">
      <p className="font-display text-lg font-bold text-navy">{powitanie(profil)}</p>
      <p className="mt-1 text-[13px] text-muted">{podtytulProfilu(profil)}</p>
    </Card>
  )
}
```

- [ ] **Krok 5: Zmień sygnaturę komponentu i dodaj stan profilu.** Zamień linię 173 (`export function AsystentScreen() {`) na:

```tsx
export function AsystentScreen({ imieZSesji, roles }: { imieZSesji: string; roles: Role[] }) {
```

Następnie pod deklaracją `const [glosDostepny, setGlosDostepny] = useState(false)` (linia 184) dodaj:

```tsx
  const [profil, setProfil] = useState<ProfilAsystenta | null>(null)
  // Ref, nie stan, bo czyta go callback `dociagnijSaldo` (zadanie 8) — inaczej trzeba by
  // przebudowywać cały łańcuch przetworzPolecenie/handleSubmit przy każdej zmianie profilu
  // (ten sam wzorzec co `wyciszonyRef` niżej).
  const profilRef = useRef<ProfilAsystenta | null>(null)
```

- [ ] **Krok 6: Dodaj efekt pobierający profil.** Bezpośrednio pod efektem sond możliwości (kończy się na linii 205 `}, [])`) dodaj:

```tsx
  // Profil pobierany raz na wejście na ekran. `imieZSesji`/`roles` przychodzą z komponentu
  // serwerowego (app/(tenant)/asystent/page.tsx) i nie zmieniają tożsamości w trakcie życia strony,
  // więc efekt wykona się dokładnie raz.
  useEffect(() => {
    let porzucone = false
    void (async () => {
      const [odczyt, nazwyJednostek] = await Promise.all([
        odczytajKartoteke(),
        fetchUnitNames().catch((): NamedCatalog => ({})),
      ])
      if (porzucone) return
      const zbudowany = zbudujProfil({ imieZSesji, roles, odczyt, nazwyJednostek })
      profilRef.current = zbudowany
      setProfil(zbudowany)
    })()
    return () => {
      porzucone = true
    }
  }, [imieZSesji, roles])
```

- [ ] **Krok 7: Wyrenderuj kartę powitania.** W zwracanym JSX zamień linie 348–349 (`<div className="mx-auto max-w-[760px]">` i następującą po niej `<Card className="mb-6 p-4">`) na:

```tsx
    <div className="mx-auto max-w-[760px]">
      {profil ? <KartaPowitania profil={profil} /> : null}
      <Card className="mb-6 p-4">
```

- [ ] **Krok 8: Uruchom i ZOBACZ zieleń typów.**

```
cd apps/web && npx tsc --noEmit
```

Oczekiwane: brak wyjścia, kod wyjścia 0.

- [ ] **Krok 9: Uruchom lint, bo ten plik ma reguły hooków i zakaz nieużywanych importów.**

```
cd apps/web && npx eslint components/asystent/asystent-screen.tsx app/\(tenant\)/asystent/page.tsx
```

Oczekiwane: brak wyjścia, kod wyjścia 0.

- [ ] **Krok 10: Commit.**

```
git add apps/web/components/asystent/asystent-screen.tsx "apps/web/app/(tenant)/asystent/page.tsx" && git commit -m "feat(web): karta powitania asystenta — imie, rola, jednostka; konto bez kartoteki obsluzone"
```

---

### Zadanie 25 (C-7): Podpowiedzi wg roli w gałęzi nierozpoznanej intencji

**Pliki:**
- Zmień: `apps/web/components/asystent/asystent-screen.tsx`
- Bramki: `npx tsc --noEmit` (czerwień → zieleń), `npx eslint`; zachowanie — zadanie 9 (przypadki C3, C3b).

- [ ] **Krok 1: Policz podpowiedzi raz i przekaż je do karty tury.** W `AsystentScreen`, tuż nad `return (` w JSX (po linii `const zajety = submitting || transkrybuje`), dodaj:

```tsx
  // Jedna para na cały ekran — zależy od roli, nie od tury, więc nie ma powodu liczyć jej w pętli.
  const podpowiedzi = podpowiedziDlaRoli(roles)
```

Następnie w mapowaniu tur (linie 452–462) dopisz props do `<TurnCard ...>`:

```tsx
            <TurnCard
              key={turn.id}
              turn={turn}
              podpowiedzi={podpowiedzi}
              wypowiedz={wypowiedz}
              onConfirm={() => {
                if (!turn.interpretResult) return
                void runExecute(turn.id, turn.interpretResult.intent, turn.interpretResult.entities, true)
              }}
            />
```

Do bloku importu z `@/lib/personalizacja` (dodanego w zadaniu 6) dopisz `podpowiedziDlaRoli,` jako pierwszą pozycję.

- [ ] **Krok 2: Uruchom i ZOBACZ czerwień typów.**

```
cd apps/web && npx tsc --noEmit
```

Oczekiwane: niezerowy kod wyjścia, `components/asystent/asystent-screen.tsx(…): error TS2322: … Property 'podpowiedzi' does not exist on type …` (sygnatura `TurnCard` jej jeszcze nie zna).

- [ ] **Krok 3: Rozszerz sygnaturę `TurnCard`.** Zamień nagłówek funkcji (linie 469–477) na:

```tsx
function TurnCard({
  turn,
  onConfirm,
  podpowiedzi,
  wypowiedz,
}: {
  turn: Turn
  onConfirm: () => void
  /** Dwie komendy dopasowane do roli — pokazywane po nierozpoznanej intencji. */
  podpowiedzi: readonly [string, string]
  wypowiedz: (tekst: string) => void
}) {
```

- [ ] **Krok 4: Dodaj podpowiedzi do gałęzi `fallback`.** Zamień cały blok `{turn.status === 'fallback' && ir && ( ... )}` (linie 526–537) na:

```tsx
      {turn.status === 'fallback' && ir && (
        <div className="space-y-2">
          <p className="text-sm text-ink">{FALLBACK_MESSAGE}</p>
          {/* „Nie zrozumiałem" bez wskazówki zostawia użytkownika w tym samym miejscu. Te dwie komendy
              są dobrane do roli: pracownik dostaje pytania o siebie, rola kadrowa — o zespół. */}
          <div data-personalizacja="podpowiedzi">
            <p className="text-[13px] text-ink">Spróbuj na przykład tak:</p>
            <ul className="mt-1 space-y-1">
              {podpowiedzi.map((komenda) => (
                <li key={komenda} className="text-[13px] text-muted">
                  „{komenda}"
                </li>
              ))}
            </ul>
          </div>
          <a
            href={fallbackLink(ir.intent).href}
            className="inline-flex items-center text-[13px] font-medium text-accent-ink underline underline-offset-2"
          >
            {fallbackLink(ir.intent).label}
          </a>
          <p className="text-[12px] text-muted-2">{ir.aiNotice}</p>
        </div>
      )}
```

- [ ] **Krok 5: Uruchom i ZOBACZ zieleń typów oraz lint.**

```
cd apps/web && npx tsc --noEmit && npx eslint components/asystent/asystent-screen.tsx
```

Oczekiwane: obie komendy bez wyjścia, kod wyjścia 0.

- [ ] **Krok 6: Commit.**

```
git add apps/web/components/asystent/asystent-screen.tsx && git commit -m "feat(web): dwie podpowiedzi komend wg roli po nierozpoznanej intencji"
```

---

### Zadanie 26 (C-8): Saldo urlopu w karcie potwierdzenia wniosku

**Pliki:**
- Zmień: `apps/web/components/asystent/asystent-screen.tsx`
- Bramki: `npx tsc --noEmit` (czerwień → zieleń), `npx eslint`, pełny `npx vitest run`; zachowanie — zadanie 9 (C2, C2b).

- [ ] **Krok 1: Wywołaj czerwień — dodaj render salda, którego pole jeszcze nie istnieje.** W `TurnCard`, w gałęzi `{(turn.status === 'awaiting-confirm' || turn.status === 'executing') && ir && (...)}`, bezpośrednio pod linią `<p className="text-[14.5px] text-ink">{ir.humanReadable}</p>` (linia 545) wstaw:

```tsx
          {turn.saldoUrlopu !== undefined ? (
            <p className="text-[13px] text-muted" data-personalizacja="saldo">
              {zdanieOSaldzie(turn.saldoUrlopu)}
            </p>
          ) : null}
```

- [ ] **Krok 2: Uruchom i ZOBACZ czerwień.**

```
cd apps/web && npx tsc --noEmit
```

Oczekiwane: niezerowy kod wyjścia, `error TS2339: Property 'saldoUrlopu' does not exist on type 'Turn'.` oraz `error TS2304: Cannot find name 'zdanieOSaldzie'.`

- [ ] **Krok 3: Uzupełnij importy i rozszerz `Turn`.** Do bloku importu z `@/lib/personalizacja` dopisz `zdanieOSaldzie,`; do bloku importu z `@/lib/agent-glosowy` (linie 7–21) dopisz `czytajSaldoUrlopu,` oraz `type SaldoUrlopu,`. Następnie w interfejsie `Turn` (linie 132–141), pod polem `sttConfidence`, dodaj:

```tsx
  /**
   * Saldo urlopu dla karty potwierdzenia wniosku urlopowego.
   * `undefined` = nie dotyczy tej tury (inna intencja / jeszcze nie pobrano) → nic nie renderujemy;
   * `null`      = pobrano i NIE ZNAMY → renderujemy jawny komunikat o niewiedzy, nigdy zera.
   */
  saldoUrlopu?: SaldoUrlopu | null
```

- [ ] **Krok 4: Dodaj pobieranie salda.** W `AsystentScreen`, tuż pod definicją `runExecute` (kończy się na linii 242 `)`), dodaj:

```tsx
  /**
   * Doczytanie salda urlopu do karty potwierdzenia. REUŻYWA istniejącej, przetestowanej intencji
   * `SALDO_URLOPU` (odczyt, `requiresConfirmation: false` — voice-command.service.ts:246-254), więc
   * liczba w potwierdzeniu nie może rozjechać się z odpowiedzią na „ile mam dni urlopu".
   *
   * Konto BEZ kartoteki pracownika NIE PYTA o saldo: dla niego `LeaveService.list({ mine: true })`
   * zwraca pustą listę (leave.service.ts:143-148), więc backend policzyłby „pozostało 20 z 20" komuś,
   * kto nie ma w systemie ani dnia urlopu. Zamiast tego ustawiamy `null` i mówimy wprost, że salda nie
   * znamy. Awaria odczytu kończy się tak samo — nigdy zerem.
   *
   * Gdy profil jeszcze się nie wczytał (użytkownik wpisał polecenie szybciej niż wróciło
   * `/api/employees/me`), pytamy o stan kartoteki wprost, zamiast domyślać się z `null`-a — inaczej
   * pracownik, który kartotekę MA, dostałby „nie znam salda" tylko dlatego, że był szybszy od sieci.
   */
  const dociagnijSaldo = useCallback(
    async (id: string) => {
      const stanKartoteki = profilRef.current?.kartoteka ?? (await odczytajKartoteke()).stan
      if (stanKartoteki !== 'jest') {
        updateTurn(id, { saldoUrlopu: null })
        return
      }
      try {
        const wynik = await agentGlosowyApi.execute({ intent: 'SALDO_URLOPU' })
        updateTurn(id, { saldoUrlopu: czytajSaldoUrlopu(wynik.result) })
      } catch {
        updateTurn(id, { saldoUrlopu: null })
      }
    },
    [updateTurn],
  )
```

- [ ] **Krok 5: Wywołaj pobieranie przy wniosku urlopowym.** W `przetworzPolecenie` zamień gałąź `else` (linie 270–274) na:

```tsx
        } else {
          // Zapis (URLOP/L4) czeka na jawne kliknięcie człowieka — głos też, bez wyjątku.
          updateTurn(id, { status: 'awaiting-confirm' })
          wypowiedz(interpretResult.humanReadable)
          // Saldo dokładamy TYLKO do wniosku urlopowego. L4 nie pomniejsza puli art. 154
          // (apps/tenant-runtime/src/common/leave-type.ts:77 — `drawsDownAnnualEntitlement`), więc przy
          // zwolnieniu lekarskim liczba o urlopie byłaby myląca.
          if (interpretResult.intent === 'URLOP') await dociagnijSaldo(id)
        }
```

Do tablicy zależności `przetworzPolecenie` (linia 281) dopisz `dociagnijSaldo`:

```tsx
    [dociagnijSaldo, runExecute, updateTurn, wypowiedz],
```

- [ ] **Krok 6: Uruchom i ZOBACZ zieleń typów.**

```
cd apps/web && npx tsc --noEmit
```

Oczekiwane: brak wyjścia, kod wyjścia 0.

- [ ] **Krok 7: Uruchom lint i pełny zestaw vitest.**

```
cd apps/web && npx eslint app components lib middleware.ts && npx vitest run
```

Oczekiwane: eslint bez wyjścia; vitest kończy się `Test Files … passed` bez ani jednego `failed` (w tym `lib/agent-glosowy.test.ts` → 22 i `lib/personalizacja.test.ts` → 21).

- [ ] **Krok 8: Commit.**

```
git add apps/web/components/asystent/asystent-screen.tsx && git commit -m "feat(web): saldo urlopu w karcie potwierdzenia wniosku — konto bez kartoteki nie dostaje wymyslonej liczby"
```

---

### Zadanie 27 (C-9): Test e2e personalizacji (w tym RODO i konto bez kartoteki)

**Pliki:**
- Utwórz: `apps/web/e2e/km3-personalizacja-asystenta.spec.ts`
- Bramka: `npx playwright test e2e/km3-personalizacja-asystenta.spec.ts` + trzy weryfikacje negatywne (kroki 6–8)

- [ ] **Krok 1: Zmierz, które konto demo NIE MA kartoteki pracownika. To pomiar potwierdzający, nie rozgałęzienie.** Z `scripts/seed-demo-m2-modules.sql:19-28` wynika, że `demo` (`admin@staging.hrobot.local`) dostaje wiersz w `users`, ale nigdzie nie powstaje dla niego wiersz w `employees` — to jest jedyne konto demo bez kartoteki. Potwierdź to na żywej bazie:

```
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -c "SELECT u.email, e.first_name, e.last_name FROM users u LEFT JOIN employees e ON e.user_id = u.id ORDER BY u.email;"
```

Oczekiwane: wiersz `admin@staging.hrobot.local` ma `first_name` i `last_name` puste (NULL), a wiersze `manager.demo@demo.hrobot.local`, `pracownik.demo@demo.hrobot.local` i `pracownica.demo@demo.hrobot.local` mają wypełnione nazwiska. **Jeśli pomiar wyjdzie inaczej — ZATRZYMAJ blok i zgłoś rozbieżność. Nie przepisuj testu C2b i nie fabrykuj konta:** brak konta bez kartoteki oznacza, że kryterium C1 („konto bez kartoteki nie wywala ekranu") nie da się wykazać na tym stosie i jest to fakt do raportu, nie do obejścia.

- [ ] **Krok 2: Ustal hasło konta administracyjnego ze środowiska.** `scripts/demo-up.mjs:22-32` wymaga `DEMO_ADMIN_PASSWORD` i wprost stwierdza, że wartość `demo-staging-2026` została zrotowana, bo jest w historii gita. Sprawdź, że masz ją w powłoce:

```
test -n "$DEMO_ADMIN_PASSWORD" && echo "DEMO_ADMIN_PASSWORD ustawione" || echo "BRAK — ustaw je tym samym hasłem, którym demo loguje się w Keycloaku"
```

Oczekiwane: `DEMO_ADMIN_PASSWORD ustawione`. Jeśli nie — ustaw zmienną przed krokiem 5; bez niej przypadek C2b padnie z czytelnym komunikatem, a nie zostanie po cichu pominięty.

- [ ] **Krok 3: Napisz cały spec.** Utwórz `apps/web/e2e/km3-personalizacja-asystenta.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

/**
 * M3 c) — personalizacja komunikacji asystenta. Sprawdza dokładnie cztery kryteria akceptacji:
 *  C1 pracownik widzi swoje imię, rolę i jednostkę, a konto bez kartoteki nie wywala ekranu;
 *  C2 potwierdzenie wniosku urlopowego podaje limit, a przy nieznanym limicie mówi to wprost;
 *  C3 podpowiedzi po nierozpoznanej intencji różnią się dla PRACOWNIKA i dla roli kadrowej;
 *  C4 w treści nie ma danych innego pracownika.
 *
 * Uruchomienie (Bash / Git Bash):
 *   cd apps/web && E2E_BASE_URL=http://localhost:8080 DEMO_ADMIN_PASSWORD="…" \
 *     npx playwright test e2e/km3-personalizacja-asystenta.spec.ts
 *
 * Hasła `pracownik.demo`/`manager.demo` są jawne w repo (scripts/seed-keycloak-demo.mjs:36-37), więc
 * są tu wpisane wprost — tak samo jak w e2e/km3-modules-reachable.spec.ts. Hasło konta `demo` NIE
 * jest w repo (scripts/demo-up.mjs:22-32: „Rotate the old value … it is already in git history"),
 * więc przychodzi ze zmiennej środowiskowej i jego brak jest twardym błędem testu, nie cichym skipem.
 */

const HASLO_DEMO = process.env.DEMO_ADMIN_PASSWORD ?? ''

/** Komunikaty, których obecność oznacza, że ekran się NIE wyrenderował (ta sama lista co
 *  e2e/km3-modules-reachable.spec.ts:26). */
const BLAD_RE = /Nie udało się|Brak połączenia|Brak dostępu|Coś poszło nie tak/i

async function zaloguj(page: Page, login: string, pw: string): Promise<void> {
  await page.context().clearCookies()
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name="login"]').fill(login)
  await page.locator('input[name="pw"]').fill(pw)
  await page.getByRole('button', { name: /Zaloguj/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function wyslijPolecenie(page: Page, tekst: string): Promise<void> {
  await page.locator('#asystentInput').fill(tekst)
  await page.getByRole('button', { name: /^Wyślij$/ }).click()
}

test('C1: PRACOWNIK widzi powitanie imieniem, rolę i jednostkę', async ({ page }) => {
  test.setTimeout(120_000)
  await zaloguj(page, 'pracownik.demo', 'Pracownik!2026')
  await page.goto('/asystent', { waitUntil: 'domcontentloaded' })

  const powitanie = page.locator('[data-personalizacja="powitanie"]')
  await expect(powitanie).toBeVisible({ timeout: 30_000 })
  await expect(powitanie).toContainText('Cześć, Anna.')
  await expect(powitanie).toContainText('Pracownik')
  await expect(powitanie).toContainText('Region Centrum')
})

test('C3: podpowiedzi po nierozpoznanej intencji są ROZŁĄCZNE dla PRACOWNIKA i roli kadrowej', async ({ page }) => {
  test.setTimeout(180_000)

  await zaloguj(page, 'pracownik.demo', 'Pracownik!2026')
  await page.goto('/asystent', { waitUntil: 'domcontentloaded' })
  await wyslijPolecenie(page, 'opowiedz mi dowcip o pingwinie')
  const pracownik = page.locator('[data-personalizacja="podpowiedzi"]').first()
  await expect(pracownik).toBeVisible({ timeout: 30_000 })
  await expect(pracownik).toContainText('ile mam dni urlopu')
  await expect(pracownik).toContainText('kiedy mam następną zmianę')
  await expect(pracownik).not.toContainText('zastępstwa')

  await zaloguj(page, 'manager.demo', 'Manager!2026')
  await page.goto('/asystent', { waitUntil: 'domcontentloaded' })
  await wyslijPolecenie(page, 'opowiedz mi dowcip o pingwinie')
  const manager = page.locator('[data-personalizacja="podpowiedzi"]').first()
  await expect(manager).toBeVisible({ timeout: 30_000 })
  await expect(manager).toContainText('kto dzisiaj pracuje')
  await expect(manager).toContainText('potrzebuję zastępstwa na moją zmianę w piątek')
  await expect(manager).not.toContainText('ile mam dni urlopu')
})

test('C3b: obie podpowiedzi PRACOWNIKA są REALNYMI komendami — żadna nie kończy się fallbackiem', async ({ page }) => {
  test.setTimeout(180_000)
  await zaloguj(page, 'pracownik.demo', 'Pracownik!2026')

  // Etykieta rozpoznanej intencji z lib/agent-glosowy.ts (INTENT_LABEL) — jej obecność jest dowodem
  // POZYTYWNYM, że parser rozpoznał komendę. Sam brak bloku podpowiedzi przeszedłby też na pustym
  // ekranie, więc nie wystarcza.
  const KOMENDY: ReadonlyArray<readonly [string, string]> = [
    ['ile mam dni urlopu', 'Saldo urlopu'],
    ['kiedy mam następną zmianę', 'Najbliższa zmiana'],
  ]

  for (const [komenda, etykieta] of KOMENDY) {
    await page.goto('/asystent', { waitUntil: 'domcontentloaded' })
    await wyslijPolecenie(page, komenda)
    await expect(
      page.getByText(etykieta, { exact: true }).first(),
      `„${komenda}" nie została rozpoznana — karta nie pokazała etykiety „${etykieta}"`,
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.locator('[data-personalizacja="podpowiedzi"]'),
      `„${komenda}" spadła do fallbacku`,
    ).toHaveCount(0)
  }
})

test('C2: potwierdzenie wniosku urlopowego podaje pozostały limit', async ({ page }) => {
  test.setTimeout(120_000)
  await zaloguj(page, 'pracownik.demo', 'Pracownik!2026')
  await page.goto('/asystent', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-personalizacja="powitanie"]')).toBeVisible({ timeout: 30_000 })

  // „1 do 3 września" trafia w MONTH_RANGE_RE (intent.util.ts) → URLOP z pewnością 0.9 i bramką
  // potwierdzenia. Nie klikamy „Potwierdź i wykonaj", więc test nie zapisuje niczego do bazy.
  await wyslijPolecenie(page, 'chcę urlop od 1 do 3 września')
  const saldo = page.locator('[data-personalizacja="saldo"]').first()
  await expect(saldo).toBeVisible({ timeout: 30_000 })
  await expect(saldo).toHaveText(/pozostało \d+ z 20 dni \(wykorzystano \d+\)\./)

  // Bramka potwierdzenia człowieka MUSI nadal stać — personalizacja nic nie wykonuje sama.
  await expect(page.getByRole('button', { name: 'Potwierdź i wykonaj' })).toBeVisible()
})

test('C2b: konto BEZ kartoteki pracownika nie wywala ekranu i nie dostaje wymyślonego salda', async ({ page }) => {
  test.setTimeout(120_000)
  expect(
    HASLO_DEMO,
    'Ustaw DEMO_ADMIN_PASSWORD — hasło konta `demo` nie jest w repo (scripts/demo-up.mjs:22-32).',
  ).not.toBe('')

  // Login ustalony pomiarem w bazie (krok 1 zadania 9): jedyne konto bez wiersza w `employees`.
  await zaloguj(page, 'demo', HASLO_DEMO)
  await page.goto('/asystent', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('[data-personalizacja="powitanie"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-personalizacja="powitanie"]')).toContainText(
    'to konto nie ma kartoteki pracownika',
  )
  expect(BLAD_RE.test(await page.locator('main').innerText())).toBe(false)

  await wyslijPolecenie(page, 'chcę urlop od 1 do 3 września')
  const saldo = page.locator('[data-personalizacja="saldo"]').first()
  await expect(saldo).toBeVisible({ timeout: 30_000 })
  await expect(saldo).toContainText('Nie znam Twojego salda urlopu')
  await expect(saldo).not.toContainText('20')
})

test('C4 (RODO): na ekranie asystenta PRACOWNIKA nie ma nazwisk innych osób', async ({ page }) => {
  test.setTimeout(120_000)
  await zaloguj(page, 'pracownik.demo', 'Pracownik!2026')
  await page.goto('/asystent', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-personalizacja="powitanie"]')).toBeVisible({ timeout: 30_000 })
  await wyslijPolecenie(page, 'chcę urlop od 1 do 3 września')
  await expect(page.locator('[data-personalizacja="saldo"]').first()).toBeVisible({ timeout: 30_000 })

  const tresc = await page.locator('main').innerText()
  // Te nazwiska istnieją w danych demo i pokazują się rolom kadrowym na innych ekranach — gdyby
  // scoping padł, wypłynęłyby tutaj (ta sama lista co w e2e/km3-modules-reachable.spec.ts:78).
  for (const cudze of ['Rafał Adamczyk', 'Andrzej Kowalczyk', 'Marcin Dąbrowski', 'Tomasz Nowacki', 'Ewa Lewandowska']) {
    expect(tresc, `wyciek: pracownik widzi dane innej osoby (${cudze})`).not.toContain(cudze)
  }
  // Katarzyna Zając to druga kartoteka pracownicza w demo (scripts/seed-demo-m2-modules.sql:201) —
  // jej imię nie ma prawa pojawić się w powitaniu ani w saldzie Anny.
  expect(tresc).not.toContain('Katarzyna')
})
```

- [ ] **Krok 4: Sprawdź, że stack demo odpowiada.**

```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/login
```

Oczekiwane: `200`. Jeśli nie — podnieś stack (`DEMO_ADMIN_PASSWORD="…" node scripts/demo-up.mjs`) przed dalszymi krokami.

- [ ] **Krok 5: Uruchom spec i ZOBACZ zieleń.**

```
cd apps/web && E2E_BASE_URL=http://localhost:8080 npx playwright test e2e/km3-personalizacja-asystenta.spec.ts
```

Oczekiwane: `6 passed`.

- [ ] **Krok 6: Weryfikacja negatywna C2b — cofnij poprawkę salda i ZOBACZ czerwień.** W `apps/web/components/asystent/asystent-screen.tsx`, w `dociagnijSaldo`, tymczasowo zamień warunek `if (stanKartoteki !== 'jest') {` na `if (false) {`. Uruchom:

```
cd apps/web && E2E_BASE_URL=http://localhost:8080 npx playwright test e2e/km3-personalizacja-asystenta.spec.ts -g "C2b"
```

Oczekiwane: `1 failed` — `Expected string: "Nie znam Twojego salda urlopu"` przy otrzymanym „pozostało 20 z 20 dni". Następnie przywróć oryginalny warunek i udowodnij, że plik wrócił do stanu z commita:

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2 && git diff --exit-code apps/web/components/asystent/asystent-screen.tsx && echo "przywrocone"
```

Oczekiwane: `przywrocone`, kod wyjścia 0. Potem `npx playwright test … -g "C2b"` → `1 passed`.

- [ ] **Krok 7: Weryfikacja negatywna C3 — zepsuj rozłączność podpowiedzi i ZOBACZ czerwień.** W `apps/web/lib/personalizacja.ts` tymczasowo zamień ciało `podpowiedziDlaRoli` na `return PODPOWIEDZI_PRACOWNIK`. Uruchom:

```
cd apps/web && E2E_BASE_URL=http://localhost:8080 npx playwright test e2e/km3-personalizacja-asystenta.spec.ts -g "ROZŁĄCZNE"
```

Oczekiwane: `1 failed` — asercja `toContainText('kto dzisiaj pracuje')` dla `manager.demo`. Przywróć oryginalne ciało i potwierdź:

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2 && git diff --exit-code apps/web/lib/personalizacja.ts && echo "przywrocone"
```

Oczekiwane: `przywrocone`. Potem ten sam `-g "ROZŁĄCZNE"` → `1 passed`.

- [ ] **Krok 8: Weryfikacja negatywna C1 — zepsuj powitanie imieniem i ZOBACZ czerwień.** W `apps/web/lib/personalizacja.ts` tymczasowo zamień ciało `powitanie` na `` return `Cześć.` ``. Uruchom:

```
cd apps/web && E2E_BASE_URL=http://localhost:8080 npx playwright test e2e/km3-personalizacja-asystenta.spec.ts -g "C1"
```

Oczekiwane: `1 failed` — `Expected string: "Cześć, Anna."`. Przywróć i potwierdź:

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2 && git diff --exit-code apps/web/lib/personalizacja.ts && echo "przywrocone"
```

Oczekiwane: `przywrocone`. Potem `-g "C1"` → `1 passed`.

(Warstwa jednostkowa ma weryfikację negatywną wbudowaną w cykl TDD: każdy test zadań 1–5 był uruchomiony i widziany na czerwono, zanim powstała implementacja.)

- [ ] **Krok 9: Commit.**

```
git add apps/web/e2e/km3-personalizacja-asystenta.spec.ts && git commit -m "test(e2e): personalizacja asystenta — imie, saldo, podpowiedzi wg roli, RODO, konto bez kartoteki"
```

---

### Zadanie 28 (C-10): Zgłoszenie zakresu i ograniczenia w raporcie KM3 + domknięcie bloku

**Pliki:**
- Zmień: `docs/raport-km3/Raport_KM3_HRobot.md`
- Bramki: dwa `grep` na dopiski, `git diff --stat` bez `deletions`, pomiar kotwic demo, dowód nietknięcia backendu

Sekcja 5 jest DOPISYWANA, nie przepisywana — cztery istniejące deklaracje zostają bez zmian, dochodzi piąta, pisana tym samym wzorcem `[Etykieta.]{.lbl}` + zdanie faktu + odsyłacz do dowodu. Budowa PDF-a nie należy do bloku C (pipeline `report.html` → `print-km3.mjs` obsługują bloki A i B); tutaj zmieniamy wyłącznie źródło markdown.

- [ ] **Krok 1: Dopisz personalizację do listy „Co zbudowano" w §3.3.** W `docs/raport-km3/Raport_KM3_HRobot.md`, w sekcji `## 3.3. Agent Głosowy`, po myślniku zaczynającym się od `- Aplikacja referencyjna: ekran ...` (kończy się na `formularzem-fallbackiem.`) dodaj kolejny punkt listy:

```
- Personalizacja komunikacji (zadanie M3 c) --- **deterministyczna, bez
  modelu językowego**: powitanie imieniem odczytanym z kartoteki
  (`GET /api/employees/me`) wraz z rolą i nazwą jednostki organizacyjnej,
  saldo urlopu wypoczynkowego w karcie potwierdzenia wniosku urlopowego
  (reużycie istniejącej intencji `SALDO_URLOPU`, więc liczba jest ta sama,
  co w odpowiedzi na polecenie „ile mam dni urlopu") oraz dwie podpowiedzi
  komend **różne dla pracownika i dla roli kadrowej** po nierozpoznanej
  intencji. Logika w `apps/web/lib/personalizacja.ts` (testy vitest),
  zachowanie na żywym stosie w
  `apps/web/e2e/km3-personalizacja-asystenta.spec.ts`. Konto bez kartoteki
  pracownika (login administracyjny) obsługiwane jawnym komunikatem, nie
  błędem ekranu.
```

- [ ] **Krok 2: Dopisz ograniczenie do §5.** W sekcji `# 5. Ograniczenia realizacji demonstracyjnej (uczciwość)`, po ostatnim punkcie listy (`- [Dane syntetyczne.]{.lbl} ...` kończącym się na `pozostają nietknięte.`) dodaj:

```
- [Limit urlopowy jest ustawowy, nie kartotekowy.]{.lbl} Saldo urlopu,
  które asystent podaje przy potwierdzeniu wniosku, liczone jest jako
  płaski wymiar ustawowy 20 dni (Kodeks pracy art. 154 §1, stała
  `WYMIAR_URLOPU_DNI` w `voice-command.service.ts`) pomniejszony o
  zatwierdzone urlopy zaklasyfikowane jako wypoczynkowe
  (`common/leave-type.ts`). Model danych nie zawiera indywidualnego
  wymiaru urlopu per pracownik (wymiar 26 dni po 10 latach stażu,
  uprawnienia szczególne, urlop zaległy), bo źródłem takiej informacji
  jest system kadrowo-płacowy Odbiorcy --- ten sam, którego konektor
  pozostaje poza zakresem etapu demonstracyjnego. Dla konta bez kartoteki
  pracownika asystent **nie podaje żadnej liczby**, tylko komunikat, że
  salda nie zna (potwierdzone testem `km3-personalizacja-asystenta.spec.ts`,
  przypadek C2b).
```

- [ ] **Krok 3: Zweryfikuj oba dopiski i nienaruszalność czterech istniejących deklaracji.**

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2 && grep -cF "{.lbl}" docs/raport-km3/Raport_KM3_HRobot.md && grep -n "Limit urlopowy jest ustawowy\|Personalizacja komunikacji (zadanie M3 c)" docs/raport-km3/Raport_KM3_HRobot.md
```

Oczekiwane: `13` (baseline zmierzony przed blokiem: **12**) oraz dwa numery linii — jeden w okolicy §3.3 (przed linią 330), drugi za dotychczasową linią 406.

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2 && git diff --numstat docs/raport-km3/Raport_KM3_HRobot.md
```

Oczekiwane: dwie kolumny liczb, w których **druga (usunięcia) wynosi `0`** — dopisujemy, nie przepisujemy. Pierwsza kolumna to 27 wstawionych linii (12 w §3.3 + 15 w §5).

- [ ] **Krok 4: Commit dokumentacji.**

```
git add docs/raport-km3/Raport_KM3_HRobot.md && git commit -m "docs(km3): personalizacja komunikacji w 3.3 + ustawowy charakter limitu urlopowego w 5"
```

- [ ] **Krok 5: Udowodnij, że blok C nie dotknął backendu (a więc i `compositeScore`).**

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2 && git diff --name-only blok-c-baza..HEAD
```

Oczekiwane: lista wyłącznie ze ścieżkami zaczynającymi się od `apps/web/` i `docs/raport-km3/`. **Zero** wpisów pod `apps/tenant-runtime/`, `packages/db/`, `agent-service/` i `scripts/`. W szczególności `apps/tenant-runtime/src/strategic-brain/scoring.util.ts` nie może się tam pojawić.

- [ ] **Krok 6: Zmierz kotwice danych demo po przebiegu e2e.**

```
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -t -A -c "SELECT (SELECT count(*) FROM employees) || '/' || (SELECT count(*) FROM shifts);"
```

Oczekiwane: dokładnie `39/1558`. Blok C nie zawiera migracji ani zapisu do tych tabel; jedyny ślad, jaki zostawia w bazie, to wpisy `agent-glosowy.execute` w append-only `audit_log` (voice-command.service.ts:647-655) — świadome, opisane w Ryzyku 2.

- [ ] **Krok 7: Domknięcie bloku — pełny zestaw testów web i sprzątnięcie tagu.**

```
cd apps/web && npx tsc --noEmit && npx eslint app components lib middleware.ts && npx vitest run
```

Oczekiwane: `tsc` i `eslint` bez wyjścia; vitest `Test Files … passed`, zero `failed`.

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2 && git tag -d blok-c-baza
```

Backend nie był dotykany (dowód: krok 5), więc jego jest nie musi być uruchamiany. Jeśli chcesz mieć to na papierze: `cd apps/tenant-runtime && npx jest src/agent-glosowy` powinno pozostać w tym samym stanie co przed blokiem.

---

**Ryzyka bloku C:**

1. **Rozszerzenie unii `AgentIntent` dotyka pliku współdzielonego z innymi ekranami.** Ryzyko niskie i zamknięte: grep pokazał, że `AgentIntent` występuje wyłącznie w `lib/agent-glosowy.ts`, `lib/agent-glosowy.test.ts` i `components/asystent/asystent-screen.tsx`; jedyny `switch` (`komunikatWykonania`, linie 120–130) ma gałąź `default`. Bramka: `npx tsc --noEmit` w kroku 7 zadania 1.
2. **`execute({ intent: 'SALDO_URLOPU' })` zapisuje wpis do `audit_log`** (`voice-command.service.ts:647-655`). Wywołanie jest leniwe — tylko przy realnym wniosku urlopowym, nie przy każdym wejściu na ekran — ale przy intensywnym demo doda wpisy do tabeli append-only. Świadoma decyzja: ślad audytowy odczytu własnego salda jest pożądany, nie szkodliwy. Kotwice 39/1558 tego nie dotyczą (krok 6 zadania 10 je mierzy).
3. **Nazwa jednostki wymaga drugiego zapytania** (`GET /api/grafik/units`). Gdy padnie, `fetchUnitNames` zwraca `{}` i podtytuł pokazuje **samą rolę**, bez żadnego zdania o jednostce — czyli mówi mniej, ale nic nieprawdziwego. Alternatywą byłoby rozszerzenie `SAFE_SELECT` o relację `unit`, czyli zmiana projekcji RODO tydzień przed odbiorem. Nie robimy tego.
4. **Test C2 zakłada wymiar 20 dni** (`/pozostało \d+ z 20 dni/`). Gdyby ktoś zmienił `WYMIAR_URLOPU_DNI`, test zapali się na czerwono — i tak ma być, bo raport KM3 §5 podaje tę liczbę wprost.
5. **Konto bez kartoteki jest jedno i wynika z seedu, nie z założenia.** `scripts/seed-demo-m2-modules.sql:19-28` tworzy dla `demo` wiersz w `users` i nigdy w `employees`. Krok 1 zadania 9 to potwierdza pomiarem. Jeśli pomiar wyjdzie inaczej — blok się zatrzymuje i zgłasza fakt, zamiast przepisywać kryterium akceptacji pod stan bazy.
6. **Hasło konta `demo` jest sekretem środowiskowym.** Nie trafia do repo; spec czyta `DEMO_ADMIN_PASSWORD` i pada z instrukcją, gdy jej nie ma. Istniejący `e2e/km3-modules-reachable.spec.ts` ma jeszcze starą, zrotowaną wartość wpisaną wprost — to dług sprzed bloku C, którego ten blok nie powiela i nie naprawia.
7. **`compositeScore` nietknięty.** Blok C nie dotyka `apps/tenant-runtime/src/strategic-brain/` ani żadnego pliku backendu — cała zmiana mieści się w `apps/web/{lib,components,app,e2e}` plus jeden plik dokumentacji. Dowód, nie deklaracja: krok 5 zadania 10.
8. **Wyścig „użytkownik szybszy niż `/api/employees/me`".** `dociagnijSaldo` dopytuje o stan kartoteki, gdy profil jeszcze się nie wczytał, więc pracownik z kartoteką nie zobaczy komunikatu o niewiedzy tylko dlatego, że wpisał polecenie w pierwszej sekundzie. Koszt: co najwyżej jedno dodatkowe `GET /api/employees/me` na turę w tym rzadkim przypadku.

**Wycofanie bloku C:**

Blok nie zmienia schematu bazy, danych demo ani żadnego pliku backendu, więc wycofanie jest czysto kodowe i bezstanowe.

- **Wycofanie całości:** `git revert` ośmiu commitów bloku w odwrotnej kolejności (od `docs(km3): personalizacja komunikacji…` do `fix(web): AgentIntent 1:1 z backendem…`). Ekran wraca do treści bezosobowej: bez karty powitania, bez salda, z samym `FALLBACK_MESSAGE` i linkiem do formularza. Backend nic o tym nie wie.
- **Wycofanie częściowe, najbardziej prawdopodobne (saldo okazuje się mylące dla odbiorcy):** revert wyłącznie commita `feat(web): saldo urlopu w karcie potwierdzenia wniosku…` (zadanie 8). Powitanie i podpowiedzi zostają; `czytajSaldoUrlopu` i `zdanieOSaldzie` zostają jako martwy, przetestowany kod albo idą razem z revertem zadań 2 i 5. Trzeba wtedy usunąć też przypadki C2 i C2b ze specu e2e — inaczej lane zapala się na czerwono na nieistniejącym elemencie.
- **Wyłączenie bez rewertu, na żywo:** propsy `imieZSesji`/`roles` są wymagane, więc szybkiego „flagowego" wyłączenia nie ma — i to jest świadomy wybór: personalizacja albo działa, albo jej nie ma, bez konfiguracyjnej trzeciej ścieżki do przetestowania.
- **Dokumentacja:** dopisek do §3.3 i §5 raportu KM3 wycofuje się osobno (`git revert` commita `docs(km3): …`), bo opisuje ograniczenie wymiaru urlopu, które jest prawdziwe niezależnie od tego, czy ekran je pokazuje.

---

## Blok D — Kanał powiadomień e-mail przez nowy NotificationPort (M1 j)

*Zadania globalne 29–39. Kroki numerowane ciągiem 1–68 w obrębie bloku.*

**Repozytorium:** `C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2`, gałąź `feat/demo-4mobility` (HEAD w chwili pisania: `680a28d`).
Wszystkie ścieżki poniżej są względem korzenia tego repo. Komendy `npx jest ...` uruchamiasz z katalogu `apps/tenant-runtime` (tam leży `jest.config.cjs`, auto-wykrywany przez jest). Powłoka: PowerShell.

---

### Ustalenia sprzeczne z założeniem

Poniższe zweryfikowano w kodzie **przed** napisaniem planu. Plan uwzględnia stan faktyczny, nie brief.

1. **`Employee` NIE ma pola z adresem e-mail.** `packages/db/generated/tenant/schema.prisma` — model `Employee` ma `firstName`, `lastName`, `pesel`, `peselHash`, `homeAddress`, ale żadnego `email`. Adres istnieje wyłącznie na `User.email` (`@unique`), a `Employee.userId` jest **opcjonalne** (`String? @unique`). Skutek: adresata wyznaczamy przez `Employee.user.email`, a przypadek „pracownik bez konta użytkownika” musi być pełnoprawnym wynikiem (`NO_RECIPIENT`), nie wyjątkiem. To dotyczy realnych danych demo — nie każdy z 39 pracowników musi mieć konto.
2. **W repo nie ma `nodemailer` ani żadnej biblioteki SMTP.** `grep -c nodemailer pnpm-lock.yaml` → `0`; `apps/tenant-runtime/package.json` bez zależności pocztowej. Dołożenie zależności = instalacja z sieci + zmiana lockfile + przebudowa obrazu `tenant-runtime`. Plan **nie dokłada zależności** — używa minimalnego klienta SMTP na wbudowanym `node:net` (Mailpit przyjmuje nieuwierzytelniony SMTP plaintext na 1025). Konsekwencja do jawnego zadeklarowania: **brak TLS i brak AUTH** — kanał jest środowiskiem testowym, nie relayem produkcyjnym.
3. **Ścieżka ODRZUCENIA zamiany nie pisze dziś do `audit_log`.** `apps/tenant-runtime/src/shift-swap/shift-swap.service.ts` — całe `managerDecision` to linie 284–295, gałąź odrzucenia (`applyTransition(..., SwapAction.ManagerReject, ...)`) to linie 289–293, a jedyne `tx.auditLog.create` w tym pliku siedzi w `approve()` od linii 357. Nie naprawiamy tego w tym bloku; wpis audytowy powiadomienia pisze `NotificationService` niezależnie od ścieżki, więc kryterium D5 („każde wysłane powiadomienie ma wpis w audit_log”) jest spełnione również przy odrzuceniu.
4. **`ShiftSwapService` i `LeaveService` są konstruowane ręcznie w 5 miejscach testów** (`grep -rn "new ShiftSwapService\|new LeaveService" apps/`): `leave.service.spec.ts:43`, `optimizer-swap-feasibility.validator.spec.ts:169`, `shift-swap.controller.spec.ts:186`, `shift-swap.service.spec.ts:90` i `:313`. Dlatego nową zależność wstrzykujemy jako `@Optional() @Inject(NotificationService) ... = null` — żaden istniejący plik testowy nie wymaga edycji. `@Inject` jest tu obowiązkowy: `emitDecoratorMetadata` dla typu unijnego `NotificationService | null` emituje `Object`, więc bez jawnego tokenu Nest nie rozwiąże zależności.
5. **`noUncheckedIndexedAccess: true`** (`packages/config/tsconfig.base.json`), a ts-jest scala inline'owe `compilerOptions` z najbliższym `tsconfig.json`. Zweryfikowane sondą uruchomioną w tym repo: `messages[0].To[0].Address` daje `TS2532`, a `const [h, e] = s.split(sep)` + `e.split(...)` daje `TS18048`. **Każdy test w tym planie unika indeksowania tablic o znanym typie** — stąd pomocnik `splitMessage` i jawne sprawdzenia `undefined`. Wyjątek: `jest.Mock.mock.calls[0][0]` jest bezpieczne, bo `jest.Mock<T = any, Y = any>` daje element typu `any` (potwierdzone tą samą sondą i istniejącym `shift-swap.service.spec.ts:273`).
6. **`apps/tenant-runtime/tsconfig.json` ma `"exclude": ["node_modules", "dist", "**/*.spec.ts"]`.** `npx tsc --noEmit -p tsconfig.json` sprawdza więc WYŁĄCZNIE kod produkcyjny. Typy plików `*.spec.ts` egzekwuje ts-jest przy każdym przebiegu jest — i tylko tam.
7. **Kolizja portu 8080 w zatwierdzonym `docker-compose.yml`** jest realna (`keycloak` linia 78, `caddy` linia 242), ale na tej maszynie działa gitignorowany `docker-compose.override.yml`, który przemapowuje `keycloak` na `8081:8080` i odpublikowuje postgres/redis/rabbitmq/optimizer/control-plane. Blok D nie wprowadza i nie naprawia kolizji; Mailpit dostaje 8025/1025 — `grep -rn "8025\|:1025"` po repo → zero trafień, a wolność portów NA HOŚCIE sprawdzamy osobnym krokiem (Krok 48), bo grep po repo tego nie dowodzi.
8. **§5 raportu KM3 podaje dziś kotwice „36 pracowników, 832 zmiany”** (`docs/raport-km3/Raport_KM3_HRobot.md:406`), a brief mówi o 39/1558. Rozjazd **zgłaszam, nie ruszam** — to poza zakresem bloku D i wymaga decyzji właściciela raportu.
9. `AuditService` jest dostępny globalnie (`tenant-runtime.module.ts` ma `@Global()` i eksportuje `AuditService`), więc `NotificationsModule` nie musi go importować ani re-rejestrować.
10. **Rozjazd nazwy pliku wobec specu.** Spec (tabela „Pliki”) wymienia `apps/tenant-runtime/src/notifications/email.adapter.ts`. Plan tworzy `notification.email.adapter.ts`, bo cała reszta katalogu ma prefiks `notification.` i mieszanka byłaby myląca. Rozjazd jest świadomy i odnotowany tutaj.
11. `C:\Users\Wilk\Documents\WORKSPACE` **nie jest repozytorium git** (`git rev-parse` → `fatal: not a git repository`). Zmiana w `PORTS.md` jest edycją pliku lokalnego, bez commita — i tak jest opisana w Zadaniu 10.

---

### Zadanie 29 (D-0): punkt wyjścia dla dowodów liczbowych

- [ ] **Krok 1: Oznacz stan repo sprzed bloku D.** Z korzenia repo:

```
git tag blok-d-baza
git rev-parse --short blok-d-baza
```

Oczekiwane: wypisany skrót aktualnego HEAD gałęzi `feat/demo-4mobility` (np. `680a28d`). Ten tag jest jedynym punktem odniesienia dla Kroków 65 i 66 — bez niego dowód „`compositeScore` nietknięty” byłby porównaniem dwóch rozbieżnych gałęzi, czyli niczym.

---

### Zadanie 30 (D-1): Port powiadomień + szablony PL bez PII w temacie

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/notifications/notification.port.ts`
- Utwórz: `apps/tenant-runtime/src/notifications/notification.templates.ts`
- Test: `apps/tenant-runtime/src/notifications/notification.templates.spec.ts`

- [ ] **Krok 2: Utwórz katalog i plik portu.** Port to czysta deklaracja typów — nie ma zachowania, które można zapalić na czerwono; jego kontrakt egzekwują testy adapterów (Zadanie 3) i usługi (Zadanie 4). Zapisz `apps/tenant-runtime/src/notifications/notification.port.ts`:

```ts
/**
 * Port KANAŁU POWIADOMIEŃ o zdarzeniu (M1 j).
 *
 * ŚWIADOMIE OSOBNY od `zastepstwa/outreach-channel.port.ts`. Tamten port to kontrakt
 * PYTANIE/ODPOWIEDŹ do kandydata na zastępstwo — `zapytaj(...) -> zapytanieId` plus
 * `odpowiedz(zapytanieId) -> TAK | NIE | BRAK_ODPOWIEDZI` — czyli dialog ze stanem, którego
 * właścicielem jest maszyna stanów `zastepstwa-state-machine.ts`. Powiadomienie o decyzji jest
 * jednokierunkowe i bezstanowe: nikt na nie nie odpowiada. Wciśnięcie e-maila w `OutreachChannel`
 * wymusiłoby zwracanie fikcyjnego `zapytanieId`, którego nikt nigdy nie odpyta, i zaśmieciłoby
 * `odpowiedz()` gałęzią „to był e-mail, nie ma odpowiedzi". Dwa porty, dwa kontrakty, zero gałęzi.
 */
export interface NotificationMessage {
  /** Adres e-mail odbiorcy. RODO: to dana osobowa — NIE trafia ani do logu, ani do `audit_log`. */
  to: string
  /** Temat wiadomości. MUSI być wolny od PII (patrz `notification.templates.ts`). */
  subject: string
  /** Treść tekstowa (UTF-8, zwykły tekst — bez HTML). */
  body: string
}

export interface NotificationPort {
  /**
   * Tożsamość kanału do wpisu audytowego: `email` albo `noop`. Adapter deklaruje ją SAM, bo
   * `NotificationService` nie ma prawa zgadywać — wpis `notification.sent` z `channel: "email"`
   * przy związanym adapterze no-op byłby kłamstwem w `audit_log`.
   */
  readonly channel: string

  /**
   * Wysyła jedną wiadomość. Implementacja MOŻE rzucić — odporność na awarię kanału jest
   * odpowiedzialnością `NotificationService`, nie adaptera (adapter ma być szczery co do porażki).
   */
  send(message: NotificationMessage): Promise<void>
}

/** DI token dla {@link NotificationPort} (wzorzec z `OUTREACH_CHANNEL` / `SWAP_FEASIBILITY_VALIDATOR`). */
export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT')
```

- [ ] **Krok 3: Napisz czerwony test szablonów.** Zapisz `apps/tenant-runtime/src/notifications/notification.templates.spec.ts`:

```ts
import { renderLeaveDecided, renderSwapDecided } from './notification.templates.js'

describe('szablony powiadomień', () => {
  const leaveVars = {
    approved: true,
    startDate: '2026-08-17',
    endDate: '2026-08-21',
    type: 'URLOP_WYPOCZYNKOWY',
  }

  it('temat decyzji urlopowej jest stały i nie zawiera ŻADNEJ cyfry (PESEL, daty, identyfikatory)', () => {
    const { subject } = renderLeaveDecided(leaveVars)
    expect(subject).toBe('HRobot: decyzja w sprawie wniosku urlopowego')
    expect(subject).not.toMatch(/\d/)
  })

  it('temat decyzji o zamianie jest stały i nie zawiera ŻADNEJ cyfry', () => {
    const { subject } = renderSwapDecided({ approved: false, swapRequestId: 'a1b2c3d4-0000-0000-0000-000000000001' })
    expect(subject).toBe('HRobot: decyzja w sprawie zamiany zmiany')
    expect(subject).not.toMatch(/\d/)
  })

  it('temat nie przenosi żadnej wartości zmiennej do treści tematu', () => {
    const { subject } = renderLeaveDecided(leaveVars)
    for (const value of [leaveVars.startDate, leaveVars.endDate, leaveVars.type]) {
      expect(subject).not.toContain(value)
    }
  })

  it('treść decyzji urlopowej podaje zakres, rodzaj i wynik — i mówi "zaakceptowany" przy zgodzie', () => {
    const { body } = renderLeaveDecided(leaveVars)
    expect(body).toContain('2026-08-17')
    expect(body).toContain('2026-08-21')
    expect(body).toContain('URLOP_WYPOCZYNKOWY')
    expect(body).toContain('zaakceptowany')
    expect(body).not.toContain('odrzucony')
  })

  it('treść decyzji urlopowej mówi "odrzucony" przy odmowie', () => {
    const { body } = renderLeaveDecided({ ...leaveVars, approved: false })
    expect(body).toContain('odrzucony')
    expect(body).not.toContain('zaakceptowany')
  })

  it('treść decyzji o zamianie rozróżnia zatwierdzenie od odrzucenia i podaje numer wniosku', () => {
    const zgoda = renderSwapDecided({ approved: true, swapRequestId: 'swap-42' })
    const odmowa = renderSwapDecided({ approved: false, swapRequestId: 'swap-42' })
    expect(zgoda.body).toContain('zatwierdzona')
    expect(zgoda.body).toContain('swap-42')
    expect(odmowa.body).toContain('odrzucona')
  })
})
```

- [ ] **Krok 4: Uruchom test i ZOBACZ czerwień.** Z `apps/tenant-runtime`:

```
npx jest src/notifications/notification.templates.spec.ts
```

Oczekiwane wyjście: `Cannot find module './notification.templates' from 'src/notifications/notification.templates.spec.ts'` i `Test suite failed to run`. Jeśli zobaczysz cokolwiek innego — plik już istnieje, przerwij i sprawdź stan repo.

- [ ] **Krok 5: Napisz minimalną implementację szablonów.** Zapisz `apps/tenant-runtime/src/notifications/notification.templates.ts`:

```ts
/**
 * Szablony powiadomień (PL). REGUŁA RODO: temat jest STAŁYM ŁAŃCUCHEM — żadnej interpolacji.
 * Temat wędruje przez logi serwerów pocztowych, nagłówki i listy wiadomości, więc nie może nieść
 * nazwiska, PESEL-u, dat ani identyfikatorów. Wymuszamy to typami: funkcje renderujące nie
 * przyjmują nazwiska ani PESEL-u W OGÓLE, a test `notification.templates.spec.ts` sprawdza, że
 * temat nie zawiera ani jednej cyfry.
 */

export interface RenderedNotification {
  subject: string
  body: string
}

export interface LeaveDecidedVars {
  /** true = wniosek zaakceptowany, false = odrzucony. */
  approved: boolean
  /** Data początku w formacie YYYY-MM-DD. */
  startDate: string
  /** Data końca w formacie YYYY-MM-DD. */
  endDate: string
  /** Rodzaj urlopu (`LeaveRequest.type` — wolny tekst, np. URLOP_WYPOCZYNKOWY). */
  type: string
}

export interface SwapDecidedVars {
  approved: boolean
  /** Identyfikator `ShiftSwapRequest` — tylko w TREŚCI, nigdy w temacie. */
  swapRequestId: string
}

const STOPKA = 'Wiadomość wygenerowana automatycznie — prosimy na nią nie odpowiadać.'

/** Powiadomienie o rozpatrzeniu wniosku urlopowego (`LeaveService.decide`). */
export function renderLeaveDecided(vars: LeaveDecidedVars): RenderedNotification {
  const decyzja = vars.approved ? 'zaakceptowany' : 'odrzucony'
  return {
    subject: 'HRobot: decyzja w sprawie wniosku urlopowego',
    body: [
      'Dzień dobry,',
      '',
      `Twój wniosek urlopowy (${vars.type}) na okres od ${vars.startDate} do ${vars.endDate} został ${decyzja}.`,
      '',
      'Szczegóły znajdziesz po zalogowaniu w zakładce „Wnioski".',
      '',
      STOPKA,
    ].join('\n'),
  }
}

/** Powiadomienie o decyzji przełożonego w sprawie zamiany zmiany (`ShiftSwapService.managerDecision`). */
export function renderSwapDecided(vars: SwapDecidedVars): RenderedNotification {
  const decyzja = vars.approved ? 'zatwierdzona' : 'odrzucona'
  return {
    subject: 'HRobot: decyzja w sprawie zamiany zmiany',
    body: [
      'Dzień dobry,',
      '',
      `Prośba o zamianę zmiany (nr ${vars.swapRequestId}) została ${decyzja} przez przełożonego.`,
      '',
      'Szczegóły znajdziesz po zalogowaniu w zakładce „Zamiany".',
      '',
      STOPKA,
    ].join('\n'),
  }
}
```

- [ ] **Krok 6: Uruchom test i ZOBACZ zieleń.** Z `apps/tenant-runtime`:

```
npx jest src/notifications/notification.templates.spec.ts
```

Oczekiwane: `Tests: 6 passed, 6 total`, `Test Suites: 1 passed`.

- [ ] **Krok 7: Weryfikacja negatywna kryterium D3 — wstaw PII do tematu i ZOBACZ czerwień.** W `notification.templates.ts` tymczasowo zamień w `renderLeaveDecided` linię tematu na:

```ts
    subject: `HRobot: decyzja w sprawie wniosku urlopowego (${vars.type} ${vars.startDate})`,
```

Uruchom `npx jest src/notifications/notification.templates.spec.ts`. Oczekiwane: `Tests: 3 failed, 3 passed` — padają „temat decyzji urlopowej jest stały…” (`toBe` nie zgadza się), „…nie zawiera ŻADNEJ cyfry” (`2026`) i „temat nie przenosi żadnej wartości zmiennej”. Przywróć stały łańcuch i uruchom ponownie — `6 passed`. Bez tego kroku test nie liczy się jako pokrycie D3.

- [ ] **Krok 8: Commit.** Z korzenia repo:

```
git add apps/tenant-runtime/src/notifications/notification.port.ts apps/tenant-runtime/src/notifications/notification.templates.ts apps/tenant-runtime/src/notifications/notification.templates.spec.ts
git commit -m "feat(notifications): port powiadomien + szablony PL z tematem bez PII (M1 j)"
```

---

### Zadanie 31 (D-2): Minimalny klient SMTP na `node:net` (bez nowej zależności)

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/notifications/smtp.client.ts`
- Test: `apps/tenant-runtime/src/notifications/smtp.client.spec.ts`

- [ ] **Krok 9: Napisz czerwony test klienta SMTP z atrapą serwera.** Zapisz `apps/tenant-runtime/src/notifications/smtp.client.spec.ts`:

```ts
import { createServer, type Server } from 'node:net'
import { buildRfc5322Message, encodeSubject, readSmtpConfig, sendViaSmtp, type SmtpConfig } from './smtp.client.js'

/** Nadpisania odpowiedzi atrapy — pozwalają wymusić błąd na dowolnym etapie sesji. */
interface FakeReplies {
  greeting?: string
  helo?: string
  mail?: string
  rcpt?: string
  data?: string
  afterData?: string
}

interface FakeSmtp {
  port: number
  /** Wszystkie linie POLECEŃ odebrane przez serwer (bez ciała wiadomości). */
  received: string[]
  /** Ciało sesji DATA, bez kropki kończącej. */
  message: string
  /** Spełnia się, gdy atrapa domknie gniazdo sesji — dopiero wtedy `received` jest kompletne. */
  sessionClosed: Promise<void>
  close: () => Promise<void>
}

/** Atrapa serwera SMTP na porcie efemerycznym (0) — zero zależności, zero sieci zewnętrznej. */
async function startFakeSmtp(replies: FakeReplies = {}): Promise<FakeSmtp> {
  const received: string[] = []
  let message = ''
  let resolveClosed: () => void = () => undefined
  const sessionClosed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  const server: Server = createServer((socket) => {
    let inData = false
    let buffer = ''
    socket.setEncoding('utf8')
    socket.write(replies.greeting ?? '220 fake ESMTP\r\n')
    socket.on('data', (chunk) => {
      buffer += String(chunk)
      let idx = buffer.indexOf('\r\n')
      while (idx !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        if (inData) {
          if (line === '.') {
            inData = false
            socket.write(replies.afterData ?? '250 Queued\r\n')
          } else {
            message += `${line}\n`
          }
        } else {
          received.push(line)
          if (line.startsWith('HELO')) socket.write(replies.helo ?? '250 fake\r\n')
          else if (line.startsWith('MAIL FROM')) socket.write(replies.mail ?? '250 OK\r\n')
          else if (line.startsWith('RCPT TO')) socket.write(replies.rcpt ?? '250 OK\r\n')
          else if (line === 'DATA') {
            socket.write(replies.data ?? '354 Send data\r\n')
            inData = true
          } else if (line === 'QUIT') {
            socket.write('221 Bye\r\n')
            socket.end()
          }
        }
        idx = buffer.indexOf('\r\n')
      }
    })
    // Klient może zerwać gniazdo po błędzie — ECONNRESET nie jest błędem testu.
    socket.on('error', () => undefined)
    socket.on('close', () => resolveClosed())
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Atrapa SMTP nie dostała portu TCP')
  return {
    port: address.port,
    received,
    get message() {
      return message
    },
    sessionClosed,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

const config = (port: number): SmtpConfig => ({
  host: '127.0.0.1',
  port,
  from: 'powiadomienia@hrobot.local',
  timeoutMs: 3000,
})

/**
 * Rozdziela nagłówki od ciała bez destrukturyzacji tablicy — `noUncheckedIndexedAccess` czyni
 * `const [a, b] = s.split(sep)` typem `string | undefined` i każde późniejsze `b.split(...)`
 * jest twardym błędem TS18048.
 */
function splitMessage(raw: string, separator: string): { headers: string; encoded: string } {
  const at = raw.indexOf(separator)
  if (at === -1) throw new Error('Wiadomość nie ma pustej linii oddzielającej nagłówki od ciała')
  return { headers: raw.slice(0, at), encoded: raw.slice(at + separator.length) }
}

describe('readSmtpConfig', () => {
  it('zwraca null, gdy SMTP_HOST nie jest ustawiony (brak konfiguracji = kanał wyłączony)', () => {
    expect(readSmtpConfig({})).toBeNull()
    expect(readSmtpConfig({ SMTP_HOST: '   ' })).toBeNull()
  })

  it('uzupełnia domyślny port, nadawcę i limit czasu, gdy podano tylko host', () => {
    expect(readSmtpConfig({ SMTP_HOST: 'mailpit' })).toEqual({
      host: 'mailpit',
      port: 1025,
      from: 'powiadomienia@hrobot.local',
      timeoutMs: 5000,
    })
  })

  it('rzuca na błędny SMTP_PORT zamiast po cichu wysyłać w próżnię', () => {
    expect(() => readSmtpConfig({ SMTP_HOST: 'mailpit', SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT/)
  })
})

describe('buildRfc5322Message', () => {
  it('koduje temat jako encoded-word Base64 (RFC 2047) — polskie znaki nie trafiają surowe do nagłówka', () => {
    expect(encodeSubject('Zażółć')).toBe(`=?UTF-8?B?${Buffer.from('Zażółć', 'utf8').toString('base64')}?=`)
  })

  it('koduje ciało w Base64 i łamie je co najwyżej co 76 znaków', () => {
    const body = 'Dzień dobry,\n\n'.repeat(40)
    const msg = buildRfc5322Message('a@b.test', { to: 'c@d.test', subject: 'Temat', body }, new Date('2026-08-17T09:00:00Z'))
    const { headers, encoded } = splitMessage(msg, '\r\n\r\n')
    expect(headers).toContain('Content-Transfer-Encoding: base64')
    expect(headers).toContain('Content-Type: text/plain; charset=utf-8')
    for (const line of encoded.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(76)
    }
    expect(Buffer.from(encoded.split('\r\n').join(''), 'base64').toString('utf8')).toBe(body)
  })
})

describe('sendViaSmtp', () => {
  it('przeprowadza pełną sesję SMTP i dostarcza wiadomość z odtwarzalną treścią', async () => {
    const fake = await startFakeSmtp()
    try {
      await sendViaSmtp(config(fake.port), {
        to: 'anna@example.test',
        subject: 'HRobot: decyzja w sprawie wniosku urlopowego',
        body: 'Dzień dobry,\n\nWniosek został zaakceptowany.',
      })
      // Bez tego asercja na `received` byłaby wyścigiem: FIN klienta i przetworzenie QUIT
      // po stronie atrapy to dwa różne momenty.
      await fake.sessionClosed
      expect(fake.received).toEqual([
        'HELO hrobot',
        'MAIL FROM:<powiadomienia@hrobot.local>',
        'RCPT TO:<anna@example.test>',
        'DATA',
        'QUIT',
      ])
      const { headers, encoded } = splitMessage(fake.message.trimEnd(), '\n\n')
      expect(headers).toContain('To: anna@example.test')
      expect(headers).toContain(`Subject: ${encodeSubject('HRobot: decyzja w sprawie wniosku urlopowego')}`)
      expect(Buffer.from(encoded.split('\n').join(''), 'base64').toString('utf8')).toContain('zaakceptowany')
    } finally {
      await fake.close()
    }
  })

  it('rzuca z kodem i treścią odpowiedzi, gdy serwer odrzuca odbiorcę', async () => {
    const fake = await startFakeSmtp({ rcpt: '550 No such user here\r\n' })
    try {
      await expect(
        sendViaSmtp(config(fake.port), { to: 'nikt@example.test', subject: 'Temat', body: 'Treść' }),
      ).rejects.toThrow(/550 No such user here.*oczekiwano kodu 250/)
    } finally {
      await fake.close()
    }
  })

  it('rzuca, gdy pod wskazanym portem nikt nie słucha', async () => {
    // Port 1 na loopbacku: uprzywilejowany i pewnie zamknięty — połączenie odpada natychmiast.
    await expect(
      sendViaSmtp({ host: '127.0.0.1', port: 1, from: 'a@b.test', timeoutMs: 1000 }, { to: 'c@d.test', subject: 'T', body: 'B' }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Krok 10: Uruchom test i ZOBACZ czerwień.** Z `apps/tenant-runtime`:

```
npx jest src/notifications/smtp.client.spec.ts
```

Oczekiwane: `Cannot find module './smtp.client' from 'src/notifications/smtp.client.spec.ts'`.

- [ ] **Krok 11: Napisz implementację klienta SMTP.** Zapisz `apps/tenant-runtime/src/notifications/smtp.client.ts`:

```ts
import { createConnection, type Socket } from 'node:net'

/**
 * Minimalny klient SMTP na wbudowanym `node:net`.
 *
 * DLACZEGO BEZ BIBLIOTEKI. W repozytorium nie ma `nodemailer` ani żadnej innej biblioteki
 * pocztowej (`grep -c nodemailer pnpm-lock.yaml` → 0). Dołożenie zależności oznacza instalację
 * z sieci, zmianę lockfile i przebudowę obrazu `tenant-runtime` — koszt nieproporcjonalny do
 * jednej ścieżki „wyślij tekst do lokalnego Mailpita".
 *
 * ZAKRES I JEGO GRANICE — DEKLARACJA, NIE PRZEOCZENIE:
 *   - obsługujemy HELO (nie EHLO), bez STARTTLS i bez AUTH;
 *   - to wystarcza dla Mailpita i dla relaya w tej samej sieci prywatnej;
 *   - to NIE wystarcza dla publicznego dostawcy poczty (Gmail/O365) — tam potrzebny jest transport
 *     TLS+AUTH, świadomie poza zakresem M1 j i zgłoszony w §5 raportu KM3.
 *
 * Ciało kodujemy w Base64, więc żadna linia ciała nie zaczyna się kropką — problem „dot-stuffing"
 * (RFC 5321 §4.5.2) znika z definicji, zamiast być załatany warunkiem, który ktoś kiedyś usunie.
 */

export interface SmtpConfig {
  host: string
  port: number
  /** Adres w kopercie `MAIL FROM` i w nagłówku `From`. */
  from: string
  /** Limit bezczynności gniazda; po jego przekroczeniu wysyłka pada zamiast wisieć. */
  timeoutMs: number
}

export interface SmtpEnvelope {
  to: string
  subject: string
  body: string
}

export const SMTP_DEFAULT_PORT = 1025
export const SMTP_DEFAULT_FROM = 'powiadomienia@hrobot.local'
export const SMTP_DEFAULT_TIMEOUT_MS = 5000

/** Liczba dodatnia z zakresu, albo głośny błąd — literówka w .env nie ma prawa milczeć. */
function requirePositiveInt(name: string, raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new Error(`${name} musi być liczbą całkowitą 1..${max}, otrzymano: ${raw}`)
  }
  return value
}

/**
 * Czyta konfigurację SMTP ze środowiska. `null` = kanał e-mail WYŁĄCZONY (brak `SMTP_HOST`) —
 * to stan normalny, nie awaria. Błędna wartość (np. `SMTP_PORT=abc`) rzuca; decyzję, co z tym
 * zrobić, podejmuje fabryka kanału (`notification.channel.factory.ts`), żeby zła konfiguracja
 * powiadomień nie wywracała startu całego tenant-runtime.
 */
export function readSmtpConfig(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim()
  if (!host) return null
  const from = env.SMTP_FROM?.trim()
  return {
    host,
    port: requirePositiveInt('SMTP_PORT', env.SMTP_PORT, SMTP_DEFAULT_PORT, 65535),
    from: from !== undefined && from.length > 0 ? from : SMTP_DEFAULT_FROM,
    timeoutMs: requirePositiveInt('SMTP_TIMEOUT_MS', env.SMTP_TIMEOUT_MS, SMTP_DEFAULT_TIMEOUT_MS, 600_000),
  }
}

/** Nagłówek w kodowaniu encoded-word Base64 (RFC 2047) — polskie znaki nie mogą iść surowe. */
export function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
}

/** Składa wiadomość RFC 5322 z ciałem Base64 łamanym co 76 znaków. */
export function buildRfc5322Message(from: string, envelope: SmtpEnvelope, sentAt: Date): string {
  const encoded = Buffer.from(envelope.body, 'utf8').toString('base64')
  const wrapped = encoded.match(/.{1,76}/g) ?? ['']
  return [
    `From: ${from}`,
    `To: ${envelope.to}`,
    `Subject: ${encodeSubject(envelope.subject)}`,
    `Date: ${sentAt.toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    ...wrapped,
  ].join('\r\n')
}

interface ReplyReader {
  expect(code: number): Promise<string>
}

/**
 * Czytnik odpowiedzi SMTP. Odpowiedź KOMPLETNA to linia `NNN <treść>` ze SPACJĄ po kodzie;
 * `NNN-<treść>` (myślnik) to linia pośrednia odpowiedzi wieloliniowej i jest pomijana.
 *
 * Gotowe odpowiedzi lądują w osobnej kolejce `ready`, a nie są rozdawane w miejscu parsowania.
 * Gdyby jeden pakiet TCP przyniósł dwie kompletne odpowiedzi przy jednym oczekującym, wariant
 * „resolve w pętli parsera" zgubiłby drugą bezpowrotnie — bufor byłby już przesunięty.
 */
function createReplyReader(socket: Socket): ReplyReader {
  let buffer = ''
  let failure: Error | null = null
  const ready: string[] = []
  const waiting: Array<{ resolve: (line: string) => void; reject: (err: Error) => void }> = []

  const flush = (): void => {
    let idx = buffer.indexOf('\r\n')
    while (idx !== -1) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      if (/^\d{3} /.test(line)) ready.push(line)
      idx = buffer.indexOf('\r\n')
    }
    while (ready.length > 0 && waiting.length > 0) {
      const line = ready.shift() as string
      waiting.shift()?.resolve(line)
    }
  }

  const fail = (err: Error): void => {
    failure ??= err
    while (waiting.length > 0) waiting.shift()?.reject(failure)
  }

  // Bez adnotacji typu na `chunk`: deklaracja `net.Socket` typuje zdarzenie `data` jako Buffer,
  // a `setEncoding('utf8')` daje w czasie wykonania string. `String(chunk)` jest poprawne dla obu.
  socket.on('data', (chunk) => {
    buffer += String(chunk)
    flush()
  })
  socket.on('error', (err: Error) => fail(err))
  socket.on('timeout', () => fail(new Error('Przekroczono limit czasu połączenia SMTP')))
  socket.on('close', () => fail(new Error('Serwer SMTP zamknął połączenie przed zakończeniem sesji')))

  return {
    async expect(code: number): Promise<string> {
      const line = await new Promise<string>((resolve, reject) => {
        if (failure !== null) {
          reject(failure)
          return
        }
        waiting.push({ resolve, reject })
        flush()
      })
      if (!line.startsWith(`${code} `)) {
        throw new Error(`Serwer SMTP odpowiedział "${line}", oczekiwano kodu ${code}`)
      }
      return line
    },
  }
}

/**
 * Przeprowadza jedną sesję SMTP i wysyła jedną wiadomość. Rzuca na dowolnym niezgodnym kodzie.
 *
 * Zamknięcie po QUIT idzie przez `socket.end()`, NIE `destroy()`: `destroy()` nie gwarantuje
 * wypchnięcia zakolejkowanego zapisu, więc QUIT mógłby nigdy nie dotrzeć do serwera. `destroy()`
 * zostaje wyłącznie dla ścieżki błędu, gdzie i tak nie ma czego dosyłać.
 */
export async function sendViaSmtp(
  config: SmtpConfig,
  envelope: SmtpEnvelope,
  now: () => Date = () => new Date(),
): Promise<void> {
  const socket = createConnection({ host: config.host, port: config.port })
  socket.setEncoding('utf8')
  socket.setTimeout(config.timeoutMs)
  const reader = createReplyReader(socket)
  try {
    await reader.expect(220)
    socket.write('HELO hrobot\r\n')
    await reader.expect(250)
    socket.write(`MAIL FROM:<${config.from}>\r\n`)
    await reader.expect(250)
    socket.write(`RCPT TO:<${envelope.to}>\r\n`)
    await reader.expect(250)
    socket.write('DATA\r\n')
    await reader.expect(354)
    socket.write(`${buildRfc5322Message(config.from, envelope, now())}\r\n.\r\n`)
    await reader.expect(250)
    socket.write('QUIT\r\n')
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve())
      socket.end(() => resolve())
    })
  } catch (err) {
    socket.destroy()
    throw err
  }
}
```

- [ ] **Krok 12: Uruchom test i ZOBACZ zieleń.** Z `apps/tenant-runtime`:

```
npx jest src/notifications/smtp.client.spec.ts
```

Oczekiwane: `Tests: 8 passed, 8 total`, `Test Suites: 1 passed`.

- [ ] **Krok 13: Commit.** Z korzenia repo:

```
git add apps/tenant-runtime/src/notifications/smtp.client.ts apps/tenant-runtime/src/notifications/smtp.client.spec.ts
git commit -m "feat(notifications): minimalny klient SMTP na node:net, bez nowej zaleznosci"
```

---

### Zadanie 32 (D-3): Adapter e-mail, adapter no-op i fabryka wybierająca między nimi

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/notifications/notification.noop.adapter.ts`
- Utwórz: `apps/tenant-runtime/src/notifications/notification.email.adapter.ts`
- Utwórz: `apps/tenant-runtime/src/notifications/notification.channel.factory.ts`
- Test: `apps/tenant-runtime/src/notifications/notification.channel.factory.spec.ts`

- [ ] **Krok 14: Napisz czerwony test fabryki kanału.** Zapisz `apps/tenant-runtime/src/notifications/notification.channel.factory.spec.ts`:

```ts
import { createNotificationChannel } from './notification.channel.factory.js'
import { EmailNotificationChannel } from './notification.email.adapter.js'
import { NoopNotificationChannel } from './notification.noop.adapter.js'

const makeLogger = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() })

describe('createNotificationChannel', () => {
  it('bez SMTP_HOST zwraca adapter no-op i NIE rzuca (kryterium D4)', () => {
    const logger = makeLogger()
    const channel = createNotificationChannel({}, logger)
    expect(channel).toBeInstanceOf(NoopNotificationChannel)
    expect(channel.channel).toBe('noop')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('SMTP_HOST'))
  })

  it('adapter no-op połyka wysyłkę bez wyjątku (RODO: bez adresu w logu)', async () => {
    const channel = createNotificationChannel({}, makeLogger())
    await expect(channel.send({ to: 'anna@example.test', subject: 'Temat', body: 'Treść' })).resolves.toBeUndefined()
  })

  it('z SMTP_HOST zwraca adapter e-mail deklarujący kanał "email"', () => {
    const channel = createNotificationChannel({ SMTP_HOST: 'mailpit', SMTP_PORT: '1025' }, makeLogger())
    expect(channel).toBeInstanceOf(EmailNotificationChannel)
    expect(channel.channel).toBe('email')
  })

  it('przy błędnej konfiguracji SMTP schodzi do no-op i głośno loguje, zamiast wywracać start aplikacji', () => {
    const logger = makeLogger()
    const channel = createNotificationChannel({ SMTP_HOST: 'mailpit', SMTP_PORT: 'abc' }, logger)
    expect(channel).toBeInstanceOf(NoopNotificationChannel)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('SMTP_PORT'))
  })
})
```

- [ ] **Krok 15: Uruchom test i ZOBACZ czerwień.** Z `apps/tenant-runtime`:

```
npx jest src/notifications/notification.channel.factory.spec.ts
```

Oczekiwane: `Cannot find module './notification.channel.factory' from 'src/notifications/notification.channel.factory.spec.ts'`.

- [ ] **Krok 16: Napisz adapter no-op.** Zapisz `apps/tenant-runtime/src/notifications/notification.noop.adapter.ts`:

```ts
import { Logger } from '@nestjs/common'
import type { NotificationMessage, NotificationPort } from './notification.port.js'

/**
 * DOMYŚLNY adapter: brak konfiguracji SMTP nie może wywrócić ani startu aplikacji, ani żadnego
 * zapisu (kryterium D4). Wyłączenie kanału powiadomień to zdjęcie `SMTP_HOST` ze środowiska —
 * zmiana konfiguracji, nie zmiana kodu (to jest zarazem plan wycofania całego bloku D).
 *
 * BEZ `@Injectable()`: tę klasę tworzy WYŁĄCZNIE `createNotificationChannel`. Dekorator na klasie,
 * której Nest nigdy nie konstruuje, sugerowałby nieistniejące wpięcie do kontenera.
 */
export class NoopNotificationChannel implements NotificationPort {
  readonly channel = 'noop'
  private readonly logger = new Logger(NoopNotificationChannel.name)

  async send(message: NotificationMessage): Promise<void> {
    // RODO: logujemy TEMAT (z definicji wolny od PII), nigdy adresu odbiorcy ani treści.
    this.logger.log(`Kanał powiadomień wyłączony — pominięto wiadomość „${message.subject}"`)
  }
}
```

- [ ] **Krok 17: Napisz adapter e-mail.** Zapisz `apps/tenant-runtime/src/notifications/notification.email.adapter.ts`:

```ts
import type { NotificationMessage, NotificationPort } from './notification.port.js'
import { sendViaSmtp, type SmtpConfig } from './smtp.client.js'

/**
 * Adapter e-mail portu {@link NotificationPort}. Cienki — cała mechanika protokołu siedzi w
 * `smtp.client.ts`, żeby dała się przetestować bez kontenera DI i bez Nesta.
 *
 * CELOWO RZUCA na porażce wysyłki. Odporność decyzji na awarię kanału (kryterium D2) jest
 * zaimplementowana JEDEN poziom wyżej, w `NotificationService` — adapter, który po cichu połyka
 * błąd, zamienia awarię w ciszę i nie zostawia po sobie wpisu `notification.failed`.
 *
 * BEZ `@Injectable()`: konstruktor przyjmuje zwykły `SmtpConfig`, którego Nest nie potrafiłby
 * rozwiązać. Jedynym twórcą tej klasy jest `createNotificationChannel`.
 */
export class EmailNotificationChannel implements NotificationPort {
  readonly channel = 'email'

  constructor(private readonly config: SmtpConfig) {}

  async send(message: NotificationMessage): Promise<void> {
    await sendViaSmtp(this.config, { to: message.to, subject: message.subject, body: message.body })
  }
}
```

- [ ] **Krok 18: Napisz fabrykę kanału.** Zapisz `apps/tenant-runtime/src/notifications/notification.channel.factory.ts`:

```ts
import { Logger } from '@nestjs/common'
import type { NotificationPort } from './notification.port.js'
import { EmailNotificationChannel } from './notification.email.adapter.js'
import { NoopNotificationChannel } from './notification.noop.adapter.js'
import { readSmtpConfig } from './smtp.client.js'

/** Minimalny kształt logera, żeby test mógł podstawić atrapę bez kontenera Nesta. */
export interface ChannelFactoryLogger {
  log(message: string): void
  warn(message: string): void
  error(message: string): void
}

/**
 * Wybiera adapter na podstawie środowiska. Jedyne miejsce, w którym zapada decyzja
 * „e-mail czy no-op" — reszta systemu widzi wyłącznie {@link NotificationPort}.
 *
 * Błędna konfiguracja SMTP NIE wywraca startu tenant-runtime: schodzimy do no-op i logujemy
 * `error`. Uzasadnienie asymetrii wobec `parseEnv` (`packages/config/src/env.ts`, które przy złym
 * .env celowo zabija proces): `parseEnv` pilnuje rzeczy, bez których aplikacja nie działa (baza,
 * klucz szyfrujący). Kanał powiadomień jest dodatkiem — zabicie API firmy z powodu literówki w
 * `SMTP_PORT` byłoby gorszą awarią niż niewysłany e-mail. Wpis `error` w logu jest tu sygnałem,
 * nie ozdobą.
 */
export function createNotificationChannel(
  env: Record<string, string | undefined>,
  logger: ChannelFactoryLogger = new Logger('NotificationChannelFactory'),
): NotificationPort {
  try {
    const config = readSmtpConfig(env)
    if (config === null) {
      logger.warn('SMTP_HOST nie jest ustawiony — powiadomienia e-mail wyłączone (adapter no-op)')
      return new NoopNotificationChannel()
    }
    logger.log(`Kanał powiadomień e-mail aktywny: ${config.host}:${config.port}`)
    return new EmailNotificationChannel(config)
  } catch (err) {
    logger.error(`Błędna konfiguracja SMTP — powiadomienia e-mail wyłączone: ${(err as Error).message}`)
    return new NoopNotificationChannel()
  }
}
```

- [ ] **Krok 19: Uruchom test i ZOBACZ zieleń.** Z `apps/tenant-runtime`:

```
npx jest src/notifications/notification.channel.factory.spec.ts
```

Oczekiwane: `Tests: 4 passed, 4 total`.

- [ ] **Krok 20: Weryfikacja negatywna kryterium D4 — zdejmij siatkę i ZOBACZ czerwień.** W `notification.channel.factory.ts` tymczasowo usuń `try {` oraz cały blok `} catch (err) { ... }`, zostawiając samo ciało. Uruchom `npx jest src/notifications/notification.channel.factory.spec.ts`. Oczekiwane: `Tests: 1 failed, 3 passed` — pada „przy błędnej konfiguracji SMTP schodzi do no-op…” z komunikatem `SMTP_PORT musi być liczbą całkowitą 1..65535, otrzymano: abc`. Przywróć `try/catch` i uruchom ponownie — `4 passed`.

- [ ] **Krok 21: Commit.** Z korzenia repo:

```
git add apps/tenant-runtime/src/notifications/notification.noop.adapter.ts apps/tenant-runtime/src/notifications/notification.email.adapter.ts apps/tenant-runtime/src/notifications/notification.channel.factory.ts apps/tenant-runtime/src/notifications/notification.channel.factory.spec.ts
git commit -m "feat(notifications): adapter e-mail + no-op jako domyslny, wybor przez SMTP_HOST"
```

---

### Zadanie 33 (D-4): `NotificationService` — rozwiązanie adresata, wpis do `audit_log`, odporność na awarię

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/notifications/notification.service.ts`
- Test: `apps/tenant-runtime/src/notifications/notification.service.spec.ts`

- [ ] **Krok 22: Napisz czerwony test usługi.** Zapisz `apps/tenant-runtime/src/notifications/notification.service.spec.ts`:

```ts
import type { TenantClient } from '@hrobot/db'
import type { AuditService } from '../tenant-runtime/audit/audit.service.js'
import type { NotificationPort } from './notification.port.js'
import { NotificationService, type NotificationRequest } from './notification.service.js'

function makeClient() {
  return { employee: { findUnique: jest.fn() } }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

describe('NotificationService', () => {
  let audit: { log: jest.Mock }
  let port: { channel: string; send: jest.Mock }
  let client: MockClient
  let service: NotificationService

  const request = (): NotificationRequest => ({
    client: asClient(client),
    actorUserId: 'kc-mgr',
    ipAddress: '10.0.0.3',
    employeeId: 'emp-anna',
    entityType: 'LeaveRequest',
    entityId: 'lv-1',
    template: 'leave.decided',
    subject: 'HRobot: decyzja w sprawie wniosku urlopowego',
    body: 'Dzień dobry,\n\nWniosek został zaakceptowany.',
  })

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    port = { channel: 'email', send: jest.fn().mockResolvedValue(undefined) }
    client = makeClient()
    client.employee.findUnique.mockResolvedValue({ user: { email: 'anna@example.test' } })
    service = new NotificationService(audit as unknown as AuditService, port as unknown as NotificationPort)
  })

  it('wysyła na adres z konta użytkownika pracownika i zapisuje notification.sent (kryterium D5)', async () => {
    await expect(service.dispatch(request())).resolves.toBe('SENT')
    expect(port.send).toHaveBeenCalledWith({
      to: 'anna@example.test',
      subject: 'HRobot: decyzja w sprawie wniosku urlopowego',
      body: 'Dzień dobry,\n\nWniosek został zaakceptowany.',
    })
    expect(audit.log).toHaveBeenCalledTimes(1)
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.sent', entityType: 'LeaveRequest', entityId: 'lv-1', actorUserId: 'kc-mgr' }),
    )
  })

  it('ładunek audytu nie zawiera adresu e-mail ani treści wiadomości (RODO)', async () => {
    await service.dispatch(request())
    const payload = audit.log.mock.calls[0][0].payload as Record<string, unknown>
    expect(payload).toEqual({ channel: 'email', template: 'leave.decided', employeeId: 'emp-anna', outcome: 'SENT' })
    expect(JSON.stringify(payload)).not.toContain('anna@example.test')
    expect(JSON.stringify(payload)).not.toContain('Wniosek został')
  })

  it('wpisuje do audytu TOŻSAMOŚĆ związanego adaptera, a nie stałe "email"', async () => {
    const noop = { channel: 'noop', send: jest.fn().mockResolvedValue(undefined) }
    const zNoop = new NotificationService(audit as unknown as AuditService, noop as unknown as NotificationPort)
    await zNoop.dispatch(request())
    expect((audit.log.mock.calls[0][0].payload as Record<string, unknown>).channel).toBe('noop')
  })

  it('awaria kanału NIE rzuca — zwraca FAILED i zostawia wpis notification.failed (kryterium D2)', async () => {
    port.send.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:1025'))
    await expect(service.dispatch(request())).resolves.toBe('FAILED')
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'notification.failed' }))
  })

  it('pracownik bez konta użytkownika: nie woła kanału, zwraca NO_RECIPIENT, zapisuje notification.skipped', async () => {
    client.employee.findUnique.mockResolvedValue({ user: null })
    await expect(service.dispatch(request())).resolves.toBe('NO_RECIPIENT')
    expect(port.send).not.toHaveBeenCalled()
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'notification.skipped' }))
  })

  it('nieznany pracownik również kończy się NO_RECIPIENT, a nie wyjątkiem', async () => {
    client.employee.findUnique.mockResolvedValue(null)
    await expect(service.dispatch(request())).resolves.toBe('NO_RECIPIENT')
  })

  it('awaria samego zapisu audytu też nie rzuca — powiadomienie już poszło', async () => {
    audit.log.mockRejectedValue(new Error('audit_log unavailable'))
    await expect(service.dispatch(request())).resolves.toBe('SENT')
  })

  it('pisze DOKŁADNIE jeden wpis audytu na jedno wywołanie dispatch', async () => {
    port.send.mockRejectedValue(new Error('SMTP down'))
    await service.dispatch(request())
    expect(audit.log).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Krok 23: Uruchom test i ZOBACZ czerwień.** Z `apps/tenant-runtime`:

```
npx jest src/notifications/notification.service.spec.ts
```

Oczekiwane: `Cannot find module './notification.service' from 'src/notifications/notification.service.spec.ts'`.

- [ ] **Krok 24: Napisz implementację usługi.** Zapisz `apps/tenant-runtime/src/notifications/notification.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { NOTIFICATION_PORT, type NotificationPort } from './notification.port.js'

/** Wynik jednej próby powiadomienia. Nigdy nie jest rzucany — jest ZWRACANY. */
export type NotificationOutcome = 'SENT' | 'FAILED' | 'NO_RECIPIENT'

export interface NotificationRequest {
  /** Klient tenanta z bieżącego żądania (multi-tenant: nie ma singletonu — wzorzec z AuditService). */
  client: TenantClient
  /** Kto podjął decyzję wywołującą powiadomienie — `audit_log.actor_user_id`. */
  actorUserId: string
  ipAddress: string
  /** ODBIORCA: pracownik. Adres wyznaczamy z `Employee.user.email` (Employee NIE ma pola e-mail). */
  employeeId: string
  /** Encja, której dotyczy decyzja — `audit_log.entity_type` / `entity_id`. */
  entityType: string
  entityId: string
  /** Nazwa szablonu do audytu (np. `leave.decided`) — nazwa, nie treść. */
  template: string
  /** Temat wolny od PII (patrz `notification.templates.ts`). */
  subject: string
  body: string
}

const ACTION_BY_OUTCOME: Record<NotificationOutcome, string> = {
  SENT: 'notification.sent',
  FAILED: 'notification.failed',
  NO_RECIPIENT: 'notification.skipped',
}

/**
 * Dyspozytor powiadomień: rozwiązuje adresata, woła port i ZAWSZE zostawia dokładnie jeden wpis
 * w `audit_log`.
 *
 * KONTRAKT: `dispatch` NIGDY nie rzuca. To jest cała odpowiedź na kryterium D2 — decyzja o urlopie
 * czy o zamianie jest już zapisana, zanim tu wejdziemy, a niedostępny serwer pocztowy nie ma prawa
 * zamienić udanej decyzji w HTTP 500. Wywołujący może (ale nie musi) sprawdzić zwrócony
 * {@link NotificationOutcome}.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)

  constructor(
    private readonly audit: AuditService,
    @Inject(NOTIFICATION_PORT) private readonly port: NotificationPort,
  ) {}

  async dispatch(request: NotificationRequest): Promise<NotificationOutcome> {
    let outcome: NotificationOutcome
    try {
      const recipient = await this.recipientEmail(request.client, request.employeeId)
      if (recipient === null) {
        this.logger.warn(
          `Pominięto powiadomienie ${request.template} dla ${request.entityType} ${request.entityId}: ` +
            `pracownik ${request.employeeId} nie ma konta użytkownika z adresem e-mail`,
        )
        outcome = 'NO_RECIPIENT'
      } else {
        await this.port.send({ to: recipient, subject: request.subject, body: request.body })
        outcome = 'SENT'
      }
    } catch (err) {
      // Bez adresu w komunikacie — logi też są miejscem, w którym PII nie ma czego szukać.
      this.logger.warn(
        `Powiadomienie ${request.template} dla ${request.entityType} ${request.entityId} nie zostało wysłane: ` +
          `${(err as Error).message}`,
      )
      outcome = 'FAILED'
    }

    // Osobne try: nieudany zapis audytu nie może przekłamać wyniku wysyłki na FAILED, gdy list
    // faktycznie poszedł — ani, tym bardziej, wywrócić decyzji.
    try {
      await this.writeAudit(request, outcome)
    } catch (auditErr) {
      this.logger.error(`Nie udało się zapisać audytu powiadomienia: ${(auditErr as Error).message}`)
    }

    return outcome
  }

  /**
   * `Employee` nie ma kolumny z adresem — e-mail żyje na `User.email`, a `Employee.userId` jest
   * opcjonalne. Pracownik bez konta użytkownika jest więc normalnym stanem danych, nie błędem.
   */
  private async recipientEmail(client: TenantClient, employeeId: string): Promise<string | null> {
    const employee = await client.employee.findUnique({
      where: { id: employeeId },
      select: { user: { select: { email: true } } },
    })
    return employee?.user?.email ?? null
  }

  private writeAudit(request: NotificationRequest, outcome: NotificationOutcome): Promise<void> {
    return this.audit.log({
      tenantClient: request.client,
      actorUserId: request.actorUserId,
      action: ACTION_BY_OUTCOME[outcome],
      entityType: request.entityType,
      entityId: request.entityId,
      // RODO: wyłącznie identyfikatory i nazwa szablonu. ZERO adresu, ZERO treści, ZERO tematu.
      // `channel` czytamy z portu — wpis ma mówić prawdę także wtedy, gdy związany jest no-op.
      payload: { channel: this.port.channel, template: request.template, employeeId: request.employeeId, outcome },
      ipAddress: request.ipAddress,
    })
  }
}
```

- [ ] **Krok 25: Uruchom test i ZOBACZ zieleń.** Z `apps/tenant-runtime`:

```
npx jest src/notifications/notification.service.spec.ts
```

Oczekiwane: `Tests: 8 passed, 8 total`.

- [ ] **Krok 26: Weryfikacja negatywna kryterium D2 — cofnij poprawkę i ZOBACZ czerwień.** W `notification.service.ts` tymczasowo zamień ciało `catch (err) { ... outcome = 'FAILED' }` na samo `throw err`. Uruchom `npx jest src/notifications/notification.service.spec.ts`. Oczekiwane: padają „awaria kanału NIE rzuca…", „nieznany pracownik…" nie (tam nie ma wyjątku) — konkretnie `Tests: 2 failed, 6 passed`, a komunikat pierwszej porażki zawiera `ECONNREFUSED 127.0.0.1:1025`. Przywróć `outcome = 'FAILED'` i uruchom ponownie — `8 passed`. Bez tego kroku test nie liczy się jako pokrycie D2.

- [ ] **Krok 27: Commit.** Z korzenia repo:

```
git add apps/tenant-runtime/src/notifications/notification.service.ts apps/tenant-runtime/src/notifications/notification.service.spec.ts
git commit -m "feat(notifications): dyspozytor z wpisem do audit_log i kontraktem never-throw"
```

---

### Zadanie 34 (D-5): Moduł Nest wiążący port z fabryką

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/notifications/notifications.module.ts`
- Test: `apps/tenant-runtime/src/notifications/notifications.module.spec.ts`

- [ ] **Krok 28: Napisz czerwony test kompilacji modułu.** Zapisz `apps/tenant-runtime/src/notifications/notifications.module.spec.ts`:

```ts
import { Global, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { NotificationsModule } from './notifications.module.js'
import { NotificationService } from './notification.service.js'
import { NOTIFICATION_PORT } from './notification.port.js'
import { NoopNotificationChannel } from './notification.noop.adapter.js'

/**
 * W aplikacji `AuditService` pochodzi z `@Global()` TenantRuntimeModule. Ładowanie go tutaj
 * wciągnęłoby Keycloaka, Redisa i Prometheusa, więc podstawiamy atrapę w module TAKŻE `@Global()`
 * — dokładnie tak, jak wygląda prawdziwy graf. `overrideProvider(AuditService)` nie zadziała:
 * nadpisać można tylko token, który już jest w kompilowanym grafie.
 */
@Global()
@Module({
  providers: [{ provide: AuditService, useValue: { log: jest.fn() } }],
  exports: [AuditService],
})
class FakeGlobalAuditModule {}

describe('NotificationsModule', () => {
  const originalHost = process.env.SMTP_HOST

  afterEach(() => {
    if (originalHost === undefined) delete process.env.SMTP_HOST
    else process.env.SMTP_HOST = originalHost
  })

  it('kompiluje się bez SMTP_HOST i wiąże adapter no-op (kryterium D4 — start bez konfiguracji)', async () => {
    delete process.env.SMTP_HOST

    const moduleRef = await Test.createTestingModule({
      imports: [FakeGlobalAuditModule, NotificationsModule],
    }).compile()

    expect(moduleRef.get(NotificationService)).toBeInstanceOf(NotificationService)
    expect(moduleRef.get(NOTIFICATION_PORT)).toBeInstanceOf(NoopNotificationChannel)
    await moduleRef.close()
  })
})
```

- [ ] **Krok 29: Uruchom test i ZOBACZ czerwień.** Z `apps/tenant-runtime`:

```
npx jest src/notifications/notifications.module.spec.ts
```

Oczekiwane: `Cannot find module './notifications.module' from 'src/notifications/notifications.module.spec.ts'`.

- [ ] **Krok 30: Napisz moduł.** Zapisz `apps/tenant-runtime/src/notifications/notifications.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { NOTIFICATION_PORT } from './notification.port.js'
import { createNotificationChannel } from './notification.channel.factory.js'
import { NotificationService } from './notification.service.js'

/**
 * Moduł kanału powiadomień (M1 j). Podmiana providera `NOTIFICATION_PORT` jest JEDYNYM miejscem
 * wpięcia — `LeaveService` i `ShiftSwapService` widzą wyłącznie `NotificationService`.
 *
 * `AuditService` pochodzi z `@Global()` TenantRuntimeModule (`tenant-runtime.module.ts` ma go w
 * `providers` i w `exports`), więc NIE jest tu rejestrowany — lokalny provider przesłoniłby
 * globalny eksport i zrobił drugą instancję bez żadnego powodu.
 *
 * Moduł jest importowany przez `LeaveModule` i `ShiftSwapModule` — `app.module.ts` (plik jednego
 * właściciela, który już importuje oba) NIE wymaga zmiany.
 */
@Module({
  providers: [
    NotificationService,
    { provide: NOTIFICATION_PORT, useFactory: () => createNotificationChannel(process.env) },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
```

- [ ] **Krok 31: Uruchom cały pakiet modułu i ZOBACZ zieleń.** Z `apps/tenant-runtime`:

```
npx jest src/notifications
```

Oczekiwane: `Test Suites: 5 passed, 5 total`, `Tests: 27 passed, 27 total` (6 + 8 + 4 + 8 + 1). Lane jednostkowy pomija `*.integration.spec.ts` przez `testPathIgnorePatterns` w `jest.config.cjs`, więc plik z Zadania 9 nie jest tu liczony.

- [ ] **Krok 32: Commit.** Z korzenia repo:

```
git add apps/tenant-runtime/src/notifications/notifications.module.ts apps/tenant-runtime/src/notifications/notifications.module.spec.ts
git commit -m "feat(notifications): modul Nest wiazacy NOTIFICATION_PORT z fabryka kanalu"
```

---

### Zadanie 35 (D-6): Wpięcie w rozpatrzenie wniosku urlopowego

**Pliki:**
- Zmień: `apps/tenant-runtime/src/leave/leave.service.ts`
- Zmień: `apps/tenant-runtime/src/leave/leave.module.ts`
- Test: `apps/tenant-runtime/src/leave/leave.notifications.spec.ts` (nowy — istniejący `leave.service.spec.ts` zostaje nietknięty)

- [ ] **Krok 33: Napisz czerwony test powiadomienia przy decyzji urlopowej.** Zapisz `apps/tenant-runtime/src/leave/leave.notifications.spec.ts`:

```ts
import type { TenantClient } from '@hrobot/db'
import { LeaveStatus, Role } from '@hrobot/shared'
import { LeaveService, type LeaveActor } from './leave.service.js'
import type { AuditService } from '../tenant-runtime/audit/audit.service.js'
import type { ReplacementService } from '../ai-grafik/replacement.service.js'
import type { AiProposalService } from '../ai-grafik/ai-proposal.service.js'
import { NotificationService } from '../notifications/notification.service.js'
import type { NotificationPort } from '../notifications/notification.port.js'

const HR: LeaveActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.1' }

const PENDING_LEAVE = {
  id: 'lv-1',
  employeeId: 'emp-anna',
  startDate: new Date('2026-08-17T00:00:00Z'),
  endDate: new Date('2026-08-21T00:00:00Z'),
  status: LeaveStatus.PENDING,
  type: 'URLOP_WYPOCZYNKOWY',
}

function makeClient() {
  return {
    leaveRequest: {
      findUnique: jest.fn().mockResolvedValue(PENDING_LEAVE),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...PENDING_LEAVE, status: LeaveStatus.APPROVED }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    // ownEmployeeId → null: HR nie ma kartoteki, więc maker-checker przepuszcza decyzję.
    employee: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-hr' }) },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

describe('LeaveService.decide — powiadomienie e-mail (M1 j)', () => {
  let audit: { log: jest.Mock }
  let port: { channel: string; send: jest.Mock }
  let client: MockClient
  let service: LeaveService

  function build(portImpl: NotificationPort): LeaveService {
    return new LeaveService(
      audit as unknown as AuditService,
      { findVacatedShifts: jest.fn().mockResolvedValue([]) } as unknown as ReplacementService,
      { createReplacement: jest.fn() } as unknown as AiProposalService,
      new NotificationService(audit as unknown as AuditService, portImpl),
    )
  }

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    port = { channel: 'email', send: jest.fn().mockResolvedValue(undefined) }
    client = makeClient()
    client.employee.findUnique.mockResolvedValue({ user: { email: 'anna@example.test' } })
    service = build(port as unknown as NotificationPort)
  })

  it('po akceptacji wysyła wiadomość do wnioskodawcy z tematem bez PII', async () => {
    await service.decide(asClient(client), HR, 'lv-1', { approve: true })

    expect(port.send).toHaveBeenCalledTimes(1)
    const message = port.send.mock.calls[0][0] as { to: string; subject: string; body: string }
    expect(message.to).toBe('anna@example.test')
    expect(message.subject).toBe('HRobot: decyzja w sprawie wniosku urlopowego')
    expect(message.subject).not.toMatch(/\d/)
    expect(message.body).toContain('2026-08-17')
    expect(message.body).toContain('zaakceptowany')
  })

  it('po odrzuceniu wysyła wiadomość o odmowie', async () => {
    client.leaveRequest.findUniqueOrThrow.mockResolvedValue({ ...PENDING_LEAVE, status: LeaveStatus.REJECTED })
    await service.decide(asClient(client), HR, 'lv-1', { approve: false })
    expect((port.send.mock.calls[0][0] as { body: string }).body).toContain('odrzucony')
  })

  it('zostawia wpis notification.sent w audit_log obok wpisu leave.approved (kryterium D5)', async () => {
    await service.decide(asClient(client), HR, 'lv-1', { approve: true })
    const actions = audit.log.mock.calls.map((call) => (call[0] as { action: string }).action)
    expect(actions).toContain('leave.approved')
    expect(actions).toContain('notification.sent')
  })

  it('AWARIA KANAŁU NIE WYWRACA DECYZJI: zapis przechodzi, błąd ląduje w audit_log (kryterium D2)', async () => {
    const failing = { channel: 'email', send: jest.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:1025')) }
    service = build(failing as unknown as NotificationPort)

    const result = await service.decide(asClient(client), HR, 'lv-1', { approve: true })

    expect(result.status).toBe(LeaveStatus.APPROVED)
    expect(client.leaveRequest.updateMany).toHaveBeenCalledTimes(1)
    const actions = audit.log.mock.calls.map((call) => (call[0] as { action: string }).action)
    expect(actions).toContain('leave.approved')
    expect(actions).toContain('notification.failed')
  })

  it('bez wstrzykniętego kanału (stary sposób konstrukcji) decyzja działa jak dotąd', async () => {
    const bare = new LeaveService(
      audit as unknown as AuditService,
      { findVacatedShifts: jest.fn().mockResolvedValue([]) } as unknown as ReplacementService,
      { createReplacement: jest.fn() } as unknown as AiProposalService,
    )
    await expect(bare.decide(asClient(client), HR, 'lv-1', { approve: true })).resolves.toMatchObject({
      status: LeaveStatus.APPROVED,
    })
    expect(port.send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Krok 34: Uruchom test i ZOBACZ czerwień.** Z `apps/tenant-runtime`:

```
npx jest src/leave/leave.notifications.spec.ts
```

Oczekiwane: kompilacja pada na `error TS2554: Expected 3 arguments, but got 4.` w wywołaniu `new LeaveService(...)` wewnątrz `build`.

- [ ] **Krok 35: Dodaj opcjonalną zależność do `LeaveService`.** W `apps/tenant-runtime/src/leave/leave.service.ts` zamień linię 1 na:

```ts
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common'
```

Zaraz po linii 8 (`import type { CreateLeaveDto } from './dto/leave.dto.js'`) dopisz:

```ts
import { NotificationService } from '../notifications/notification.service.js'
import { renderLeaveDecided } from '../notifications/notification.templates.js'
```

Następnie zamień konstruktor (linie 61–65) na:

```ts
  constructor(
    private readonly audit: AuditService,
    private readonly replacement: ReplacementService,
    private readonly proposals: AiProposalService,
    /**
     * Kanał powiadomień (M1 j). @Optional + wartość domyślna, bo `LeaveService` jest konstruowany
     * ręcznie w istniejących testach (`leave.service.spec.ts:43`) — bez tego każdy z nich trzeba by
     * przepisać. Jawny @Inject jest KONIECZNY: `emitDecoratorMetadata` dla typu unijnego
     * `NotificationService | null` emituje `Object`, więc Nest nie odgadłby tokenu z typu.
     */
    @Optional() @Inject(NotificationService) private readonly notifications: NotificationService | null = null,
  ) {}
```

- [ ] **Krok 36: Wywołaj powiadomienie w `decide`.** W tym samym pliku, w metodzie `decide`, po bloku `await this.writeAudit(...)` kończącym się linią `})` po `decidedByUserId,` i **przed** `if (approve) await this.autoScanReplacements(client, actor, leave)`, wstaw:

```ts
    await this.notifyDecision(client, actor, leave, id, approve)
```

a poniżej metody `autoScanReplacements` (przed `async cancel`) dodaj:

```ts
  /**
   * POWIADOMIENIE O DECYZJI (M1 j). Wywoływane PO zatwierdzonym zapisie i PO wpisie audytowym
   * decyzji — powiadamiamy o fakcie, który już się wydarzył. `NotificationService.dispatch` ma
   * kontrakt „nigdy nie rzuca", więc niedostępny serwer pocztowy nie może zamienić udanej decyzji
   * w błąd HTTP (kryterium D2); własny wpis `notification.failed` zostaje w `audit_log`.
   */
  private async notifyDecision(
    client: TenantClient,
    actor: LeaveActor,
    leave: LeaveRow,
    id: string,
    approve: boolean,
  ): Promise<void> {
    if (this.notifications === null) return
    const rendered = renderLeaveDecided({
      approved: approve,
      startDate: leave.startDate.toISOString().slice(0, 10),
      endDate: leave.endDate.toISOString().slice(0, 10),
      type: leave.type,
    })
    await this.notifications.dispatch({
      client,
      actorUserId: actor.userId,
      ipAddress: actor.ipAddress,
      employeeId: leave.employeeId,
      entityType: 'LeaveRequest',
      entityId: id,
      template: 'leave.decided',
      subject: rendered.subject,
      body: rendered.body,
    })
  }
```

- [ ] **Krok 37: Zaimportuj `NotificationsModule` w `LeaveModule`.** W `apps/tenant-runtime/src/leave/leave.module.ts` po linii `import { LeaveService } from './leave.service.js'` dopisz:

```ts
import { NotificationsModule } from '../notifications/notifications.module.js'
```

oraz zamień `  imports: [AiGrafikModule],` na:

```ts
  imports: [AiGrafikModule, NotificationsModule],
```

- [ ] **Krok 38: Uruchom nowy i stary pakiet testów `leave` i ZOBACZ zieleń.** Z `apps/tenant-runtime`:

```
npx jest src/leave
```

Oczekiwane: `Test Suites: 3 passed, 3 total` — nowy `leave.notifications.spec.ts` (5 testów) oraz nietknięte `leave.service.spec.ts` i `leave.controller.spec.ts` bez ani jednej edycji.

- [ ] **Krok 39: Commit.** Z korzenia repo:

```
git add apps/tenant-runtime/src/leave/leave.service.ts apps/tenant-runtime/src/leave/leave.module.ts apps/tenant-runtime/src/leave/leave.notifications.spec.ts
git commit -m "feat(leave): powiadomienie e-mail o decyzji, awaria kanalu nie wywraca zapisu"
```

---

### Zadanie 36 (D-7): Wpięcie w decyzję managera o zamianie zmiany

**Pliki:**
- Zmień: `apps/tenant-runtime/src/shift-swap/shift-swap.service.ts`
- Zmień: `apps/tenant-runtime/src/shift-swap/shift-swap.module.ts`
- Test: `apps/tenant-runtime/src/shift-swap/shift-swap.notifications.spec.ts` (nowy)

- [ ] **Krok 40: Napisz czerwony test powiadomienia przy decyzji managera.** Zapisz `apps/tenant-runtime/src/shift-swap/shift-swap.notifications.spec.ts`:

```ts
import type { TenantClient } from '@hrobot/db'
import type { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { ShiftSwapService, type ManagerDecisionInput } from './shift-swap.service.js'
import { SwapState } from './swap-state-machine.js'
import { AllowAllSwapFeasibilityValidator } from './swap-feasibility-validator.js'
import { NotificationService } from '../notifications/notification.service.js'
import type { NotificationPort } from '../notifications/notification.port.js'

const REQUEST_ROW = {
  id: 'swap-1',
  requesterEmployeeId: 'emp-anna',
  requesterShiftId: 'shift-a',
  targetEmployeeId: 'emp-bartek',
  targetShiftId: 'shift-b',
  state: SwapState.PENDING_MANAGER,
  decidedByManagerId: null,
}

const INPUT: ManagerDecisionInput = {
  approve: false,
  decidedByManagerId: 'kc-mgr',
  actorUserId: 'kc-mgr',
  ipAddress: '10.0.0.3',
}

function makeClient() {
  return {
    shiftSwapRequest: {
      findUnique: jest.fn().mockResolvedValue(REQUEST_ROW),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...REQUEST_ROW, state: SwapState.REJECTED }),
    },
    shift: { findUnique: jest.fn(), update: jest.fn() },
    employee: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

describe('ShiftSwapService.managerDecision — powiadomienie e-mail (M1 j)', () => {
  let audit: { log: jest.Mock }
  let port: { channel: string; send: jest.Mock }
  let client: MockClient

  function build(portImpl: NotificationPort): ShiftSwapService {
    return new ShiftSwapService(
      new AllowAllSwapFeasibilityValidator(),
      new NotificationService(audit as unknown as AuditService, portImpl),
    )
  }

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    port = { channel: 'email', send: jest.fn().mockResolvedValue(undefined) }
    client = makeClient()
    client.employee.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ user: { email: `${where.id}@example.test` } }),
    )
  })

  it('po odrzuceniu powiadamia OBIE strony zamiany, tematem bez PII', async () => {
    await build(port as unknown as NotificationPort).managerDecision(asClient(client), 'swap-1', INPUT)

    expect(port.send).toHaveBeenCalledTimes(2)
    const adresaci = port.send.mock.calls.map((call) => (call[0] as { to: string }).to)
    expect(adresaci).toEqual(['emp-anna@example.test', 'emp-bartek@example.test'])
    const message = port.send.mock.calls[0][0] as { subject: string; body: string }
    expect(message.subject).toBe('HRobot: decyzja w sprawie zamiany zmiany')
    expect(message.subject).not.toMatch(/\d/)
    expect(message.body).toContain('odrzucona')
    expect(message.body).toContain('swap-1')
  })

  it('każde powiadomienie zostawia wpis notification.sent w audit_log (kryterium D5)', async () => {
    await build(port as unknown as NotificationPort).managerDecision(asClient(client), 'swap-1', INPUT)
    const wysylki = audit.log.mock.calls.filter((call) => (call[0] as { action: string }).action === 'notification.sent')
    expect(wysylki).toHaveLength(2)
    expect(wysylki[0][0]).toMatchObject({ entityType: 'ShiftSwapRequest', entityId: 'swap-1' })
  })

  it('AWARIA KANAŁU NIE WYWRACA DECYZJI: przejście stanu zostaje, błąd ląduje w audit_log (kryterium D2)', async () => {
    const failing = { channel: 'email', send: jest.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:1025')) }
    const result = await build(failing as unknown as NotificationPort).managerDecision(asClient(client), 'swap-1', INPUT)

    expect(result.state).toBe(SwapState.REJECTED)
    expect(client.shiftSwapRequest.updateMany).toHaveBeenCalledTimes(1)
    const actions = audit.log.mock.calls.map((call) => (call[0] as { action: string }).action)
    // Ścieżka odrzucenia nie pisze dziś własnego `shift_swap.rejected` — jedyny ślad audytowy tej
    // decyzji to dwa wpisy powiadomień. Stan zastany, opisany w Ustaleniach #3.
    expect(actions).toEqual(['notification.failed', 'notification.failed'])
  })

  it('bez wstrzykniętego kanału (stary sposób konstrukcji) decyzja działa jak dotąd', async () => {
    const bare = new ShiftSwapService(new AllowAllSwapFeasibilityValidator())
    await expect(bare.managerDecision(asClient(client), 'swap-1', INPUT)).resolves.toMatchObject({
      state: SwapState.REJECTED,
    })
    expect(port.send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Krok 41: Uruchom test i ZOBACZ czerwień.** Z `apps/tenant-runtime`:

```
npx jest src/shift-swap/shift-swap.notifications.spec.ts
```

Oczekiwane: kompilacja pada na `error TS2554: Expected 1 arguments, but got 2.` w `new ShiftSwapService(...)` wewnątrz `build`.

- [ ] **Krok 42: Dodaj opcjonalną zależność do `ShiftSwapService`.** W `apps/tenant-runtime/src/shift-swap/shift-swap.service.ts` zamień blok importu z `@nestjs/common` (linie 1–7) na:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
```

Zaraz po linii 23 (`} from './swap-feasibility-validator.js'`) dopisz:

```ts
import { NotificationService } from '../notifications/notification.service.js'
import { renderSwapDecided } from '../notifications/notification.templates.js'
```

Następnie zamień konstruktor (linie 89–92 w pliku sprzed edycji importów) na:

```ts
  constructor(
    @Inject(SWAP_FEASIBILITY_VALIDATOR)
    private readonly feasibility: SwapFeasibilityValidator,
    /**
     * Kanał powiadomień (M1 j). @Optional + wartość domyślna, bo `ShiftSwapService` jest
     * konstruowany ręcznie w czterech istniejących testach (`shift-swap.service.spec.ts:90` i `:313`,
     * `shift-swap.controller.spec.ts:186`, `optimizer-swap-feasibility.validator.spec.ts:169`) —
     * bez tego każdy z nich wymagałby edycji. Jawny @Inject jest konieczny: metadane dekoratorów
     * dla typu unijnego `NotificationService | null` to `Object`, więc token nie wynika z typu.
     */
    @Optional() @Inject(NotificationService) private readonly notifications: NotificationService | null = null,
  ) {}
```

- [ ] **Krok 43: Przepnij `managerDecision` na wspólne wyjście z powiadomieniem.** W tym samym pliku zamień całe `managerDecision` (linie 284–295 w pliku sprzed edycji importów) na:

```ts
  async managerDecision(
    client: TenantClient,
    id: string,
    input: ManagerDecisionInput,
  ): Promise<SwapRequestRow> {
    const decided = input.approve
      ? await this.approve(client, id, input)
      : await this.applyTransition(client, id, SwapAction.ManagerReject, {
          decidedByManagerId: input.decidedByManagerId,
        })
    // Powiadomienie PO zatwierdzonym przejściu stanu — nigdy przed.
    await this.notifyDecision(client, decided, input)
    return decided
  }

  /**
   * POWIADOMIENIE O DECYZJI MANAGERA (M1 j). Powiadamiamy OBIE strony zamiany: wnioskodawcę i —
   * jeśli istnieje — kontrahenta (przy „oddaniu zmiany" `targetEmployeeId` jest null).
   * `NotificationService.dispatch` ma kontrakt „nigdy nie rzuca", więc awaria poczty nie może
   * zamienić zatwierdzonej zamiany w błąd HTTP (kryterium D2).
   *
   * UWAGA: ścieżka ODRZUCENIA nie pisze dziś własnego wpisu `shift_swap.rejected` w `audit_log`
   * (audyt zamiany istnieje tylko w `approve()`, od linii 357); wpis `notification.*` pisany tutaj
   * jest przy odrzuceniu JEDYNYM śladem audytowym tej decyzji. To stan zastany, nie zmieniany
   * w bloku D.
   */
  private async notifyDecision(
    client: TenantClient,
    request: SwapRequestRow,
    input: ManagerDecisionInput,
  ): Promise<void> {
    if (this.notifications === null) return
    const rendered = renderSwapDecided({ approved: input.approve, swapRequestId: request.id })
    const recipients = [request.requesterEmployeeId, request.targetEmployeeId].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    )
    for (const employeeId of recipients) {
      await this.notifications.dispatch({
        client,
        actorUserId: input.actorUserId,
        ipAddress: input.ipAddress,
        employeeId,
        entityType: 'ShiftSwapRequest',
        entityId: request.id,
        template: 'shift_swap.decided',
        subject: rendered.subject,
        body: rendered.body,
      })
    }
  }
```

- [ ] **Krok 44: Zaimportuj `NotificationsModule` w `ShiftSwapModule`.** W `apps/tenant-runtime/src/shift-swap/shift-swap.module.ts` po linii `import { OPTIMIZER_CLIENT, HttpOptimizerClient } from './optimizer.client.js'` dopisz:

```ts
import { NotificationsModule } from '../notifications/notifications.module.js'
```

i w dekoratorze `@Module({ ... })` dodaj linię `imports` bezpośrednio przed `controllers`:

```ts
  imports: [NotificationsModule],
```

- [ ] **Krok 45: Uruchom cały pakiet `shift-swap` i ZOBACZ zieleń.** Z `apps/tenant-runtime`:

```
npx jest src/shift-swap
```

Oczekiwane: `Test Suites: 5 passed, 5 total` — nowy `shift-swap.notifications.spec.ts` (4 testy) plus cztery istniejące pakiety (`shift-swap.service.spec.ts`, `shift-swap.controller.spec.ts`, `optimizer-swap-feasibility.validator.spec.ts`, `swap-state-machine.spec.ts`) bez ani jednej edycji. Istniejące pakiety konstruują `ShiftSwapService` bez kanału, więc `this.notifications === null` wychodzi z `notifyDecision` przed pętlą adresatów — żaden z nich nie dotyka nowego kodu.

- [ ] **Krok 46: Weryfikacja negatywna „obie strony" — zawęź adresatów i ZOBACZ czerwień.** W `shift-swap.service.ts` tymczasowo zamień w `notifyDecision`:

```ts
    const recipients = [request.requesterEmployeeId].filter(
```

Uruchom `npx jest src/shift-swap/shift-swap.notifications.spec.ts`. Oczekiwane: `Tests: 2 failed, 2 passed` — padają „po odrzuceniu powiadamia OBIE strony…" (`Expected number of calls: 2, Received number of calls: 1`) oraz „każde powiadomienie zostawia wpis notification.sent…" (`Expected length: 2, Received length: 1`). Przywróć `[request.requesterEmployeeId, request.targetEmployeeId]` i uruchom ponownie — `4 passed`.

- [ ] **Krok 47: Sprawdź typy kodu produkcyjnego.** Z `apps/tenant-runtime`:

```
npx tsc --noEmit -p tsconfig.json
```

Oczekiwane: brak wyjścia, kod wyjścia 0. Uwaga: `tsconfig.json` ma `"exclude": ["node_modules", "dist", "**/*.spec.ts"]`, więc ta komenda NIE sprawdza plików testowych — ich typy egzekwuje ts-jest przy każdym `npx jest` (Kroki 12, 25, 31, 38, 45).

- [ ] **Krok 48: Commit.** Z korzenia repo:

```
git add apps/tenant-runtime/src/shift-swap/shift-swap.service.ts apps/tenant-runtime/src/shift-swap/shift-swap.module.ts apps/tenant-runtime/src/shift-swap/shift-swap.notifications.spec.ts
git commit -m "feat(shift-swap): powiadomienie e-mail obu stron o decyzji managera"
```

---

### Zadanie 37 (D-8): Mailpit w `docker-compose.yml` za profilem `full` + konfiguracja środowiska

**Pliki:**
- Zmień: `docker-compose.yml`
- Zmień: `.env.example`

- [ ] **Krok 49: Sprawdź, czy porty 8025 i 1025 są wolne NA TYM HOŚCIE.** W PowerShell, z dowolnego katalogu:

```
netstat -ano | Select-String ":8025\s|:1025\s"
```

Oczekiwane: brak wyjścia. `grep` po repo (zero trafień na `8025`/`:1025`) dowodzi tylko, że repo ich nie używa — a ta maszyna prowadzi inne projekty Compose (patrz nagłówek `docker-compose.override.yml`: „logmagai holds host 5432/6379/5672/15672 and 8000; app-app-1 holds 8080"). Jeśli wyjście NIE jest puste, zatrzymaj się: wybór portu jest decyzją do uzgodnienia z rejestrem `WORKSPACE/PORTS.md`, a nie do zaimprowizowania w tym kroku.

- [ ] **Krok 50: Dodaj usługę `mailpit` do compose.** W `docker-compose.yml` wstaw poniższy blok **przed** linią 235 — `  # Brama — jeden publiczny origin.` (czyli przed usługą `caddy`, która zaczyna się w linii 237):

```yaml
  # Skrzynka testowa poczty wychodzącej (dokument j) wymienia Mailpit z nazwy jako narzędzie
  # środowiska testowego). Przechwytuje KAŻDĄ wiadomość z tenant-runtime i pokazuje ją w UI
  # na :8025 — nic nie wychodzi na zewnątrz, więc żaden e-mail demo nie trafi do realnej skrzynki.
  # Za profilem "full" jak pozostałe usługi aplikacyjne: `docker compose up -d` go nie podnosi,
  # a brak SMTP_HOST oznacza adapter no-op, więc backend startuje bez niego bez jednego wyjątku.
  mailpit:
    profiles: ["full"]
    restart: unless-stopped
    image: axllent/mailpit:v1.21
    environment:
      # Demo: przyjmij każdą sesję bez uwierzytelnienia i bez TLS — klient SMTP w tenant-runtime
      # (smtp.client.ts) celowo nie implementuje ani AUTH, ani STARTTLS.
      MP_SMTP_AUTH_ACCEPT_ANY: "1"
      MP_SMTP_AUTH_ALLOW_INSECURE: "1"
      # Kubeł ma dno: skrzynka demo nie ma prawa rosnąć bez końca.
      MP_MAX_MESSAGES: "500"
    ports:
      # 8025 = UI/API, 1025 = SMTP. Wolność portów potwierdzona na hoście w Kroku 49.
      - "8025:8025"
      - "1025:1025"
    healthcheck:
      test: ["CMD", "/mailpit", "readyz"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 10s
```

- [ ] **Krok 51: Wskaż Mailpita usłudze `tenant-runtime`.** W `docker-compose.yml`, w bloku `tenant-runtime` → `environment` (linie 143–149), bezpośrednio po linii 149 `      PORT: "3001"` dopisz:

```yaml
      # Kanał powiadomień e-mail (M1 j). Sam fakt ustawienia SMTP_HOST włącza adapter e-mail;
      # jego brak = adapter no-op (kryterium D4). Nazwa hosta to nazwa usługi w sieci compose.
      SMTP_HOST: mailpit
      SMTP_PORT: "1025"
      SMTP_FROM: powiadomienia@hrobot.local
      # Jawnie, żeby dało się skrócić limit bez zmiany kodu (patrz Ryzyko 5).
      SMTP_TIMEOUT_MS: "5000"
```

a na końcu bloku `depends_on` tej samej usługi (linie 150–156, ostatni wpis to `rabbitmq: condition: service_healthy`) dopisz:

```yaml
      mailpit:
        condition: service_healthy
```

- [ ] **Krok 52: Udokumentuj zmienne w `.env.example`.** Na końcu `.env.example` (po ostatniej linii `PORT=3000`) dopisz:

```
# --- Powiadomienia e-mail (M1 j) --------------------------------------------
# BRAK SMTP_HOST = kanał wyłączony (adapter no-op): decyzje zapisują się normalnie, e-mail nie
# wychodzi, aplikacja nie rzuca żadnego wyjątku. To jest zarazem sposób wyłączenia kanału —
# zmiana konfiguracji, nie zmiana kodu.
#
# Środowisko demo: `docker compose --profile full up -d mailpit`, skrzynka pod http://localhost:8025
# SMTP_HOST=mailpit
# SMTP_PORT=1025
# SMTP_FROM=powiadomienia@hrobot.local
# SMTP_TIMEOUT_MS=5000
#
# OGRANICZENIE ZAKRESU: klient SMTP (apps/tenant-runtime/src/notifications/smtp.client.ts) mówi
# HELO bez STARTTLS i bez AUTH. Wystarcza dla Mailpita i relaya w sieci prywatnej; NIE wystarcza
# dla publicznego dostawcy poczty (Gmail/O365) — transport TLS+AUTH jest poza zakresem M1 j.
```

- [ ] **Krok 53: Zweryfikuj składnię compose.** Z korzenia repo:

```
docker compose --profile full config --services
```

Oczekiwane wyjście zawiera linię `mailpit` obok `postgres`, `redis`, `rabbitmq`, `keycloak`, `control-plane`, `tenant-runtime`, `optimizer`, `web`, `caddy`, `stt` (usługa `agent` NIE wystąpi — siedzi za profilem `agent`). Brak komunikatu `services.mailpit ... invalid`. Uwaga: `docker compose` scala tu również gitignorowany `docker-compose.override.yml`, który nie dotyka `mailpit`.

- [ ] **Krok 54: Commit.** Z korzenia repo:

```
git add docker-compose.yml .env.example
git commit -m "feat(compose): mailpit za profilem full jako skrzynka testowa powiadomien (M1 j)"
```

---

### Zadanie 38 (D-9): Dowód na żywym stacku — wiadomość widoczna w Mailpicie

**Pliki:**
- Test: `apps/tenant-runtime/src/notifications/mailpit.integration.spec.ts` (nowy, lane integracyjny)

- [ ] **Krok 55: Podnieś Mailpita i potwierdź, że skrzynka jest pusta.** Z korzenia repo:

```
docker compose --profile full up -d mailpit
docker compose ps mailpit
curl.exe -s http://localhost:8025/api/v1/messages
```

Oczekiwane: `docker compose ps` pokazuje stan `healthy`; `curl.exe` zwraca JSON zawierający `"total":0`. Używamy `curl.exe`, nie `curl` — w PowerShell `curl` jest aliasem `Invoke-WebRequest`, który odrzuca `-s`.

- [ ] **Krok 56: Napisz czerwony test integracyjny przeciwko Mailpitowi.** Zapisz `apps/tenant-runtime/src/notifications/mailpit.integration.spec.ts`:

```ts
import type { TenantClient } from '@hrobot/db'
import { LeaveStatus, Role } from '@hrobot/shared'
import type { AuditService } from '../tenant-runtime/audit/audit.service.js'
import type { ReplacementService } from '../ai-grafik/replacement.service.js'
import type { AiProposalService } from '../ai-grafik/ai-proposal.service.js'
import { LeaveService, type LeaveActor } from '../leave/leave.service.js'
import { createNotificationChannel } from './notification.channel.factory.js'
import { NotificationService } from './notification.service.js'
import { renderLeaveDecided } from './notification.templates.js'

/**
 * Lane integracyjny [CI-4]: wymaga ŻYWEGO Mailpita (`docker compose --profile full up -d mailpit`).
 * Uruchomienie (PowerShell, z apps/tenant-runtime):
 *   $env:MAILPIT_URL="http://localhost:8025"; $env:SMTP_HOST="localhost"; $env:SMTP_PORT="1025";
 *   npx jest --config jest.integration.config.cjs src/notifications
 *
 * `describe.skip` (nie ciche przejście) bez MAILPIT_URL — pominięty przebieg ma być widoczny w logu.
 * W CI pominięcie byłoby FAŁSZYWĄ ZIELENIĄ, więc tam brak zmiennej jest twardym błędem. Konwencja
 * przeniesiona 1:1 z `analityk.integration.spec.ts:77–85`.
 */
const MAILPIT_URL = process.env.MAILPIT_URL

if (!MAILPIT_URL && process.env.CI) {
  throw new Error(
    'MAILPIT_URL jest wymagany w CI: bramka kanału e-mail nie może po cichu przechodzić. ' +
      'Podnieś `docker compose --profile full up -d mailpit` i ustaw MAILPIT_URL.',
  )
}

const describeIntegration = MAILPIT_URL ? describe : describe.skip

interface MailpitMessage {
  ID: string
  Subject: string
  To: Array<{ Address: string }>
}

const SMTP_ENV = {
  SMTP_HOST: process.env.SMTP_HOST ?? 'localhost',
  SMTP_PORT: process.env.SMTP_PORT ?? '1025',
}

/** Jedna wiadomość dla podanego adresata, albo głośny błąd — bez indeksowania „na wiarę". */
async function findOneByRecipient(address: string): Promise<MailpitMessage> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)
  expect(res.ok).toBe(true)
  const { messages } = (await res.json()) as { messages: MailpitMessage[] }
  expect(messages).toHaveLength(1)
  const first = messages[0]
  if (first === undefined) throw new Error(`Mailpit nie zwrócił wiadomości dla ${address}`)
  return first
}

describeIntegration('kanał e-mail → Mailpit', () => {
  it('adapter dostarcza wiadomość o decyzji urlopowej z poprawnym adresatem i tematem bez PII (kryterium D3)', async () => {
    const adresat = `anna.${Date.now()}@example.test`
    const channel = createNotificationChannel(SMTP_ENV)
    const rendered = renderLeaveDecided({
      approved: true,
      startDate: '2026-08-17',
      endDate: '2026-08-21',
      type: 'URLOP_WYPOCZYNKOWY',
    })

    await channel.send({ to: adresat, subject: rendered.subject, body: rendered.body })

    const message = await findOneByRecipient(adresat)
    expect(message.To[0]?.Address).toBe(adresat)
    // Mailpit dekoduje encoded-word — temat po polsku, bez PII i bez cyfr.
    expect(message.Subject).toBe('HRobot: decyzja w sprawie wniosku urlopowego')
    expect(message.Subject).not.toMatch(/\d/)

    const raw = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json()) as { Text: string }
    expect(raw.Text).toContain('zaakceptowany')
  })

  it('PEŁNA ŚCIEŻKA: LeaveService.decide → adres z Employee.user.email → Mailpit (kryterium D1)', async () => {
    const adresat = `bartek.${Date.now()}@example.test`
    const audit = { log: jest.fn().mockResolvedValue(undefined) }
    const notifications = new NotificationService(
      audit as unknown as AuditService,
      createNotificationChannel(SMTP_ENV),
    )

    const PENDING_LEAVE = {
      id: 'lv-int-1',
      employeeId: 'emp-bartek',
      startDate: new Date('2026-08-17T00:00:00Z'),
      endDate: new Date('2026-08-21T00:00:00Z'),
      status: LeaveStatus.PENDING,
      type: 'URLOP_WYPOCZYNKOWY',
    }
    // Prisma jest atrapą — dowodzimy ścieżki decyzja→szablon→port→SMTP→Mailpit, nie zapisu do bazy
    // (ten pokrywa `leave.service.spec.ts`).
    const client = {
      leaveRequest: {
        findUnique: jest.fn().mockResolvedValue(PENDING_LEAVE),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...PENDING_LEAVE, status: LeaveStatus.APPROVED }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      employee: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ user: { email: adresat } }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-hr' }) },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const HR: LeaveActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.1' }

    const service = new LeaveService(
      audit as unknown as AuditService,
      { findVacatedShifts: jest.fn().mockResolvedValue([]) } as unknown as ReplacementService,
      { createReplacement: jest.fn() } as unknown as AiProposalService,
      notifications,
    )

    const result = await service.decide(client as unknown as TenantClient, HR, 'lv-int-1', { approve: true })
    expect(result.status).toBe(LeaveStatus.APPROVED)

    const message = await findOneByRecipient(adresat)
    expect(message.To[0]?.Address).toBe(adresat)
    expect(message.Subject).toBe('HRobot: decyzja w sprawie wniosku urlopowego')

    const raw = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json()) as { Text: string }
    expect(raw.Text).toContain('2026-08-17')
    expect(raw.Text).toContain('zaakceptowany')

    const actions = audit.log.mock.calls.map((call) => (call[0] as { action: string }).action)
    expect(actions).toContain('leave.approved')
    expect(actions).toContain('notification.sent')
  })
})
```

- [ ] **Krok 57: Uruchom test BEZ zmiennej i ZOBACZ, że jest pominięty (kontrola bramki).** Z `apps/tenant-runtime`:

```
npx jest --config jest.integration.config.cjs src/notifications/mailpit.integration.spec.ts
```

Oczekiwane: `Tests: 2 skipped, 2 total` — bramka `describe.skip` działa i lane jednostkowy nigdy nie zależy od kontenera.

- [ ] **Krok 58: Uruchom test Z Mailpitem i ZOBACZ zieleń.** Z `apps/tenant-runtime` (PowerShell):

```
$env:MAILPIT_URL="http://localhost:8025"; $env:SMTP_HOST="localhost"; $env:SMTP_PORT="1025"; npx jest --config jest.integration.config.cjs src/notifications/mailpit.integration.spec.ts
```

Oczekiwane: `Tests: 2 passed, 2 total`.

- [ ] **Krok 59: Obejrzyj wiadomość w UI Mailpita i zapisz dowód odbiorczy.** Otwórz `http://localhost:8025` i potwierdź naocznie: na liście są dwie wiadomości, temat obu brzmi „HRobot: decyzja w sprawie wniosku urlopowego", w kolumnie odbiorcy widnieją `anna.<timestamp>@example.test` i `bartek.<timestamp>@example.test`, a w treści są polskie znaki bez „krzaków" (dowód, że kodowanie Base64 + `charset=utf-8` działa). Zrzut ekranu zapisz jako `docs/raport-km3/assets/mailpit-powiadomienie-urlop.png` — katalog `docs/raport-km3/assets` już istnieje i jest miejscem zrzutów tego raportu.

- [ ] **Krok 60: Weryfikacja negatywna kryterium D2 na żywo — zatrzymaj Mailpita i potwierdź, że decyzja przechodzi.** Z korzenia repo:

```
docker compose stop mailpit
```

Z `apps/tenant-runtime`:

```
npx jest src/leave/leave.notifications.spec.ts src/shift-swap/shift-swap.notifications.spec.ts
```

Oczekiwane: `Tests: 9 passed, 9 total` — testy jednostkowe nie dotykają sieci, a testy „AWARIA KANAŁU NIE WYWRACA DECYZJI" dowodzą zachowania przy niedostępnym serwerze. Następnie sprawdź, że przy wyłączonym Mailpicie lane integracyjny UCZCIWIE pada, zamiast udawać zieleń:

```
$env:MAILPIT_URL="http://localhost:8025"; $env:SMTP_HOST="localhost"; $env:SMTP_PORT="1025"; npx jest --config jest.integration.config.cjs src/notifications/mailpit.integration.spec.ts
```

Oczekiwane: `Tests: 2 failed` z błędem połączenia (`ECONNREFUSED`). Na koniec przywróć stack: `docker compose --profile full up -d mailpit`.

- [ ] **Krok 61: Commit.** Z korzenia repo:

```
git add apps/tenant-runtime/src/notifications/mailpit.integration.spec.ts docs/raport-km3/assets/mailpit-powiadomienie-urlop.png
git commit -m "test(notifications): integracja z Mailpitem — pelna sciezka decyzji, temat bez PII"
```

---

### Zadanie 39 (D-10): Zapisy — rejestr portów i uczciwa deklaracja w §5 raportu KM3

**Pliki:**
- Zmień: `C:\Users\Wilk\Documents\WORKSPACE\PORTS.md` (rejestr workspace, POZA repo i POZA jakimkolwiek gitem)
- Zmień: `docs/raport-km3/Raport_KM3_HRobot.md`

- [ ] **Krok 62: Dopisz porty Mailpita do rejestru workspace.** W `C:\Users\Wilk\Documents\WORKSPACE\PORTS.md`, w tabeli „HRobot (rodzina 5 repo)" (wiersze 60–70), po wierszu 70 `| Virtual tour (nginx) | \`4810\` ✅ | 80 |` dopisz dwa wiersze:

```
| Mailpit UI (profil full) | `8025` ✅ | 8025 |
| Mailpit SMTP (profil full) | `1025` ✅ | 1025 |
```

a bezpośrednio pod tabelą, przed akapitem `**✅ Wszystkie 5 repo zmigrowane…**`, dopisz jedno zdanie uzasadnienia — rejestr deklaruje „Kanoniczny pas: `48xx`", więc odstępstwo musi być w nim nazwane, nie przemilczane:

```
> Mailpit świadomie zostaje na portach domyślnych (8025/1025) zamiast w pasie `48xx`: narzędzie
> testowe rozpoznaje się po porcie, a oba są na tym hoście wolne (sprawdzone `netstat -ano`).
```

`C:\Users\Wilk\Documents\WORKSPACE` **nie jest repozytorium git** (`git rev-parse --is-inside-work-tree` → `fatal: not a git repository`), więc ta zmiana nie ma commita i nie ma czego zatwierdzać. Krok kończy się zapisaniem pliku.

- [ ] **Krok 63: Dopisz jedną uczciwą pozycję do §5 raportu KM3.** W `docs/raport-km3/Raport_KM3_HRobot.md`, w sekcji `# 5. Ograniczenia realizacji demonstracyjnej (uczciwość)` (zaczyna się w linii 378), po linii 406 — ostatniej linii pozycji `- [Dane syntetyczne.]{.lbl}`, kończącej się słowami „pozostają nietknięte." — a przed pustą linią 407 dopisz, wzorcem czterech istniejących (etykieta `{.lbl}` + zdanie faktu + odsyłacz do dowodu):

```
- [Powiadomienia: e-mail tak, push nie.]{.lbl} Kanał powiadomień (M1 j)
  wdrożono jako **osobny port** `NotificationPort` z adapterem e-mail (SMTP)
  i adapterem no-op jako domyślnym; decyzja o wniosku urlopowym i decyzja
  przełożonego o zamianie zmiany wysyłają wiadomość, a każda wysyłka
  zostawia wpis w `audit_log`. Poza zakresem demo pozostają: **powiadomienia
  push** (wymagają rejestracji aplikacji w usługach dostawców) oraz
  **transport TLS+AUTH** do publicznego dostawcy poczty — klient SMTP
  (`apps/tenant-runtime/src/notifications/smtp.client.ts`) obsługuje sesję
  bez szyfrowania i bez uwierzytelnienia, co wystarcza dla środowiska
  testowego (Mailpit, `docker-compose.yml`, profil `full`) i dla relaya w
  sieci prywatnej. Temat wiadomości jest z założenia wolny od danych
  osobowych, co utrwala test `notification.templates.spec.ts`.
```

- [ ] **Krok 64: Sprawdź, że sekcja 5 nie została przepisana, a tylko rozszerzona.** Z korzenia repo:

```
git diff --stat docs/raport-km3/Raport_KM3_HRobot.md
```

Oczekiwane: `1 file changed, 12 insertions(+)` — dokładnie 12 wstawionych linii i **zero** usuniętych. Jeśli pojawi się jakakolwiek liczba przy `deletions`, cofnij zmianę (`git checkout -- docs/raport-km3/Raport_KM3_HRobot.md`) i dopisz pozycję ponownie, nie ruszając istniejących czterech.

- [ ] **Krok 65: Uruchom pełny lane jednostkowy tenant-runtime.** Z `apps/tenant-runtime`:

```
npx jest
```

Oczekiwane: wszystkie pakiety zielone, w tym pięć nowych pakietów w `src/notifications` (27 testów) oraz dwa nowe pakiety powiadomień w `src/leave` i `src/shift-swap` (9 testów). Następnie potwierdź, że blok D dotknął dokładnie czterech istniejących plików i żadnego istniejącego testu — z korzenia repo:

```
git diff --name-status blok-d-baza..HEAD -- apps/tenant-runtime/src
```

Oczekiwane: siedem wierszy `A` (nowe pliki w `src/notifications` plus `leave.notifications.spec.ts` i `shift-swap.notifications.spec.ts`) oraz dokładnie cztery wiersze `M`: `leave.service.ts`, `leave.module.ts`, `shift-swap.service.ts`, `shift-swap.module.ts`. Żaden istniejący `*.spec.ts` nie może wystąpić z `M`.

- [ ] **Krok 66: Potwierdź, że `compositeScore` nie został tknięty.** Z korzenia repo:

```
git diff --stat blok-d-baza..HEAD -- apps/tenant-runtime/src/strategic-brain/
```

Oczekiwane: brak wyjścia (zero zmienionych plików w `strategic-brain/`). Tag `blok-d-baza` z Kroku 1 jest tu konieczny: dowolny inny SHA (np. z gałęzi dokumentacyjnej) nie jest przodkiem HEAD i pokazałby różnicę międzygałęziową zamiast śladu bloku D. To dowód, że blok D nie ruszył wyniku rozliczanego w macierzy AN-1..AN-13 raportu KM3.

- [ ] **Krok 67: Commit raportu.** Z korzenia repo:

```
git add docs/raport-km3/Raport_KM3_HRobot.md
git commit -m "docs(km3): §5 — kanal e-mail wdrozony, push i TLS+AUTH poza zakresem demo"
```

- [ ] **Krok 68: Usuń tag pomocniczy.** Z korzenia repo:

```
git tag -d blok-d-baza
```

Oczekiwane: `Deleted tag 'blok-d-baza'`. Tag był rusztowaniem dowodowym Kroków 65–66 i nie ma czego robić w historii.

---

**Ryzyka bloku D:**

1. **Klient SMTP własnej roboty zamiast biblioteki.** `nodemailer` nie istnieje w repo ani w `pnpm-lock.yaml` (`grep -c` → 0); dołożenie go = instalacja z sieci + zmiana lockfile + przebudowa obrazu `tenant-runtime`, czego w 2,5 h przed odbiorem nie chcemy. Cena: obsługujemy HELO bez STARTTLS i bez AUTH, więc kanał działa z Mailpitem i relayem w sieci prywatnej, ale **nie** z Gmailem/O365. Zmitygowane przez: jawną deklarację w §5 raportu (Krok 63), komentarz na czele `smtp.client.ts` i wpis w `.env.example`. Gdyby odbiorca zażądał publicznego dostawcy — podmiana dotyczy jednego pliku (`notification.email.adapter.ts`), reszta systemu widzi tylko `NotificationPort`.
2. **Pracownik bez konta użytkownika nie dostanie e-maila.** `Employee` nie ma pola e-mail, a `Employee.userId` jest opcjonalne. W danych demo część z 39 pracowników może nie mieć konta — dla nich wynik to `NO_RECIPIENT` i wpis `notification.skipped`, nie awaria. Przed pokazem sprawdź, ilu pracowników ma konto: `SELECT count(*) FROM employees e JOIN users u ON u.id = e.user_id;` na bazie tenanta `hrobot_t_900d948b` — jeśli wynik jest mały, wybierz do scenariusza demo pracownika, który konto ma.
3. **Porty i kolizje w compose.** Zatwierdzony `docker-compose.yml` mapuje 8080 dwa razy (`keycloak` linia 78 i `caddy` linia 242), ale na tej maszynie działa gitignorowany `docker-compose.override.yml`, który przenosi Keycloaka na 8081 i odpublikowuje postgres/redis/rabbitmq/optimizer/control-plane; jego nagłówek odnotowuje też, że `app-app-1` trzyma hosta 8080. Skutek: `docker compose --profile full up -d` może paść na „port is already allocated" na `caddy`, zanim Mailpit w ogóle wstanie — wtedy podnieś samą usługę: `docker compose --profile full up -d mailpit`. Blok D tego nie wprowadza i nie naprawia. Wolność 8025/1025 na hoście sprawdza Krok 49; jeśli są zajęte, plan zatrzymuje się na tym kroku zamiast improwizować numer portu wbrew rejestrowi `WORKSPACE/PORTS.md`.
4. **`@Optional()` ukrywa błąd okablowania.** Jeśli ktoś w przyszłości utworzy nowy moduł z `LeaveService`, ale zapomni zaimportować `NotificationsModule`, powiadomienia po cichu znikną — `this.notifications === null` po prostu wraca. Wczesny sygnał: brak linii `Kanał powiadomień e-mail aktywny: mailpit:1025` w logu startu tenant-runtime. Sprawdzaj ją w runbooku demo. Drugi sygnał, tańszy: wpisy `notification.*` w `audit_log` niosą teraz `channel` czytany z portu, więc `channel: "noop"` w produkcyjnym wpisie od razu mówi, że kanał jest wyłączony, zamiast udawać wysyłkę.
5. **Powiadomienie wydłuża czas odpowiedzi decyzji.** `dispatch` jest awaitowany w ścieżce żądania HTTP; przy niedostępnym serwerze SMTP koszt to `SMTP_TIMEOUT_MS` (domyślnie 5 s), a przy zamianie **dwa razy** tyle (dwóch adresatów, pętla sekwencyjna). Dla demo akceptowalne; gdyby przeszkadzało, zmniejsz `SMTP_TIMEOUT_MS` do `"2000"` w `docker-compose.yml` (zmienna jest tam ustawiona jawnie w Kroku 51) — bez zmiany kodu. Kolejkowanie przez istniejący `outbox` to właściwe rozwiązanie docelowe, świadomie poza zakresem M1 j.
6. **Rozjazd kotwic demo w §5 raportu.** Raport KM3 podaje dziś w linii 406 „36 pracowników, 832 zmiany", a brief mówi o 39/1558. Zgłaszam, nie zmieniam — to decyzja właściciela raportu i nie należy do bloku D.
7. **Nazwa pliku adaptera odbiega od tabeli „Pliki" w specyfikacji** (`email.adapter.ts` → `notification.email.adapter.ts`). Świadome, dla spójności prefiksów w katalogu; odnotowane w Ustaleniach #10, żeby recenzent porównujący spec z repo nie zobaczył rozjazdu, o którym nikt nie uprzedził.

**Wycofanie bloku D:**

| Poziom | Działanie | Skutek |
|---|---|---|
| Konfiguracja (bez zmiany kodu, bez redeployu obrazu) | Usuń `SMTP_HOST` z `environment` usługi `tenant-runtime` i zrestartuj: `docker compose --profile full up -d --force-recreate tenant-runtime` | Fabryka wiąże `NoopNotificationChannel`; decyzje o urlopie i zamianie działają identycznie jak przed blokiem D, zero wyjątków, a wpisy `notification.*` w `audit_log` niosą odtąd `channel: "noop"` — widać, że kanał jest wyłączony, a nie że list poszedł |
| Infrastruktura | `docker compose stop mailpit` | Kanał e-mail pada przy każdej wysyłce → `notification.failed` w `audit_log`; **decyzje nadal przechodzą** (kryterium D2, dowód w Kroku 60) |
| Kod | `git revert` commitów z Zadań 1–9 (Kroki 8, 13, 21, 27, 32, 39, 48, 54, 61) | Znikają: katalog `apps/tenant-runtime/src/notifications/`, usługa `mailpit` w compose oraz wpięcia w `leave.service.ts` / `shift-swap.service.ts` i dwa importy modułów |
| Dane | brak | Blok D **nie zmienia `schema.prisma`**, nie tworzy migracji i nie dotyka żadnej istniejącej tabeli. `audit_log` jest append-only i przyrasta o wpisy `notification.*` — te zostają po wycofaniu jako historyczny ślad, co jest zgodne z jego przeznaczeniem |
| Raport | `git revert` commitu z Kroku 67 | §5 wraca do czterech pierwotnych pozycji; ponieważ dopisywaliśmy (12 wstawień, 0 usunięć — sprawdzone w Kroku 64), rewert nie może uszkodzić istniejących deklaracji |
| Rejestr portów | Usuń dwa wiersze i akapit z `WORKSPACE/PORTS.md` ręcznie | Plik leży poza jakimkolwiek repozytorium git, więc nie ma commita do cofnięcia — edycja jest odwracalna wyłącznie ręcznie |

Blok D nie dotyka `apps/tenant-runtime/src/strategic-brain/scoring.util.ts` (dowód liczbowy: Krok 66), nie zmienia danych demo i nie modyfikuje `app.module.ts` — `NotificationsModule` wchodzi do grafu przez `imports` w `LeaveModule` i `ShiftSwapModule`, które `app.module.ts` już importuje (linie 19 i 22).

---

## Blok E — Eksport kalendarza ICS (M1 j, zawężony)

*Zadania globalne 40–49. Kroki numerowane osobno w każdym zadaniu (tak jak w planie źródłowym).*

**Ustalenia zweryfikowane w kodzie** (gałąź `feat/demo-4mobility`, repo `C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2`):

1. **Nie istnieje przejście `APPROVED → CANCELLED`.** `packages/shared/src/leave.ts` definiuje `LEAVE_TRANSITIONS` tak, że `approve`/`reject`/`cancel` są legalne **wyłącznie z `PENDING`**, a `APPROVED`/`REJECTED`/`CANCELLED` należą do `LEAVE_TERMINAL_STATES`. `LeaveService.cancel` (`apps/tenant-runtime/src/leave/leave.service.ts:280`) rzuca `ConflictException('Leave request is not pending')` dla czegokolwiek innego niż `PENDING`.
   **Wariant realny:** kanał zawiera `PENDING` jako `STATUS:TENTATIVE`, `APPROVED` jako `STATUS:CONFIRMED`, a `CANCELLED`/`REJECTED` jako nagrobek `STATUS:CANCELLED` z tym samym `UID` i wyższym `SEQUENCE`. Ścieżka „anuluj → `STATUS:CANCELLED`" jest wtedy sprawdzalna automatycznie (`PENDING → cancel`), a mechanizm jest identyczny dla `APPROVED → CANCELLED`, gdyby domena kiedyś to przejście dopuściła. **Nie zmieniam maszyny stanów.**

2. **Kanał nie może przejść przez BFF.** `apps/web/middleware.ts` ma w `config.matcher` wpis `'/api/:path*'` i zwraca 401 każdemu żądaniu bez `hrobot_token`; klient kalendarza nie ma ciasteczka ani bearera. Dopisanie kanału do `PUBLICZNE_API` (`apps/web/lib/api-gate.ts`) otworzyłoby dziurę pilnowaną przez strażnika parytetu (`apps/web/lib/api-gate.test.ts`).
   **Wariant realny:** kanał wystawia **bezpośrednio tenant-runtime**. `docker-compose.override.yml` publikuje `3001:3001` (potwierdzone `docker compose -p hrobot ps`), a `apps/tenant-runtime/src/main.ts:25` ustawia `setGlobalPrefix('api')`, więc adres kanału to `http://localhost:3001/api/kalendarz/feed/<token>/kalendarz.ics`. BFF proxuje wyłącznie trasy uwierzytelnione sesją.

3. **Subskrypcja z chmury Google/Microsoft nie jest sprawdzalna na demie lokalnym** — serwer Google musi dosięgnąć adresu kanału, a `http://localhost:3001` z chmury nie jest osiągalny. To trafia do raportu, nie do demonstracji.

4. **Rozjazd kotwic demo.** `docs/raport-km3/Raport_KM3_HRobot.md:406` (i `:227`) mówi „36 pracowników, 832 zmiany", brief mówi 39/1558. Blok E tych linii nie dotyka — sygnalizuję integratorowi.

5. **Blok E dodaje 18. trasę pod `apps/web/app/api/`.** Dziś jest ich dokładnie 17 (`find apps/web/app/api -name route.ts | wc -l` → 17). Strażnik `apps/web/lib/api-gate.test.ts` asertuje `>= 17`, więc się nie zapali, ale kryterium akceptacji **A-2** ze specu („każda z 17 tras BFF") wymaga aktualizacji po stronie bloku A.

Ponadto: `compositeScore` (`apps/tenant-runtime/src/strategic-brain/scoring.util.ts:100`) nie jest importowany przez żaden plik tego bloku; blok E nie tworzy migracji i nie pisze do bazy (same `GET`), a `AuditInterceptor` no-opuje na metodach spoza `POST/PATCH/PUT/DELETE` (`audit.interceptor.ts`, stała `MUTATING`).

**Powłoki.** Komendy `npx` uruchamiam z katalogu pakietu, zgodnie z briefem (`cd apps/tenant-runtime; npx jest src/<modul>`). Komendy z potokami i `curl` uruchamiam w **Bash (Git Bash)**; przy komendach, gdzie ma to znaczenie, podaję to wprost.

---

### Zadanie 40 (E-1): Generator ICS zgodny z RFC 5545 (funkcja czysta)

**Pliki:** utwórz `apps/tenant-runtime/src/kalendarz/ics.util.ts` i `apps/tenant-runtime/src/kalendarz/ics.util.spec.ts`.

- [ ] **Krok 1: Napisz czerwony test prymitywów RFC 5545.** Utwórz `apps/tenant-runtime/src/kalendarz/ics.util.spec.ts`:

```ts
import { escapeIcsText, foldIcsLine, formatIcsDate, formatIcsTimestamp } from './ics.util.js'

describe('ics.util — prymitywy RFC 5545', () => {
  it('formatIcsDate zwraca YYYYMMDD w UTC (kolumna @db.Date to północ UTC)', () => {
    expect(formatIcsDate(new Date('2026-08-03T00:00:00.000Z'))).toBe('20260803')
    expect(formatIcsDate(new Date('2026-12-31T00:00:00.000Z'))).toBe('20261231')
  })

  it('formatIcsTimestamp zwraca YYYYMMDDTHHMMSSZ (§3.3.5, forma UTC)', () => {
    expect(formatIcsTimestamp(new Date('2026-08-12T09:07:05.000Z'))).toBe('20260812T090705Z')
  })

  it('escapeIcsText chroni backslash, średnik, przecinek i nową linię (§3.3.11)', () => {
    expect(escapeIcsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })

  it('foldIcsLine nie rusza wiersza mieszczącego się w 75 oktetach', () => {
    const krotki = 'SUMMARY:Urlop'
    expect(foldIcsLine(krotki)).toBe(krotki)
  })

  it('foldIcsLine zwija po 75 oktetach, kontynuacja zaczyna się od pojedynczej spacji (§3.1)', () => {
    const dlugi = `X-TEST:${'a'.repeat(200)}`
    const wiersze = foldIcsLine(dlugi).split('\r\n')
    expect(wiersze.length).toBeGreaterThan(1)
    expect(Buffer.byteLength(wiersze[0]!, 'utf8')).toBe(75)
    for (const w of wiersze.slice(1)) {
      expect(w.startsWith(' ')).toBe(true)
      expect(Buffer.byteLength(w, 'utf8')).toBeLessThanOrEqual(75)
    }
    expect(wiersze.map((w, i) => (i === 0 ? w : w.slice(1))).join('')).toBe(dlugi)
  })

  it('foldIcsLine nie tnie w środku wielobajtowego znaku UTF-8 (polskie znaki)', () => {
    const dlugi = `X-TEST:${'ą'.repeat(120)}`
    const zlozony = foldIcsLine(dlugi)
      .split('\r\n')
      .map((w, i) => (i === 0 ? w : w.slice(1)))
      .join('')
    expect(zlozony).toBe(dlugi)
    expect(zlozony).not.toContain('\uFFFD')
  })
})
```

- [ ] **Krok 2: Uruchom test i zobacz, że pada z braku modułu.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/ics.util.spec.ts
```

Oczekiwane wyjście (zmierzony format ts-jest w tym repo):
`TS2307: Cannot find module './ics.util.js' or its corresponding type declarations.`

- [ ] **Krok 3: Napisz prymitywy w `apps/tenant-runtime/src/kalendarz/ics.util.ts`.**

```ts
/**
 * Generator pliku iCalendar (RFC 5545) dla urlopów. Funkcja czysta: żadnego Nesta, żadnej Prismy,
 * żadnego zegara systemowego — `now` wchodzi argumentem, żeby test mógł przypiąć DTSTAMP.
 *
 * ZERO PII (wymóg dok. j) §7): jedyny tekst, jaki trafia do pliku, to stała {@link ICS_EVENT_SUMMARY}
 * i identyfikator wniosku w UID. Ani imienia, ani nazwiska, ani rodzaju urlopu, ani uzasadnienia —
 * typ wniosku (`URLOP_WYPOCZYNKOWY` vs `ZWOLNIENIE_LEKARSKIE`) jest daną o zdrowiu i celowo NIE
 * wychodzi do kalendarza.
 */

/** Neutralny tytuł zdarzenia. Stała, nie parametr — parametr zaprosiłby PII z powrotem. */
export const ICS_EVENT_SUMMARY = 'Urlop'

/** Wartości STATUS dopuszczone przez RFC 5545 §3.8.1.11 dla komponentu VEVENT. */
export type IcsEventStatus = 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED'

const CRLF = '\r\n'
/** RFC 5545 §3.1: wiersz nie może przekroczyć 75 OKTETÓW (nie znaków) plus CRLF. */
const MAX_LINE_OCTETS = 75

/** `YYYYMMDD` w UTC — kolumny `startDate`/`endDate` są `@db.Date`, czyli północ UTC. */
export function formatIcsDate(d: Date): string {
  const rok = String(d.getUTCFullYear()).padStart(4, '0')
  const miesiac = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dzien = String(d.getUTCDate()).padStart(2, '0')
  return `${rok}${miesiac}${dzien}`
}

/** `YYYYMMDDTHHMMSSZ` — forma UTC DATE-TIME z RFC 5545 §3.3.5. */
export function formatIcsTimestamp(d: Date): string {
  const g = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return `${formatIcsDate(d)}T${g}${m}${s}Z`
}

/** Ucieczka znaków dla wartości TEXT (RFC 5545 §3.3.11). Kolejność ma znaczenie: backslash pierwszy. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Zwijanie wiersza (RFC 5545 §3.1). Liczymy OKTETY, nie znaki, i nigdy nie tniemy w środku
 * wielobajtowej sekwencji UTF-8 — inaczej polski znak rozpadłby się na dwa uszkodzone bajty po obu
 * stronach złamania. Pierwszy wiersz mieści 75 oktetów, każdy kolejny 74 (jeden oktet zjada wiodąca
 * spacja kontynuacji).
 */
export function foldIcsLine(line: string): string {
  const bajty = Buffer.from(line, 'utf8')
  if (bajty.length <= MAX_LINE_OCTETS) return line

  const czesci: string[] = []
  let offset = 0
  let limit = MAX_LINE_OCTETS
  while (offset < bajty.length) {
    let ile = Math.min(limit, bajty.length - offset)
    // Cofnij się do początku sekwencji UTF-8: 0b10xxxxxx to bajt kontynuacji.
    while (
      ile > 0 &&
      offset + ile < bajty.length &&
      (bajty[offset + ile]! & 0b1100_0000) === 0b1000_0000
    ) {
      ile -= 1
    }
    czesci.push(bajty.subarray(offset, offset + ile).toString('utf8'))
    offset += ile
    limit = MAX_LINE_OCTETS - 1
  }
  return czesci.join(`${CRLF} `)
}
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/ics.util.spec.ts
```

Oczekiwane wyjście: `Tests:       6 passed, 6 total`.

- [ ] **Krok 5: Dopisz czerwony test budowy całego VCALENDAR.** W `ics.util.spec.ts` zamień pierwszą linię pliku na linię z pełnym importem, a na końcu pliku dopisz drugi blok `describe`.

Nowa pierwsza linia:

```ts
import {
  buildLeaveCalendar,
  escapeIcsText,
  foldIcsLine,
  formatIcsDate,
  formatIcsTimestamp,
  icsLeaveUid,
  type IcsLeaveEvent,
} from './ics.util.js'
```

Na końcu pliku:

```ts
const now = new Date('2026-08-12T09:07:05.000Z')

const zdarzenie = (over: Partial<IcsLeaveEvent> = {}): IcsLeaveEvent => ({
  uid: icsLeaveUid('11111111-1111-4111-8111-111111111111'),
  startDate: new Date('2026-08-03T00:00:00.000Z'),
  endDate: new Date('2026-08-07T00:00:00.000Z'),
  status: 'CONFIRMED',
  sequence: 1,
  lastModified: new Date('2026-08-01T12:00:00.000Z'),
  ...over,
})

describe('ics.util — buildLeaveCalendar', () => {
  it('opakowuje zdarzenia w VCALENDAR z VERSION/PRODID i kończy plik CRLF', () => {
    const ics = buildLeaveCalendar([zdarzenie()], now)
    const wiersze = ics.split('\r\n')
    expect(wiersze[0]).toBe('BEGIN:VCALENDAR')
    expect(wiersze).toContain('VERSION:2.0')
    expect(wiersze).toContain('PRODID:-//HRobot//Eksport ICS//PL')
    expect(wiersze).toContain('END:VCALENDAR')
    expect(ics.endsWith('\r\n')).toBe(true)
  })

  it('DTEND jest EKSKLUZYWNY: ostatni dzień urlopu + 1 (§3.6.1, wartość DATE)', () => {
    const wiersze = buildLeaveCalendar([zdarzenie()], now).split('\r\n')
    expect(wiersze).toContain('DTSTART;VALUE=DATE:20260803')
    expect(wiersze).toContain('DTEND;VALUE=DATE:20260808')
  })

  it('urlop jednodniowy ma DTEND równy dniu następnemu', () => {
    const jeden = zdarzenie({
      startDate: new Date('2026-08-03T00:00:00.000Z'),
      endDate: new Date('2026-08-03T00:00:00.000Z'),
    })
    const wiersze = buildLeaveCalendar([jeden], now).split('\r\n')
    expect(wiersze).toContain('DTSTART;VALUE=DATE:20260803')
    expect(wiersze).toContain('DTEND;VALUE=DATE:20260804')
  })

  it('tytuł jest neutralny i identyczny dla każdego zdarzenia — zero PII', () => {
    const ics = buildLeaveCalendar([zdarzenie(), zdarzenie({ status: 'CANCELLED', sequence: 2 })], now)
    const summary = ics.split('\r\n').filter((w) => w.startsWith('SUMMARY'))
    expect(summary).toEqual(['SUMMARY:Urlop', 'SUMMARY:Urlop'])
  })

  it('UID jest deterministyczny z id wniosku — nagrobek trafia w to samo zdarzenie', () => {
    expect(icsLeaveUid('abc')).toBe('urlop-abc@hrobot.local')
    const potwierdzony = buildLeaveCalendar([zdarzenie()], now)
    const anulowany = buildLeaveCalendar([zdarzenie({ status: 'CANCELLED', sequence: 2 })], now)
    const uid = (t: string) => t.split('\r\n').filter((w) => w.startsWith('UID:'))
    expect(uid(potwierdzony)).toEqual(uid(anulowany))
    expect(anulowany.split('\r\n')).toContain('STATUS:CANCELLED')
    expect(anulowany.split('\r\n')).toContain('SEQUENCE:2')
  })

  it('pusty kalendarz to poprawny VCALENDAR bez żadnego VEVENT', () => {
    const wiersze = buildLeaveCalendar([], now).split('\r\n')
    expect(wiersze).not.toContain('BEGIN:VEVENT')
    expect(wiersze[0]).toBe('BEGIN:VCALENDAR')
  })
})
```

- [ ] **Krok 6: Uruchom i zobacz, że pada na braku eksportu.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/ics.util.spec.ts
```

Oczekiwane wyjście: `TS2305: Module '"./ics.util.js"' has no exported member 'buildLeaveCalendar'.`

- [ ] **Krok 7: Dopisz budowę kalendarza na końcu `ics.util.ts`.**

```ts
/** Jedno zdarzenie kalendarza — projekcja wniosku urlopowego pozbawiona wszystkiego poza datami. */
export interface IcsLeaveEvent {
  uid: string
  /** Pierwszy dzień urlopu, włącznie. */
  startDate: Date
  /** Ostatni dzień urlopu, WŁĄCZNIE. DTEND liczymy z niego jako dzień następny. */
  endDate: Date
  status: IcsEventStatus
  /** RFC 5545 §3.8.7.4 — musi rosnąć przy każdej zmianie, inaczej klient zignoruje aktualizację. */
  sequence: number
  lastModified: Date
}

/**
 * Deterministyczny UID zdarzenia. Wyprowadzony wyłącznie z id wniosku, więc ten sam wniosek ma ten
 * sam UID przez całe życie — to jedyny powód, dla którego nagrobek `STATUS:CANCELLED` trafia w to
 * zdarzenie, które klient już ma, zamiast tworzyć drugie.
 */
export function icsLeaveUid(leaveId: string): string {
  return `urlop-${leaveId}@hrobot.local`
}

/** Dzień następny w UTC — DTEND zdarzenia całodniowego jest EKSKLUZYWNY (RFC 5545 §3.6.1). */
function nextDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
}

/** Buduje kompletny obiekt VCALENDAR. `now` wchodzi argumentem, żeby DTSTAMP dało się przypiąć w teście. */
export function buildLeaveCalendar(events: readonly IcsLeaveEvent[], now: Date): string {
  const dtstamp = formatIcsTimestamp(now)
  const wiersze: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HRobot//Eksport ICS//PL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText('Urlopy (eksport ICS)')}`,
  ]
  for (const e of events) {
    wiersze.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(e.uid)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${formatIcsDate(e.startDate)}`,
      `DTEND;VALUE=DATE:${formatIcsDate(nextDayUtc(e.endDate))}`,
      `SUMMARY:${escapeIcsText(ICS_EVENT_SUMMARY)}`,
      `STATUS:${e.status}`,
      `SEQUENCE:${e.sequence}`,
      'TRANSP:OPAQUE',
      `LAST-MODIFIED:${formatIcsTimestamp(e.lastModified)}`,
      'END:VEVENT',
    )
  }
  wiersze.push('END:VCALENDAR')
  return wiersze.map(foldIcsLine).join(CRLF) + CRLF
}
```

- [ ] **Krok 8: Uruchom test i zobacz zielone.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/ics.util.spec.ts
```

Oczekiwane wyjście: `Tests:       12 passed, 12 total`.

- [ ] **Krok 9: Commit.**

```
git add apps/tenant-runtime/src/kalendarz/ics.util.ts apps/tenant-runtime/src/kalendarz/ics.util.spec.ts
git commit -m "feat(kalendarz): generator ICS zgodny z RFC 5545, zero PII w zdarzeniu"
```

---

### Zadanie 41 (E-2): Walidator strukturalny RFC 5545 (kryterium akceptacji E-1)

**Pliki:** utwórz `apps/tenant-runtime/src/kalendarz/ics-rfc5545.validator.ts` i `ics-rfc5545.validator.spec.ts`.

Kryterium „plik przechodzi walidację RFC 5545" musi mieć wykonywalne znaczenie. Nie dokładam zależności npm — walidator jest w repo, wymienia z nazwy klauzule, które sprawdza, i jest używany zarówno w testach jednostkowych, jak i w teście serwisu.

- [ ] **Krok 1: Napisz czerwony test walidatora.** Utwórz `apps/tenant-runtime/src/kalendarz/ics-rfc5545.validator.spec.ts`:

```ts
import { validateIcs } from './ics-rfc5545.validator.js'
import { buildLeaveCalendar, icsLeaveUid } from './ics.util.js'

const now = new Date('2026-08-12T09:07:05.000Z')

const poprawny = buildLeaveCalendar(
  [
    {
      uid: icsLeaveUid('11111111-1111-4111-8111-111111111111'),
      startDate: new Date('2026-08-03T00:00:00.000Z'),
      endDate: new Date('2026-08-07T00:00:00.000Z'),
      status: 'CONFIRMED',
      sequence: 1,
      lastModified: new Date('2026-08-01T12:00:00.000Z'),
    },
  ],
  now,
)

describe('ics-rfc5545.validator', () => {
  it('wyjście buildLeaveCalendar nie ma ani jednego naruszenia', () => {
    expect(validateIcs(poprawny)).toEqual([])
  })

  it('wykrywa zakończenia wierszy inne niż CRLF (§3.1)', () => {
    expect(validateIcs(poprawny.replace(/\r\n/g, '\n'))).toContainEqual(
      expect.stringContaining('§3.1'),
    )
  })

  it('wykrywa brak VERSION:2.0 (§3.7.4)', () => {
    expect(validateIcs(poprawny.replace('VERSION:2.0\r\n', ''))).toContainEqual(
      expect.stringContaining('§3.7.4'),
    )
  })

  it('wykrywa VEVENT bez UID (§3.6.1)', () => {
    expect(validateIcs(poprawny.replace(/UID:[^\r]*\r\n/, ''))).toContainEqual(
      expect.stringContaining('UID'),
    )
  })

  it('wykrywa niedomknięty BEGIN:VEVENT (§3.6.1)', () => {
    expect(validateIcs(poprawny.replace('END:VEVENT\r\n', ''))).toContainEqual(
      expect.stringContaining('END:VEVENT'),
    )
  })

  it('wykrywa wiersz dłuższy niż 75 oktetów (§3.1)', () => {
    const zly = poprawny.replace('BEGIN:VEVENT\r\n', `X-DLUGI:${'a'.repeat(200)}\r\nBEGIN:VEVENT\r\n`)
    expect(validateIcs(zly)).toContainEqual(expect.stringContaining('oktet'))
  })

  it('wykrywa pierwszy wiersz inny niż BEGIN:VCALENDAR (§3.4)', () => {
    expect(validateIcs(`X-SMIEC:1\r\n${poprawny}`)).toContainEqual(expect.stringContaining('§3.4'))
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz, że pada z braku modułu.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/ics-rfc5545.validator.spec.ts
```

Oczekiwane wyjście: `TS2307: Cannot find module './ics-rfc5545.validator.js' or its corresponding type declarations.`

- [ ] **Krok 3: Napisz walidator w `apps/tenant-runtime/src/kalendarz/ics-rfc5545.validator.ts`.**

```ts
/**
 * Walidator strukturalny RFC 5545 dla wyjścia `buildLeaveCalendar`. Nie jest pełnym parserem
 * iCalendara i nie udaje nim być — sprawdza dokładnie te klauzule, na które kryterium akceptacji E-1
 * się powołuje, i każde naruszenie nazywa numerem klauzuli. Świadomie w repo, a nie jako zależność
 * npm: pakiet, którego nikt nie audytował, byłby gorszym dowodem niż siedem sprawdzeń, które da się
 * przeczytać.
 */

const MAX_LINE_OCTETS = 75
const WYMAGANE_W_VEVENT = ['UID', 'DTSTAMP', 'DTSTART'] as const

/** Lista naruszeń. Pusta = plik przechodzi walidację. */
export function validateIcs(text: string): string[] {
  const bledy: string[] = []

  if (/(?<!\r)\n/.test(text) || /\r(?!\n)/.test(text)) {
    bledy.push('RFC 5545 §3.1: każdy wiersz musi kończyć się sekwencją CRLF')
  }
  if (!text.endsWith('\r\n')) {
    bledy.push('RFC 5545 §3.1: plik musi kończyć się sekwencją CRLF')
  }

  const surowe = text.split('\r\n')
  while (surowe.length > 0 && surowe[surowe.length - 1] === '') surowe.pop()

  surowe.forEach((w, i) => {
    const oktety = Buffer.byteLength(w, 'utf8')
    if (oktety > MAX_LINE_OCTETS) {
      bledy.push(
        `RFC 5545 §3.1: wiersz ${i + 1} ma ${oktety} oktetów (limit ${MAX_LINE_OCTETS}, brak zwijania)`,
      )
    }
  })

  // Rozwiń zwinięte wiersze: kontynuacja zaczyna się od pojedynczej spacji.
  const logiczne: string[] = []
  for (const w of surowe) {
    if (w.startsWith(' ') && logiczne.length > 0) logiczne[logiczne.length - 1] += w.slice(1)
    else logiczne.push(w)
  }

  if (logiczne[0] !== 'BEGIN:VCALENDAR') {
    bledy.push('RFC 5545 §3.4: pierwszym wierszem musi być BEGIN:VCALENDAR')
  }
  if (logiczne[logiczne.length - 1] !== 'END:VCALENDAR') {
    bledy.push('RFC 5545 §3.4: ostatnim wierszem musi być END:VCALENDAR')
  }
  if (!logiczne.includes('VERSION:2.0')) {
    bledy.push('RFC 5545 §3.7.4: brak obowiązkowej własności VERSION:2.0')
  }
  if (!logiczne.some((w) => w.startsWith('PRODID:'))) {
    bledy.push('RFC 5545 §3.7.3: brak obowiązkowej własności PRODID')
  }

  let wZdarzeniu = false
  let nazwy: string[] = []
  for (const w of logiczne) {
    if (w === 'BEGIN:VEVENT') {
      if (wZdarzeniu) bledy.push('RFC 5545 §3.6.1: zagnieżdżony BEGIN:VEVENT')
      wZdarzeniu = true
      nazwy = []
      continue
    }
    if (w === 'END:VEVENT') {
      if (!wZdarzeniu) {
        bledy.push('RFC 5545 §3.6.1: END:VEVENT bez odpowiadającego BEGIN:VEVENT')
        continue
      }
      for (const wymagana of WYMAGANE_W_VEVENT) {
        if (!nazwy.includes(wymagana)) {
          bledy.push(`RFC 5545 §3.6.1: VEVENT bez obowiązkowej własności ${wymagana}`)
        }
      }
      wZdarzeniu = false
      continue
    }
    if (wZdarzeniu) {
      const dwukropek = w.indexOf(':')
      const zParametrami = dwukropek > 0 ? w.slice(0, dwukropek) : w
      nazwy.push(zParametrami.split(';')[0]!)
    }
  }
  if (wZdarzeniu) bledy.push('RFC 5545 §3.6.1: BEGIN:VEVENT bez END:VEVENT')

  return bledy
}
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/ics-rfc5545.validator.spec.ts
```

Oczekiwane wyjście: `Tests:       7 passed, 7 total`.

- [ ] **Krok 5: Weryfikacja negatywna — cofnij poprawkę CRLF.** W `ics.util.ts`, w ostatniej linii `buildLeaveCalendar`, zamień `.join(CRLF) + CRLF` na `.join('\n') + '\n'` i uruchom:

```
cd apps/tenant-runtime
npx jest src/kalendarz
```

Oczekiwane wyjście zawiera `RFC 5545 §3.1: każdy wiersz musi kończyć się sekwencją CRLF` oraz `Test Suites: 2 failed, 2 total`.

- [ ] **Krok 6: Przywróć poprawkę i potwierdź zielone.** Wróć do `.join(CRLF) + CRLF` i uruchom:

```
cd apps/tenant-runtime
npx jest src/kalendarz
```

Oczekiwane wyjście: `Tests:       19 passed, 19 total`.

- [ ] **Krok 7: Commit.**

```
git add apps/tenant-runtime/src/kalendarz/ics-rfc5545.validator.ts apps/tenant-runtime/src/kalendarz/ics-rfc5545.validator.spec.ts
git commit -m "test(kalendarz): walidator strukturalny RFC 5545 dla eksportu ICS"
```

---

### Zadanie 42 (E-3): Token subskrypcji (HMAC, bezstanowy — bez migracji)

**Pliki:** utwórz `apps/tenant-runtime/src/kalendarz/feed-token.util.ts` i `feed-token.util.spec.ts`.

Kanał musi się uwierzytelnić bez sesji i bez ciasteczka. Token jest **wyprowadzony**, nie przechowywany — dzięki temu blok E nie tworzy migracji i wycofuje się przez skasowanie plików, zgodnie z planem wycofania ze specu („E | usunięcie trasy; brak zmian w danych").

- [ ] **Krok 1: Napisz czerwony test tokenu.** Utwórz `apps/tenant-runtime/src/kalendarz/feed-token.util.spec.ts`:

```ts
import { buildFeedToken, parseFeedToken, type FeedTokenPayload } from './feed-token.util.js'

const secret = 'a'.repeat(48)
const payload: FeedTokenPayload = {
  tenantSlug: '4mobility',
  employeeId: '11111111-1111-4111-8111-111111111111',
}

describe('feed-token.util', () => {
  it('token jest deterministyczny dla tego samego sekretu i ładunku', () => {
    expect(buildFeedToken(secret, payload)).toBe(buildFeedToken(secret, payload))
  })

  it('parseFeedToken odtwarza slug i employeeId z własnego tokenu', () => {
    expect(parseFeedToken(secret, buildFeedToken(secret, payload))).toEqual(payload)
  })

  it('odrzuca token podpisany innym sekretem', () => {
    expect(parseFeedToken(secret, buildFeedToken('b'.repeat(48), payload))).toBeNull()
  })

  it('odrzuca token z podmienionym employeeId (podpis obejmuje ładunek)', () => {
    const [slug, , sig] = buildFeedToken(secret, payload).split('.')
    const podmieniony = [slug, '22222222-2222-4222-8222-222222222222', sig].join('.')
    expect(parseFeedToken(secret, podmieniony)).toBeNull()
  })

  it('odrzuca token z podmienionym slugiem najemcy (izolacja najemców)', () => {
    const [, emp, sig] = buildFeedToken(secret, payload).split('.')
    expect(parseFeedToken(secret, ['inny-najemca', emp, sig].join('.'))).toBeNull()
  })

  it('odrzuca token o złej liczbie segmentów, pusty i z pustym segmentem', () => {
    expect(parseFeedToken(secret, '')).toBeNull()
    expect(parseFeedToken(secret, 'a.b')).toBeNull()
    expect(parseFeedToken(secret, 'a.b.c.d')).toBeNull()
    expect(parseFeedToken(secret, `.${payload.employeeId}.x`)).toBeNull()
  })

  it('token ma trzy segmenty, a podpis jest czystym base64url (brak kropki w alfabecie)', () => {
    const segmenty = buildFeedToken(secret, payload).split('.')
    expect(segmenty).toHaveLength(3)
    expect(segmenty[2]).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz, że pada z braku modułu.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/feed-token.util.spec.ts
```

Oczekiwane wyjście: `TS2307: Cannot find module './feed-token.util.js' or its corresponding type declarations.`

- [ ] **Krok 3: Napisz `apps/tenant-runtime/src/kalendarz/feed-token.util.ts`.**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Token subskrypcji kanału ICS. BEZSTANOWY z rozmysłem: klient kalendarza odpytuje adres bez
 * ciasteczka i bez bearera, a blok E nie ma prawa dotknąć schematu bazy (plan wycofania: „usunięcie
 * trasy; brak zmian w danych"). Token niesie więc swój ładunek jawnie i jest opieczętowany
 * HMAC-SHA256 sekretem serwera.
 *
 * KONSEKWENCJA, KTÓRĄ TRZEBA ZGŁOSIĆ, A NIE UKRYĆ: skoro nie ma tabeli tokenów, nie ma też
 * unieważnienia pojedynczej subskrypcji — cofnięcie dostępu to rotacja `ICS_FEED_SECRET`, która
 * unieważnia wszystkie kanały naraz. Zapisane w §5 raportu KM3 (zadanie 10).
 *
 * Separator `.` jest bezpieczny: slug najemcy pasuje do `[a-z0-9][a-z0-9-]{1,28}[a-z0-9]` (regex
 * `isTrustedIssuer` w keycloak-jwt.strategy.ts:91), employeeId to UUID, a podpis jest base64url —
 * żaden z trzech alfabetów nie zawiera kropki.
 */

export interface FeedTokenPayload {
  tenantSlug: string
  employeeId: string
}

const SEPARATOR = '.'

function signature(secret: string, payload: FeedTokenPayload): string {
  return createHmac('sha256', secret)
    .update(`${payload.tenantSlug}:${payload.employeeId}`)
    .digest('base64url')
}

/** `<slug>.<employeeId>.<podpis base64url>` */
export function buildFeedToken(secret: string, payload: FeedTokenPayload): string {
  return [payload.tenantSlug, payload.employeeId, signature(secret, payload)].join(SEPARATOR)
}

/** Ładunek tokenu, albo `null` gdy token jest zniekształcony lub podpis się nie zgadza. */
export function parseFeedToken(secret: string, token: string): FeedTokenPayload | null {
  const segmenty = token.split(SEPARATOR)
  if (segmenty.length !== 3) return null
  const [tenantSlug, employeeId, podpis] = segmenty as [string, string, string]
  if (tenantSlug === '' || employeeId === '' || podpis === '') return null

  const oczekiwany = signature(secret, { tenantSlug, employeeId })
  const a = Buffer.from(podpis, 'utf8')
  const b = Buffer.from(oczekiwany, 'utf8')
  // timingSafeEqual rzuca przy różnych długościach, więc długość sprawdzamy najpierw. Sama różnica
  // długości nie zdradza nic o sekrecie — podpis HMAC-SHA256 ma zawsze 43 znaki base64url.
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null

  return { tenantSlug, employeeId }
}
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/feed-token.util.spec.ts
```

Oczekiwane wyjście: `Tests:       7 passed, 7 total`.

- [ ] **Krok 5: Weryfikacja negatywna — wyjmij employeeId spod podpisu.** W `feed-token.util.ts`, w funkcji `signature`, zamień `.update(\`${payload.tenantSlug}:${payload.employeeId}\`)` na `.update(payload.tenantSlug)` i uruchom:

```
cd apps/tenant-runtime
npx jest src/kalendarz/feed-token.util.spec.ts
```

Oczekiwane wyjście: `Tests:       1 failed, 6 passed, 7 total`, a czerwony test to `odrzuca token z podmienionym employeeId (podpis obejmuje ładunek)`.

- [ ] **Krok 6: Przywróć podpis nad pełnym ładunkiem i potwierdź zielone.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/feed-token.util.spec.ts
```

Oczekiwane wyjście: `Tests:       7 passed, 7 total`.

- [ ] **Krok 7: Commit.**

```
git add apps/tenant-runtime/src/kalendarz/feed-token.util.ts apps/tenant-runtime/src/kalendarz/feed-token.util.spec.ts
git commit -m "feat(kalendarz): bezstanowy token subskrypcji ICS (HMAC-SHA256)"
```

---

### Zadanie 43 (E-4): Konfiguracja `ICS_FEED_SECRET` (fail-closed, bez psucia startu)

**Pliki:** zmień `packages/config/src/env.ts`, `packages/config/src/index.ts`, `packages/config/src/env.test.ts`, `.env.example`, `docker-compose.yml`; utwórz `apps/tenant-runtime/src/kalendarz/kalendarz.config.ts`.

Nowa zmienna **nie może** być wymagana w `envSchema` jako obowiązkowa: `parseEnv()` jest wołane w czasie żądania (`keycloak-jwt.strategy.ts:52`) i rzuca przy pierwszym braku, więc obowiązkowe `ICS_FEED_SECRET` położyłoby całą aplikację przed KM3. Brak sekretu = eksport ICS wyłączony, nie eksport ICS bez ochrony.

- [ ] **Krok 1: Napisz czerwony test czytnika sekretu.** W `packages/config/src/env.test.ts` zamień pierwszą linię `import { parseEnv } from './env.js'` na `import { parseEnv, readIcsFeedSecret } from './env.js'`, a na końcu pliku dopisz:

```ts
describe('readIcsFeedSecret', () => {
  it('zwraca null, gdy zmiennej nie ma — eksport ICS jest wtedy wyłączony (fail-closed)', () => {
    expect(readIcsFeedSecret({})).toBeNull()
  })

  it('zwraca null dla wartości pustej lub samych spacji', () => {
    expect(readIcsFeedSecret({ ICS_FEED_SECRET: '' })).toBeNull()
    expect(readIcsFeedSecret({ ICS_FEED_SECRET: '   ' })).toBeNull()
  })

  it('rzuca dla sekretu krótszego niż 32 znaki — słaby sekret jest gorszy niż brak', () => {
    expect(() => readIcsFeedSecret({ ICS_FEED_SECRET: 'za-krotki' })).toThrow(/at least 32 characters/)
  })

  it('zwraca sekret o poprawnej długości', () => {
    const s = 'x'.repeat(48)
    expect(readIcsFeedSecret({ ICS_FEED_SECRET: s })).toBe(s)
  })

  it('nie wymaga poprawności całego środowiska — czyta tylko swoją zmienną', () => {
    expect(readIcsFeedSecret({ ICS_FEED_SECRET: 'y'.repeat(32), KEYCLOAK_URL: 'to-nie-url' })).toBe(
      'y'.repeat(32),
    )
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz, że pada z braku eksportu.**

```
cd packages/config
npx jest src/env.test.ts
```

Oczekiwane wyjście: `TS2305: Module '"./env.js"' has no exported member 'readIcsFeedSecret'.`

- [ ] **Krok 3: Dodaj schemat sekretu w `packages/config/src/env.ts` (przed `envSchema`).** Znajdź linię `export const envSchema = z.object({` i wstaw **bezpośrednio nad nią**:

```ts
/** Reguła długości sekretu kanału ICS — jedno źródło prawdy dla schematu i dla czytnika. */
export const icsFeedSecretSchema = z
  .string()
  .min(32, 'ICS_FEED_SECRET must be at least 32 characters')

```

- [ ] **Krok 4: Dodaj dwa pola do `envSchema`.** W tym samym pliku zamień blok:

```ts
  GLOBAL_ADMIN_JWT_SECRET: z
    .string()
    .min(32, 'GLOBAL_ADMIN_JWT_SECRET must be at least 32 characters'),
})
```

na:

```ts
  GLOBAL_ADMIN_JWT_SECRET: z
    .string()
    .min(32, 'GLOBAL_ADMIN_JWT_SECRET must be at least 32 characters'),
  /**
   * Sekret podpisujący token subskrypcji kanału ICS (blok E, M1 j — eksport ICS, NIE integracja
   * OAuth z Google/MS). OPCJONALNY z rozmysłem: `parseEnv()` bywa wołane w czasie żądania
   * (keycloak-jwt.strategy.ts:52), więc nowe pole obowiązkowe położyłoby działającą instalację.
   * Brak wartości = eksport ICS wyłączony. Wygeneruj: `openssl rand -base64 48`.
   */
  ICS_FEED_SECRET: icsFeedSecretSchema.optional(),
  /** Publiczna baza adresu tenant-runtime, pod którą klient kalendarza sięga po kanał ICS. */
  ICS_FEED_PUBLIC_BASE_URL: z.string().url().optional(),
})
```

- [ ] **Krok 5: Dodaj czytnik na końcu `packages/config/src/env.ts`.**

```ts
/**
 * Sekret kanału ICS albo `null`, gdy nie skonfigurowano. Osobny czytnik zamiast
 * `parseEnv().ICS_FEED_SECRET`, bo ten wymagałby POPRAWNEGO CAŁEGO środowiska — a testy jednostkowe
 * modułu kalendarza nie mają ani Postgresa, ani Keycloaka w `process.env`. Zbyt krótki sekret RZUCA:
 * cicha akceptacja słabego sekretu byłaby gorsza niż wyłączony eksport. Wywołanie z fabryki
 * providera (kalendarz.config.ts) oznacza, że błąd wychodzi przy STARCIE kontenera, nie przy
 * żądaniu — świadomy kompromis, zapisany w „Ryzykach".
 */
export function readIcsFeedSecret(
  source: Record<string, string | undefined> = process.env,
): string | null {
  const raw = source['ICS_FEED_SECRET']
  if (raw == null || raw.trim() === '') return null
  const parsed = icsFeedSecretSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid ICS_FEED_SECRET: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  }
  return parsed.data
}
```

- [ ] **Krok 6: Wyeksportuj czytnik.** W `packages/config/src/index.ts` zamień pierwszą linię na:

```ts
export { envSchema, parseEnv, icsFeedSecretSchema, readIcsFeedSecret } from './env.js'
```

- [ ] **Krok 7: Uruchom test i zobacz zielone.**

```
cd packages/config
npx jest src/env.test.ts
```

Oczekiwane wyjście: `Tests:       11 passed, 11 total` (6 dotychczasowych testów `parseEnv` + 5 nowych `readIcsFeedSecret`; jeśli liczba dotychczasowych jest inna, zgadza się suma: dotychczasowa + 5).

- [ ] **Krok 8: Przebuduj `@hrobot/config` — bez tego tenant-runtime NIE ZOBACZY nowej nazwy.** `apps/tenant-runtime` rozwiązuje `@hrobot/config` przez `packages/config/dist/index.d.ts` (pole `types` w package.json), a nie przez źródła; mapowanie na `src` istnieje tylko w `jest.config.cjs`.

```
pnpm --filter @hrobot/config build
```

Oczekiwane wyjście: brak błędów (kod wyjścia 0). Sprawdzenie:

```
grep readIcsFeedSecret packages/config/dist/index.d.ts
```

Oczekiwane wyjście: `export { envSchema, parseEnv, icsFeedSecretSchema, readIcsFeedSecret } from './env.js';`

- [ ] **Krok 9: Dodaj dostawcę konfiguracji modułu.** Utwórz `apps/tenant-runtime/src/kalendarz/kalendarz.config.ts`:

```ts
import type { Provider } from '@nestjs/common'
import { readIcsFeedSecret } from '@hrobot/config'

export const KALENDARZ_CONFIG = 'KALENDARZ_CONFIG'

export interface KalendarzConfig {
  /** `null` = eksport ICS wyłączony: kanał odpowiada 503, ekran mówi „niedostępny". */
  secret: string | null
  /** Baza adresu, z której klient kalendarza pobiera kanał (bez ukośnika na końcu). */
  publicBaseUrl: string
}

/**
 * Domyślny adres celowo wskazuje port tenant-runtime, a nie BFF: `apps/web/middleware.ts` obejmuje
 * `'/api/:path*'` i odrzuca 401 każde żądanie bez ciasteczka sesji, więc kanał subskrypcyjny NIE MOŻE
 * iść przez BFF. `docker-compose.override.yml` publikuje `3001:3001`, a `main.ts:25` ustawia
 * `setGlobalPrefix('api')` — stąd `/api` w ścieżce kanału.
 */
export const kalendarzConfigProvider: Provider = {
  provide: KALENDARZ_CONFIG,
  useFactory: (): KalendarzConfig => ({
    secret: readIcsFeedSecret(process.env),
    publicBaseUrl: (process.env['ICS_FEED_PUBLIC_BASE_URL'] ?? 'http://localhost:3001').replace(
      /\/+$/,
      '',
    ),
  }),
}
```

- [ ] **Krok 10: Uzupełnij `.env.example`.** Znajdź linię `GLOBAL_ADMIN_JWT_SECRET=dev-global-admin-jwt-secret-change-me-please` (linia 99, sekcja `# --- Secrets`) i wstaw **bezpośrednio pod nią**:

```
# Podpisuje token subskrypcji kanału ICS (blok E, M1 j). Min. 32 znaki: openssl rand -base64 48
# NIEUSTAWIONE = eksport ICS wyłączony (kanał zwraca 503, ekran pokazuje „niedostępny").
# UWAGA: token jest bezstanowy, więc cofnięcie dostępu = rotacja tej wartości i unieważnienie
# WSZYSTKICH subskrypcji naraz. Nie ma unieważnienia pojedynczej.
ICS_FEED_SECRET=dev-ics-feed-secret-change-me-please-32-chars-min
# Adres, pod którym klient kalendarza widzi tenant-runtime. NIE jest to adres BFF —
# apps/web/middleware.ts odrzuca 401 każde /api bez ciasteczka sesji.
ICS_FEED_PUBLIC_BASE_URL=http://localhost:3001
```

- [ ] **Krok 11: Dodaj adres publiczny do `docker-compose.yml`.** W usłudze `tenant-runtime`, w bloku `environment:`, znajdź linię `      PORT: "3001"` i wstaw **bezpośrednio pod nią**:

```yaml
      # Adres kanału ICS widziany przez klienta kalendarza (blok E, M1 j). SEKRET ICS_FEED_SECRET
      # NIE JEST tu wymieniony celowo: wszystkie sekrety tej usługi wchodzą przez `env_file: .env`
      # (jak TENANT_DB_ENCRYPTION_KEY i GLOBAL_ADMIN_JWT_SECRET), a wpis w `environment` nadpisałby
      # env_file pustym stringiem, gdyby zmiennej zabrakło w kontekście interpolacji Compose.
      ICS_FEED_PUBLIC_BASE_URL: ${ICS_FEED_PUBLIC_BASE_URL:-http://localhost:3001}
```

- [ ] **Krok 12: Commit.**

```
git add packages/config/src/env.ts packages/config/src/index.ts packages/config/src/env.test.ts apps/tenant-runtime/src/kalendarz/kalendarz.config.ts .env.example docker-compose.yml
git commit -m "feat(config): ICS_FEED_SECRET jako opcja fail-closed dla eksportu ICS"
```

---

### Zadanie 44 (E-5): `KalendarzService` — mapowanie statusów i projekcja bez PII

**Pliki:** utwórz `apps/tenant-runtime/src/kalendarz/kalendarz.service.ts` i `kalendarz.service.spec.ts`.

- [ ] **Krok 1: Napisz czerwony test mapowania statusów.** Utwórz `apps/tenant-runtime/src/kalendarz/kalendarz.service.spec.ts`:

```ts
import { LeaveStatus } from '@hrobot/shared'
import { leaveStatusToIcsStatus, leaveStatusToSequence } from './kalendarz.service.js'

describe('kalendarz.service — mapowanie statusu wniosku na RFC 5545', () => {
  it('APPROVED to CONFIRMED, PENDING to TENTATIVE (§3.8.1.11)', () => {
    expect(leaveStatusToIcsStatus(LeaveStatus.APPROVED)).toBe('CONFIRMED')
    expect(leaveStatusToIcsStatus(LeaveStatus.PENDING)).toBe('TENTATIVE')
  })

  it('CANCELLED i REJECTED to nagrobek CANCELLED — obie ścieżki usuwają zdarzenie u subskrybenta', () => {
    expect(leaveStatusToIcsStatus(LeaveStatus.CANCELLED)).toBe('CANCELLED')
    expect(leaveStatusToIcsStatus(LeaveStatus.REJECTED)).toBe('CANCELLED')
  })

  it('SEQUENCE rośnie monotonicznie wzdłuż cyklu życia wniosku (§3.8.7.4)', () => {
    expect(leaveStatusToSequence(LeaveStatus.PENDING)).toBe(0)
    expect(leaveStatusToSequence(LeaveStatus.APPROVED)).toBe(1)
    expect(leaveStatusToSequence(LeaveStatus.CANCELLED)).toBe(2)
    expect(leaveStatusToSequence(LeaveStatus.REJECTED)).toBe(2)
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz, że pada z braku modułu.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/kalendarz.service.spec.ts
```

Oczekiwane wyjście: `TS2307: Cannot find module './kalendarz.service.js' or its corresponding type declarations.`

- [ ] **Krok 3: Napisz `apps/tenant-runtime/src/kalendarz/kalendarz.service.ts`.**

```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { LeaveStatus } from '@hrobot/shared'
import {
  buildLeaveCalendar,
  icsLeaveUid,
  type IcsEventStatus,
  type IcsLeaveEvent,
} from './ics.util.js'

/**
 * Eksport ICS urlopów (blok E, M1 j — zawężony). To NIE jest integracja OAuth z Google Calendar ani
 * Microsoft 365: nie ma rejestracji aplikacji u dostawcy, zgód ani odświeżania tokenów. Nazwa
 * „eksport ICS" obowiązuje w kodzie, w interfejsie i w raporcie.
 *
 * RODO — PROJEKCJA JAKO GRANICA. {@link KALENDARZ_LEAVE_SELECT} celowo NIE pobiera `type`, `reason`
 * ani relacji `employee`. Rodzaj wniosku (`ZWOLNIENIE_LEKARSKIE` obok `URLOP_WYPOCZYNKOWY`) jest
 * daną o zdrowiu, a kalendarz bywa współdzielony — tego pola nie da się przypadkiem wypuścić, jeśli
 * nigdy nie opuściło bazy. Ta sama zasada, co w `LEAVE_SELECT` (leave.service.ts:32), tylko węższa.
 */

/** Minimalny wiersz, jakiego generator potrzebuje. Strukturalny — pasuje też do `LEAVE_SELECT`. */
export interface KalendarzLeaveRow {
  id: string
  startDate: Date
  endDate: Date
  status: string
  updatedAt: Date
}

/** Projekcja odczytu. Cztery kolumny plus id — nic, co byłoby daną osobową. */
export const KALENDARZ_LEAVE_SELECT = {
  id: true,
  startDate: true,
  endDate: true,
  status: true,
  updatedAt: true,
} as const

/**
 * Status zdarzenia wg RFC 5545 §3.8.1.11.
 *
 * CANCELLED i REJECTED dają NAGROBEK: to samo UID, `STATUS:CANCELLED`, wyższy SEQUENCE. Klient, który
 * miał już to zdarzenie jako TENTATIVE albo CONFIRMED, usuwa je — a to jest jedyny sposób, żeby
 * wycofany wniosek zniknął z subskrybowanego kalendarza. Pominięcie wiersza w kanale NIE usuwa
 * zdarzenia u subskrybenta; zostałoby tam na zawsze.
 */
export function leaveStatusToIcsStatus(status: string): IcsEventStatus {
  switch (status) {
    case LeaveStatus.APPROVED:
      return 'CONFIRMED'
    case LeaveStatus.PENDING:
      return 'TENTATIVE'
    default:
      return 'CANCELLED'
  }
}

/** SEQUENCE rośnie wzdłuż cyklu życia wniosku, inaczej klient odrzuciłby aktualizację jako starszą. */
export function leaveStatusToSequence(status: string): number {
  switch (status) {
    case LeaveStatus.PENDING:
      return 0
    case LeaveStatus.APPROVED:
      return 1
    default:
      return 2
  }
}

function toIcsEvent(row: KalendarzLeaveRow): IcsLeaveEvent {
  return {
    uid: icsLeaveUid(row.id),
    startDate: row.startDate,
    endDate: row.endDate,
    status: leaveStatusToIcsStatus(row.status),
    sequence: leaveStatusToSequence(row.status),
    lastModified: row.updatedAt,
  }
}

@Injectable()
export class KalendarzService {
  /** Kartoteka zalogowanego (przez `User.keycloakSub`), albo null gdy login nie ma pracownika. */
  async ownEmployeeId(client: TenantClient, keycloakSub: string): Promise<string | null> {
    const me = await client.employee.findFirst({
      where: { user: { keycloakSub } },
      select: { id: true },
    })
    return me?.id ?? null
  }

  /** Kalendarz z gotowych wierszy — używane przez trasę pojedynczego wniosku, po kontroli zakresu. */
  calendarFromRows(rows: readonly KalendarzLeaveRow[], now: Date): string {
    return buildLeaveCalendar(rows.map(toIcsEvent), now)
  }

  /**
   * Kalendarz JEDNEGO pracownika. Filtr `employeeId` jest jedyną granicą widoczności w tej metodzie
   * — wywołujący MUSI podać id, do którego żądający ma prawo (własne z JWT albo z podpisanego tokenu).
   */
  async calendarForEmployee(client: TenantClient, employeeId: string, now: Date): Promise<string> {
    const rows = await client.leaveRequest.findMany({
      where: { employeeId },
      orderBy: { startDate: 'asc' },
      select: KALENDARZ_LEAVE_SELECT,
    })
    return this.calendarFromRows(rows, now)
  }

  /** Kalendarz zalogowanego. 404, gdy konto nie ma kartoteki — nigdy pusty kalendarz „cudzy". */
  async calendarForOwnLeaves(client: TenantClient, keycloakSub: string, now: Date): Promise<string> {
    const employeeId = await this.ownEmployeeId(client, keycloakSub)
    if (employeeId == null) {
      throw new NotFoundException('Brak kartoteki pracownika dla bieżącego użytkownika')
    }
    return this.calendarForEmployee(client, employeeId, now)
  }
}
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/kalendarz.service.spec.ts
```

Oczekiwane wyjście: `Tests:       3 passed, 3 total`.

- [ ] **Krok 5: Dopisz czerwone testy odczytu (samozawężenie, brak PII, kryterium E-4).** W `kalendarz.service.spec.ts` zamień pierwsze dwie linie na blok importów, a na końcu pliku dopisz drugi `describe`.

Nowe pierwsze linie:

```ts
import type { TenantClient } from '@hrobot/db'
import { LeaveStatus } from '@hrobot/shared'
import {
  KalendarzService,
  KALENDARZ_LEAVE_SELECT,
  leaveStatusToIcsStatus,
  leaveStatusToSequence,
} from './kalendarz.service.js'
import { validateIcs } from './ics-rfc5545.validator.js'
```

Na końcu pliku:

```ts
const now = new Date('2026-08-12T09:07:05.000Z')

const client = {
  employee: { findFirst: jest.fn() },
  leaveRequest: { findMany: jest.fn() },
} as unknown as TenantClient

const findFirst = (client.employee as unknown as { findFirst: jest.Mock }).findFirst
const findMany = (client.leaveRequest as unknown as { findMany: jest.Mock }).findMany

const wiersz = (id: string, status: string) => ({
  id,
  startDate: new Date('2026-08-03T00:00:00.000Z'),
  endDate: new Date('2026-08-07T00:00:00.000Z'),
  status,
  updatedAt: new Date('2026-08-01T12:00:00.000Z'),
})

describe('KalendarzService — odczyt', () => {
  const service = new KalendarzService()
  beforeEach(() => jest.clearAllMocks())

  it('calendarForEmployee filtruje po employeeId i pobiera WYŁĄCZNIE projekcję bez PII', async () => {
    findMany.mockResolvedValue([wiersz('lv-1', LeaveStatus.APPROVED)])
    await service.calendarForEmployee(client, 'emp-1', now)
    expect(findMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp-1' },
      orderBy: { startDate: 'asc' },
      select: KALENDARZ_LEAVE_SELECT,
    })
    expect(Object.keys(KALENDARZ_LEAVE_SELECT)).not.toContain('type')
    expect(Object.keys(KALENDARZ_LEAVE_SELECT)).not.toContain('reason')
    expect(Object.keys(KALENDARZ_LEAVE_SELECT)).not.toContain('employee')
  })

  it('wynik przechodzi walidację RFC 5545 i zawiera nagrobek dla anulowanego wniosku', async () => {
    findMany.mockResolvedValue([
      wiersz('lv-1', LeaveStatus.APPROVED),
      wiersz('lv-2', LeaveStatus.CANCELLED),
    ])
    const ics = await service.calendarForEmployee(client, 'emp-1', now)
    expect(validateIcs(ics)).toEqual([])
    const wiersze = ics.split('\r\n')
    expect(wiersze).toContain('UID:urlop-lv-2@hrobot.local')
    expect(wiersze).toContain('STATUS:CANCELLED')
    expect(wiersze).toContain('STATUS:CONFIRMED')
  })

  // KRYTERIUM AKCEPTACJI E-4: „Anulowanie urlopu odzwierciedla się w feedzie (STATUS:CANCELLED)".
  // Ten sam wniosek, dwa kolejne odczyty kanału — to jedyna forma, w której E-4 znaczy cokolwiek:
  // porównanie dwóch RÓŻNYCH wniosków nie dowodzi, że klient kalendarza usunie ten, który już ma.
  it('E-4: po anulowaniu ten sam UID wraca jako STATUS:CANCELLED z wyższym SEQUENCE', async () => {
    findMany.mockResolvedValueOnce([wiersz('lv-7', LeaveStatus.PENDING)])
    const przed = (await service.calendarForEmployee(client, 'emp-1', now)).split('\r\n')

    findMany.mockResolvedValueOnce([wiersz('lv-7', LeaveStatus.CANCELLED)])
    const po = await service.calendarForEmployee(client, 'emp-1', now)

    expect(przed).toContain('UID:urlop-lv-7@hrobot.local')
    expect(przed).toContain('STATUS:TENTATIVE')
    expect(przed).toContain('SEQUENCE:0')

    expect(po.split('\r\n')).toContain('UID:urlop-lv-7@hrobot.local')
    expect(po.split('\r\n')).toContain('STATUS:CANCELLED')
    expect(po.split('\r\n')).toContain('SEQUENCE:2')
    expect(leaveStatusToSequence(LeaveStatus.CANCELLED)).toBeGreaterThan(
      leaveStatusToSequence(LeaveStatus.PENDING),
    )
    expect(leaveStatusToIcsStatus(LeaveStatus.CANCELLED)).toBe('CANCELLED')
    expect(validateIcs(po)).toEqual([])
  })

  it('calendarForOwnLeaves rozwiązuje kartotekę po keycloakSub i pyta o JEJ id', async () => {
    findFirst.mockResolvedValue({ id: 'emp-9' })
    findMany.mockResolvedValue([])
    await service.calendarForOwnLeaves(client, 'kc-9', now)
    expect(findFirst).toHaveBeenCalledWith({
      where: { user: { keycloakSub: 'kc-9' } },
      select: { id: true },
    })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId: 'emp-9' } }))
  })

  it('konto bez kartoteki dostaje 404, nigdy cudzego ani pustego kalendarza po cichu', async () => {
    findFirst.mockResolvedValue(null)
    await expect(service.calendarForOwnLeaves(client, 'kc-brak', now)).rejects.toThrow(
      'Brak kartoteki pracownika dla bieżącego użytkownika',
    )
    expect(findMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Krok 6: Uruchom i zobacz zielone.** (Implementacja z kroku 3 już to pokrywa — to testy charakteryzujące granicę RODO, samozawężenie i kryterium E-4.)

```
cd apps/tenant-runtime
npx jest src/kalendarz/kalendarz.service.spec.ts
```

Oczekiwane wyjście: `Tests:       8 passed, 8 total`.

- [ ] **Krok 7: Weryfikacja negatywna — zdejmij samozawężenie.** W `kalendarz.service.ts`, w `calendarForEmployee`, zamień `where: { employeeId },` na `where: {},` i uruchom:

```
cd apps/tenant-runtime
npx jest src/kalendarz/kalendarz.service.spec.ts
```

Oczekiwane wyjście: `Tests:       2 failed, 6 passed, 8 total`; w pierwszym czerwonym `Expected: ..."where": {"employeeId": "emp-1"} / Received: ..."where": {}`.

- [ ] **Krok 8: Przywróć `where: { employeeId },` i potwierdź zielone.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/kalendarz.service.spec.ts
```

Oczekiwane wyjście: `Tests:       8 passed, 8 total`.

- [ ] **Krok 9: Commit.**

```
git add apps/tenant-runtime/src/kalendarz/kalendarz.service.ts apps/tenant-runtime/src/kalendarz/kalendarz.service.spec.ts
git commit -m "feat(kalendarz): serwis eksportu ICS z projekcja bez PII i nagrobkiem CANCELLED"
```

---

### Zadanie 45 (E-6): Trasy uwierzytelnione (`@TenantRoute`) + rejestracja modułu

**Pliki:** utwórz `apps/tenant-runtime/src/kalendarz/kalendarz.controller.ts`, `kalendarz.controller.spec.ts`, `kalendarz.module.ts`; zmień `apps/tenant-runtime/src/app.module.ts`.

- [ ] **Krok 1: Napisz czerwony test kontrolera.** Utwórz `apps/tenant-runtime/src/kalendarz/kalendarz.controller.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Response } from 'express'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { KalendarzController } from './kalendarz.controller.js'
import { KalendarzService } from './kalendarz.service.js'
import { KALENDARZ_CONFIG, type KalendarzConfig } from './kalendarz.config.js'
import { LeaveService } from '../leave/leave.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const bypass = { canActivate: (_c: ExecutionContext) => true }
const bypassI = { intercept: (_c: ExecutionContext, next: { handle(): unknown }) => next.handle() }

const client = {} as TenantClient
const user: JwtPayload = { sub: 'kc-1', iss: 'x', hrobot_roles: [Role.PRACOWNIK], exp: 0 }

const kalendarz = {
  calendarForOwnLeaves: jest.fn(),
  calendarFromRows: jest.fn(),
  ownEmployeeId: jest.fn(),
}
const leave = { getById: jest.fn() }
// findFirst, nie findUnique — ta sama metoda, którą TenantContextInterceptor rozwiązuje najemcę.
const controlPlane = { tenant: { findFirst: jest.fn() } }
const config: KalendarzConfig = { secret: 's'.repeat(48), publicBaseUrl: 'http://localhost:3001' }

const res = () => {
  const r = { setHeader: jest.fn(), send: jest.fn() }
  return r as unknown as Response & { setHeader: jest.Mock; send: jest.Mock }
}

async function build(cfg: KalendarzConfig = config): Promise<KalendarzController> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [KalendarzController],
    providers: [
      { provide: KalendarzService, useValue: kalendarz },
      { provide: LeaveService, useValue: leave },
      { provide: ControlPlanePrismaService, useValue: controlPlane },
      { provide: KALENDARZ_CONFIG, useValue: cfg },
    ],
  })
    .overrideGuard(KeycloakJwtGuard)
    .useValue(bypass)
    .overrideGuard(RbacGuard)
    .useValue(bypass)
    .overrideInterceptor(TenantContextInterceptor)
    .useValue(bypassI)
    .overrideInterceptor(AuditInterceptor)
    .useValue(bypassI)
    .compile()
  return module.get(KalendarzController)
}

describe('KalendarzController', () => {
  beforeEach(() => jest.clearAllMocks())

  it('GET moje.ics odpowiada typem text/calendar i załącznikiem', async () => {
    kalendarz.calendarForOwnLeaves.mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')
    const r = res()
    await (await build()).moje(client, user, r)
    expect(kalendarz.calendarForOwnLeaves).toHaveBeenCalledWith(client, 'kc-1', expect.any(Date))
    expect(r.setHeader).toHaveBeenCalledWith('Content-Type', 'text/calendar; charset=utf-8')
    expect(r.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="urlopy.ics"')
    expect(r.send).toHaveBeenCalledWith('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')
  })

  it('GET wniosek/:id przechodzi przez LeaveService.getById — zakres RBAC nie jest tu kopiowany', async () => {
    const row = {
      id: 'lv-1',
      startDate: new Date('2026-08-03T00:00:00.000Z'),
      endDate: new Date('2026-08-07T00:00:00.000Z'),
      status: 'APPROVED',
      updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    }
    leave.getById.mockResolvedValue(row)
    kalendarz.calendarFromRows.mockReturnValue('ICS')
    const r = res()
    await (await build()).wniosek(client, user, '1.2.3.4', 'lv-1', r)
    expect(leave.getById).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.PRACOWNIK], ipAddress: '1.2.3.4' },
      'lv-1',
    )
    expect(kalendarz.calendarFromRows).toHaveBeenCalledWith([row], expect.any(Date))
    expect(r.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="urlop-lv-1.ics"',
    )
  })

  it('GET subskrypcja składa adres kanału z podpisanego tokenu własnej kartoteki', async () => {
    kalendarz.ownEmployeeId.mockResolvedValue('emp-7')
    controlPlane.tenant.findFirst.mockResolvedValue({ slug: '4mobility' })
    const out = await (await build()).subskrypcja(client, 't-1', user)
    expect(out.available).toBe(true)
    expect(out.path).toMatch(
      /^\/api\/kalendarz\/feed\/4mobility\.emp-7\.[A-Za-z0-9_-]+\/kalendarz\.ics$/,
    )
    expect(out.url).toBe(`http://localhost:3001${out.path!}`)
  })

  it('GET subskrypcja bez skonfigurowanego sekretu zgłasza niedostępność, nie zmyśla adresu', async () => {
    kalendarz.ownEmployeeId.mockResolvedValue('emp-7')
    const bezSekretu = await build({ secret: null, publicBaseUrl: 'http://localhost:3001' })
    expect(await bezSekretu.subskrypcja(client, 't-1', user)).toEqual({
      available: false,
      path: null,
      url: null,
    })
    expect(controlPlane.tenant.findFirst).not.toHaveBeenCalled()
  })

  it('każda trasa jest otwarta dla wszystkich czterech ról najemcy', () => {
    const reflector = new Reflector()
    for (const trasa of ['moje', 'subskrypcja', 'wniosek'] as const) {
      expect(
        reflector.get<string[]>(
          ROLES_KEY,
          KalendarzController.prototype[trasa] as (...a: unknown[]) => unknown,
        ),
      ).toEqual([Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    }
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz, że pada z braku kontrolera.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/kalendarz.controller.spec.ts
```

Oczekiwane wyjście: `TS2307: Cannot find module './kalendarz.controller.js' or its corresponding type declarations.`

- [ ] **Krok 3: Napisz `apps/tenant-runtime/src/kalendarz/kalendarz.controller.ts`.**

```ts
import {
  Controller,
  Get,
  Inject,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common'
import type { Response } from 'express'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import {
  CurrentTenantClient,
  CurrentTenantId,
  CurrentUser,
} from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { LeaveService } from '../leave/leave.service.js'
import { KalendarzService } from './kalendarz.service.js'
import { buildFeedToken } from './feed-token.util.js'
import { KALENDARZ_CONFIG, type KalendarzConfig } from './kalendarz.config.js'

/** Każda rola najemcy ma własne urlopy, więc każda ma prawo do własnego eksportu ICS. */
const ANY_ROLE = [Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const

/** Odpowiedź `GET /kalendarz/subskrypcja`. `available: false` = brak `ICS_FEED_SECRET`. */
export interface SubscriptionResponse {
  available: boolean
  path: string | null
  url: string | null
}

function sendIcs(res: Response, filename: string | null, ics: string): void {
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  if (filename != null) res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  // Jak w dokumenty.controller.ts:97 — wysyłamy przez `res.send`, nie `return` z @Res({passthrough}):
  // Nest zserializowałby wynik do JSON-a i pobrany plik nie byłby kalendarzem.
  res.send(ics)
}

/**
 * Eksport ICS — trasy UWIERZYTELNIONE sesją (Bearer z Keycloaka przez BFF). Kanał subskrypcyjny
 * mieszka w osobnym kontrolerze (`KalendarzFeedController`), bo klient kalendarza nie ma czym
 * się przedstawić w tym trybie.
 *
 * Ścieżki z segmentem `.ics` są STATYCZNE (`moje.ics`, `urlop.ics`) — parametr nigdy nie sąsiaduje
 * z kropką, więc router Express nie ma jak wciągnąć rozszerzenia do wartości parametru.
 */
@Controller('kalendarz')
@TenantRoute()
export class KalendarzController {
  constructor(
    private readonly kalendarz: KalendarzService,
    private readonly leave: LeaveService,
    private readonly controlPlane: ControlPlanePrismaService,
    @Inject(KALENDARZ_CONFIG) private readonly config: KalendarzConfig,
  ) {}

  /** Własne urlopy jako jeden plik. Zakres: wyłącznie kartoteka zalogowanego (serwis rozwiązuje sub). */
  @Get('moje.ics')
  @Roles(...ANY_ROLE)
  async moje(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    const ics = await this.kalendarz.calendarForOwnLeaves(client, user.sub, new Date())
    sendIcs(res, 'urlopy.ics', ics)
  }

  /**
   * Adres kanału subskrypcyjnego dla ZALOGOWANEGO. Token powstaje tu, w kontekście uwierzytelnionym,
   * i obejmuje wyłącznie własną kartotekę — nie ma parametru, którym dałoby się poprosić o cudzą.
   */
  @Get('subskrypcja')
  @Roles(...ANY_ROLE)
  async subskrypcja(
    @CurrentTenantClient() client: TenantClient,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<SubscriptionResponse> {
    const employeeId = await this.kalendarz.ownEmployeeId(client, user.sub)
    if (employeeId == null) {
      throw new NotFoundException('Brak kartoteki pracownika dla bieżącego użytkownika')
    }
    if (this.config.secret == null) return { available: false, path: null, url: null }

    const tenant = await this.controlPlane.tenant.findFirst({
      where: { id: tenantId },
      select: { slug: true },
    })
    if (tenant == null) throw new NotFoundException('Nie można ustalić najemcy dla bieżącej sesji')

    const token = buildFeedToken(this.config.secret, { tenantSlug: tenant.slug, employeeId })
    const path = `/api/kalendarz/feed/${token}/kalendarz.ics`
    return { available: true, path, url: `${this.config.publicBaseUrl}${path}` }
  }

  /**
   * Pojedynczy wniosek jako plik `.ics`. Zakres widoczności jest w CAŁOŚCI delegowany do
   * `LeaveService.getById` (404 dla nieznanego id, 403 poza zakresem) — druga kopia reguły RBAC
   * rozjechałaby się z pierwszą.
   */
  @Get('wniosek/:id/urlop.ics')
  @Roles(...ANY_ROLE)
  async wniosek(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const row = await this.leave.getById(
      client,
      { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip },
      id,
    )
    sendIcs(res, `urlop-${id}.ics`, this.kalendarz.calendarFromRows([row], new Date()))
  }
}
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/kalendarz.controller.spec.ts
```

Oczekiwane wyjście: `Tests:       5 passed, 5 total`. (Test `wniosek` używa `'lv-1'` jako id — `ParseUUIDPipe` działa tylko w pipeline HTTP, nie przy bezpośrednim wywołaniu metody; walidację UUID pokrywa E2E w zadaniu 9.)

- [ ] **Krok 5: Utwórz `apps/tenant-runtime/src/kalendarz/kalendarz.module.ts` (na razie bez kanału).**

```ts
import { Module } from '@nestjs/common'
import { LeaveModule } from '../leave/leave.module.js'
import { KalendarzController } from './kalendarz.controller.js'
import { KalendarzService } from './kalendarz.service.js'
import { kalendarzConfigProvider } from './kalendarz.config.js'

/**
 * Eksport ICS (blok E, M1 j — zawężony). BEZ MIGRACJI: moduł tylko czyta `leave_requests`, więc
 * wycofanie to skasowanie katalogu i jednej linii w app.module.ts.
 *
 * `LeaveModule` jest importowany po `LeaveService` — dokładnie tak, jak robi to `AgentGlosowyModule`:
 * zakres widoczności pojedynczego wniosku ma jedną implementację, nie dwie.
 * `ControlPlanePrismaService` i `TenantPrismaManager` przychodzą z modułów `@Global()`
 * (CommonModule, TenantRuntimeModule), więc nie ma ich w `imports`.
 */
@Module({
  imports: [LeaveModule],
  controllers: [KalendarzController],
  providers: [KalendarzService, kalendarzConfigProvider],
})
export class KalendarzModule {}
```

- [ ] **Krok 6: Zarejestruj moduł w `apps/tenant-runtime/src/app.module.ts`.** Zamień linię:

```ts
import { LeaveModule } from './leave/leave.module.js'
```

na:

```ts
import { LeaveModule } from './leave/leave.module.js'
import { KalendarzModule } from './kalendarz/kalendarz.module.js'
```

oraz w tablicy `imports` zamień linię `    LeaveModule,` na:

```ts
    LeaveModule,
    // Eksport ICS (blok E, M1 j). Bez tej linii trasy /api/kalendarz/* nie istnieją, mimo że kod jest.
    KalendarzModule,
```

- [ ] **Krok 7: Sprawdź, że kontener się składa (typecheck).**

```
pnpm --filter @hrobot/tenant-runtime exec tsc --noEmit -p tsconfig.json
```

Oczekiwane wyjście: brak wypisanych błędów, kod wyjścia 0. (Jeśli pojawi się `TS2305: Module '"@hrobot/config"' has no exported member 'readIcsFeedSecret'` — nie wykonano kroku 8 zadania 4.)

- [ ] **Krok 8: Commit.**

```
git add apps/tenant-runtime/src/kalendarz/kalendarz.controller.ts apps/tenant-runtime/src/kalendarz/kalendarz.controller.spec.ts apps/tenant-runtime/src/kalendarz/kalendarz.module.ts apps/tenant-runtime/src/app.module.ts
git commit -m "feat(kalendarz): uwierzytelnione trasy eksportu ICS + rejestracja modulu"
```

---

### Zadanie 46 (E-7): Kanał subskrypcyjny (trasa publiczna, token, samozawężenie)

**Pliki:** utwórz `apps/tenant-runtime/src/kalendarz/kalendarz-feed.controller.ts` i `kalendarz-feed.controller.spec.ts`; zmień `kalendarz.module.ts`.

- [ ] **Krok 1: Napisz czerwony test kanału.** Utwórz `apps/tenant-runtime/src/kalendarz/kalendarz-feed.controller.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing'
import type { Response } from 'express'
import { TenantPrismaManager, type TenantClient } from '@hrobot/db'
import { TenantStatus } from '@hrobot/shared'
import { KalendarzFeedController } from './kalendarz-feed.controller.js'
import { KalendarzService } from './kalendarz.service.js'
import { KALENDARZ_CONFIG, type KalendarzConfig } from './kalendarz.config.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { buildFeedToken } from './feed-token.util.js'

const secret = 's'.repeat(48)
const config: KalendarzConfig = { secret, publicBaseUrl: 'http://localhost:3001' }
const token = buildFeedToken(secret, { tenantSlug: '4mobility', employeeId: 'emp-7' })

const kalendarz = { calendarForEmployee: jest.fn() }
const controlPlane = { tenant: { findFirst: jest.fn() } }
const tenantManager = {
  withClient: jest.fn(async (_id: string, fn: (c: TenantClient) => Promise<string>) =>
    fn({} as TenantClient),
  ),
}

const res = () => {
  const r = { setHeader: jest.fn(), send: jest.fn() }
  return r as unknown as Response & { setHeader: jest.Mock; send: jest.Mock }
}

async function build(cfg: KalendarzConfig = config): Promise<KalendarzFeedController> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [KalendarzFeedController],
    providers: [
      { provide: KalendarzService, useValue: kalendarz },
      { provide: ControlPlanePrismaService, useValue: controlPlane },
      { provide: TenantPrismaManager, useValue: tenantManager },
      { provide: KALENDARZ_CONFIG, useValue: cfg },
    ],
  }).compile()
  return module.get(KalendarzFeedController)
}

describe('KalendarzFeedController', () => {
  beforeEach(() => jest.clearAllMocks())

  it('poprawny token zwraca kalendarz WYŁĄCZNIE tej kartoteki, którą token niesie', async () => {
    controlPlane.tenant.findFirst.mockResolvedValue({ id: 't-1', status: TenantStatus.ACTIVE })
    kalendarz.calendarForEmployee.mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')
    const r = res()
    await (await build()).feed(token, r)
    expect(controlPlane.tenant.findFirst).toHaveBeenCalledWith({
      where: { slug: '4mobility' },
      select: { id: true, status: true },
    })
    expect(tenantManager.withClient).toHaveBeenCalledWith('t-1', expect.any(Function))
    expect(kalendarz.calendarForEmployee).toHaveBeenCalledWith({}, 'emp-7', expect.any(Date))
    expect(r.setHeader).toHaveBeenCalledWith('Content-Type', 'text/calendar; charset=utf-8')
    expect(r.setHeader).not.toHaveBeenCalledWith('Content-Disposition', expect.anything())
  })

  // UWAGA: najemca jest tu zamockowany jako ISTNIEJĄCY i AKTYWNY z rozmysłem. Gdyby nie był,
  // usunięcie sprawdzenia podpisu i tak dałoby 401 (z innego powodu), a test przestałby cokolwiek
  // dowodzić — właśnie to sprawdza weryfikacja negatywna w kroku 5.
  it('token z podmienioną kartoteką jest odrzucany 401 i NIE dotyka bazy najemcy', async () => {
    controlPlane.tenant.findFirst.mockResolvedValue({ id: 't-1', status: TenantStatus.ACTIVE })
    const [slug, , sig] = token.split('.')
    const podrobiony = [slug, 'emp-CUDZY', sig].join('.')
    await expect((await build()).feed(podrobiony, res())).rejects.toThrow(
      'Nieprawidłowy token subskrypcji',
    )
    expect(controlPlane.tenant.findFirst).not.toHaveBeenCalled()
    expect(kalendarz.calendarForEmployee).not.toHaveBeenCalled()
  })

  it('token podpisany innym sekretem jest odrzucany 401', async () => {
    controlPlane.tenant.findFirst.mockResolvedValue({ id: 't-1', status: TenantStatus.ACTIVE })
    const obcy = buildFeedToken('x'.repeat(48), { tenantSlug: '4mobility', employeeId: 'emp-7' })
    await expect((await build()).feed(obcy, res())).rejects.toThrow('Nieprawidłowy token subskrypcji')
    expect(kalendarz.calendarForEmployee).not.toHaveBeenCalled()
  })

  it('nieznany najemca daje 401, nie 404 — token nie może służyć do zgadywania slugów', async () => {
    controlPlane.tenant.findFirst.mockResolvedValue(null)
    await expect((await build()).feed(token, res())).rejects.toThrow('Nieprawidłowy token subskrypcji')
  })

  it('najemca inny niż ACTIVE dostaje 403', async () => {
    controlPlane.tenant.findFirst.mockResolvedValue({ id: 't-1', status: TenantStatus.SUSPENDED })
    await expect((await build()).feed(token, res())).rejects.toThrow('Konto najemcy jest nieaktywne')
    expect(kalendarz.calendarForEmployee).not.toHaveBeenCalled()
  })

  it('brak ICS_FEED_SECRET wyłącza kanał (503), zamiast wpuszczać bez podpisu', async () => {
    const bez = await build({ secret: null, publicBaseUrl: 'http://localhost:3001' })
    await expect(bez.feed(token, res())).rejects.toThrow('Eksport ICS nie jest skonfigurowany')
    expect(controlPlane.tenant.findFirst).not.toHaveBeenCalled()
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz, że pada z braku modułu.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/kalendarz-feed.controller.spec.ts
```

Oczekiwane wyjście: `TS2307: Cannot find module './kalendarz-feed.controller.js' or its corresponding type declarations.`

- [ ] **Krok 3: Napisz `apps/tenant-runtime/src/kalendarz/kalendarz-feed.controller.ts`.**

```ts
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import type { Response } from 'express'
import { TenantPrismaManager, type TenantClient } from '@hrobot/db'
import { TenantStatus } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { KalendarzService } from './kalendarz.service.js'
import { parseFeedToken } from './feed-token.util.js'
import { KALENDARZ_CONFIG, type KalendarzConfig } from './kalendarz.config.js'

/**
 * Kanał subskrypcyjny eksportu ICS. JEDYNA trasa tenant-runtime poza `@TenantRoute()`, i to z twardego
 * powodu: klient kalendarza (Thunderbird, iOS, Outlook) odpytuje adres zwykłym GET-em bez nagłówka
 * Authorization i bez ciasteczka, więc `KeycloakJwtGuard` odrzuciłby każdą subskrypcję. Uwierzytelnienie
 * niesie więc podpisany token w ścieżce, a najemcę rozwiązujemy sami — tym samym trybem, co
 * `TenantContextInterceptor` (slug → tenant → status ACTIVE → klient Prismy) i co
 * `UsageSnapshotScheduler` (ControlPlanePrismaService + TenantPrismaManager.withClient).
 *
 * SAMOZAWĘŻENIE. `employeeId` pochodzi WYŁĄCZNIE z ładunku tokenu, który wcześniej opieczętował
 * `KalendarzController.subskrypcja` własną kartoteką zalogowanego. Nie ma parametru zapytania, którym
 * dałoby się poprosić o cudze urlopy — a podmiana ładunku unieważnia podpis (zadanie 3).
 *
 * Limit żądań daje globalny `ThrottlerGuard` z `app.module.ts` (`{ ttl: 60_000, limit: 100 }`, tracker
 * po adresie IP), więc tokenu nie da się zgadywać wsadowo.
 */
@Controller('kalendarz')
export class KalendarzFeedController {
  constructor(
    private readonly kalendarz: KalendarzService,
    private readonly controlPlane: ControlPlanePrismaService,
    private readonly tenantManager: TenantPrismaManager,
    @Inject(KALENDARZ_CONFIG) private readonly config: KalendarzConfig,
  ) {}

  @Get('feed/:token/kalendarz.ics')
  async feed(@Param('token') token: string, @Res() res: Response): Promise<void> {
    if (this.config.secret == null) {
      throw new ServiceUnavailableException(
        'Eksport ICS nie jest skonfigurowany (brak ICS_FEED_SECRET)',
      )
    }

    const payload = parseFeedToken(this.config.secret, token)
    if (payload == null) throw new UnauthorizedException('Nieprawidłowy token subskrypcji')

    const tenant = await this.controlPlane.tenant.findFirst({
      where: { slug: payload.tenantSlug },
      select: { id: true, status: true },
    })
    // Nieznany najemca to 401, nie 404: 404 potwierdzałby, które slugi istnieją.
    if (tenant == null) throw new UnauthorizedException('Nieprawidłowy token subskrypcji')
    if (tenant.status !== TenantStatus.ACTIVE) {
      throw new ForbiddenException('Konto najemcy jest nieaktywne')
    }

    const ics = await this.tenantManager.withClient(tenant.id, (client: TenantClient) =>
      this.kalendarz.calendarForEmployee(client, payload.employeeId, new Date()),
    )

    // Bez Content-Disposition: to kanał do subskrypcji, nie plik do pobrania. Załącznik kazałby
    // części klientów zapisać snapshot zamiast odpytywać adres cyklicznie.
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.send(ics)
  }
}
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/kalendarz-feed.controller.spec.ts
```

Oczekiwane wyjście: `Tests:       6 passed, 6 total`.

- [ ] **Krok 5: Weryfikacja negatywna — usuń sprawdzenie podpisu.** W `kalendarz-feed.controller.ts` zamień dwie linie:

```ts
    const payload = parseFeedToken(this.config.secret, token)
    if (payload == null) throw new UnauthorizedException('Nieprawidłowy token subskrypcji')
```

na:

```ts
    const payload = { tenantSlug: token.split('.')[0]!, employeeId: token.split('.')[1]! }
```

i uruchom:

```
cd apps/tenant-runtime
npx jest src/kalendarz/kalendarz-feed.controller.spec.ts
```

Oczekiwane wyjście: `Tests:       2 failed, 4 passed, 6 total`; czerwone to `token z podmienioną kartoteką jest odrzucany 401 i NIE dotyka bazy najemcy` oraz `token podpisany innym sekretem jest odrzucany 401`.

- [ ] **Krok 6: Przywróć `parseFeedToken` i potwierdź zielone.**

```
cd apps/tenant-runtime
npx jest src/kalendarz/kalendarz-feed.controller.spec.ts
```

Oczekiwane wyjście: `Tests:       6 passed, 6 total`.

- [ ] **Krok 7: Zarejestruj kanał w module.** W `apps/tenant-runtime/src/kalendarz/kalendarz.module.ts` zamień linię:

```ts
import { KalendarzController } from './kalendarz.controller.js'
```

na:

```ts
import { KalendarzController } from './kalendarz.controller.js'
import { KalendarzFeedController } from './kalendarz-feed.controller.js'
```

oraz zamień linię:

```ts
  controllers: [KalendarzController],
```

na:

```ts
  controllers: [KalendarzController, KalendarzFeedController],
```

- [ ] **Krok 8: Uruchom cały pakiet modułu i typecheck.**

```
cd apps/tenant-runtime
npx jest src/kalendarz
```

Oczekiwane wyjście: `Test Suites: 6 passed, 6 total` oraz `Tests:       45 passed, 45 total`.

```
pnpm --filter @hrobot/tenant-runtime exec tsc --noEmit -p tsconfig.json
```

Oczekiwane wyjście: brak wypisanych błędów, kod wyjścia 0.

- [ ] **Krok 9: Commit.**

```
git add apps/tenant-runtime/src/kalendarz/kalendarz-feed.controller.ts apps/tenant-runtime/src/kalendarz/kalendarz-feed.controller.spec.ts apps/tenant-runtime/src/kalendarz/kalendarz.module.ts
git commit -m "feat(kalendarz): kanal subskrypcyjny ICS uwierzytelniony podpisanym tokenem"
```

---

### Zadanie 47 (E-8): Warstwa web — proxy BFF, model kliencki, ekran Wnioski

**Pliki:** utwórz `apps/web/app/api/kalendarz/[[...path]]/route.ts`, `apps/web/lib/kalendarz-ics.ts`, `apps/web/lib/kalendarz-ics.test.ts`; zmień `apps/web/components/wnioski/wnioski-screen.tsx`, `apps/web/lib/middleware-api-gate.test.ts`.

- [ ] **Krok 1: Napisz czerwony test modelu klienckiego.** Utwórz `apps/web/lib/kalendarz-ics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ICS_EXPORT_LABEL,
  ICS_EXPORT_HINT,
  icsMojeHref,
  icsWniosekHref,
  webcalUrl,
} from './kalendarz-ics'

describe('kalendarz-ics — nazewnictwo', () => {
  it('etykieta mówi „eksport ICS" i nigdzie nie obiecuje integracji z Google/Microsoft', () => {
    const tekst = `${ICS_EXPORT_LABEL} ${ICS_EXPORT_HINT}`.toLowerCase()
    expect(tekst).toContain('ics')
    expect(tekst).not.toContain('google')
    expect(tekst).not.toContain('microsoft')
    expect(tekst).not.toContain('outlook')
    expect(tekst).not.toContain('oauth')
  })
})

describe('kalendarz-ics — adresy', () => {
  it('icsMojeHref wskazuje trasę BFF własnych urlopów', () => {
    expect(icsMojeHref()).toBe('/api/kalendarz/moje.ics')
  })

  it('icsWniosekHref składa adres pojedynczego wniosku', () => {
    expect(icsWniosekHref('11111111-1111-4111-8111-111111111111')).toBe(
      '/api/kalendarz/wniosek/11111111-1111-4111-8111-111111111111/urlop.ics',
    )
  })

  it('webcalUrl zamienia http/https na webcal, żeby klient kalendarza przejął odnośnik', () => {
    expect(webcalUrl('http://localhost:3001/api/kalendarz/feed/a.b.c/kalendarz.ics')).toBe(
      'webcal://localhost:3001/api/kalendarz/feed/a.b.c/kalendarz.ics',
    )
    expect(webcalUrl('https://demo.example/api/kalendarz/feed/a.b.c/kalendarz.ics')).toBe(
      'webcal://demo.example/api/kalendarz/feed/a.b.c/kalendarz.ics',
    )
  })

  it('webcalUrl zwraca null dla pustego adresu (kanał niedostępny)', () => {
    expect(webcalUrl(null)).toBeNull()
    expect(webcalUrl('')).toBeNull()
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz, że pada z braku modułu.**

```
cd apps/web
npx vitest run lib/kalendarz-ics.test.ts
```

Oczekiwane wyjście (zmierzony format vitest 2.1.x w tym repo):
`Error: Failed to load url ./kalendarz-ics (resolved id: ./kalendarz-ics) in .../apps/web/lib/kalendarz-ics.test.ts. Does the file exist?`

- [ ] **Krok 3: Napisz `apps/web/lib/kalendarz-ics.ts`.**

```ts
/**
 * Eksport ICS urlopów — model kliencki (blok E, M1 j — zawężony).
 *
 * NAZEWNICTWO JEST CZĘŚCIĄ SPECYFIKACJI. To eksport pliku iCalendar zgodnego z RFC 5545 i kanał
 * subskrypcyjny — NIE integracja OAuth z Google Calendar ani Microsoft 365. Interfejs nie ma prawa
 * sugerować inaczej; pilnuje tego test `lib/kalendarz-ics.test.ts`.
 */

export const ICS_EXPORT_LABEL = 'Eksport ICS'
export const ICS_EXPORT_HINT =
  'Pobierz plik .ics albo dodaj adres kanału w swojej aplikacji kalendarza. Zdarzenia mają neutralny tytuł „Urlop” i nie zawierają danych osobowych.'

/**
 * Odpowiedź `GET /api/kalendarz/subskrypcja`. Lustro backendowego `SubscriptionResponse`
 * (apps/tenant-runtime/src/kalendarz/kalendarz.controller.ts) — trzy pola, te same nazwy; rozjazd
 * łapie E2E `apps/web/e2e/ics-export.spec.ts`, które czyta realną odpowiedź.
 */
export interface SubscriptionResponse {
  available: boolean
  path: string | null
  url: string | null
}

/** Wszystkie własne urlopy jako jeden plik. */
export function icsMojeHref(): string {
  return '/api/kalendarz/moje.ics'
}

/** Pojedynczy wniosek jako plik. Zakres widoczności rozstrzyga backend (LeaveService.getById). */
export function icsWniosekHref(leaveId: string): string {
  return `/api/kalendarz/wniosek/${leaveId}/urlop.ics`
}

/**
 * `webcal://` zamiast `http(s)://` — tylko ten schemat każe przeglądarce oddać odnośnik aplikacji
 * kalendarza zamiast pobrać plik. `null` propaguje „kanał niedostępny" bez udawania adresu.
 */
export function webcalUrl(httpUrl: string | null): string | null {
  if (httpUrl == null || httpUrl === '') return null
  return httpUrl.replace(/^https?:\/\//, 'webcal://')
}

/** Adres kanału dla zalogowanego. Rzuca dopiero na wywołaniu — ekran obsługuje błąd lokalnie. */
export async function fetchSubscription(): Promise<SubscriptionResponse> {
  const res = await fetch('/api/kalendarz/subskrypcja', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Nie udało się pobrać adresu kanału (HTTP ${res.status}).`)
  return (await res.json()) as SubscriptionResponse
}
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/web
npx vitest run lib/kalendarz-ics.test.ts
```

Oczekiwane wyjście: ` Test Files  1 passed (1)` oraz `      Tests  5 passed (5)`.

- [ ] **Krok 5: Weryfikacja negatywna — złam nazewnictwo.** W `apps/web/lib/kalendarz-ics.ts` zamień `ICS_EXPORT_HINT` na wersję z zakazaną obietnicą:

```ts
export const ICS_EXPORT_HINT =
  'Podłącz swój Google Calendar jednym kliknięciem.'
```

i uruchom:

```
cd apps/web
npx vitest run lib/kalendarz-ics.test.ts
```

Oczekiwane wyjście: `      Tests  1 failed | 4 passed (5)`; czerwony to `etykieta mówi „eksport ICS" i nigdzie nie obiecuje integracji z Google/Microsoft`.

- [ ] **Krok 6: Przywróć poprawną treść `ICS_EXPORT_HINT` z kroku 3 i potwierdź zielone.**

```
cd apps/web
npx vitest run lib/kalendarz-ics.test.ts
```

Oczekiwane wyjście: `      Tests  5 passed (5)`.

- [ ] **Krok 7: Dodaj proxy BFF.** Utwórz `apps/web/app/api/kalendarz/[[...path]]/route.ts`:

```ts
// Proxy tras eksportu ICS wymagających sesji: /api/kalendarz/* → ${TENANT_RUNTIME_URL}/kalendarz/*.
// Wzorzec 1:1 z app/api/wnioski/[[...path]] — opcjonalny catch-all, bo `/api/kalendarz/moje.ics`
// i `/api/kalendarz/subskrypcja` mają jeden segment, a `/api/kalendarz/wniosek/:id/urlop.ics` trzy.
//
// KANAŁ SUBSKRYPCYJNY NIE PRZECHODZI TĘDY i przechodzić nie może: middleware.ts obejmuje
// '/api/:path*' i odrzuca 401 każde żądanie bez ciasteczka sesji, a klient kalendarza go nie ma.
// Kanał obsługuje tenant-runtime bezpośrednio (KalendarzFeedController, port 3001).
//
// proxyToTenantRuntime czyta ciało jako arrayBuffer i przepuszcza content-type oraz
// content-disposition, więc plik .ics dociera do przeglądarki bez zniekształceń — ta sama ścieżka,
// co PDF z dokumenty/:id/pobierz.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('kalendarz', path ?? []), search)
}

export const GET = handle
```

- [ ] **Krok 8: Dopisz nowe trasy do strażnika middleware.** W `apps/web/lib/middleware-api-gate.test.ts` zamień linię `  '/api/voice/transcribe',` (ostatni element tablicy `CHRONIONE`) na:

```ts
  '/api/voice/transcribe',
  // Blok E (M1 j) — eksport ICS. Obie trasy wymagają sesji; kanał subskrypcyjny NIE jest tu
  // wymieniony, bo nie idzie przez BFF (obsługuje go tenant-runtime na :3001).
  '/api/kalendarz/moje.ics',
  '/api/kalendarz/subskrypcja',
```

- [ ] **Krok 9: Sprawdź, że nowa trasa nie otworzyła dziury w bramce.**

```
cd apps/web
npx vitest run lib/api-gate.test.ts lib/middleware-api-gate.test.ts
```

Oczekiwane wyjście: ` Test Files  2 passed (2)` — `/api/kalendarz` nie jest w `PUBLICZNE_API`, więc strażnik parytetu potwierdza, że trasa jest domyślnie zamknięta, a dwa nowe przypadki `it.each` potwierdzają 401 dla anonima.

- [ ] **Krok 10: Wepnij eksport do ekranu Wnioski — importy.** W `apps/web/components/wnioski/wnioski-screen.tsx` zamień linię:

```tsx
import { IconCheck, IconClose, IconPlus } from '@/components/icons'
```

na:

```tsx
import { IconCalendar, IconCheck, IconClose, IconFileText, IconPlus } from '@/components/icons'
```

oraz zamień linię `} from '@/lib/wnioski'` na:

```tsx
} from '@/lib/wnioski'
import {
  ICS_EXPORT_HINT,
  ICS_EXPORT_LABEL,
  fetchSubscription,
  icsMojeHref,
  icsWniosekHref,
  webcalUrl,
  type SubscriptionResponse,
} from '@/lib/kalendarz-ics'
```

- [ ] **Krok 11: Dodaj stan subskrypcji.** W tym samym pliku zamień blok:

```tsx
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
```

na:

```tsx
  const [subskrypcja, setSubskrypcja] = useState<SubscriptionResponse | null>(null)

  useEffect(() => {
    let anulowane = false
    void fetchSubscription()
      .then((s) => {
        if (!anulowane) setSubskrypcja(s)
      })
      .catch(() => {
        // 404 (konto bez kartoteki) albo 5xx — ekran mówi „wyłączony", nigdy nie zmyśla adresu.
        if (!anulowane) setSubskrypcja({ available: false, path: null, url: null })
      })
    return () => {
      anulowane = true
    }
  }, [])

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
```

- [ ] **Krok 12: Dodaj kartę eksportu.** W tym samym pliku zamień linię:

```tsx
        {mine.length === 0 ? (
```

na:

```tsx
        <Card className="p-4 mb-3">
          <h3 className="font-display font-bold text-[15px] text-navy mb-1">{ICS_EXPORT_LABEL}</h3>
          <p className="text-muted-2 text-[13px] mb-3">{ICS_EXPORT_HINT}</p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={icsMojeHref()}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line text-[13px] text-navy hover:bg-surface-2"
            >
              <IconFileText className="w-4 h-4" strokeWidth={2} />
              Pobierz wszystkie urlopy (.ics)
            </a>
            {subskrypcja?.available && subskrypcja.url != null ? (
              <>
                <a
                  href={webcalUrl(subskrypcja.url) ?? subskrypcja.url}
                  className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line text-[13px] text-navy hover:bg-surface-2"
                >
                  <IconCalendar className="w-4 h-4" strokeWidth={2} />
                  Subskrybuj kanał
                </a>
                <code className="text-[12px] text-muted-2 break-all">{subskrypcja.url}</code>
              </>
            ) : (
              <span className="text-muted-2 text-[13px]">
                Kanał subskrypcyjny jest wyłączony w tym środowisku (brak ICS_FEED_SECRET).
              </span>
            )}
          </div>
        </Card>

        {mine.length === 0 ? (
```

- [ ] **Krok 13: Dodaj pobranie pojedynczego wniosku.** W tym samym pliku, w sekcji „Moje wnioski", zamień blok:

```tsx
                    <Td className="text-right pr-4">
                      {actions.length > 0 ? (
                        <Button
                          variant="ghost"
                          className="h-8 px-3 text-[13px]"
                          onClick={() => void run(l.id, 'cancel')}
                          disabled={busy.has(`${l.id}:cancel`)}
                        >
                          <IconClose className="w-4 h-4" strokeWidth={2} />
                          Anuluj
                        </Button>
                      ) : (
                        <span className="text-muted-2 text-xs">—</span>
                      )}
                    </Td>
```

na:

```tsx
                    <Td className="text-right pr-4">
                      <div className="inline-flex items-center gap-1.5">
                        <a
                          href={icsWniosekHref(l.id)}
                          title="Pobierz ten urlop jako plik .ics"
                          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] text-navy hover:bg-surface-2"
                        >
                          <IconFileText className="w-4 h-4" strokeWidth={2} />
                          .ics
                        </a>
                        {actions.length > 0 ? (
                          <Button
                            variant="ghost"
                            className="h-8 px-3 text-[13px]"
                            onClick={() => void run(l.id, 'cancel')}
                            disabled={busy.has(`${l.id}:cancel`)}
                          >
                            <IconClose className="w-4 h-4" strokeWidth={2} />
                            Anuluj
                          </Button>
                        ) : null}
                      </div>
                    </Td>
```

- [ ] **Krok 14: Uruchom typecheck, lint i cały pakiet testów web.**

```
cd apps/web
npx tsc --noEmit
npx eslint app components lib middleware.ts
npx vitest run
```

Oczekiwane wyjście: typecheck i lint bez wypisanych błędów (kod wyjścia 0); vitest kończy się `Test Files` bez ani jednego `failed`, a liczba w `Tests` jest o **7** wyższa niż przed blokiem E (5 z `kalendarz-ics.test.ts` + 2 nowe przypadki `it.each` w `middleware-api-gate.test.ts`).

- [ ] **Krok 15: Commit.**

```
git add apps/web/app/api/kalendarz apps/web/lib/kalendarz-ics.ts apps/web/lib/kalendarz-ics.test.ts apps/web/lib/middleware-api-gate.test.ts apps/web/components/wnioski/wnioski-screen.tsx
git commit -m "feat(web): eksport ICS na ekranie Wnioski (pobranie pliku + adres kanalu)"
```

---

### Zadanie 48 (E-9): Weryfikacja na żywym stacku + E2E

**Pliki:** utwórz `apps/web/e2e/ics-export.spec.ts`.

Dzialający stack to projekt Compose o nazwie **`hrobot`** (`docker compose ls` → `hrobot  running(10)`), a `docker-compose.yml` nie ma klucza `name:` — **bez `-p hrobot` powstałby drugi, równoległy stack o nazwie katalogu.** Wszystkie komendy poniżej pinują projekt jawnie. Powłoka: **Bash (Git Bash)**.

- [ ] **Krok 1: Ustaw sekret w pliku roboczym `.env`** (gitignored, `.gitignore:13`).

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2
printf 'ICS_FEED_SECRET=%s\n' "$(openssl rand -base64 48 | tr -d '\n')" >> .env
grep -c '^ICS_FEED_SECRET=' .env
```

Oczekiwane wyjście: `1`.

- [ ] **Krok 2: Przebuduj i podnieś tenant-runtime w projekcie `hrobot`.**

```
docker compose -p hrobot --profile full up -d --build tenant-runtime
docker compose -p hrobot ps tenant-runtime
```

Oczekiwane wyjście: w wierszu `tenant-runtime` kolumna `STATUS` zawiera `healthy`.

- [ ] **Krok 3: Potwierdź, że trasa uwierzytelniona odmawia bez tokenu.**

```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/kalendarz/moje.ics
```

Oczekiwane wyjście: `401`.

- [ ] **Krok 4: Potwierdź, że kanał odrzuca zmyślony token.**

```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/kalendarz/feed/4mobility.emp-1.zmyslony/kalendarz.ics
```

Oczekiwane wyjście: `401`.

- [ ] **Krok 5: Napisz E2E sprawdzający pełną ścieżkę, w tym kryterium E-4.** Utwórz `apps/web/e2e/ics-export.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

/**
 * Eksport ICS (blok E, M1 j). Sprawdza to, czego test jednostkowy nie sprawdzi: że plik dojeżdża
 * przez BFF z właściwym typem MIME, że kanał odmawia po podmianie tokenu i że anulowanie wniosku
 * ZMIENIA kanał (kryterium E-4) — na żywych danych, nie na atrapie.
 *
 * Konta i selektory jak w e2e/smoke.spec.ts i e2e/km3-modules-reachable.spec.ts (formularz logowania
 * ma pola `input[name="login"]` i `input[name="pw"]`; konta z scripts/seed-keycloak-demo.mjs).
 *
 * Uruchomienie przeciw stackowi compose (front jest wewnętrzny, publiczny origin to Caddy na 8080):
 *   E2E_BASE_URL=http://localhost:8080 npx playwright test e2e/ics-export.spec.ts
 */

const LOGIN = process.env.E2E_USERNAME ?? 'pracownik.demo'
const PASSWORD = process.env.E2E_PASSWORD ?? 'Pracownik!2026'

/** Blok VEVENT zawierający podany UID, jako tablica wierszy. Pusta, gdy zdarzenia nie ma. */
function vevent(ics: string, uid: string): string[] {
  const wiersze = ics.split('\r\n')
  for (let i = 0; i < wiersze.length; i += 1) {
    if (wiersze[i] !== 'BEGIN:VEVENT') continue
    const koniec = wiersze.indexOf('END:VEVENT', i)
    const blok = wiersze.slice(i, koniec + 1)
    if (blok.includes(`UID:${uid}`)) return blok
  }
  return []
}

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies()
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name="login"]').fill(LOGIN)
  await page.locator('input[name="pw"]').fill(PASSWORD)
  await page.getByRole('button', { name: /Zaloguj/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
})

test('ekran Wnioski oferuje eksport ICS i nie obiecuje integracji z Google/Microsoft', async ({ page }) => {
  await page.goto('/wnioski', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Eksport ICS')).toBeVisible({ timeout: 30_000 })
  const tresc = (await page.locator('body').innerText()).toLowerCase()
  expect(tresc).not.toContain('google calendar')
  expect(tresc).not.toContain('microsoft 365')
})

test('pobranie własnych urlopów zwraca poprawny plik text/calendar bez PII', async ({ page }) => {
  const res = await page.request.get('/api/kalendarz/moje.ics')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('text/calendar')
  const body = await res.text()
  expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
  expect(body.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
  // Zero PII: jedyny tytuł, jaki plik zna, to stała neutralna.
  for (const linia of body.split('\r\n').filter((l) => l.startsWith('SUMMARY'))) {
    expect(linia).toBe('SUMMARY:Urlop')
  }
})

test('kanał subskrypcyjny jest osiągalny własnym adresem i odmawia po podmianie tokenu', async ({ page, request }) => {
  const sub = (await (await page.request.get('/api/kalendarz/subskrypcja')).json()) as {
    available: boolean
    url: string | null
  }
  expect(sub.available, 'ICS_FEED_SECRET nie jest ustawiony — wróć do kroku 1 zadania 9').toBe(true)
  expect(sub.url).not.toBeNull()

  const ok = await request.get(sub.url!)
  expect(ok.status()).toBe(200)
  expect((await ok.text()).startsWith('BEGIN:VCALENDAR')).toBe(true)

  const podmieniony = sub.url!.replace(
    /\/feed\/([^.]+)\.([^.]+)\./,
    '/feed/$1.00000000-0000-4000-8000-000000000000.',
  )
  expect((await request.get(podmieniony)).status()).toBe(401)
})

test('E-4: anulowanie wniosku zmienia kanał na STATUS:CANCELLED pod tym samym UID', async ({ page, request }) => {
  const sub = (await (await page.request.get('/api/kalendarz/subskrypcja')).json()) as {
    available: boolean
    url: string | null
  }
  expect(sub.available).toBe(true)

  // Daty w 2027 r., żeby nie kolidować z żadnym scenariuszem demo. Kotwice demo (pracownicy, zmiany)
  // nie są tu dotykane — powstaje jeden wniosek urlopowy, który ten sam test kończy jako CANCELLED.
  const utworzony = await page.request.post('/api/wnioski', {
    data: { type: 'URLOP_WYPOCZYNKOWY', startDate: '2027-03-01', endDate: '2027-03-03' },
  })
  expect(utworzony.status()).toBe(201)
  const { id } = (await utworzony.json()) as { id: string }
  const uid = `urlop-${id}@hrobot.local`

  const przed = vevent(await (await request.get(sub.url!)).text(), uid)
  expect(przed).toContain('STATUS:TENTATIVE')
  expect(przed).toContain('SEQUENCE:0')

  const anulowany = await page.request.post(`/api/wnioski/${id}/cancel`)
  expect(anulowany.status()).toBe(201)

  const po = vevent(await (await request.get(sub.url!)).text(), uid)
  expect(po).toContain('STATUS:CANCELLED')
  expect(po).toContain('SEQUENCE:2')
})
```

- [ ] **Krok 6: Uruchom E2E przeciw żywemu stackowi.**

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2/apps/web
E2E_BASE_URL=http://localhost:8080 npx playwright test e2e/ics-export.spec.ts
```

Oczekiwane wyjście: `4 passed`. (W PowerShell: `$env:E2E_BASE_URL='http://localhost:8080'; npx playwright test e2e/ics-export.spec.ts`.)

- [ ] **Krok 7: Uruchom pełne pakiety, żeby potwierdzić brak regresji.**

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2/apps/tenant-runtime
npx jest
```

Oczekiwane wyjście: `Test Suites:` bez ani jednego `failed`, a liczba w `Tests` o **45** wyższa niż przed blokiem E.

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2/packages/config
npx jest
```

Oczekiwane wyjście: bez `failed`, liczba `Tests` o **5** wyższa niż przed blokiem E.

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2/apps/web
npx vitest run
```

Oczekiwane wyjście: bez `failed`, liczba `Tests` o **7** wyższa niż przed blokiem E.

- [ ] **Krok 8: Commit.**

```
git add apps/web/e2e/ics-export.spec.ts
git commit -m "test(e2e): eksport ICS - plik, kanal, odmowa po podmianie tokenu i kryterium E-4"
```

---

### Zadanie 49 (E-10): Wpis do §5 raportu KM3 (uczciwa deklaracja zakresu)

**Pliki:** zmień `docs/raport-km3/Raport_KM3_HRobot.md`, `docs/raport-km3/build/body.html`, `docs/raport-km3/report.html`, `docs/raport-km3/Raport_KM3_HRobot.pdf`; utwórz `docs/raport-km3/build/assemble-report.mjs`.

`print-km3.mjs` renderuje **`report.html`**, nie `.md` (linia 9: `path.join(ROOT, 'report.html')`). Łańcuch budowania nie był dotąd zapisany w repo — poniższe kroki go zapisują. Zweryfikowane empirycznie: `pandoc Raport_KM3_HRobot.md -f markdown -t html5` odtwarza obecne `build/body.html` **co do bajtu**, a `report.html` to `nagłówek + build/style.html + '</head><body>\n' + build/body.html + '</body></html>\n'`.

- [ ] **Krok 1: Dopisz dwie pozycje do §5.** W `docs/raport-km3/Raport_KM3_HRobot.md` znajdź linię 406:

```
  kotwice demo (36 pracowników, 832 zmiany) pozostają nietknięte.
```

i wstaw **bezpośrednio pod nią**:

```markdown
- [Eksport ICS, nie integracja OAuth z Google/MS.]{.lbl} Interoperacyjność
  kalendarzowa została zrealizowana jako **eksport ICS zgodny z RFC 5545**:
  plik `.ics` do pobrania (pojedynczy wniosek lub wszystkie własne urlopy)
  oraz subskrybowalny kanał per pracownik. **Nie jest to integracja OAuth z
  Google Calendar ani Microsoft 365** --- nie ma rejestracji aplikacji u
  dostawcy, zgód OAuth ani odświeżania tokenów, więc zapis harmonogramu M1 j)
  o integracji z kalendarzami pozostaje zamknięty tylko w części dotyczącej
  interoperacyjności. Zdarzenie ma neutralny tytuł „Urlop" i nie zawiera
  danych osobowych: projekcja odczytu nie pobiera ani rodzaju wniosku (dana o
  zdrowiu), ani uzasadnienia, ani relacji do kartoteki
  (`apps/tenant-runtime/src/kalendarz/kalendarz.service.ts`). Kanał wymaga
  podpisanego tokenu i zwraca wyłącznie urlopy jego właściciela
  (`kalendarz-feed.controller.spec.ts`); zgodność strukturalną z RFC 5545
  sprawdza `ics-rfc5545.validator.ts`.
- [Odwołanie subskrypcji przez rotację sekretu i zasięg kanału.]{.lbl} Token
  kanału ICS jest **bezstanowy** (HMAC-SHA256 z `ICS_FEED_SECRET`), dzięki
  czemu moduł nie tworzy migracji ani nie zmienia danych demonstracyjnych ---
  ale też nie ma tabeli tokenów, więc **nie da się unieważnić pojedynczej
  subskrypcji**: cofnięcie dostępu to rotacja sekretu, która unieważnia
  wszystkie kanały naraz. Kanał jest wystawiony na porcie usługi
  `tenant-runtime`, nie za warstwą BFF (ta odrzuca każde żądanie bez sesji), więc
  **subskrypcja z chmury Google/Microsoft wymaga publicznego adresu**; w
  środowisku demonstracyjnym kanał jest sprawdzalny klientem lokalnym i
  poleceniem `curl`. Brak `ICS_FEED_SECRET` wyłącza kanał w całości (odpowiedź
  503), zamiast wystawiać go bez ochrony.
```

- [ ] **Krok 2: Potwierdź, że nie ruszyłeś istniejących czterech deklaracji.** W powłoce Bash:

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2
git diff --numstat docs/raport-km3/Raport_KM3_HRobot.md
git diff -U0 docs/raport-km3/Raport_KM3_HRobot.md | grep "^-" | grep -v "^---"
```

Oczekiwane wyjście pierwszej komendy: `26	0	docs/raport-km3/Raport_KM3_HRobot.md` (26 wstawionych linii, **0 usuniętych**). Oczekiwane wyjście drugiej komendy: **puste** — sekcja 5 jest dopisana, nie przepisana.

- [ ] **Krok 3: Zapisz w repo brakujący krok składania `report.html`.** Utwórz `docs/raport-km3/build/assemble-report.mjs`:

```js
// Skleja docs/raport-km3/report.html z build/style.html + build/body.html (wyjście pandoca).
//
// DLACZEGO TEN PLIK ISTNIEJE. print-km3.mjs renderuje report.html, a report.html nie był dotąd
// generowany przez nic zapisanego w repo — powstawał ręcznie. Edycja .md bez tego kroku dawała PDF
// sprzed zmiany, w sposób całkowicie niewidoczny. Pełny łańcuch to:
//
//   pandoc Raport_KM3_HRobot.md -f markdown -t html5 -o build/body.html
//   node build/assemble-report.mjs
//   node build/print-km3.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const HEAD =
  '<!doctype html><html lang="pl"><head><meta charset="utf-8">' +
  '<title>Raport z realizacji Kamienia Milowego 3 — HRobot.AI</title>\n'

const style = fs.readFileSync(path.join(ROOT, 'build', 'style.html'), 'utf8')
const body = fs.readFileSync(path.join(ROOT, 'build', 'body.html'), 'utf8')
const out = `${HEAD}${style}</head><body>\n${body}</body></html>\n`

fs.writeFileSync(path.join(ROOT, 'report.html'), out)
console.log(`report.html: ${out.length} znakow`)
```

- [ ] **Krok 4: Zregeneruj `body.html` i `report.html`.** W powłoce Bash:

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2/docs/raport-km3
pandoc Raport_KM3_HRobot.md -f markdown -t html5 -o build/body.html
node build/assemble-report.mjs
grep -c "Eksport ICS, nie integracja OAuth" report.html
```

Oczekiwane wyjście `assemble-report.mjs`: `report.html: <liczba> znakow`. Oczekiwane wyjście `grep -c`: `1`.

- [ ] **Krok 5: Sprawdź, że regeneracja nie przepisała reszty raportu.**

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2
git diff --numstat docs/raport-km3/build/body.html docs/raport-km3/report.html
```

Oczekiwane wyjście: dwa wiersze, w każdym kolumna „usunięte" (druga liczba) równa `0` — pandoc odtwarza dotychczasową treść bez zmian, doklejając tylko nowe akapity.

- [ ] **Krok 6: Zbuduj PDF.**

```
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2
node docs/raport-km3/build/print-km3.mjs
```

Oczekiwane wyjście: zapis `docs/raport-km3/Raport_KM3_HRobot.pdf`; plik ma świeżą datę modyfikacji (`ls -l docs/raport-km3/Raport_KM3_HRobot.pdf`).

- [ ] **Krok 7: Commit.**

```
git add docs/raport-km3/Raport_KM3_HRobot.md docs/raport-km3/build/body.html docs/raport-km3/build/assemble-report.mjs docs/raport-km3/report.html docs/raport-km3/Raport_KM3_HRobot.pdf
git commit -m "docs(km3): par. 5 - eksport ICS zamiast integracji OAuth, zasieg kanalu i rotacja sekretu"
```

---

**Ryzyka bloku E:**

1. **Ekstensja `.ics` w ścieżce trasy.** Segmenty z kropką są w planie zawsze **statyczne** (`moje.ics`, `urlop.ics`, `kalendarz.ics`), a parametr nigdy z kropką nie sąsiaduje. Gdyby ktoś „uprościł" trasę do `@Get('wniosek/:id.ics')`, router Express wciągnąłby `.ics` do wartości parametru i `ParseUUIDPipe` zwróciłby 400 dla poprawnego UUID-a. Objaw byłby mylący: 400 zamiast 404.
2. **Bezstanowy token nie ma unieważnienia pojedynczego.** Adres kanału wycieka razem z historią przeglądarki, zrzutem ekranu albo współdzielonym kalendarzem, a jedyną reakcją jest rotacja `ICS_FEED_SECRET`, która zrywa wszystkie subskrypcje. Alternatywa (tabela tokenów) wymagałaby migracji, czyli złamania planu wycofania bloku E ze specu. Ryzyko jest zgłoszone w §5, nie zamiecione.
3. **Zbyt krótki `ICS_FEED_SECRET` kładzie start usługi, nie pojedyncze żądanie.** `readIcsFeedSecret` rzuca, a wołany jest z `useFactory` providera, czyli przy inicjalizacji modułu. To świadomy wybór (cicha akceptacja słabego sekretu byłaby gorsza), ale konsekwencja jest twarda: literówka w `.env` = kontener nie wstaje. Brak zmiennej jest bezpieczny (kanał 503), zła wartość — nie.
4. **Kanał jest trasą publiczną w usłudze, która poza nim publicznych tras nie ma.** Chroni ją podpis, sprawdzenie statusu najemcy i globalny `ThrottlerGuard` (`{ ttl: 60_000, limit: 100 }`), ale każda przyszła zmiana w `KalendarzFeedController` wychodzi poza `@TenantRoute()` i nie ma za sobą `KeycloakJwtGuard`. Sześć testów z zadania 7 plus weryfikacja negatywna (krok 5) są tam po to, żeby regresja była głośna.
5. **Wnioski `PENDING` w kanale.** Kanał pokazuje także wnioski nierozpatrzone jako `TENTATIVE`. To decyzja z „Ustaleń": bez niej kryterium E-4 byłoby niesprawdzalne, skoro `APPROVED` jest stanem terminalnym. Konsekwencja: we własnym kalendarzu pracownika pojawia się absencja, która może zostać odrzucona — wtedy dostaje nagrobek `STATUS:CANCELLED` i znika. Jeśli odbiorca uzna to za niepożądane, zmiana to jedna gałąź w `leaveStatusToIcsStatus` plus filtr w `calendarForEmployee` — i utrata sprawdzalności E-4.
6. **`ParseUUIDPipe` na trasie pobrania pojedynczego wniosku** odrzuca id spoza formatu UUID zanim `LeaveService.getById` zdąży rozstrzygnąć zakres. To 400 zamiast 404 dla śmieciowego id — zgodne z zachowaniem `/wnioski/:id` (`leave.controller.ts:52`), ale test jednostkowy kontrolera go nie widzi (pipeline HTTP nie działa przy bezpośrednim wywołaniu metody).
7. **Blok E dodaje 18. trasę BFF.** Dziś jest ich 17. `apps/web/lib/api-gate.test.ts` asertuje `>= 17`, więc się nie zapali, ale **kryterium akceptacji A-2 ze specu mówi „każda z 17 tras BFF"** — blok A musi to policzyć na nowo. Blok E ze swojej strony dopisał dwie nowe ścieżki do `CHRONIONE` w `middleware-api-gate.test.ts` (zadanie 8, krok 8).
8. **E2E dla E-4 tworzy wniosek urlopowy na żywym najemcy demo** (daty 2027-03-01…03, `pracownik.demo`) i kończy go jako `CANCELLED`. Kotwice demo (39 pracowników, 1558 zmian) nie są dotykane — `leave_requests` to inna tabela — ale w bazie demo zostaje jeden anulowany wniosek na osi 2027. Jeśli to nieakceptowalne przed odbiorem, ten jeden test należy odpalić na kopii, a nie na demie.
9. **Rozjazd kotwic demo w raporcie.** `Raport_KM3_HRobot.md:406` i `:227` mówią „36 pracowników, 832 zmiany", brief mówi 39/1558. Blok E tych linii nie dotyka; rozstrzygnięcie należy do integratora przed złożeniem raportu.
10. **Łańcuch budowania PDF-a raportu był dotąd niezapisany.** Zadanie 10 go zapisuje (`build/assemble-report.mjs` + komenda pandoca w komentarzu tego pliku). Do czasu, aż inne bloki też z niego skorzystają, istnieje ryzyko, że ktoś zmieni `.md` i uruchomi sam `print-km3.mjs` — dostanie PDF sprzed swojej zmiany, bez żadnego komunikatu.

**Wycofanie bloku E:**

Blok E nie tworzy migracji, nie zapisuje ani jednego wiersza (wszystkie trasy to `GET`, `AuditInterceptor` no-opuje poza `POST/PATCH/PUT/DELETE`) i nie importuje `scoring.util.ts`. Wycofanie w całości:

```
git rm -r apps/tenant-runtime/src/kalendarz apps/web/app/api/kalendarz
git rm apps/web/lib/kalendarz-ics.ts apps/web/lib/kalendarz-ics.test.ts apps/web/e2e/ics-export.spec.ts
git rm docs/raport-km3/build/assemble-report.mjs
git checkout -- apps/tenant-runtime/src/app.module.ts apps/web/components/wnioski/wnioski-screen.tsx apps/web/lib/middleware-api-gate.test.ts
git checkout -- packages/config/src/env.ts packages/config/src/index.ts packages/config/src/env.test.ts .env.example docker-compose.yml
git checkout -- docs/raport-km3/Raport_KM3_HRobot.md docs/raport-km3/build/body.html docs/raport-km3/report.html docs/raport-km3/Raport_KM3_HRobot.pdf
pnpm --filter @hrobot/config build
```

Ostatnia linia jest konieczna: bez niej `packages/config/dist` zostaje z `readIcsFeedSecret`, którego już nie ma w źródłach.

Wycofanie częściowe, bez dotykania kodu: usuń linię `ICS_FEED_SECRET=` z `.env` i uruchom `docker compose -p hrobot --profile full up -d tenant-runtime`. Kanał subskrypcyjny odpowiada wtedy 503, ekran Wnioski pokazuje „Kanał subskrypcyjny jest wyłączony w tym środowisku", a pobranie pliku `.ics` (trasa uwierzytelniona sesją) działa dalej. Rotacja samego sekretu unieważnia wszystkie wydane adresy kanałów, nie ruszając niczego innego.

---

## Kolizje i decyzje otwarte

Wszystko poniżej wymaga decyzji **człowieka** przed uruchomieniem planu albo — tam, gdzie to zaznaczono — w trakcie, w konkretnym kroku. Żadna z tych pozycji nie da się rozstrzygnąć „w locie" przez wykonawcę bez ryzyka, że dokument odbiorczy powie coś, czego nie ma w kodzie.

### K-1. Inwentarz tras BFF: 17 czy 18? *(bloki A × E — najdroższa kolizja)*

Blok E dodaje `apps/web/app/api/kalendarz/[[...path]]/route.ts`, czyli 18. trasę. Blok A przypina liczbę 17 w **czterech** niezależnych miejscach:

| Miejsce | Wartość w planie A | Wartość po bloku E (wyliczona) |
|---|---|---|
| `apps/web/lib/api-gate.security.test.ts` — lista nazw | 17 tras wymienionych co do znaku | 18 (dochodzi `/api/kalendarz/[[...path]]`) |
| `apps/web/lib/api-gate.security.test.ts` — partycja | 14 bramkowanych / 3 publiczne | 15 / 3 |
| `apps/web/lib/api-gate.security.test.ts` — suma testów | `Tests 94 passed` | `99` (4 + 2 + 15 + 60 + 15 + 3) |
| `scripts/bff-routes.test.mjs` | `routes.length === 17`, 14 / 3 | 18, 15 / 3 |
| `pnpm test:security` — Krok 37 bloku A | `bff-route-sweep — 94`, `bff-middleware — 49`, `265 testow` | `99`, `51`, `272` |
| Zał. 6 §4 (tabela sond) | 17 wierszy, „z 17 tras BFF **14** odmawia" | 18 wierszy, 15 odmawia |
| Krok 41 bloku A (kontrola wzrokowa) | „tabela §4 ma **17** wierszy" | 18 |

**Decyzja:** albo (a) blok E ląduje **przed** blokiem A i wszystkie powyższe liczby zapisujemy od razu jako 18 / 15 / 3 / 99 / 51 / 272, albo (b) blok A ląduje pierwszy i po bloku E ktoś świadomie aktualizuje siedem miejsc **oraz przedrukowuje Zał. 6**. Rekomendacja planu: wariant (a) — patrz „Graf zależności", faza 1. Liczby 99 / 51 / 272 są **wyliczone, nie zmierzone** — pierwszy przebieg po bloku E musi je potwierdzić; jeśli wyjdą inne, do dokumentu trafia liczba zmierzona.

Uwaga poboczna: kryterium akceptacji **A-2** ze specyfikacji mówi dosłownie „każda z 17 tras BFF". Po bloku E kryterium trzeba przeczytać jako „każda trasa BFF", bo liczba jest własnością repozytorium, nie kryterium.

### K-2. `package.json` — dwie wstawki w to samo miejsce *(A × B)*

Blok A (Kroki 7, 35, 45) wstawia `test:perf`, `test:scripts`, `test:security`, `raport:testy` **zaraz po** `"test:e2e:smoke"`. Blok B (Krok 37) wstawia `audyt`, `test:audyt`, a potem `audyt:pdf` **w to samo miejsce**. Wykonane sekwencyjnie: bezkonfliktowe. Wykonane równolegle w dwóch worktree: konflikt scalania w jednym hunku.

**Decyzja:** ustalić właściciela pliku na czas bloków A i B (rekomendacja: A wstawia swoje cztery wpisy pierwszy, B dokłada trzy pod nimi) albo prowadzić oba bloki sekwencyjnie. Docelowa sekcja `scripts` ma po obu blokach **siedem** nowych wpisów.

### K-3. Trzy skrypty składające `report.html` *(A × B × E)*

| Blok | Plik | Co robi |
|---|---|---|
| A | `docs/raport-km3/build/make-report-html.mjs` | `style.html` + `body.html` → `report.html` (pandoc uruchamiany osobno, w Kroku 50) |
| B | `docs/raport-km3/build/build-report-html.mjs` | pandoc **oraz** złożenie `report.html` (jedna komenda) |
| E | `docs/raport-km3/build/assemble-report.mjs` | `style.html` + `body.html` → `report.html` (jak A, inna nazwa) |

Trzy pliki o jednej odpowiedzialności to dokładnie ta klasa długu, którą sekcja „Struktura plików" ma wyłapywać. Wszystkie trzy odtwarzają istniejący `report.html` co do bajtu (każdy blok to weryfikuje), więc różnica jest wyłącznie w nazwie i w tym, czy pandoc jest w środku.

**Decyzja:** wybrać **jeden** i wykreślić dwa pozostałe z odpowiednich kroków. Rekomendacja: `build-report-html.mjs` z bloku B, bo obejmuje pandoca, czyli usuwa całą klasę błędu „zmieniłem `.md`, wydrukowałem stary PDF" (Ryzyko 10 bloku E). Wtedy: w bloku A Krok 43 tworzy ten plik zamiast `make-report-html.mjs`, a Krok 50 traci pierwszą linię (pandoc); w bloku E Krok 3 zadania 10 znika, a Krok 4 woła `build-report-html.mjs`.

### K-4. §5 raportu KM3 — cztery bloki dopisują do tej samej listy *(A × C × D × E)*

Sekcja `# 5. Ograniczenia realizacji demonstracyjnej (uczciwość)` ma dziś **cztery** pozycje (wiersze 384, 391, 397, 404; łącznie 12 wystąpień `{.lbl}` w całym pliku — zmierzone). Plany dopisują:

| Blok | Ile pozycji | Kotwica wstawienia | Asercja liczbowa w planie |
|---|---|---|---|
| A (Krok 48) | 2 | po `[Dane syntetyczne.]{.lbl}` | „§5 ma **sześć** punktów" (Krok 50) |
| C (zad. 10, Krok 2) | 1 (+1 punkt w §3.3) | po `[Dane syntetyczne.]{.lbl}` | `grep -cF "{.lbl}"` = **13**, `git diff --numstat` = 27 / 0 |
| D (Krok 63) | 1 | po `[Dane syntetyczne.]{.lbl}` | `git diff --stat` = **12 insertions**, 0 deletions |
| E (zad. 10, Krok 1) | 2 | po wierszu 406 | `git diff --numstat` = **26 / 0** |

Każda z tych asercji zakłada, że jej blok jest **jedynym** edytorem pliku. Wykonane po kolei, wszystkie cztery przestają się zgadzać poza pierwszym.

**Stan docelowy, jeśli wszystkie cztery bloki wejdą:** §5 ma **dziesięć** pozycji, a `grep -cF "{.lbl}"` zwraca **18** (12 + 2 + 1 + 1 + 2). Kotwica „po `[Dane syntetyczne.]{.lbl}`" po pierwszym bloku przestaje być ostatnią pozycją listy.

**Decyzja (trzy rzeczy naraz):**
1. **Kolejność pozycji w §5.** Rekomendacja: A → C → D → E (każdy dopisuje na końcu listy, nie po `[Dane syntetyczne.]`), żeby czytelnik dostał najpierw pomiar i bezpieczeństwo, potem trzy deklaracje zakresu funkcjonalnego.
2. **Asercje liczbowe.** Każdy blok musi asertować **przyrost**, nie wartość bezwzględną: `git diff --numstat` liczony wobec stanu sprzed własnej edycji (a nie wobec HEAD gałęzi), a `grep -cF "{.lbl}"` = wartość poprzednia + własne pozycje. Wartość „0 usunięć" pozostaje bez zmian i jest najważniejszą z tych asercji — to ona pilnuje, że §5 jest dopisywana, a nie przepisywana.
3. **Czy §5 z dziesięcioma pozycjami jest jeszcze czytelna dla recenzenta PARP**, czy trzeba ją podzielić na podsekcje („ograniczenia pomiaru", „ograniczenia zakresu funkcjonalnego"). To decyzja właściciela raportu, nie wykonawcy.

### K-5. §8 wykaz załączników — Zał. 6 przed Zał. 7 *(A × B)*

Blok A dopisuje `**Zał. 6**` pod `**Zał. 5**`, blok B dopisuje `**Zał. 7**` pod `**Zał. 6**` i ma to jako jawną bramkę (Krok 60: „jeśli Zał. 6 nie ma na liście, przerwij"). Tabela jest prostą tabelą pandoc o stałej siatce kolumn (kolumna „Nr" 12 znaków, druga od offsetu 15), więc konflikt scalania uszkodziłby jej wyrównanie, nie tylko treść.

**Decyzja:** brak — kolejność jest wymuszona i już zakodowana. Do potwierdzenia jedynie, że **nikt nie prowadzi A i B równolegle** na tym pliku.

### K-6. Audyt zna 10 usług, blok D dodaje jedenastą *(B × D)*

`EXPECTED_SERVICES` w `scripts/audyt/lib.mjs` wymienia dokładnie 10 usług i jawnie uzasadnia, dlaczego `agent` się nie liczy. Blok D dodaje `mailpit` za profilem `full` — czyli usługę uruchamianą tą samą komendą, którą audyt zakłada w Kroku 40. Audyt **nie zapali się na czerwono** (iteruje po `EXPECTED_SERVICES`, nie po tym, co zwrócił Docker), ale Zał. 7 przemilczy działającą usługę.

**Decyzja:** albo (a) `mailpit` **wchodzi** do audytu — wtedy `EXPECTED_SERVICES` ma 11 pozycji, liczba kontroli rośnie z 38 na 40, a testy bloku B zmieniają liczby: `assert.equal(EXPECTED_SERVICES.length, 10)` → 11, `assert.equal(out.length, 20)` → 22, `assert.equal(findings.length, 38)` → 40, `37 × OK` → `39 × OK`, Kroki 41–42 („38 kontroli", „ustalen: 38") → 40; albo (b) `mailpit` **nie wchodzi**, a `scripts/audyt/lib.mjs` dostaje jedno zdanie komentarza mówiące dlaczego (narzędzie testowe, nie składnik produktu — tak samo jak `agent`). Rekomendacja: **(b)**, dla symetrii z istniejącym uzasadnieniem `agent`, i wtedy Zał. 7 nie kłamie, bo jawnie mówi, czego nie audytuje.

### K-7. `docker-compose.yml` i `.env.example` — dwie wstawki w to samo miejsce *(D × E)*

Obie zmiany celują w wiersz `PORT: "3001"` (linia 149) wewnątrz `environment` usługi `tenant-runtime`: D dokłada cztery zmienne `SMTP_*` i wpis w `depends_on`, E dokłada `ICS_FEED_PUBLIC_BASE_URL`. Podobnie `.env.example`: D dopisuje na końcu pliku, E wstawia pod `GLOBAL_ADMIN_JWT_SECRET`.

**Decyzja:** brak sporu merytorycznego — wystarczy **sekwencyjne** scalanie (rekomendacja: D, potem E) i jeden właściciel pliku w danym momencie. Jeśli oba bloki idą równolegle w worktree'ach, konflikt wystąpi na pewno i trzeba go rozwiązać ręcznie, zachowując obie wstawki.

### K-8. Dwie drukarki PDF na tym samym porcie CDP *(A × B)*

`docs/raport-km3/build/print-testy-koncowe.mjs` (A) i `docs/raport-km3/build/print-audyt.mjs` (B) obie ustawiają `const PORT = 9338`. `print-km3.mjs` używa 9337, więc konflikt jest tylko między dwiema nowymi. Uruchomione **sekwencyjnie** działają (każda ubija swój proces Chrome na końcu); uruchomione równolegle — druga nie znajdzie swojego endpointu DevTools albo podłączy się do cudzego.

**Decyzja:** zmienić port w jednej z nich (rekomendacja: `print-audyt.mjs` → `9339`) albo zapisać w obu plikach komentarz „nie uruchamiaj równolegle z drugą drukarką". Rekomendacja: zmiana portu — jest tańsza niż zasada, o której trzeba pamiętać.

### K-9. Kotwice demo 36/832 vs 39/1558 — jeden blok poprawia, dwa zgłaszają jako cudzy problem

Blok A (Krok 47) **poprawia** dwa wystąpienia w `Raport_KM3_HRobot.md` (wiersze 227 i 406) na 39/1558. Blok D (Ryzyko 6) i blok E (Ustalenie 4, Ryzyko 9) opisują ten sam rozjazd jako „zgłaszam, nie ruszam". Po wykonaniu bloku A te dwa zgłoszenia stają się nieaktualne — a ich treść zostaje w tym dokumencie.

Ponadto kotwice 36/832 występują w **szesnastu innych plikach** (blok A, Ryzyka: `docs/HRobotDocs/m-zgodnosc-eu-ai-act.md:142`, `docs/raport-km3/macierz-pokrycia-dokumenty.md:22`, `docs/demo/M2-demo-walkthrough.md:5` i `:29`, `data/m2-evidence/rodo-security-checklist.md:6`, plus 11 plików w `docs/superpowers/`). Blok A świadomie ich nie rusza.

**Decyzja:** (1) potwierdzić, że korekta w `Raport_KM3_HRobot.md` jest pożądana **przed** odbiorem (Zał. 6 i Zał. 7 wydrukują 39/1558, więc rozjazd w jednym pakiecie byłby widoczny); (2) rozstrzygnąć, czy `docs/raport-km3/macierz-pokrycia-dokumenty.md` — jako **Zał. 1**, czyli część tego samego pakietu — też ma zostać poprawiony. Rekomendacja: tak, bo Zał. 1 i Zał. 6 jadą do PARP w jednej kopercie. Pozostałe czternaście plików to dokumentacja wewnętrzna i mogą poczekać.

### K-10. Blok F nie został dostarczony *(luka w samym planie)*

Specyfikacja (`spec-km3-luki.md`) opisuje **sześć** bloków A–F. Ten dokument zawiera pięć: A, B, C, D, E. **Bloku F (M3 b — minimalna ankieta pulsowa i analiza dobrostanu, 3 h, migracja + próg anonimowości 5 odpowiedzi + test regresyjny `compositeScore`) nie ma.**

To nie jest przeoczenie w scalaniu — plan bloku F nie wpłynął do materiału wejściowego. Skutki, które ten dokument już generuje:
- Zał. 6 (generowany przez `scripts/raport-testy-koncowe.mjs`, tablica `LUKI`) wypisze wiersz: *„M3 b) ankiety i analiza dobrostanu — **Dostarcza Blok F**; dobrostan celowo NIE wchodzi do compositeScore…"*. Jeśli blok F nie powstanie, Zał. 6 **obiecuje coś, czego nie ma** — dokładnie ten rodzaj rozjazdu, którego cały ten plan ma unikać.
- „Definicja ukończenia" ze specu (punkt 1: „sześć bloków wdrożonych", punkt 5: „`compositeScore` niezmieniony — dowód liczbowy") nie zostanie spełniona: dowód liczbowy dla `compositeScore` miał być **testem regresyjnym z bloku F** (kryterium F4), a nie samą deklaracją.

**Decyzja (pilna, blokująca treść Zał. 6):**
- (a) **Blok F powstaje** — wtedy trzeba go zaplanować i wstawić do tego dokumentu jako zadania 50+, a jego kolizje (migracja, nowa tabela, ekran, `minPeerGroupSize`) przeanalizować tak samo jak pozostałe; albo
- (b) **Blok F nie powstaje** — wtedy wiersz w tablicy `LUKI` (`scripts/raport-testy-koncowe.mjs`, Krok 40 bloku A) musi zabrzmieć: *„M3 b) ankiety i analiza dobrostanu — **brak pokrycia w kodzie**; zgłoszone w §5 jako pozycja poza zakresem etapu demonstracyjnego"*, **oraz** §5 raportu dostaje jedenastą pozycję o tej treści. Bez tej zmiany Zał. 6 mówi nieprawdę.

Niezależnie od wariantu: **żaden z pięciu opisanych bloków nie dotyka `compositeScore`** i każdy z nich ma na to własny krok dowodowy (B: Ryzyko 7; C: zad. 10 Krok 5; D: Krok 66; E: Ustalenia + wycofanie). Punkt 5 „Definicji ukończenia" jest więc spełniony **negatywnie** (nikt go nie ruszył), ale nie **pozytywnie** (nikt nie policzył wyniku przed i po dla 39 pracowników).

### K-11. Hasło konta `demo` — dwa bloki mówią co innego *(A/B × C)*

- Bloki **A** (`scripts/perf-smoke.mjs`, `PERF_PASSWORD ?? 'demo-staging-2026'`) i **B** (`scripts/audyt-powdrozeniowy.mjs`, `KEYCLOAK_DEMO_PASSWORD ?? 'demo-staging-2026'`) używają wartości `demo-staging-2026` jako **fallbacku** i twierdzą, że jest to domyślna wartość `KEYCLOAK_DEMO_PASSWORD` z `docker-compose.yml` — blok A raportuje przy tym udany pomiar tokenem tego konta (Ustalenie 4: obie ścieżki → 200).
- Blok **C** (Ustalenie 9, zad. 9 Krok 2) twierdzi, że `scripts/demo-up.mjs:22-32` wprost mówi o **rotacji** tej wartości, bo jest w historii gita, i wymaga `DEMO_ADMIN_PASSWORD` ze środowiska, a jego brak jest twardym błędem testu.

Obie obserwacje mogą być prawdziwe naraz (realm postawiony domyślną wartością, mimo że skrypt zaleca rotację), ale plan nie może opierać dwóch narzędzi odbiorczych na sekrecie, o którym trzeci blok mówi „zrotowany".

**Decyzja:** ustawić `DEMO_ADMIN_PASSWORD` **i** `KEYCLOAK_DEMO_PASSWORD` w powłoce przed uruchomieniem bloków A, B i C, i traktować fallback w kodzie wyłącznie jako wygodę lokalną. Jeśli hasło realmu jest inne niż fallback, bloki A i B padną z czytelnym komunikatem (`Keycloak 401 … czy konto demo istnieje?` / `Keycloak zwrócił HTTP 401 dla konta demo`) — to jest zachowanie zamierzone, nie awaria planu.

### K-12. Kolejność Kroków 24 i 25 w bloku A *(pułapka wykonawcza, nie kolizja)*

Krok 24 (weryfikacja negatywna bramy) kończy się `git checkout -- infra/caddy/Caddyfile`, co przywraca stan **z HEAD**. Jeśli Krok 25 (commit) jeszcze nie został wykonany, `git checkout` skasuje cały blok `header` napisany w Kroku 21. Plan bloku A odnotowuje to w nawiasie („Bezpieczna kolejność: Krok 25 → Krok 24"), ale numeracja sugeruje odwrotną.

**Decyzja:** wykonawca ma wykonać **Krok 25 przed Krokiem 24**. Warto rozważyć trwałą zamianę numeracji tych dwóch kroków przy najbliższej redakcji planu.

### K-13. Świadome odstępstwa od specyfikacji — do akceptacji, nie do dyskusji z wykonawcą

| Odstępstwo | Spec mówi | Plan robi | Uzasadnienie w planie |
|---|---|---|---|
| Nazwa adaptera powiadomień | `notifications/email.adapter.ts` | `notifications/notification.email.adapter.ts` | spójność prefiksów w katalogu (blok D, Ustalenie 10) |
| Miejsce podpowiedzi wg roli | `apps/web/lib/agent-glosowy.ts:185` | `apps/web/lib/personalizacja.ts` | `agent-glosowy.ts` jest lustrem kontraktu backendu; logika produktowa rozmyłaby tę zasadę (blok C, Ustalenie 11) |
| Próg wydajnościowy | „p95 < 800/3000/500 ms" | rozliczenie na **p97,5** | `autocannon` v8 nie publikuje p95; p97,5 jest ostrzejsze (blok A, Ustalenie 3) |
| Kryterium „17 tras BFF" | 17 | 17 lub 18 — patrz K-1 | blok E dodaje trasę |
| Bramka audytu „liczba migracji" | „liczba zastosowanych migracji i zgodność schematu" | bramką jest **zgodność struktury**, liczby są raportowane z notą | 6 wpisów w rejestrze wobec 13 katalogów na zdrowym stosie (blok B, Ustalenie 3) |
| Bramka „szyfrowanie PESEL" | kontrola zero-jedynkowa | BŁĄD = zero PESEL-i jawnych; 3 zaślepki = UWAGA | 36/39 zaszyfrowanych na żywym stosie (blok B, Ustalenie 4) |

**Decyzja:** zaakceptować listę w całości albo wskazać pozycje do zmiany **przed** startem. Każde z tych odstępstw jest opisane w treści odpowiedniego bloku, więc recenzent porównujący spec z repo zobaczy je od nas — ale tylko jeśli ktoś je świadomie zatwierdzi.

### K-14. Decyzje produktowe wymagające właściciela produktu, nie wykonawcy

1. **Czy kanał ICS ma pokazywać wnioski `PENDING`** jako `STATUS:TENTATIVE`? Blok E mówi tak i uzasadnia to sprawdzalnością kryterium E-4 (bez `PENDING` nie ma legalnego przejścia do `CANCELLED`, bo `APPROVED` jest stanem terminalnym). Konsekwencja: w kalendarzu pracownika pojawia się absencja, która może zostać odrzucona. Odwrócenie decyzji kosztuje jedną gałąź w `leaveStatusToIcsStatus` **i** utratę automatycznego dowodu na E-4.
2. **Czy akceptujemy trasę publiczną w `tenant-runtime`** (`KalendarzFeedController` poza `@TenantRoute()`) na tydzień przed odbiorem? Chroni ją podpis HMAC, sprawdzenie statusu najemcy i globalny `ThrottlerGuard`, ale to jedyna taka trasa w całej usłudze.
3. **Czy brak unieważnienia pojedynczej subskrypcji ICS** (tylko rotacja `ICS_FEED_SECRET`, zrywająca wszystkie kanały naraz) jest akceptowalny na etapie demonstracyjnym? Alternatywa to tabela tokenów, czyli migracja — a spec deklaruje dla bloku E „brak zmian w danych".
4. **Czy zrzut ekranu ze skrzynki Mailpit** (`docs/raport-km3/assets/mailpit-powiadomienie-urlop.png`, blok D Krok 59) trafia do pakietu dla PARP jako dowód, czy zostaje materiałem wewnętrznym.
5. **Czy `pnpm test:security` z dwoma zestawami `POMINIETY`** (`stt-service` bez `.venv`, izolacja najemców bez `POSTGRES_SUPERUSER_URL`) jest do przyjęcia w Zał. 6, czy przed odbiorem domykamy oba (blok A wskazuje dokładne komendy w „Ryzykach"). Rekomendacja: domknąć — 12/12 zielonych czyta się w protokole inaczej niż 10/12 z dwiema notkami.

### K-15. Co ten plan świadomie zostawia bez zmian

Dla porządku, żeby nikt nie uznał tego za przeoczenie:

- **`compositeScore`** (`apps/tenant-runtime/src/strategic-brain/scoring.util.ts:100`) — nietknięty przez wszystkie pięć bloków, z krokiem dowodowym w każdym z nich.
- **Kotwice demo 39 / 1558** — mierzone (blok B kategoria 6, blok C zad. 10 Krok 6), nigdy modyfikowane. Jedyny zapis do bazy w całym planie poza `audit_log` to wniosek urlopowy tworzony i anulowany przez E2E bloku E (inna tabela).
- **Cztery istniejące deklaracje w §5** — dopisujemy pod nimi, nie przepisujemy; każdy blok asertuje `0 usunięć`.
- **Maszyna stanów wniosku urlopowego** (`packages/shared/src/leave.ts`) — blok E jawnie odmawia dodania przejścia `APPROVED → CANCELLED` i zamiast tego dostosowuje test do istniejącej domeny.
- **Ścieżka odrzucenia zamiany zmiany nie pisze do `audit_log`** — blok D to odnotowuje (Ustalenie 3) i **nie naprawia**; po bloku D jedynym śladem audytowym odrzucenia są dwa wpisy `notification.*`.
- **`--testPathPattern`** (przestarzałe w Jest 30, działa w 29.7.0) — zostaje, z notą w „Ryzykach" bloku A.


---

# ⚠ Blok F — DOŁĄCZONY, ALE NIEZRECENZOWANY

Poniższy blok **nie przeszedł etapu rewizji**. Agent recenzujący przekroczył limit
64 000 tokenów wyjścia i padł, przez co blok F wypadł z syntezy — dokument powyżej
(zadania 1–49) opisuje **pięć bloków, nie sześć**.

Przyczyna jest po stronie konstrukcji workflow, nie planu: schemat recenzenta kazał
mu zwrócić **pełny poprawiony plan** w polu strukturalnym. Przy planie tej długości
to gwarantowany przekroczony limit.

Co z tego wynika dla czytającego:

- treść poniżej to **surowe wyjście planisty**, bez sprawdzenia placeholderów,
  spójności typów, pokrycia specu ani weryfikacji faktów o kodzie;
- pozostałe pięć bloków przeszło tę kontrolę i mają ją udokumentowaną;
- **przed wykonaniem bloku F trzeba go zrecenzować** — inaczej wchodzisz w moduł
  rozliczany w KM3 z planem, którego nikt nie sprawdził;
- pozycja **K-10** w „Kolizjach i decyzjach otwartych" dotyczy dokładnie tego braku:
  Zał. 6 obiecuje „Dostarcza Blok F", a punkt 5 Definicji ukończenia (liczbowy dowód
  niezmienności `compositeScore`) opiera się na teście regresyjnym z tego bloku.

Planista sam zgłosił rozbieżność w moim briefie — wskazałem mu wygenerowaną kopię
schematu Prisma zamiast źródła prawdy. Szczegóły w sekcji „Ustalenia sprzeczne
z założeniem" poniżej.

---

## Blok F — Ankieta pulsowa i analiza dobrostanu (M3 b)

**Ustalenia sprzeczne z założeniem:**

1. **Ścieżka schematu Prisma w briefie wskazuje kopię generowaną.** `packages/db/generated/tenant/schema.prisma` (792 linie) jest bajtowo identyczny z `packages/db/prisma/tenant/schema.prisma` (792 linie), bo generator ma `output = "../../generated/tenant"`. Źródłem prawdy jest **`packages/db/prisma/tenant/schema.prisma`** — tam edytujemy, kopia powstaje z `pnpm -C packages/db db:generate`. Plan używa ścieżki źródłowej.

2. **Migracje: w repo Prisma, na żywym najemcy surowy SQL.** Kod deployu to `prisma migrate deploy` (`packages/db/src/migrateTenant.ts:45`, `apps/tenant-runtime/src/provisioning/steps/run-migrations.step.ts`), ale sprawdzone w żywej bazie: `SELECT migration_name FROM _prisma_migrations` w `hrobot_t_900d948b` zwraca **6 pozycji**, a katalog `packages/db/prisma/tenant/migrations/` ma **13**. Siedem ostatnich (w tym `20260721000000_dokumenty`) wgrano ręcznie przez `psql` + `ALTER TABLE … OWNER TO hu_900d948b`, bez wpisu do `_prisma_migrations` — dokładnie tak, jak opisuje nagłówek `20260721000000_dokumenty/migration.sql`. Plan idzie tą samą drogą i nie dotyka `_prisma_migrations`.

3. **`composite_score` w żywym najemcy jest ZASIANY, nie policzony przez silnik.** `scripts/seed-demo-strategic-brain-peers.sql:18` mówi to wprost: „WARTOSCI SA AUTORSKIE, NIE POLICZONE". Potwierdzone liczbowo: w oknie kończącym się 2026-07-16 jest 39 wierszy, ale tylko **19 różnych** wartości `composite_score`. Konsekwencja dla wymogu krytycznego: **nie da się** udowodnić niezmienności przez „przepuść dane przez `finalizeWindow` przed i po", bo `finalizeWindow` wyprodukowałoby inne liczby niż te rozliczane w KM3 — już dziś, przed blokiem F. Realny dowód liczbowy = Zadanie 1 + Zadanie 8 (zrzut bajtowy przed/po + odtworzenie ścieżki odczytu na 39 wierszach), opisane niżej.

4. **`performance_config` w żywym najemcy jest PUSTA** (`SELECT min_peer_group_size FROM performance_config LIMIT 1` → 0 wierszy). `minPeerGroupSize = 5` pochodzi z syntetycznej domyślnej konfiguracji `performance-config.service.ts:129`, nie z wiersza w bazie. Dlatego próg anonimowości pinujemy do **źródła** tego pliku, a nie do odczytu z DB.

5. **Kotwice w raporcie KM3 §5 są nieaktualne.** `docs/raport-km3/Raport_KM3_HRobot.md:406` mówi „36 pracowników, 832 zmiany"; żywy najemca ma zmierzone **39 pracowników i 1558 zmian** (`SELECT count(*) FROM employees` → 39, `FROM shifts` → 1558), zgodnie z briefem i z `docs/demo/2026-08-10-demo-4mobility-parp.md:48`. To luka §5, nie luka bloku F — Zadanie 12 dopisuje jedno zdanie i **nie** przepisuje istniejących czterech deklaracji.

**Zweryfikowane fakty, na których stoi plan:** 39 pracowników, 1558 zmian, 4 jednostki organizacyjne (Region Centrum 14 osób, Region Północ 13, Region Południe 12, „4Mobility — Operacje" 0), 122 wiersze `employee_performance_snapshot` w 5 oknach, wszystkie z niepustym `composite_score`, 2 pracowników z podpiętym kontem Keycloak (Anna Kowalska, Katarzyna Zając). Stack stoi (10 usług `healthy`).

---

### Zadanie 1: Kotwica liczbowa `compositeScore` — zrzut „przed"

To zadanie MUSI być wykonane **przed jakąkolwiek zmianą kodu bloku F**. Bez zrzutu „przed" nie ma z czym porównywać.

**Pliki:**
- Utwórz: `scripts/composite-score-baseline.mjs`
- Utwórz: `docs/raport-km3/evidence/composite-baseline-przed.json` (wygenerowany, commitowany)

- [ ] **Krok 1: Utwórz katalog na dowody.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
New-Item -ItemType Directory -Force docs\raport-km3\evidence
```

Oczekiwane: katalog `docs/raport-km3/evidence` istnieje.

- [ ] **Krok 2: Napisz skrypt zrzutu i porównania.** Utwórz `scripts/composite-score-baseline.mjs`:

```js
#!/usr/bin/env node
// Kotwica liczbowa KM3: zrzut i BAJTOWE porównanie `composite_score` wszystkich snapshotów żywego
// najemcy. Istnieje po to, żeby zdanie „blok F nie zmienił wyników 39 pracowników" było liczbą,
// nie deklaracją.
//
// DLACZEGO PORÓWNUJEMY TEKST, NIE LICZBY. `composite_score` to postgresowy `numeric` o 30 miejscach
// po przecinku. Rzutowanie na JS `number` gubi końcówkę i potrafi ZAMASKOWAĆ różnicę (albo ją
// wyprodukować). Bierzemy `composite_score::text` i porównujemy napisy — różnica na 28. miejscu
// zapala się tak samo jak różnica na pierwszym.
//
//   node scripts/composite-score-baseline.mjs --dump docs/raport-km3/evidence/composite-baseline-przed.json
//   node scripts/composite-score-baseline.mjs --compare <przed.json> <po.json>
//
// Nadpisywalne przez env: PG_CONTAINER, TENANT_DB.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const PG = process.env.PG_CONTAINER || 'hrobot-postgres-1'
const DB = process.env.TENANT_DB || 'hrobot_t_900d948b'

/** Kotwice danych demo — jeśli którakolwiek się rozjedzie, porównanie wyników jest bez znaczenia,
 *  bo porównywałoby dwa różne zbiory danych. */
const KOTWICA_PRACOWNICY = 39
const KOTWICA_ZMIANY = 1558

const SEP = '\u0001'

function psqlRows(sql) {
  const out = execFileSync(
    'docker',
    ['exec', '-i', PG, 'psql', '-U', 'postgres', '-d', DB, '-t', '-A', '-F', SEP, '-c', sql],
    { encoding: 'utf8' },
  )
  return out
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim())
    .filter(Boolean)
    .map((l) => l.split(SEP))
}

function dump(sciezka) {
  const [emp, shifts, snaps] = psqlRows(
    'SELECT (SELECT count(*) FROM employees), (SELECT count(*) FROM shifts), ' +
      '(SELECT count(*) FROM employee_performance_snapshot);',
  )[0].map(Number)

  const rows = psqlRows(
    "SELECT employee_id, window_start::date, window_end::date, coalesce(composite_score::text,'NULL') " +
      'FROM employee_performance_snapshot ORDER BY employee_id, window_start;',
  )

  const pracownicyZeSnapshotem = new Set(rows.map((r) => r[0])).size

  if (emp !== KOTWICA_PRACOWNICY || shifts !== KOTWICA_ZMIANY) {
    console.error(`✗ Kotwice demo się rozjechały: ${emp} pracowników / ${shifts} zmian ` +
      `(oczekiwano ${KOTWICA_PRACOWNICY} / ${KOTWICA_ZMIANY}). Zrzut byłby bezwartościowy.`)
    process.exit(2)
  }
  if (pracownicyZeSnapshotem !== KOTWICA_PRACOWNICY) {
    console.error(`✗ Snapshoty ma ${pracownicyZeSnapshotem} pracowników, nie ${KOTWICA_PRACOWNICY}.`)
    process.exit(2)
  }

  const doc = {
    tenantDb: DB,
    takenAt: new Date().toISOString(),
    anchors: { employees: emp, shifts, snapshots: snaps, employeesWithSnapshots: pracownicyZeSnapshotem },
    rows,
  }
  mkdirSync(dirname(sciezka), { recursive: true })
  writeFileSync(sciezka, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`✓ ${sciezka}: ${rows.length} wierszy, ${pracownicyZeSnapshotem} pracowników, ${shifts} zmian`)
}

function compare(a, b) {
  const A = JSON.parse(readFileSync(a, 'utf8'))
  const B = JSON.parse(readFileSync(b, 'utf8'))
  const bledy = []

  for (const k of Object.keys(A.anchors)) {
    if (A.anchors[k] !== B.anchors[k]) bledy.push(`kotwica ${k}: ${A.anchors[k]} -> ${B.anchors[k]}`)
  }

  const key = (r) => `${r[0]}|${r[1]}|${r[2]}`
  const mapA = new Map(A.rows.map((r) => [key(r), r[3]]))
  const mapB = new Map(B.rows.map((r) => [key(r), r[3]]))

  for (const [k, v] of mapA) {
    if (!mapB.has(k)) bledy.push(`zniknął wiersz ${k} (było ${v})`)
    else if (mapB.get(k) !== v) bledy.push(`ZMIENIONY WYNIK ${k}: ${v} -> ${mapB.get(k)}`)
  }
  for (const k of mapB.keys()) if (!mapA.has(k)) bledy.push(`doszedł wiersz ${k}`)

  if (bledy.length > 0) {
    console.error(`✗ compositeScore NIE jest identyczny — ${bledy.length} różnic:`)
    for (const b of bledy) console.error(`   ${b}`)
    process.exit(1)
  }
  console.log(`✓ compositeScore identyczny: ${mapA.size} wierszy, ` +
    `${new Set(A.rows.map((r) => r[0])).size} pracowników, porównanie tekstowe bez tolerancji`)
}

const [tryb, ...args] = process.argv.slice(2)
if (tryb === '--dump' && args[0]) dump(args[0])
else if (tryb === '--compare' && args[1]) compare(args[0], args[1])
else {
  console.error('użycie: --dump <plik> | --compare <przed> <po>')
  process.exit(64)
}
```

- [ ] **Krok 3: Uruchom zrzut „przed" i zobacz kotwice.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
node scripts/composite-score-baseline.mjs --dump docs/raport-km3/evidence/composite-baseline-przed.json
```

Oczekiwane wyjście:
```
✓ docs/raport-km3/evidence/composite-baseline-przed.json: 122 wierszy, 39 pracowników, 1558 zmian
```

- [ ] **Krok 4: Sprawdź, że porównanie pliku ze sobą jest zielone (test sanity samego narzędzia).**

```
node scripts/composite-score-baseline.mjs --compare docs/raport-km3/evidence/composite-baseline-przed.json docs/raport-km3/evidence/composite-baseline-przed.json
```

Oczekiwane: `✓ compositeScore identyczny: 122 wierszy, 39 pracowników, porównanie tekstowe bez tolerancji`

- [ ] **Krok 5: Weryfikacja negatywna narzędzia — podrób jeden wynik i zobacz czerwone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
$p = "docs/raport-km3/evidence/composite-baseline-przed.json"
(Get-Content $p -Raw).Replace('"83.000000000000000000000000000000"','"83.000000000000000000000000000001"') | Set-Content -Encoding utf8 "$env:TEMP\fake-po.json"
node scripts/composite-score-baseline.mjs --compare $p "$env:TEMP\fake-po.json"
echo "exit=$LASTEXITCODE"
```

Oczekiwane wyjście (fragment):
```
✗ compositeScore NIE jest identyczny — 1 różnic:
   ZMIENIONY WYNIK <uuid>|2026-05-07|2026-05-21: 83.000000000000000000000000000000 -> 83.000000000000000000000000000001
exit=1
```

- [ ] **Krok 6: Posprzątaj podróbkę i zacommituj kotwicę.**

```
Remove-Item "$env:TEMP\fake-po.json"
git add scripts/composite-score-baseline.mjs docs/raport-km3/evidence/composite-baseline-przed.json
git commit -m "test(km3): kotwica liczbowa compositeScore — zrzut 122 wierszy / 39 pracownikow przed blokiem F"
```

---

### Zadanie 2: Okno pulsowe — funkcja czysta

Okno = tydzień ISO (poniedziałek 00:00 UTC → niedziela). Wybór świadomy: pokrywa się z tygodniem demo 13–19 lipca 2026, nie wymaga żadnej konfiguracji i jest w całości testowalny bez bazy.

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.config.ts`
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.window.ts`
- Test: `apps/tenant-runtime/src/ankieta/ankieta.window.spec.ts`

- [ ] **Krok 1: Napisz stałe modułu.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.config.ts`:

```ts
/**
 * Stałe modułu `ankieta` (M3 b — ankieta pulsowa i analiza dobrostanu).
 *
 * DOBROSTAN NIE WCHODZI DO `compositeScore`. `scoring.util.ts:100-105` renormalizuje wagi po
 * wymiarach OBECNYCH w danym oknie, więc piąty wymiar przeliczyłby wynik KAŻDEGO z 39 pracowników
 * w każdym oknie — czyli liczby rozliczane w macierzy AN-1..AN-13 raportu KM3. Dobrostan jest
 * osobnym sygnałem OBOK, dokładnie jak `retentionSignal`, który też nie wchodzi do wyniku.
 * Pilnuje tego `scoring-izolacja.spec.ts` (izolacja strukturalna) i
 * `composite-score-nietkniety.spec.ts` (dowód liczbowy na 39 pracownikach).
 */

/**
 * Próg anonimowości: poniżej tylu odpowiedzi w jednostce nie pokazujemy ŻADNEJ wartości wyniku.
 * Ta sama liczba, co `minPeerGroupSize` w domyślnej konfiguracji ocen
 * (`../strategic-brain/performance-config.service.ts`) — i to samo uzasadnienie (M10:
 * re-identyfikacja w małej grupie). Parytet obu liczb pilnuje `scoring-izolacja.spec.ts`, który
 * czyta tamten plik jako ŹRÓDŁO, więc nie ma tu importu ani zależności runtime od modułu
 * rozliczanego w KM3.
 */
export const MIN_ANONIMOWOSCI = 5

/** Skala odpowiedzi — jedno pytanie, 1..5. */
export const PULSE_SCORE_MIN = 1
export const PULSE_SCORE_MAX = 5

/** Górny limit komentarza. Komentarz jest OPCJONALNY i jego brak nigdy nie blokuje agregacji. */
export const PULSE_COMMENT_MAX = 500

/** Jedyne pytanie ankiety (M3 b: „jedno pytanie 1–5 + opcjonalny komentarz"). */
export const PULSE_PYTANIE = 'Jak oceniasz swoje samopoczucie w pracy w tym tygodniu?'
```

- [ ] **Krok 2: Napisz CZERWONY test okna.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.window.spec.ts`:

```ts
import { pulseWindow, pulseWindowKey } from './ankieta.window.js'

/** 2026-07-13 to poniedziałek (tydzień demo 13–19 lipca 2026, `docs/demo/2026-08-10-demo-4mobility-parp.md`). */
const PON = '2026-07-13'
const NIE = '2026-07-19'

describe('pulseWindow — tydzień ISO w UTC', () => {
  it('środa w tygodniu demo wpada w okno 13–19 lipca', () => {
    const w = pulseWindow(new Date('2026-07-15T11:24:00.000Z'))
    expect(w.start.toISOString()).toBe(`${PON}T00:00:00.000Z`)
    expect(w.end.toISOString()).toBe(`${NIE}T00:00:00.000Z`)
  })

  it('poniedziałek jest początkiem swojego własnego okna', () => {
    expect(pulseWindow(new Date(`${PON}T00:00:00.000Z`)).start.toISOString()).toBe(`${PON}T00:00:00.000Z`)
  })

  it('niedziela należy jeszcze do tego samego okna, nie do następnego', () => {
    expect(pulseWindow(new Date(`${NIE}T23:59:59.999Z`)).start.toISOString()).toBe(`${PON}T00:00:00.000Z`)
  })

  it('pora dnia nie zmienia okna (inaczej „raz na okno" zależałoby od godziny kliknięcia)', () => {
    const rano = pulseWindow(new Date('2026-07-15T00:00:00.000Z'))
    const wieczor = pulseWindow(new Date('2026-07-15T23:59:59.999Z'))
    expect(rano.start.getTime()).toBe(wieczor.start.getTime())
  })

  it('okno przechodzące przez granicę miesiąca nie rozpada się', () => {
    // 2026-08-01 to sobota → okno 27.07 – 02.08.
    const w = pulseWindow(new Date('2026-08-01T09:00:00.000Z'))
    expect(w.start.toISOString()).toBe('2026-07-27T00:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-08-02T00:00:00.000Z')
  })

  it('klucz okna to data poniedziałku w formacie YYYY-MM-DD', () => {
    expect(pulseWindowKey(pulseWindow(new Date('2026-07-15T11:24:00.000Z')))).toBe(PON)
  })
})
```

- [ ] **Krok 3: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane wyjście (fragment):
```
FAIL src/ankieta/ankieta.window.spec.ts
  ● Test suite failed to run
    Cannot find module './ankieta.window.js' from 'src/ankieta/ankieta.window.spec.ts'
```

- [ ] **Krok 4: Napisz minimalną implementację.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.window.ts`:

```ts
/**
 * Okno ankiety pulsowej — funkcja CZYSTA, bez Prismy, bez konfiguracji, bez `Date.now()` w środku
 * (czas zawsze wchodzi parametrem, żeby test nie zależał od zegara maszyny).
 *
 * Tydzień ISO liczony w UTC: poniedziałek 00:00Z → niedziela 00:00Z. Wybór okna tygodniowego, nie
 * miesięcznego, wynika z tego, że „pulsowa" znaczy częsta i krótka; wyrównanie do poniedziałku
 * pokrywa się z tygodniem demo 13–19 lipca 2026, więc ekran demonstracyjny i dane demo mówią o tym
 * samym oknie bez żadnego mapowania.
 *
 * `windowStart` jest KLUCZEM UNIKALNOŚCI odpowiedzi (`@@unique([employeeId, windowStart])` w
 * `packages/db/prisma/tenant/schema.prisma`) — stąd wymóg, żeby był deterministyczny i niezależny
 * od strefy czasowej procesu.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export interface PulseWindow {
  /** Poniedziałek 00:00:00.000Z. */
  start: Date
  /** Niedziela 00:00:00.000Z tego samego tygodnia (data kalendarzowa, nie koniec doby). */
  end: Date
}

/** Okno tygodnia ISO (UTC), w którym leży `now`. */
export function pulseWindow(now: Date): PulseWindow {
  const polnocUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const dzienTygodnia = new Date(polnocUtc).getUTCDay() // 0 = niedziela
  const przesuniecie = dzienTygodnia === 0 ? 6 : dzienTygodnia - 1
  const start = new Date(polnocUtc - przesuniecie * DAY_MS)
  return { start, end: new Date(start.getTime() + 6 * DAY_MS) }
}

/** `YYYY-MM-DD` poniedziałku — stabilny, czytelny klucz okna w API i w interfejsie. */
export function pulseWindowKey(w: PulseWindow): string {
  return w.start.toISOString().slice(0, 10)
}
```

- [ ] **Krok 5: Uruchom i zobacz zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane:
```
PASS src/ankieta/ankieta.window.spec.ts
Tests:       6 passed, 6 total
```

- [ ] **Krok 6: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add apps/tenant-runtime/src/ankieta
git commit -m "feat(ankieta): okno pulsowe jako tydzien ISO w UTC (funkcja czysta, 6 testow)"
```

---

### Zadanie 3: Agregacja z progiem anonimowości — funkcja czysta

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.agregacja.ts`
- Test: `apps/tenant-runtime/src/ankieta/ankieta.agregacja.spec.ts`

- [ ] **Krok 1: Napisz CZERWONY test agregacji.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.agregacja.spec.ts`:

```ts
import { agregujJednostke, agregujWszystkie, type OdpowiedzDoAgregacji } from './ankieta.agregacja.js'
import { MIN_ANONIMOWOSCI } from './ankieta.config.js'

const U1 = 'unit-centrum'
const U2 = 'unit-polnoc'

const odp = (unitId: string, score: number, comment: string | null = null): OdpowiedzDoAgregacji => ({
  unitId,
  score,
  comment,
})

describe('agregujJednostke — próg anonimowości', () => {
  it('poniżej progu nie zwraca ŻADNEJ wartości wyniku (null, nigdy 0)', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [odp(U1, 5), odp(U1, 4), odp(U1, 5), odp(U1, 1)])
    expect(a.respondentCount).toBe(4)
    expect(a.suppressed).toBe(true)
    expect(a.averageScore).toBeNull()
    expect(a.distribution).toBeNull()
    expect(a.comments).toEqual([])
  })

  it('dokładnie na progu (5) pokazuje średnią i rozkład', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 5), odp(U1, 4), odp(U1, 4), odp(U1, 3), odp(U1, 2),
    ])
    expect(a.respondentCount).toBe(MIN_ANONIMOWOSCI)
    expect(a.suppressed).toBe(false)
    expect(a.averageScore).toBe(3.6)
    expect(a.distribution).toEqual({ '1': 0, '2': 1, '3': 1, '4': 2, '5': 1 })
  })

  it('brak komentarzy NIE blokuje agregacji wyniku', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 3), odp(U1, 3), odp(U1, 3), odp(U1, 3), odp(U1, 3),
    ])
    expect(a.averageScore).toBe(3)
    expect(a.commentCount).toBe(0)
    expect(a.comments).toEqual([])
  })

  it('komentarze mają WŁASNY próg — 5 odpowiedzi, ale 1 komentarz, to nadal jedna osoba', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 3, 'za dużo nadgodzin'), odp(U1, 4), odp(U1, 4), odp(U1, 5), odp(U1, 2),
    ])
    expect(a.averageScore).toBe(3.6)
    expect(a.commentCount).toBe(1)
    expect(a.comments).toEqual([])
  })

  it('komentarze wychodzą dopiero gdy jest ich co najmniej 5, w kolejności NIEZALEŻNEJ od zgłoszenia', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 3, 'ee'), odp(U1, 4, 'cc'), odp(U1, 4, 'aa'), odp(U1, 5, 'dd'), odp(U1, 2, 'bb'),
    ])
    expect(a.comments).toEqual(['aa', 'bb', 'cc', 'dd', 'ee'])
  })

  it('pusty i biały komentarz nie liczy się jako komentarz', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 3, '   '), odp(U1, 4, ''), odp(U1, 4), odp(U1, 5), odp(U1, 2),
    ])
    expect(a.commentCount).toBe(0)
  })

  it('jednostka bez ani jednej odpowiedzi jest widoczna jako 0/5, nie znika z listy', () => {
    const a = agregujJednostke(U2, 'Region Północ', [])
    expect(a.respondentCount).toBe(0)
    expect(a.suppressed).toBe(true)
    expect(a.averageScore).toBeNull()
  })

  it('średnia jest zaokrąglana do 2 miejsc (a nie do liczby całkowitej — 3.33 to nie 3)', () => {
    const a = agregujJednostke(U1, 'Region Centrum', [
      odp(U1, 1), odp(U1, 2), odp(U1, 3), odp(U1, 5), odp(U1, 5), odp(U1, 4),
    ])
    expect(a.averageScore).toBe(3.33)
  })
})

describe('agregujWszystkie', () => {
  it('grupuje po jednostce i zwraca jednostki bez odpowiedzi też', () => {
    const wynik = agregujWszystkie(
      [
        { id: U1, name: 'Region Centrum' },
        { id: U2, name: 'Region Północ' },
      ],
      [odp(U1, 5), odp(U1, 5), odp(U1, 5), odp(U1, 5), odp(U1, 5), odp(U2, 1), odp(U2, 2)],
    )
    expect(wynik.map((j) => j.unitId)).toEqual([U1, U2])
    expect(wynik[0]!.averageScore).toBe(5)
    expect(wynik[1]!.averageScore).toBeNull()
    expect(wynik[1]!.respondentCount).toBe(2)
  })

  it('ŻADNA jednostka poniżej progu nie ma liczbowego wyniku — sprawdzane na całym wyniku', () => {
    const wynik = agregujWszystkie(
      [{ id: U1, name: 'A' }, { id: U2, name: 'B' }],
      [odp(U1, 4), odp(U2, 1), odp(U2, 1), odp(U2, 1), odp(U2, 1)],
    )
    for (const j of wynik) {
      if (j.respondentCount < MIN_ANONIMOWOSCI) {
        expect(j.averageScore).toBeNull()
        expect(j.distribution).toBeNull()
        expect(j.comments).toEqual([])
      }
    }
  })
})
```

- [ ] **Krok 2: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta/ankieta.agregacja.spec.ts
```

Oczekiwane:
```
FAIL src/ankieta/ankieta.agregacja.spec.ts
  ● Test suite failed to run
    Cannot find module './ankieta.agregacja.js' from 'src/ankieta/ankieta.agregacja.spec.ts'
```

- [ ] **Krok 3: Napisz implementację.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.agregacja.ts`:

```ts
import { MIN_ANONIMOWOSCI } from './ankieta.config.js'

/**
 * Agregacja odpowiedzi ankiety pulsowej — funkcja CZYSTA (bez Prismy, bez I/O), żeby próg
 * anonimowości dał się udowodnić testem jednostkowym, a nie „wyklikać" na ekranie.
 *
 * ZASADA NADRZĘDNA: poniżej progu nie wychodzi ŻADNA liczba opisująca wynik — `null`, nigdy `0`.
 * Zero czyta się jak „wszyscy dali najgorszą ocenę", a to jest wypowiedź o ludziach, której nie
 * mamy prawa zrobić z czterech odpowiedzi. Jedyną liczbą, która przechodzi zawsze, jest
 * `respondentCount` — frekwencja, nie wynik; bez niej ekran nie umie powiedzieć, ile jeszcze
 * brakuje, a menedżer nie odróżni „nikt nie odpowiedział" od „za mało, żeby pokazać".
 *
 * KOMENTARZE MAJĄ WŁASNY PRÓG. Pięć odpowiedzi anonimizuje średnią, ale jeżeli komentarz zostawiła
 * JEDNA osoba, to ten komentarz nadal jest wypowiedzią jednej możliwej do wskazania osoby — treść
 * i styl identyfikują skuteczniej niż liczba. Dlatego komentarze wychodzą dopiero, gdy jest ich co
 * najmniej `minAnonimowosci`, i są sortowane leksykograficznie: kolejność zgłoszenia zdradzałaby,
 * kto odpowiedział pierwszy.
 */

export interface OdpowiedzDoAgregacji {
  unitId: string
  score: number
  comment: string | null
}

export interface JednostkaDoAgregacji {
  id: string
  name: string
}

export type RozkladOcen = Record<'1' | '2' | '3' | '4' | '5', number>

export interface AgregatJednostki {
  unitId: string
  /** Nazwa jednostki organizacyjnej — nie jest daną osobową. */
  unitName: string
  /** Frekwencja. Jedyna liczba przechodząca również poniżej progu. */
  respondentCount: number
  /** Liczba niepustych komentarzy. Przechodzi zawsze; treści już nie. */
  commentCount: number
  /** `null` poniżej progu. */
  averageScore: number | null
  /** `null` poniżej progu. */
  distribution: RozkladOcen | null
  /** Pusta lista, dopóki komentarzy nie ma co najmniej `minAnonimowosci`. */
  comments: string[]
  /** `true`, gdy jednostka nie osiągnęła progu — ekran ma pokazać komunikat, nie liczbę. */
  suppressed: boolean
}

const pustyRozklad = (): RozkladOcen => ({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 })

const niepusty = (c: string | null): c is string => typeof c === 'string' && c.trim().length > 0

/** Agregat pojedynczej jednostki. `odpowiedzi` muszą już należeć do tej jednostki. */
export function agregujJednostke(
  unitId: string,
  unitName: string,
  odpowiedzi: OdpowiedzDoAgregacji[],
  minAnonimowosci: number = MIN_ANONIMOWOSCI,
): AgregatJednostki {
  const respondentCount = odpowiedzi.length
  const komentarze = odpowiedzi.map((o) => o.comment).filter(niepusty).map((c) => c.trim())
  const commentCount = komentarze.length

  const podProgiem = respondentCount < minAnonimowosci
  if (podProgiem) {
    return {
      unitId,
      unitName,
      respondentCount,
      commentCount,
      averageScore: null,
      distribution: null,
      comments: [],
      suppressed: true,
    }
  }

  const distribution = pustyRozklad()
  let suma = 0
  for (const o of odpowiedzi) {
    suma += o.score
    const klucz = String(o.score) as keyof RozkladOcen
    distribution[klucz] += 1
  }

  return {
    unitId,
    unitName,
    respondentCount,
    commentCount,
    averageScore: Math.round((suma / respondentCount) * 100) / 100,
    distribution,
    comments: commentCount >= minAnonimowosci ? [...komentarze].sort() : [],
    suppressed: false,
  }
}

/** Agregat dla listy jednostek. Jednostki bez odpowiedzi ZOSTAJĄ na liście (jako 0 / próg). */
export function agregujWszystkie(
  jednostki: JednostkaDoAgregacji[],
  odpowiedzi: OdpowiedzDoAgregacji[],
  minAnonimowosci: number = MIN_ANONIMOWOSCI,
): AgregatJednostki[] {
  const wgJednostki = new Map<string, OdpowiedzDoAgregacji[]>()
  for (const o of odpowiedzi) {
    const lista = wgJednostki.get(o.unitId) ?? []
    lista.push(o)
    wgJednostki.set(o.unitId, lista)
  }
  return jednostki.map((j) => agregujJednostke(j.id, j.name, wgJednostki.get(j.id) ?? [], minAnonimowosci))
}
```

- [ ] **Krok 4: Uruchom i zobacz zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane:
```
PASS src/ankieta/ankieta.window.spec.ts
PASS src/ankieta/ankieta.agregacja.spec.ts
Tests:       16 passed, 16 total
```

- [ ] **Krok 5: Weryfikacja negatywna — cofnij próg i zobacz czerwone.** Zmień tymczasowo w `ankieta.agregacja.ts` warunek `respondentCount < minAnonimowosci` na `respondentCount < 1`, uruchom `npx jest src/ankieta/ankieta.agregacja.spec.ts`. Oczekiwane:

```
● agregujJednostke — próg anonimowości › poniżej progu nie zwraca ŻADNEJ wartości wyniku (null, nigdy 0)
  expect(received).toBe(expected)
  Expected: true
  Received: false
```

Przywróć `minAnonimowosci` i potwierdź zielone.

- [ ] **Krok 6: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add apps/tenant-runtime/src/ankieta
git commit -m "feat(ankieta): agregacja jednostki z progiem anonimowosci 5 (10 testow, prog udowodniony)"
```

---

### Zadanie 4: Model danych i migracja

**Pliki:**
- Zmień: `packages/db/prisma/tenant/schema.prisma`
- Utwórz: `packages/db/prisma/tenant/migrations/20260812090000_ankieta_pulsowa/migration.sql`

- [ ] **Krok 1: Dodaj model `PulseSurveyResponse`.** W `packages/db/prisma/tenant/schema.prisma` dopisz **na końcu pliku**:

```prisma
// ---------------------------------------------------------------------------
// Moduł Ankieta (M3 b): ankieta pulsowa i analiza dobrostanu. Jedno pytanie
// 1–5 + opcjonalny komentarz, jedna odpowiedź na pracownika na tydzień ISO,
// agregacja WYŁĄCZNIE na poziomie jednostki z progiem 5 odpowiedzi.
//
// DOBROSTAN NIE WCHODZI DO `compositeScore`. `scoring.util.ts:100-105`
// renormalizuje wagi po wymiarach obecnych w oknie, więc piąty wymiar
// przeliczyłby wynik każdego z 39 pracowników — czyli liczby rozliczane w
// macierzy AN-1..AN-13 raportu KM3. To jest osobny sygnał obok, jak
// `retentionSignal`. Żadnej relacji do EmployeePerformanceSnapshot.
// ---------------------------------------------------------------------------

/// Jedna odpowiedź w ankiecie pulsowej. `unitId` jest DENORMALIZOWANY (jednostka z chwili
/// odpowiedzi) — dzięki temu agregat nigdy nie dołącza tabeli `employees`, więc na ścieżce odczytu
/// menedżera nie ma żadnego pola z danymi osobowymi do przypadkowego przepuszczenia, a przeniesienie
/// pracownika między jednostkami nie przepisuje historii dobrostanu.
model PulseSurveyResponse {
  id          String             @id @default(uuid())
  employeeId  String             @map("employee_id")
  employee    Employee           @relation("PulseResponseEmployee", fields: [employeeId], references: [id])
  unitId      String             @map("unit_id")
  unit        OrganizationalUnit @relation("PulseResponseUnit", fields: [unitId], references: [id])
  /// Poniedziałek tygodnia ISO (UTC) — klucz okna, patrz src/ankieta/ankieta.window.ts.
  windowStart DateTime           @map("window_start") @db.Date
  windowEnd   DateTime           @map("window_end")   @db.Date
  /// Skala 1..5. Walidowana w DTO i ponownie w serwisie (CHECK w migracji jest trzecią bramką).
  score       Int
  /// Opcjonalny. Jego brak nigdy nie blokuje agregacji.
  comment     String?
  submittedAt DateTime           @default(now()) @map("submitted_at")
  updatedAt   DateTime           @updatedAt @map("updated_at")

  /// „Raz na okno": druga odpowiedź AKTUALIZUJE tę samą, nie tworzy drugiej.
  @@unique([employeeId, windowStart])
  @@index([unitId, windowStart])
  @@map("pulse_survey_response")
}
```

- [ ] **Krok 2: Dopisz relacje zwrotne (Prisma ich wymaga).** W `packages/db/prisma/tenant/schema.prisma`, w modelu `Employee`, tuż przed `@@map("employees")` dodaj:

```prisma
  pulseResponses       PulseSurveyResponse[]         @relation("PulseResponseEmployee")
```

W modelu `OrganizationalUnit`, tuż przed `@@map("organizational_units")` dodaj:

```prisma
  pulseResponses PulseSurveyResponse[] @relation("PulseResponseUnit")
```

- [ ] **Krok 3: Napisz migrację ręcznie (wzorzec `20260721000000_dokumenty`).** Utwórz `packages/db/prisma/tenant/migrations/20260812090000_ankieta_pulsowa/migration.sql`:

```sql
-- Moduł Ankieta (M3 b, greenfield): ankieta pulsowa i analiza dobrostanu.
-- Wyłącznie ADDYTYWNA — jedna nowa tabela, dwa FK do istniejących employees/organizational_units.
-- Zero zmian w istniejących obiektach, w szczególności ZERO zmian w employee_performance_snapshot
-- i performance_config (compositeScore rozliczany w KM3, macierz AN-1..AN-13).
--
-- HAND-AUTHORED (brak osiągalnej bazy shadow z tego środowiska — DATABASE_URL nie jest ustawione,
-- `prisma migrate dev --create-only` kończy się P1012), w kształcie generowanym przez Prismę,
-- wzorem 20260721000000_dokumenty/migration.sql.
--
-- BRAMKA WDROŻENIOWA (nie uruchamiać stąd): sprawdzone w żywym najemcy — `_prisma_migrations`
-- zawiera tylko 6 z 13 migracji, reszta była wgrywana ręcznie przez psql. Ten plik idzie tą samą
-- drogą (Zadanie 11), a po wgraniu tabela należy do roli wgrywającej i MUSI zostać przepisana:
--   ALTER TABLE "pulse_survey_response" OWNER TO hu_900d948b;

-- CreateTable
CREATE TABLE "pulse_survey_response" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "window_start" DATE NOT NULL,
    "window_end" DATE NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pulse_survey_response_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- „Raz na okno" jest niezmiennikiem BAZY, nie tylko serwisu: `upsert` w AnkietaService opiera się
-- dokładnie na tym kluczu, a wyścig dwóch równoległych zapisów tego samego pracownika kończy się
-- P2002, a nie drugim wierszem.
CREATE UNIQUE INDEX "pulse_survey_response_employee_id_window_start_key" ON "pulse_survey_response"("employee_id", "window_start");

-- CreateIndex
CREATE INDEX "pulse_survey_response_unit_id_window_start_idx" ON "pulse_survey_response"("unit_id", "window_start");

-- AddForeignKey
ALTER TABLE "pulse_survey_response" ADD CONSTRAINT "pulse_survey_response_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_survey_response" ADD CONSTRAINT "pulse_survey_response_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "organizational_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trzecia bramka skali 1..5 (pierwsza: DTO class-validator, druga: AnkietaService). Skala jest
-- CAŁYM znaczeniem tej kolumny — wartość spoza niej nie jest „dziwną oceną", tylko uszkodzonym
-- rekordem, którego agregat po cichu wliczyłby do średniej.
ALTER TABLE "pulse_survey_response" ADD CONSTRAINT "pulse_survey_response_score_range" CHECK ("score" BETWEEN 1 AND 5);
```

- [ ] **Krok 4: Wygeneruj klienta i sprawdź, że model istnieje w typach.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
pnpm -C packages/db db:generate
Select-String -Path packages\db\generated\tenant\index.d.ts -Pattern "pulseSurveyResponse" | Select-Object -First 3
```

Oczekiwane: `Generated Prisma Client (v5.22.0) to .\generated\tenant` (dwukrotnie — control-plane i tenant), a `Select-String` zwraca co najmniej jedno trafienie `pulseSurveyResponse`.

- [ ] **Krok 5: Typecheck całego backendu (nic nie mogło się zepsuć od relacji zwrotnych).**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
pnpm -C apps/tenant-runtime typecheck
```

Oczekiwane: brak wyjścia, kod 0.

- [ ] **Krok 6: Commit.**

```
git add packages/db/prisma/tenant/schema.prisma packages/db/prisma/tenant/migrations/20260812090000_ankieta_pulsowa packages/db/generated
git commit -m "feat(db): model PulseSurveyResponse + migracja addytywna (bez zmian w employee_performance_snapshot)"
```

---

### Zadanie 5: `AnkietaService` — zapis „raz na okno"

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.service.ts`
- Test: `apps/tenant-runtime/src/ankieta/ankieta.service.spec.ts`

- [ ] **Krok 1: Napisz CZERWONY test zapisu.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { AnkietaService, type AnkietaActor } from './ankieta.service.js'

/** Mock klienta najemcy — wyłącznie delegaty, których dotyka AnkietaService (idiom `makeClient`
 *  z recommendation.service.spec.ts). Brak `employee.findMany` na ścieżce agregatów jest CELOWY:
 *  gdyby serwis kiedykolwiek sięgnął po kartotekę pracownika, test rzuciłby TypeError. */
function makeClient() {
  return {
    employee: { findFirst: jest.fn() },
    organizationalUnit: { findMany: jest.fn() },
    pulseSurveyResponse: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const AKTOR: AnkietaActor = { userId: 'kc-sub-anna', roles: ['PRACOWNIK'], ipAddress: '10.0.0.1' }
const TERAZ = new Date('2026-07-15T11:24:00.000Z') // środa tygodnia demo 13–19.07

describe('AnkietaService.zapiszOdpowiedz', () => {
  let service: AnkietaService
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({ providers: [AnkietaService] }).compile()
    service = module.get(AnkietaService)
    client = makeClient()
    client.employee.findFirst.mockResolvedValue({ id: 'emp-anna', unitId: 'unit-centrum' })
    client.pulseSurveyResponse.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'resp-1', ...args.create }),
    )
  })

  it('rozwiązuje pracownika po keycloakSub i zapisuje w oknie bieżącego tygodnia', async () => {
    await service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 4, comment: 'ok' }, TERAZ)

    expect(client.employee.findFirst).toHaveBeenCalledWith({
      where: { user: { keycloakSub: 'kc-sub-anna' } },
      select: { id: true, unitId: true },
    })
    const args = client.pulseSurveyResponse.upsert.mock.calls[0]![0] as {
      where: { employeeId_windowStart: { employeeId: string; windowStart: Date } }
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect(args.where.employeeId_windowStart.employeeId).toBe('emp-anna')
    expect((args.where.employeeId_windowStart.windowStart as Date).toISOString()).toBe('2026-07-13T00:00:00.000Z')
    expect(args.create).toMatchObject({ employeeId: 'emp-anna', unitId: 'unit-centrum', score: 4, comment: 'ok' })
  })

  it('druga próba w tym samym oknie AKTUALIZUJE (upsert), nigdy nie tworzy drugiej odpowiedzi', async () => {
    await service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 4 }, TERAZ)
    await service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 2, comment: 'gorzej' }, TERAZ)

    expect(client.pulseSurveyResponse.upsert).toHaveBeenCalledTimes(2)
    // Ten sam klucz w obu wywołaniach → baza ma jeden wiersz.
    const k1 = client.pulseSurveyResponse.upsert.mock.calls[0]![0] as { where: unknown }
    const k2 = client.pulseSurveyResponse.upsert.mock.calls[1]![0] as { where: unknown }
    expect(JSON.stringify(k2.where)).toBe(JSON.stringify(k1.where))
    const drugi = client.pulseSurveyResponse.upsert.mock.calls[1]![0] as { update: Record<string, unknown> }
    expect(drugi.update).toEqual({ score: 2, comment: 'gorzej' })
    // Żadnego `create` z drugą odpowiedzią — `update` istnieje i jest niepuste.
    expect(Object.keys(drugi.update).length).toBeGreaterThan(0)
  })

  it('brak komentarza zapisuje null, a nie pusty napis', async () => {
    await service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 5 }, TERAZ)
    const args = client.pulseSurveyResponse.upsert.mock.calls[0]![0] as { create: { comment: unknown } }
    expect(args.create.comment).toBeNull()
  })

  it('konto bez kartoteki pracownika dostaje 404, a nie 500', async () => {
    client.employee.findFirst.mockResolvedValue(null)
    await expect(service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 3 }, TERAZ)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('ocena spoza 1..5 jest odrzucana także w serwisie (DTO to nie jedyna bramka)', async () => {
    await expect(service.zapiszOdpowiedz(asClient(client), AKTOR, { score: 6 }, TERAZ)).rejects.toThrow(
      /skali 1..5/,
    )
    expect(client.pulseSurveyResponse.upsert).not.toHaveBeenCalled()
  })
})

describe('AnkietaService.mojaOdpowiedz', () => {
  let service: AnkietaService
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({ providers: [AnkietaService] }).compile()
    service = module.get(AnkietaService)
    client = makeClient()
    client.employee.findFirst.mockResolvedValue({ id: 'emp-anna', unitId: 'unit-centrum' })
  })

  it('zwraca okno i pytanie nawet gdy pracownik jeszcze nie odpowiedział', async () => {
    client.pulseSurveyResponse.findUnique.mockResolvedValue(null)
    const out = (await service.mojaOdpowiedz(asClient(client), AKTOR, TERAZ)) as {
      window: { key: string }
      odpowiedz: unknown
    }
    expect(out.window.key).toBe('2026-07-13')
    expect(out.odpowiedz).toBeNull()
  })
})
```

- [ ] **Krok 2: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta/ankieta.service.spec.ts
```

Oczekiwane:
```
FAIL src/ankieta/ankieta.service.spec.ts
  ● Test suite failed to run
    Cannot find module './ankieta.service.js' from 'src/ankieta/ankieta.service.spec.ts'
```

- [ ] **Krok 3: Napisz serwis (bez metody `agregaty` — ta w Zadaniu 6).** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { MIN_ANONIMOWOSCI, PULSE_PYTANIE, PULSE_SCORE_MAX, PULSE_SCORE_MIN } from './ankieta.config.js'
import { pulseWindow, pulseWindowKey, type PulseWindow } from './ankieta.window.js'

/** Aktor projektowany z JWT + IP (wzorzec `LeaveActor` / `DokumentyActor`). */
export interface AnkietaActor {
  userId: string
  roles: string[]
  ipAddress: string
}

export interface ZapisOdpowiedziInput {
  score: number
  comment?: string
}

/**
 * PROJEKCJA WŁASNEJ ODPOWIEDZI. Jedyna ścieżka, która w ogóle zwraca treść pojedynczej odpowiedzi —
 * i tylko WŁASNEJ, rozwiązanej przez `keycloakSub`. Nie ma `employeeId`, bo odbiorcą jest ten sam
 * pracownik: identyfikator niczego mu nie mówi, a każde pole, którego tu nie ma, nie może wyciec.
 */
const MOJA_SELECT = {
  windowStart: true,
  windowEnd: true,
  score: true,
  comment: true,
  submittedAt: true,
  updatedAt: true,
} as const

/**
 * Ankieta pulsowa (M3 b). Serwis pilnuje trzech niezmienników:
 *
 *  1. JEDNA ODPOWIEDŹ NA OKNO — `upsert` po `@@unique([employeeId, windowStart])`; druga próba
 *     aktualizuje tę samą, nie tworzy drugiej.
 *  2. TOŻSAMOŚĆ TYLKO Z TOKENU — pracownik jest rozwiązywany przez `user.keycloakSub`, nigdy z
 *     ciała żądania, więc nie da się odpowiedzieć „za kogoś".
 *  3. AGREGAT NIE WIDZI OSÓB — patrz {@link AnkietaService.agregaty}.
 *
 * Dobrostan NIE dotyka `strategic-brain`: ten plik nie importuje z tamtego modułu niczego, a
 * `scoring-izolacja.spec.ts` sprawdza to strukturalnie.
 */
@Injectable()
export class AnkietaService {
  /** Kartoteka pracownika stojąca za tokenem. 404 zamiast 500, gdy konto nie ma kartoteki
   *  (regresja znana z `/moj-tydzien` — konto bez `Employee` nie może wywalać ekranu). */
  private async mojaKartoteka(client: TenantClient, actor: AnkietaActor): Promise<{ id: string; unitId: string }> {
    const me = (await client.employee.findFirst({
      where: { user: { keycloakSub: actor.userId } },
      select: { id: true, unitId: true },
    })) as { id: string; unitId: string } | null
    if (!me) throw new NotFoundException('Brak kartoteki pracownika dla zalogowanego konta')
    return me
  }

  /** Zapis (lub aktualizacja) odpowiedzi w oknie zawierającym `now`. */
  async zapiszOdpowiedz(
    client: TenantClient,
    actor: AnkietaActor,
    input: ZapisOdpowiedziInput,
    now: Date,
  ): Promise<unknown> {
    if (!Number.isInteger(input.score) || input.score < PULSE_SCORE_MIN || input.score > PULSE_SCORE_MAX) {
      throw new BadRequestException(`Ocena musi być liczbą całkowitą ze skali 1..5 (otrzymano ${input.score})`)
    }
    const me = await this.mojaKartoteka(client, actor)
    const window = pulseWindow(now)
    const comment = input.comment && input.comment.trim().length > 0 ? input.comment.trim() : null

    return client.pulseSurveyResponse.upsert({
      where: { employeeId_windowStart: { employeeId: me.id, windowStart: window.start } },
      update: { score: input.score, comment },
      create: {
        employeeId: me.id,
        unitId: me.unitId,
        windowStart: window.start,
        windowEnd: window.end,
        score: input.score,
        comment,
      },
      select: MOJA_SELECT,
    } as never)
  }

  /** Własna odpowiedź w bieżącym oknie (albo `null`) + metadane okna dla ekranu. */
  async mojaOdpowiedz(client: TenantClient, actor: AnkietaActor, now: Date): Promise<unknown> {
    const me = await this.mojaKartoteka(client, actor)
    const window = pulseWindow(now)
    const odpowiedz = await client.pulseSurveyResponse.findUnique({
      where: { employeeId_windowStart: { employeeId: me.id, windowStart: window.start } },
      select: MOJA_SELECT,
    } as never)
    return { window: this.opisOkna(window), pytanie: PULSE_PYTANIE, minAnonimowosci: MIN_ANONIMOWOSCI, odpowiedz }
  }

  protected opisOkna(window: PulseWindow): { start: string; end: string; key: string } {
    return {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      key: pulseWindowKey(window),
    }
  }
}
```

- [ ] **Krok 4: Uruchom i zobacz zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane:
```
Tests:       22 passed, 22 total
```

- [ ] **Krok 5: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add apps/tenant-runtime/src/ankieta
git commit -m "feat(ankieta): AnkietaService — jedna odpowiedz na okno, tozsamosc wylacznie z tokenu"
```

---

### Zadanie 6: `AnkietaService.agregaty` — menedżer nie widzi pojedynczej osoby

**Pliki:**
- Zmień: `apps/tenant-runtime/src/ankieta/ankieta.service.ts`
- Test: `apps/tenant-runtime/src/ankieta/ankieta.rodo.spec.ts`

- [ ] **Krok 1: Napisz CZERWONY test RODO/agregatów.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.rodo.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { AnkietaService } from './ankieta.service.js'
import type { AnkietaActor } from './ankieta.service.js'
import type { AgregatJednostki } from './ankieta.agregacja.js'

function makeClient() {
  return {
    employee: { findFirst: jest.fn() },
    organizationalUnit: { findMany: jest.fn() },
    pulseSurveyResponse: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const MENEDZER: AnkietaActor = { userId: 'kc-sub-manager', roles: ['MANAGER'], ipAddress: '10.0.0.2' }
const TERAZ = new Date('2026-07-15T11:24:00.000Z')

const U_CENTRUM = 'unit-centrum'
const U_POLNOC = 'unit-polnoc'

describe('AnkietaService.agregaty — granica RODO', () => {
  let service: AnkietaService
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({ providers: [AnkietaService] }).compile()
    service = module.get(AnkietaService)
    client = makeClient()
    client.organizationalUnit.findMany.mockResolvedValue([
      { id: U_CENTRUM, name: 'Region Centrum' },
      { id: U_POLNOC, name: 'Region Północ' },
    ])
  })

  it('ZAPYTANIE do bazy nie prosi o employeeId ani o kartotekę — agregat nie ma czego wyciec', async () => {
    client.pulseSurveyResponse.findMany.mockResolvedValue([])
    await service.agregaty(asClient(client), null, TERAZ)

    const args = client.pulseSurveyResponse.findMany.mock.calls[0]![0] as { select: Record<string, unknown> }
    expect(Object.keys(args.select).sort()).toEqual(['comment', 'score', 'unitId'])
    expect(args.select).not.toHaveProperty('employeeId')
    expect(args.select).not.toHaveProperty('employee')
    // Kartoteka nie jest w ogóle czytana na tej ścieżce.
    expect(client.employee.findFirst).not.toHaveBeenCalled()
  })

  it('jednostka z 4 odpowiedziami nie zwraca ŻADNEJ liczby wyniku', async () => {
    client.pulseSurveyResponse.findMany.mockResolvedValue([
      { unitId: U_POLNOC, score: 1, comment: 'ciężko' },
      { unitId: U_POLNOC, score: 2, comment: null },
      { unitId: U_POLNOC, score: 1, comment: null },
      { unitId: U_POLNOC, score: 5, comment: null },
    ])
    const out = (await service.agregaty(asClient(client), null, TERAZ)) as { jednostki: AgregatJednostki[] }
    const polnoc = out.jednostki.find((j) => j.unitId === U_POLNOC)!
    expect(polnoc.respondentCount).toBe(4)
    expect(polnoc.suppressed).toBe(true)
    expect(polnoc.averageScore).toBeNull()
    expect(polnoc.distribution).toBeNull()
    expect(polnoc.comments).toEqual([])
  })

  it('w CAŁEJ odpowiedzi API nie ma ani jednego identyfikatora pracownika', async () => {
    client.pulseSurveyResponse.findMany.mockResolvedValue([
      { unitId: U_CENTRUM, score: 5, comment: 'super' },
      { unitId: U_CENTRUM, score: 4, comment: 'ok' },
      { unitId: U_CENTRUM, score: 4, comment: 'ok2' },
      { unitId: U_CENTRUM, score: 3, comment: 'ok3' },
      { unitId: U_CENTRUM, score: 2, comment: 'ok4' },
    ])
    const out = await service.agregaty(asClient(client), null, TERAZ)
    const json = JSON.stringify(out)
    expect(json).not.toMatch(/employeeId/i)
    expect(json).not.toMatch(/emp-/)
    expect(json).not.toMatch(/keycloak/i)
  })

  it('MANAGER dostaje wyłącznie swoje jednostki — zakres idzie do OBU zapytań', async () => {
    client.organizationalUnit.findMany.mockResolvedValue([{ id: U_POLNOC, name: 'Region Północ' }])
    client.pulseSurveyResponse.findMany.mockResolvedValue([])
    await service.agregaty(asClient(client), [U_POLNOC], TERAZ)

    const unitArgs = client.organizationalUnit.findMany.mock.calls[0]![0] as { where: unknown }
    expect(unitArgs.where).toEqual({ id: { in: [U_POLNOC] } })
    const respArgs = client.pulseSurveyResponse.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }
    expect(respArgs.where.unitId).toEqual({ in: [U_POLNOC] })
  })

  it('pusty zakres MANAGERA zwraca zero jednostek, nigdy obejście do widoku globalnego', async () => {
    client.organizationalUnit.findMany.mockResolvedValue([])
    client.pulseSurveyResponse.findMany.mockResolvedValue([])
    const out = (await service.agregaty(asClient(client), [], TERAZ)) as { jednostki: AgregatJednostki[] }
    expect(out.jednostki).toEqual([])
  })

  it('serwis NIE udostępnia żadnej metody zwracającej cudzą pojedynczą odpowiedź', () => {
    const metody = Object.getOwnPropertyNames(AnkietaService.prototype)
    expect(metody.sort()).toEqual(['agregaty', 'constructor', 'mojaKartoteka', 'mojaOdpowiedz', 'opisOkna', 'zapiszOdpowiedz'])
  })
})
```

- [ ] **Krok 2: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta/ankieta.rodo.spec.ts
```

Oczekiwane:
```
● AnkietaService.agregaty — granica RODO › ZAPYTANIE do bazy nie prosi o employeeId ...
  TypeError: service.agregaty is not a function
```

- [ ] **Krok 3: Dopisz metodę `agregaty` do serwisu.** W `apps/tenant-runtime/src/ankieta/ankieta.service.ts` dodaj import agregacji na górze:

```ts
import { agregujWszystkie, type AgregatJednostki } from './ankieta.agregacja.js'
```

i wstaw metodę **przed** `protected opisOkna(...)`:

```ts
  /**
   * Agregaty dobrostanu w bieżącym oknie, per jednostka.
   *
   * TO JEST GRANICA RODO MODUŁU i jest ona egzekwowana PROJEKCJĄ, nie filtrowaniem po fakcie:
   * `select` prosi bazę wyłącznie o `unitId`, `score` i `comment`. Serwis fizycznie nie dostaje
   * `employeeId`, więc nie ma czego zgubić po drodze do odpowiedzi — żaden przyszły refaktor
   * mapowania nie „odsłoni" pola, którego w wyniku zapytania nie ma. Kartoteka `employees` nie
   * jest tu czytana ani razu.
   *
   * `scopeUnitIds === null` = aktor GLOBALNY (HR/ADMIN, wzorzec `isGlobal` z rbac/unit-scope.ts);
   * tablica (również PUSTA) = MANAGER — pusta daje zero jednostek, nigdy obejście do widoku
   * całego najemcy.
   */
  async agregaty(
    client: TenantClient,
    scopeUnitIds: string[] | null,
    now: Date,
  ): Promise<{
    window: { start: string; end: string; key: string }
    pytanie: string
    minAnonimowosci: number
    jednostki: AgregatJednostki[]
  }> {
    const window = pulseWindow(now)

    const jednostkiWZakresie = (await client.organizationalUnit.findMany({
      where: scopeUnitIds === null ? {} : { id: { in: scopeUnitIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })) as Array<{ id: string; name: string }>

    const odpowiedzi = (await client.pulseSurveyResponse.findMany({
      where: {
        windowStart: window.start,
        ...(scopeUnitIds === null ? {} : { unitId: { in: scopeUnitIds } }),
      },
      select: { unitId: true, score: true, comment: true },
    } as never)) as Array<{ unitId: string; score: number; comment: string | null }>

    return {
      window: this.opisOkna(window),
      pytanie: PULSE_PYTANIE,
      minAnonimowosci: MIN_ANONIMOWOSCI,
      jednostki: agregujWszystkie(jednostkiWZakresie, odpowiedzi, MIN_ANONIMOWOSCI),
    }
  }
```

- [ ] **Krok 4: Uruchom i zobacz zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane:
```
Tests:       28 passed, 28 total
```

- [ ] **Krok 5: Weryfikacja negatywna — dodaj `employeeId` do projekcji i zobacz czerwone.** Zmień tymczasowo `select: { unitId: true, score: true, comment: true }` na `select: { unitId: true, score: true, comment: true, employeeId: true }` i uruchom `npx jest src/ankieta/ankieta.rodo.spec.ts`. Oczekiwane:

```
● ... › ZAPYTANIE do bazy nie prosi o employeeId ani o kartotekę — agregat nie ma czego wyciec
  expect(received).toEqual(expected)
  - Expected  - 0
  + Received  + 1
      "comment",
  +   "employeeId",
      "score",
```

Cofnij zmianę i potwierdź zielone.

- [ ] **Krok 6: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add apps/tenant-runtime/src/ankieta
git commit -m "feat(ankieta): agregaty per jednostka z projekcja bez employeeId (6 testow RODO)"
```

---

### Zadanie 7: Kontroler, DTO, moduł i rejestracja

**Pliki:**
- Utwórz: `apps/tenant-runtime/src/ankieta/dto/odpowiedz-ankiety.dto.ts`
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.controller.ts`
- Utwórz: `apps/tenant-runtime/src/ankieta/ankieta.module.ts`
- Zmień: `apps/tenant-runtime/src/app.module.ts`
- Test: `apps/tenant-runtime/src/ankieta/ankieta.controller.spec.ts`

- [ ] **Krok 1: Napisz DTO.** Utwórz `apps/tenant-runtime/src/ankieta/dto/odpowiedz-ankiety.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { PULSE_COMMENT_MAX, PULSE_SCORE_MAX, PULSE_SCORE_MIN } from '../ankieta.config.js'

/**
 * Ciało `POST /ankieta/odpowiedz`. Świadomie NIE ma tu `employeeId` ani `unitId`: tożsamość
 * odpowiadającego bierze się wyłącznie z tokenu (`AnkietaService.mojaKartoteka`), więc nie istnieje
 * pole, którym dałoby się odpowiedzieć „za kogoś". Globalny `ValidationPipe({ whitelist: true })`
 * (main.ts:24) usuwa wszystko poza tymi dwoma polami.
 */
export class OdpowiedzAnkietyDto {
  @IsInt()
  @Min(PULSE_SCORE_MIN)
  @Max(PULSE_SCORE_MAX)
  score!: number

  @IsOptional()
  @IsString()
  @MaxLength(PULSE_COMMENT_MAX)
  comment?: string
}
```

- [ ] **Krok 2: Napisz CZERWONY test kontrolera.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.controller.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { AnkietaController } from './ankieta.controller.js'
import { AnkietaService } from './ankieta.service.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const client = {} as TenantClient
const pracownik = { sub: 'kc-sub-anna', hrobot_roles: [Role.PRACOWNIK] } as unknown as JwtPayload
const hr = { sub: 'kc-sub-hr', hrobot_roles: [Role.HR] } as unknown as JwtPayload

describe('AnkietaController', () => {
  let controller: AnkietaController
  let service: { zapiszOdpowiedz: jest.Mock; mojaOdpowiedz: jest.Mock; agregaty: jest.Mock }

  beforeEach(async () => {
    service = { zapiszOdpowiedz: jest.fn(), mojaOdpowiedz: jest.fn(), agregaty: jest.fn() }
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnkietaController],
      providers: [{ provide: AnkietaService, useValue: service }],
    }).compile()
    controller = module.get(AnkietaController)
  })

  it('POST /ankieta/odpowiedz jest otwarty dla PRACOWNIKA (to on wypełnia ankietę)', () => {
    const role = Reflect.getMetadata(ROLES_KEY, AnkietaController.prototype.odpowiedz) as string[]
    expect(role).toContain(Role.PRACOWNIK)
  })

  it('GET /ankieta/agregaty jest ZAMKNIĘTY dla PRACOWNIKA', () => {
    const role = Reflect.getMetadata(ROLES_KEY, AnkietaController.prototype.agregaty) as string[]
    expect(role).not.toContain(Role.PRACOWNIK)
    expect(role).toEqual(expect.arrayContaining([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA]))
  })

  it('HR/ADMIN idzie do serwisu z zakresem null (globalny), bez odpytywania o jednostki', async () => {
    await controller.agregaty(client, hr, '10.0.0.3')
    expect(service.agregaty).toHaveBeenCalledWith(client, null, expect.any(Date))
  })

  it('zapis przekazuje aktora zbudowanego z JWT + IP, nie z ciała żądania', async () => {
    await controller.odpowiedz(client, pracownik, '10.0.0.1', { score: 4, comment: 'ok' })
    expect(service.zapiszOdpowiedz).toHaveBeenCalledWith(
      client,
      { userId: 'kc-sub-anna', roles: [Role.PRACOWNIK], ipAddress: '10.0.0.1' },
      { score: 4, comment: 'ok' },
      expect.any(Date),
    )
  })
})
```

- [ ] **Krok 3: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta/ankieta.controller.spec.ts
```

Oczekiwane:
```
● Test suite failed to run
  Cannot find module './ankieta.controller.js' from 'src/ankieta/ankieta.controller.spec.ts'
```

- [ ] **Krok 4: Napisz kontroler.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.controller.ts`:

```ts
import { Body, Controller, Get, Ip, Post } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import { AnkietaService, type AnkietaActor } from './ankieta.service.js'
import { OdpowiedzAnkietyDto } from './dto/odpowiedz-ankiety.dto.js'

/** Ankietę wypełnia KAŻDY zalogowany — łącznie z plain PRACOWNIKIEM; to on jest respondentem. */
const RESPONDENT_ROLES = [Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const
/** Agregaty czyta kadra zarządzająca. PRACOWNIK celowo poza listą — nie ma tu nic o nim samym. */
const AGREGAT_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const

/**
 * Powierzchnia HTTP modułu `ankieta` (M3 b). CIENKI kontroler wzorem
 * `dokumenty.controller.ts` / `strategic-brain.controller.ts`: `@TenantRoute()` składa
 * KeycloakJwtGuard + RbacGuard + TenantContextInterceptor + AuditInterceptor, a cała logika siedzi
 * w {@link AnkietaService}.
 *
 * `AuditInterceptor` zapisuje POST-a do `audit_log` automatycznie — payload to zredagowane ciało
 * żądania, czyli `{ score, comment }` bez żadnego identyfikatora osoby poza `actorUserId`, który
 * audyt zapisuje z definicji dla każdej mutacji w systemie.
 *
 * Zakres MANAGERA jest rozstrzygany TUTAJ i wstrzykiwany do serwisu (wzorzec M16): `RbacGuard`
 * zna tylko gruboziarniste `hrobot_roles` i nic nie wie o jednostkach.
 */
@Controller('ankieta')
@TenantRoute()
export class AnkietaController {
  constructor(private readonly ankieta: AnkietaService) {}

  private actor(user: JwtPayload, ip: string): AnkietaActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  /** `null` ⇒ aktor GLOBALNY (HR/ADMIN); inaczej jednostki, którymi zarządza MANAGER. */
  private async resolveScope(client: TenantClient, user: JwtPayload): Promise<string[] | null> {
    return isGlobal(user.hrobot_roles ?? []) ? null : managedUnitIds(client, user.sub)
  }

  @Post('odpowiedz')
  @Roles(...RESPONDENT_ROLES)
  async odpowiedz(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: OdpowiedzAnkietyDto,
  ): Promise<unknown> {
    return this.ankieta.zapiszOdpowiedz(client, this.actor(user, ip), dto, new Date())
  }

  @Get('moja')
  @Roles(...RESPONDENT_ROLES)
  async moja(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<unknown> {
    return this.ankieta.mojaOdpowiedz(client, this.actor(user, ip), new Date())
  }

  @Get('agregaty')
  @Roles(...AGREGAT_ROLES)
  async agregaty(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() _ip: string,
  ): Promise<unknown> {
    const scope = await this.resolveScope(client, user)
    return this.ankieta.agregaty(client, scope, new Date())
  }
}
```

- [ ] **Krok 5: Napisz moduł i zarejestruj go.** Utwórz `apps/tenant-runtime/src/ankieta/ankieta.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AnkietaController } from './ankieta.controller.js'
import { AnkietaService } from './ankieta.service.js'

/**
 * Moduł `ankieta` (M3 b). Bez `imports`: `AuditService` i `RbacGuard` pochodzą z `@Global()`
 * `TenantRuntimeModule`, a klient najemcy wstrzykuje `@CurrentTenantClient`. Brak `EncryptionService`
 * jest CELOWY — ten moduł nie dotyka żadnego pola szyfrowanego (ani PESEL, ani adresu).
 *
 * Zero powiązania ze `StrategicBrainModule`: dobrostan jest sygnałem OBOK wyniku, nie w nim.
 */
@Module({
  controllers: [AnkietaController],
  providers: [AnkietaService],
})
export class AnkietaModule {}
```

W `apps/tenant-runtime/src/app.module.ts` dodaj import obok pozostałych modułów M3:

```ts
import { AnkietaModule } from './ankieta/ankieta.module.js'
```

i wpis w tablicy `imports`, bezpośrednio po `AnalitykModule,`:

```ts
    // Blok F (M3 b) — ankieta pulsowa i analiza dobrostanu. Bez tej linii POST /api/ankieta/odpowiedz
    // nie jest osiągalne, mimo że kod istnieje (ta sama pułapka, co z ZastepstwaModule niżej).
    AnkietaModule,
```

- [ ] **Krok 6: Uruchom testy i typecheck.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
pnpm -C apps/tenant-runtime typecheck
```

Oczekiwane: `Tests: 32 passed, 32 total`, typecheck bez wyjścia.

- [ ] **Krok 7: Commit.**

```
git add apps/tenant-runtime/src/ankieta apps/tenant-runtime/src/app.module.ts
git commit -m "feat(ankieta): kontroler + DTO + modul, PRACOWNIK odpowiada, agregaty tylko dla kadry"
```

---

### Zadanie 8: Dowód liczbowy — `compositeScore` 39 pracowników nietknięty

To zadanie realizuje **wymóg krytyczny**. Dwie nogi: fixture 122 wierszy z żywej bazy przepuszczony przez REALNĄ ścieżkę odczytu (`SnapshotService.overview`) oraz strukturalna izolacja modułów.

**Pliki:**
- Zmień: `scripts/composite-score-baseline.mjs` (tryb `--fixture`)
- Utwórz: `apps/tenant-runtime/src/ankieta/__fixtures__/km3-snapshots-39.json`
- Utwórz: `apps/tenant-runtime/src/ankieta/composite-score-nietkniety.spec.ts`
- Utwórz: `apps/tenant-runtime/src/ankieta/scoring-izolacja.spec.ts`

- [ ] **Krok 1: Dopisz tryb `--fixture` do skryptu.** W `scripts/composite-score-baseline.mjs` wstaw funkcję przed blokiem `const [tryb, ...args]`:

```js
/** Fixture do testu hermetycznego: WSZYSTKIE kolumny, które czyta `SnapshotService`, dla wszystkich
 *  122 wierszy. Dzięki temu test regresyjny odtwarza ścieżkę odczytu bez bazy — a więc chodzi w CI,
 *  a nie tylko na maszynie ze stojącym dockerem. */
function fixture(sciezka) {
  const rows = psqlRows(
    'SELECT employee_id, window_start::date, window_end::date, throughput, peer_group_key, ' +
      "coalesce(sla_hit_rate::text,'NULL'), coalesce(defect_rate::text,'NULL'), " +
      "coalesce(composite_score::text,'NULL'), coalesce(development_slope::text,'NULL'), " +
      "confidence::text, is_new_hire, coalesce(excluded_reason,'NULL') " +
      'FROM employee_performance_snapshot ORDER BY employee_id, window_start;',
  )
  const nz = (v) => (v === 'NULL' ? null : Number(v))
  const doc = rows.map((r) => ({
    employeeId: r[0],
    windowStart: `${r[1]}T00:00:00.000Z`,
    windowEnd: `${r[2]}T00:00:00.000Z`,
    throughput: Number(r[3]),
    peerGroupKey: r[4],
    slaHitRate: nz(r[5]),
    defectRate: nz(r[6]),
    compositeScore: nz(r[7]),
    developmentSlope: nz(r[8]),
    confidence: Number(r[9]),
    isNewHire: r[10] === 't',
    excludedReason: r[11] === 'NULL' ? null : r[11],
  }))
  mkdirSync(dirname(sciezka), { recursive: true })
  writeFileSync(sciezka, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`✓ ${sciezka}: ${doc.length} wierszy, ${new Set(doc.map((d) => d.employeeId)).size} pracowników`)
}
```

i dopisz gałąź w rozgałęzieniu trybów, przed `else {`:

```js
else if (tryb === '--fixture' && args[0]) fixture(args[0])
```

- [ ] **Krok 2: Wygeneruj fixture z żywej bazy.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
node scripts/composite-score-baseline.mjs --fixture apps/tenant-runtime/src/ankieta/__fixtures__/km3-snapshots-39.json
```

Oczekiwane:
```
✓ apps/tenant-runtime/src/ankieta/__fixtures__/km3-snapshots-39.json: 122 wierszy, 39 pracowników
```

- [ ] **Krok 3: Napisz test regresyjny (odtworzenie ścieżki odczytu).** Utwórz `apps/tenant-runtime/src/ankieta/composite-score-nietkniety.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Test, type TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { SnapshotService } from '../strategic-brain/snapshot.service.js'
import { PerformanceConfigService } from '../strategic-brain/performance-config.service.js'

/**
 * WYMÓG KRYTYCZNY BLOKU F: `compositeScore` wszystkich 39 pracowników jest identyczny przed i po
 * wdrożeniu ankiety pulsowej.
 *
 * DLACZEGO TEN TEST WYGLĄDA TAK, A NIE INACZEJ. Naturalny pomysł — „przepuść dane przez
 * `RecommendationService.finalizeWindow` przed i po" — jest NIEWYKONALNY na tych danych, i to nie
 * z powodu bloku F: wartości `composite_score` w żywym najemcy są ZASIANE, nie policzone przez
 * silnik (`scripts/seed-demo-strategic-brain-peers.sql:18`: „WARTOSCI SA AUTORSKIE, NIE
 * POLICZONE"). Potwierdza to sam rozkład — 39 pracowników i tylko 19 różnych wyników w oknie.
 * Uruchomienie silnika wyprodukowałoby inne liczby niż te rozliczane w KM3 już DZIŚ, przed
 * jakąkolwiek zmianą, więc taki test nie mierzyłby bloku F.
 *
 * Mierzymy więc to, co faktycznie jest rozliczane: 39 liczb, które ŚCIEŻKA ODCZYTU
 * (`SnapshotService.overview` — feed ekranu `/analiza` i macierzy AN-1..AN-13) zwraca dla
 * zarejestrowanych danych. Fixture to zrzut 1:1 ze `hrobot_t_900d948b` (122 wiersze), więc
 * jakakolwiek zmiana w `scoring.util.ts`, w domyślnej konfiguracji wag, w drabinie M10 albo w
 * projekcji `toHeatCell` zapala ten test na czerwono, wymieniając z nazwy każdy rozjechany wiersz.
 *
 * Drugą nogą dowodu jest `scripts/composite-score-baseline.mjs --compare` (Zadanie 11): bajtowe
 * porównanie kolumny `composite_score` w żywej bazie przed i po wdrożeniu.
 */

interface FixtureRow {
  employeeId: string
  windowStart: string
  windowEnd: string
  throughput: number
  peerGroupKey: string
  slaHitRate: number | null
  defectRate: number | null
  compositeScore: number | null
  developmentSlope: number | null
  confidence: number
  isNewHire: boolean
  excludedReason: string | null
}

const FIXTURE = path.join(__dirname, '__fixtures__', 'km3-snapshots-39.json')
const rows: FixtureRow[] = JSON.parse(readFileSync(FIXTURE, 'utf8'))

const toRow = (r: FixtureRow) => ({ ...r, windowStart: new Date(r.windowStart), windowEnd: new Date(r.windowEnd) })

function makeClient() {
  const employeeIds = [...new Set(rows.map((r) => r.employeeId))]
  return {
    employee: { findMany: jest.fn().mockResolvedValue(employeeIds.map((id) => ({ id }))) },
    employeePerformanceSnapshot: {
      findMany: jest
        .fn()
        .mockResolvedValue(rows.map(toRow).sort((a, b) => b.windowEnd.getTime() - a.windowEnd.getTime())),
    },
    // Brak wiersza konfiguracji — dokładnie jak w żywym najemcy (`performance_config` jest pusta),
    // więc obowiązuje syntetyczna domyślna z performance-config.service.ts. Zmiana którejkolwiek
    // wagi w tamtym pliku zapali ten test.
    performanceConfig: { findFirst: jest.fn().mockResolvedValue(null) },
  }
}

describe('KM3 · compositeScore 39 pracowników — nietknięty przez blok F', () => {
  let snapshots: SnapshotService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SnapshotService, PerformanceConfigService],
    }).compile()
    snapshots = module.get(SnapshotService)
  })

  it('fixture trzyma kotwice KM3: 122 wiersze, 39 pracowników', () => {
    expect(rows).toHaveLength(122)
    expect(new Set(rows.map((r) => r.employeeId)).size).toBe(39)
  })

  it('ścieżka odczytu zwraca DOKŁADNIE zarejestrowane wyniki dla każdego z 39 pracowników', async () => {
    const cells = (await snapshots.overview(makeClient() as unknown as TenantClient, null)) as Array<{
      employeeId: string
      compositeScore: number | null
    }>

    expect(cells).toHaveLength(39)

    // Oczekiwane = wynik z NAJNOWSZEGO okna każdego pracownika (ta sama reguła, którą stosuje
    // `overview`), wzięty wprost z fixture'u.
    const oczekiwane = new Map<string, number | null>()
    for (const r of [...rows].sort((a, b) => a.windowEnd.localeCompare(b.windowEnd))) {
      oczekiwane.set(r.employeeId, r.compositeScore)
    }

    const rozjazdy = cells
      .filter((c) => c.compositeScore !== oczekiwane.get(c.employeeId))
      .map((c) => `${c.employeeId}: ${String(oczekiwane.get(c.employeeId))} -> ${String(c.compositeScore)}`)

    expect(rozjazdy).toEqual([])
  })

  it('żaden z 39 wyników nie jest null — inaczej test przeszedłby na pustych danych', () => {
    const najnowsze = new Map<string, number | null>()
    for (const r of [...rows].sort((a, b) => a.windowEnd.localeCompare(b.windowEnd))) {
      najnowsze.set(r.employeeId, r.compositeScore)
    }
    expect([...najnowsze.values()].filter((v) => v === null)).toEqual([])
  })
})
```

- [ ] **Krok 4: Napisz test izolacji strukturalnej.** Utwórz `apps/tenant-runtime/src/ankieta/scoring-izolacja.spec.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { MIN_ANONIMOWOSCI } from './ankieta.config.js'

/**
 * STRAŻNIK ARCHITEKTONICZNY bloku F, rodzeństwo `composite-score-nietkniety.spec.ts`.
 *
 * Tamten test mierzy LICZBY. Ten pilnuje KSZTAŁTU: dobrostan ma zostać sygnałem OBOK wyniku i nie
 * ma prawa wejść do `compositeScore` ani dziś, ani przy kolejnym refaktorze. Czyta prawdziwe pliki
 * źródłowe — tym samym idiomem, co `lib/api-gate.test.ts` i `lib/middleware-matcher.test.ts` w
 * apps/web — więc nie da się go uśpić przepisując asercję.
 */

const SRC = path.join(__dirname, '..')
const SCORING = path.join(SRC, 'strategic-brain', 'scoring.util.ts')
const PERF_CONFIG = path.join(SRC, 'strategic-brain', 'performance-config.service.ts')

/** Testy, którym WOLNO importować strategic-brain — bo ich zadaniem jest go zmierzyć. */
const WYJATKI = ['composite-score-nietkniety.spec.ts', 'scoring-izolacja.spec.ts']

function pliki(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? pliki(path.join(dir, e.name)) : [path.join(dir, e.name)],
  )
}

describe('Blok F · izolacja od silnika oceny rozliczanego w KM3', () => {
  it('ScoreDimensions ma DOKŁADNIE 4 wymiary — piąty przeliczyłby wynik każdego z 39 pracowników', () => {
    const src = readFileSync(SCORING, 'utf8')
    const blok = /export type ScoreDimensions = \{([\s\S]*?)\n\}/.exec(src)
    expect(blok).not.toBeNull()
    const klucze = [...blok![1]!.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort()
    expect(klucze).toEqual(['development', 'performance', 'quality', 'timeliness'])
  })

  it('ScoreWeights ma dokładnie te same 4 klucze co ScoreDimensions', () => {
    const src = readFileSync(SCORING, 'utf8')
    const blok = /export type ScoreWeights = \{([\s\S]*?)\n\}/.exec(src)
    expect(blok).not.toBeNull()
    const klucze = [...blok![1]!.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort()
    expect(klucze).toEqual(['development', 'performance', 'quality', 'timeliness'])
  })

  it('żaden plik strategic-brain nie wie o istnieniu ankiety ani dobrostanu', () => {
    const winne = pliki(path.join(SRC, 'strategic-brain'))
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /ankiet|dobrostan|wellbeing|pulse/i.test(readFileSync(f, 'utf8')))
      .map((f) => path.basename(f))
    expect(winne).toEqual([])
  })

  it('produkcyjne pliki ankiety nie sięgają do strategic-brain', () => {
    const winne = pliki(__dirname)
      .filter((f) => f.endsWith('.ts') && !WYJATKI.includes(path.basename(f)))
      .filter((f) => /strategic-brain/.test(readFileSync(f, 'utf8')))
      .map((f) => path.basename(f))
    expect(winne).toEqual([])
  })

  it('próg anonimowości ankiety = minPeerGroupSize domyślnej konfiguracji ocen (jedna liczba, dwa moduły)', () => {
    const src = readFileSync(PERF_CONFIG, 'utf8')
    const m = /minPeerGroupSize:\s*(\d+),/.exec(src)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(MIN_ANONIMOWOSCI)
  })
})
```

- [ ] **Krok 5: Uruchom obie nogi i zobacz zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta
```

Oczekiwane:
```
PASS src/ankieta/composite-score-nietkniety.spec.ts
PASS src/ankieta/scoring-izolacja.spec.ts
Tests:       40 passed, 40 total
```

- [ ] **Krok 6: Weryfikacja negatywna — dodaj piąty wymiar i zobacz OBIE nogi na czerwono.** W `apps/tenant-runtime/src/strategic-brain/scoring.util.ts` dopisz tymczasowo do `ScoreDimensions` linię `  wellbeing: number | null` i do `ScoreWeights` linię `  wellbeing: number`, a w `performance-config.service.ts` w `defaultConfig` dopisz `weightWellbeing: 0.1`. Uruchom `npx jest src/ankieta`. Oczekiwane:

```
● Blok F · izolacja od silnika oceny rozliczanego w KM3 › ScoreDimensions ma DOKŁADNIE 4 wymiary ...
  - Expected  - 0
  + Received  + 1
      "timeliness",
  +   "wellbeing",
● Blok F · izolacja ... › żaden plik strategic-brain nie wie o istnieniu ankiety ani dobrostanu
  - Expected  - 0
  + Received  + 2
```

Cofnij WSZYSTKIE trzy zmiany (`git checkout -- apps/tenant-runtime/src/strategic-brain/`) i potwierdź `40 passed`.

- [ ] **Krok 7: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git status --short apps/tenant-runtime/src/strategic-brain
git add scripts/composite-score-baseline.mjs apps/tenant-runtime/src/ankieta
git commit -m "test(km3): dowod liczbowy — compositeScore 39 pracownikow nietkniety + izolacja strukturalna"
```

`git status --short` MUSI nie pokazać nic w `strategic-brain` — to potwierdzenie, że weryfikacja negatywna została cofnięta w całości.

---

### Zadanie 9: Front — klient BFF, trasa proxy, bramka sesji

**Pliki:**
- Utwórz: `apps/web/lib/ankieta.ts`
- Test: `apps/web/lib/ankieta.test.ts`
- Utwórz: `apps/web/app/api/ankieta/[[...path]]/route.ts`
- Zmień: `apps/web/middleware.ts`

- [ ] **Krok 1: Napisz CZERWONY test klienta.** Utwórz `apps/web/lib/ankieta.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { etykietaWyniku, komunikatProgu, type AgregatJednostki } from './ankieta'

const jed = (over: Partial<AgregatJednostki>): AgregatJednostki => ({
  unitId: 'u1',
  unitName: 'Region Centrum',
  respondentCount: 0,
  commentCount: 0,
  averageScore: null,
  distribution: null,
  comments: [],
  suppressed: true,
  ...over,
})

describe('etykietaWyniku', () => {
  it('powyżej progu pokazuje średnią z dwoma miejscami', () => {
    expect(etykietaWyniku(jed({ suppressed: false, averageScore: 3.6, respondentCount: 7 }))).toBe('3,60')
  })

  it('poniżej progu NIGDY nie renderuje liczby wyniku', () => {
    expect(etykietaWyniku(jed({ respondentCount: 4 }))).toBe('—')
  })

  it('zero odpowiedzi też daje kreskę, nie „0,00"', () => {
    expect(etykietaWyniku(jed({ respondentCount: 0 }))).toBe('—')
  })

  it('gdyby backend przysłał liczbę mimo suppressed, ekran i tak jej nie pokaże', () => {
    // Obrona w głąb: ekran nie ufa backendowi w kwestii progu, tylko sam go egzekwuje.
    expect(etykietaWyniku(jed({ suppressed: true, averageScore: 4.2, respondentCount: 2 }))).toBe('—')
  })
})

describe('komunikatProgu', () => {
  it('mówi wprost, ile odpowiedzi jest i ile trzeba', () => {
    expect(komunikatProgu(jed({ respondentCount: 3 }), 5)).toBe('Za mało odpowiedzi, żeby pokazać wynik (3 z 5).')
  })

  it('nie generuje komunikatu dla jednostki powyżej progu', () => {
    expect(komunikatProgu(jed({ suppressed: false, respondentCount: 8, averageScore: 4 }), 5)).toBeNull()
  })
})
```

- [ ] **Krok 2: Uruchom i ZOBACZ, że pada.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\web
npx vitest run lib/ankieta.test.ts
```

Oczekiwane:
```
FAIL  lib/ankieta.test.ts [ lib/ankieta.test.ts ]
Error: Failed to load url ./ankieta (resolved id: ./ankieta) in .../lib/ankieta.test.ts
```

- [ ] **Krok 3: Napisz klient.** Utwórz `apps/web/lib/ankieta.ts`:

```ts
/**
 * Ankieta pulsowa (M3 b) — model kliencki dla web-kitu.
 *
 * NA ŻYWO: `ankietaApi` rozmawia z REALNYM tenant-runtime przez same-origin proxy `/api/ankieta/*`
 * (app/api/ankieta/[[...path]] + lib/tenant-runtime.ts). Wzorzec z lib/dokumenty.ts: cienki
 * `ankietaFetch` + `AnkietaError` z upstreamowym statusem, a CZYSTE kalkulatory prezentacji
 * eksportowane osobno, żeby ekran i testy jednostkowe miały jedno źródło prawdy.
 *
 * PRÓG ANONIMOWOŚCI JEST EGZEKWOWANY DWA RAZY. Backend nigdy nie wysyła liczby dla jednostki
 * poniżej progu (`AnkietaService.agregaty`), a {@link etykietaWyniku} i tak nie narysuje liczby,
 * gdy `suppressed` jest ustawione. To nie jest nadmiarowość: gdyby kiedyś ktoś poluzował projekcję
 * po stronie serwera, ekran nadal nie pokaże wyniku dwóch osób.
 */

export interface AgregatJednostki {
  unitId: string
  unitName: string
  respondentCount: number
  commentCount: number
  averageScore: number | null
  distribution: Record<'1' | '2' | '3' | '4' | '5', number> | null
  comments: string[]
  suppressed: boolean
}

export interface AgregatyOdpowiedz {
  window: { start: string; end: string; key: string }
  pytanie: string
  minAnonimowosci: number
  jednostki: AgregatJednostki[]
}

export interface MojaOdpowiedz {
  window: { start: string; end: string; key: string }
  pytanie: string
  minAnonimowosci: number
  odpowiedz: { score: number; comment: string | null; submittedAt: string; updatedAt: string } | null
}

export class AnkietaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AnkietaError'
  }
}

async function ankietaFetch<T>(sciezka: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/ankieta${sciezka}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new AnkietaError(`Ankieta: ${res.status}`, res.status)
  return (await res.json()) as T
}

export const ankietaApi = {
  moja: (): Promise<MojaOdpowiedz> => ankietaFetch<MojaOdpowiedz>('/moja'),
  agregaty: (): Promise<AgregatyOdpowiedz> => ankietaFetch<AgregatyOdpowiedz>('/agregaty'),
  odpowiedz: (score: number, comment?: string): Promise<unknown> =>
    ankietaFetch('/odpowiedz', { method: 'POST', body: JSON.stringify({ score, comment }) }),
}

/** Wynik jednostki do wyświetlenia. `—` zawsze, gdy próg nieosiągnięty — nigdy „0,00". */
export function etykietaWyniku(j: AgregatJednostki): string {
  if (j.suppressed || j.averageScore === null) return '—'
  return j.averageScore.toFixed(2).replace('.', ',')
}

/** Komunikat pokazywany ZAMIAST wyniku, albo `null` gdy wynik wolno pokazać. */
export function komunikatProgu(j: AgregatJednostki, min: number): string | null {
  if (!j.suppressed) return null
  return `Za mało odpowiedzi, żeby pokazać wynik (${j.respondentCount} z ${min}).`
}
```

- [ ] **Krok 4: Napisz trasę proxy.** Utwórz `apps/web/app/api/ankieta/[[...path]]/route.ts`:

```ts
// REAL proxy dla ankiety pulsowej: /api/ankieta[/<x>] → ${TENANT_RUNTIME_URL}/ankieta[/<x>].
// Obsługuje moja/agregaty/odpowiedz jednym handlerem, wzorem app/api/dokumenty/[[...path]].
// Opcjonalny catch-all, żeby również gołe `/api/ankieta` się dopasowało.
//
// Trasa jest ZAMKNIĘTA domyślnie: matcher `/api/:path*` w middleware.ts obejmuje ją bez żadnego
// dodatkowego wpisu, a `PUBLICZNE_API` (lib/api-gate.ts) jej NIE wymienia — i wymieniać nie może,
// bo agregaty dobrostanu to dane o ludziach. Strażnik parytetu lib/api-gate.test.ts to pilnuje.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('ankieta', path ?? []), search)
}

export const GET = handle
export const POST = handle
```

- [ ] **Krok 5: Dodaj ekran do bramki sesji.** W `apps/web/middleware.ts`, w tablicy `matcher`, tuż po wpisie `'/analiza/:path*',` dodaj:

```ts
    // Ankieta pulsowa (M3 b) — pracownik zostawia tu ocenę samopoczucia, menedżer czyta agregaty
    // swoich jednostek. Bez tego wpisu ekran renderowałby pełny AppShell anonimowi, dokładnie tak,
    // jak zdarzyło się to wcześniej trzem modułom M3 (patrz komentarz przy /dokumenty).
    '/ankieta/:path*',
```

- [ ] **Krok 6: Uruchom testy frontu.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\web
npx vitest run lib/ankieta.test.ts lib/api-gate.test.ts lib/middleware-matcher.test.ts
```

Oczekiwane: `lib/ankieta.test.ts` zielony (6 testów). `lib/middleware-matcher.test.ts` **czerwony** z komunikatem o wpisie bez ekranu:

```
● middleware matcher ↔ app/(tenant) parity › every matcher entry points at a route that actually exists (no stale entries)
  expected [ 'ai-grafik-manager', 'analityk', ... ] to contain 'ankieta'
```

To jest oczekiwane — ekran powstaje w Zadaniu 10. Nie „naprawiaj" tego usuwając wpis z matchera.

- [ ] **Krok 7: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add apps/web/lib/ankieta.ts apps/web/lib/ankieta.test.ts "apps/web/app/api/ankieta" apps/web/middleware.ts
git commit -m "feat(web): klient ankiety + proxy BFF + wpis bramki sesji dla /ankieta"
```

---

### Zadanie 10: Ekran ankiety, nawigacja, E2E

**Pliki:**
- Utwórz: `apps/web/app/(tenant)/ankieta/page.tsx`
- Utwórz: `apps/web/components/ankieta/ankieta-screen.tsx`
- Utwórz: `apps/web/components/ankieta/agregaty-screen.tsx`
- Zmień: `apps/web/lib/nav.ts`
- Utwórz: `apps/web/e2e/ankieta-prog-anonimowosci.spec.ts`

- [ ] **Krok 1: Napisz formularz pracownika.** Utwórz `apps/web/components/ankieta/ankieta-screen.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { ankietaApi, type MojaOdpowiedz } from '@/lib/ankieta'

/**
 * Formularz respondenta: JEDNO pytanie 1–5 + opcjonalny komentarz. Druga wysyłka w tym samym
 * tygodniu AKTUALIZUJE odpowiedź (backend robi upsert po `(employeeId, windowStart)`), dlatego
 * przycisk zmienia treść na „Zaktualizuj odpowiedź", gdy odpowiedź już istnieje — inaczej
 * użytkownik nie wiedziałby, że nie tworzy drugiej.
 */
export function AnkietaScreen() {
  const [stan, setStan] = useState<MojaOdpowiedz | null>(null)
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [zapisuje, setZapisuje] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)

  const wczytaj = () => {
    ankietaApi
      .moja()
      .then((m) => {
        setStan(m)
        setScore(m.odpowiedz?.score ?? null)
        setComment(m.odpowiedz?.comment ?? '')
      })
      .catch(() => setBlad('Nie udało się wczytać ankiety.'))
  }

  useEffect(wczytaj, [])

  const wyslij = async () => {
    if (score === null) return
    setZapisuje(true)
    setBlad(null)
    try {
      await ankietaApi.odpowiedz(score, comment.trim() || undefined)
      wczytaj()
    } catch {
      setBlad('Nie udało się zapisać odpowiedzi.')
    } finally {
      setZapisuje(false)
    }
  }

  if (blad) return <p className="text-[15px] text-muted">{blad}</p>
  if (!stan) return <p className="text-[15px] text-muted">Wczytywanie…</p>

  return (
    <div className="rounded-2xl border border-line bg-white p-6">
      <p className="text-[15px] font-semibold text-navy">{stan.pytanie}</p>
      <p className="mt-1 text-[13px] text-muted">Tydzień {stan.window.key}. Odpowiadasz raz w tygodniu.</p>

      <div className="mt-4 flex gap-2" role="radiogroup" aria-label={stan.pytanie}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            onClick={() => setScore(n)}
            className={`h-11 w-11 rounded-xl border text-[15px] font-semibold ${
              score === n ? 'border-navy bg-navy text-white' : 'border-line text-navy'
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-[13px] text-muted" htmlFor="ankieta-komentarz">
        Komentarz (opcjonalny)
      </label>
      <textarea
        id="ankieta-komentarz"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={500}
        rows={3}
        className="mt-1 w-full rounded-xl border border-line p-3 text-[15px]"
      />

      <button
        type="button"
        disabled={score === null || zapisuje}
        onClick={wyslij}
        className="mt-4 rounded-xl bg-navy px-5 py-2.5 text-[15px] font-semibold text-white disabled:opacity-40"
      >
        {stan.odpowiedz ? 'Zaktualizuj odpowiedź' : 'Wyślij odpowiedź'}
      </button>

      {stan.odpowiedz ? (
        <p className="mt-3 text-[13px] text-muted">
          Twoja odpowiedź w tym tygodniu jest już zapisana. Wysłanie ponownie ją nadpisze — nie powstanie druga.
        </p>
      ) : null}

      <p className="mt-4 text-[13px] text-muted">
        Wyniki są pokazywane wyłącznie zbiorczo, na poziomie jednostki, i dopiero od{' '}
        {stan.minAnonimowosci} odpowiedzi. Nikt — łącznie z Twoim przełożonym — nie zobaczy Twojej
        pojedynczej oceny ani komentarza.
      </p>
    </div>
  )
}
```

- [ ] **Krok 2: Napisz widok agregatów.** Utwórz `apps/web/components/ankieta/agregaty-screen.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { ankietaApi, etykietaWyniku, komunikatProgu, type AgregatyOdpowiedz } from '@/lib/ankieta'

/**
 * Widok kadry: jeden wiersz na jednostkę. Jednostka poniżej progu pokazuje KOMUNIKAT, nigdy liczbę
 * — a decyzję o tym podejmuje `etykietaWyniku`/`komunikatProgu` z lib/ankieta.ts, przetestowane
 * jednostkowo w lib/ankieta.test.ts. Ten komponent nie liczy niczego sam.
 */
export function AgregatyScreen() {
  const [dane, setDane] = useState<AgregatyOdpowiedz | null>(null)
  const [blad, setBlad] = useState<string | null>(null)

  useEffect(() => {
    ankietaApi
      .agregaty()
      .then(setDane)
      .catch(() => setBlad('Nie udało się wczytać agregatów.'))
  }, [])

  if (blad) return <p className="text-[15px] text-muted">{blad}</p>
  if (!dane) return <p className="text-[15px] text-muted">Wczytywanie…</p>

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">
        Tydzień {dane.window.key}. Próg anonimowości: {dane.minAnonimowosci} odpowiedzi w jednostce.
      </p>
      {dane.jednostki.map((j) => {
        const komunikat = komunikatProgu(j, dane.minAnonimowosci)
        return (
          <div key={j.unitId} className="rounded-2xl border border-line bg-white p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-semibold text-navy">{j.unitName}</span>
              <span className="font-display text-2xl font-extrabold text-navy">{etykietaWyniku(j)}</span>
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {komunikat ?? `${j.respondentCount} odpowiedzi · ${j.commentCount} komentarzy`}
            </p>
            {j.comments.length > 0 ? (
              <ul className="mt-3 space-y-1 text-[13px] text-navy">
                {j.comments.map((c, i) => (
                  <li key={i}>„{c}"</li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Krok 3: Napisz stronę.** Utwórz `apps/web/app/(tenant)/ankieta/page.tsx`:

```tsx
import { AppShell } from '@/components/layout/app-shell'
import { AnkietaScreen } from '@/components/ankieta/ankieta-screen'
import { AgregatyScreen } from '@/components/ankieta/agregaty-screen'
import type { Role } from '@/lib/nav'
import { getTenant } from '@/lib/tenant'
import { getSession } from '@/lib/session'

/**
 * Ankieta pulsowa i analiza dobrostanu (M3 b). Serwerowa powłoka wzorem
 * app/(tenant)/dokumenty/page.tsx: tożsamość z `getSession`, AppShell, obie sekcje.
 *
 * KAŻDA rola widzi formularz — kierownik też jest pracownikiem i też odpowiada. Agregaty widzi
 * wyłącznie kadra; realne wymuszenie jest serwerowe (`@Roles` na `AnkietaController.agregaty` +
 * zakres jednostek w `AnkietaService.agregaty`), to tutaj jest tylko układ ekranu.
 */
export default async function AnkietaPage() {
  const session = await getSession()
  const tenant = await getTenant()
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const firstName = user.name.split(' ')[0]
  const widziAgregaty = roles.some((r) => r === 'MANAGER' || r === 'HR' || r === 'ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/ankieta" title="Dobrostan" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tighter2 text-navy">
          Ankieta <span className="text-accent-ink">pulsowa</span>
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] text-muted">
          {firstName}, jedno pytanie w tygodniu. Wyniki są liczone wyłącznie zbiorczo — dobrostan jest
          osobnym sygnałem i nie wpływa na ocenę wydajności ani na wynik zbiorczy w module rozwoju.
        </p>

        <div className="mt-6">
          <AnkietaScreen />
        </div>

        {widziAgregaty ? (
          <div className="mt-10">
            <h2 className="font-display text-xl font-extrabold text-navy">Dobrostan jednostek</h2>
            <div className="mt-4">
              <AgregatyScreen />
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}
```

- [ ] **Krok 4: Dodaj pozycję do nawigacji.** W `apps/web/lib/nav.ts`, w grupie `Moduły HR`, tuż po wpisie `Asystent`, dodaj:

```ts
      // Ankieta pulsowa / dobrostan (M3 b). BEZ ograniczenia ról: formularz jest dla każdego (także
      // MANAGER i HR są pracownikami i odpowiadają), a sekcję agregatów strona pokazuje dopiero
      // kadrze — realny zakres egzekwuje `@Roles` na AnkietaController.agregaty, nie to menu.
      { label: 'Dobrostan', href: '/ankieta', icon: IconMessageCircle },
```

- [ ] **Krok 5: Uruchom strażników parytetu — teraz muszą być zielone.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\web
npx vitest run
```

Oczekiwane: wszystkie pliki zielone, w tym `lib/middleware-matcher.test.ts` (wpis `ankieta` ma teraz swój katalog `app/(tenant)/ankieta`) i `lib/api-gate.test.ts` (nowa trasa jest zamknięta domyślnie).

- [ ] **Krok 6: Napisz E2E progu anonimowości.** Utwórz `apps/web/e2e/ankieta-prog-anonimowosci.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

/**
 * Blok F (M3 b) na żywym stacku. Sprawdza dokładnie dwie rzeczy, których test jednostkowy nie
 * dosięgnie: że pracownik może odpowiedzieć z menu, i że menedżer NIE widzi na ekranie liczby dla
 * jednostki poniżej progu.
 *
 *   E2E_BASE_URL=http://localhost:8080 npx playwright test e2e/ankieta-prog-anonimowosci.spec.ts
 */

async function zaloguj(page: import('@playwright/test').Page, login: string, pw: string) {
  await page.context().clearCookies()
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name="login"]').fill(login)
  await page.locator('input[name="pw"]').fill(pw)
  await page.getByRole('button', { name: /Zaloguj/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

test('PRACOWNIK dochodzi do ankiety z menu i zapisuje odpowiedź', async ({ page }) => {
  test.setTimeout(180_000)
  await zaloguj(page, 'pracownik.demo', 'Pracownik!2026')

  const pozycja = page.locator('a[href="/ankieta"]')
  await expect(pozycja, 'PRACOWNIK nie widzi pozycji „Dobrostan" w nawigacji').toHaveCount(1)
  await pozycja.click()
  await page.waitForURL(/\/ankieta/, { timeout: 20_000 })

  await expect(page.getByRole('heading', { name: /Ankieta/i }).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('radio', { name: '4' }).click()
  await page.getByRole('button', { name: /Wyślij odpowiedź|Zaktualizuj odpowiedź/ }).click()

  await expect(page.getByText(/Twoja odpowiedź w tym tygodniu jest już zapisana/)).toBeVisible({ timeout: 20_000 })

  // Nie ma sekcji agregatów — PRACOWNIK nie ogląda dobrostanu jednostek.
  await expect(page.getByRole('heading', { name: /Dobrostan jednostek/ })).toHaveCount(0)
})

test('MANAGER widzi komunikat progu zamiast liczby dla jednostki poniżej 5 odpowiedzi', async ({ page }) => {
  test.setTimeout(180_000)
  await zaloguj(page, 'manager.demo', 'Manager!2026')
  await page.goto('/ankieta', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Dobrostan jednostek/ })).toBeVisible({ timeout: 30_000 })

  const tresc = await page.locator('main').innerText()
  expect(tresc).toMatch(/Za mało odpowiedzi, żeby pokazać wynik \(\d z 5\)\./)

  // Twarda granica: na ekranie menedżera nie może paść ani jedno nazwisko respondenta.
  for (const nazwisko of ['Kowalska', 'Zając', 'Adamczyk', 'Lewandowska']) {
    expect(tresc, `wyciek: menedżer widzi nazwisko respondenta (${nazwisko})`).not.toContain(nazwisko)
  }
})
```

- [ ] **Krok 7: Commit (E2E uruchomimy w Zadaniu 11, po wdrożeniu i zasianiu danych).**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add "apps/web/app/(tenant)/ankieta" apps/web/components/ankieta apps/web/lib/nav.ts apps/web/e2e/ankieta-prog-anonimowosci.spec.ts
git commit -m "feat(web): ekran ankiety pulsowej + agregaty jednostek + pozycja Dobrostan w menu"
```

---

### Zadanie 11: Wdrożenie na żywy stack, seed demo i zrzut „po"

**Pliki:**
- Utwórz: `scripts/seed-demo-ankieta.sql`
- Utwórz: `docs/raport-km3/evidence/composite-baseline-po.json` (wygenerowany, commitowany)

- [ ] **Krok 1: Napisz seed demo.** Utwórz `scripts/seed-demo-ankieta.sql`:

```sql
-- ============================================================================================
-- Demo bloku F (M3 b): odpowiedzi ankiety pulsowej pokazujące WSZYSTKIE TRZY stany progu.
--
--   Region Centrum  → 8 odpowiedzi, 6 komentarzy  → wynik i komentarze WIDOCZNE
--   Region Północ   → 3 odpowiedzi                → komunikat „za mało odpowiedzi (3 z 5)"
--   Region Południe → 0 odpowiedzi                → komunikat „za mało odpowiedzi (0 z 5)"
--
-- IDEMPOTENTNY. Kasuje własny poprzedni przebieg po prefiksie `ank_demo_` i kończy na
-- ON CONFLICT DO NOTHING. Dotyka WYŁĄCZNIE nowej tabeli pulse_survey_response — nie rusza kotwic
-- demo (39 pracowników, 1558 zmian) ani employee_performance_snapshot.
--
-- Okno wyliczane z CURRENT_DATE, żeby ekran zawsze pokazywał bieżący tydzień: date_trunc('week')
-- w Postgresie daje poniedziałek — dokładnie to samo okno, co pulseWindow() w TypeScripcie.
-- ============================================================================================

BEGIN;

DELETE FROM pulse_survey_response WHERE id LIKE 'ank_demo_%';

CREATE TEMP TABLE ank_win ON COMMIT DROP AS
SELECT date_trunc('week', CURRENT_DATE)::date AS ws,
       (date_trunc('week', CURRENT_DATE)::date + 6) AS we;

-- Kandydaci: deterministyczna kolejność po id, po 8 / 3 / 0 osób z trzech regionów.
WITH kand AS (
  SELECT e.id AS employee_id,
         e.unit_id,
         u.name AS unit_name,
         row_number() OVER (PARTITION BY e.unit_id ORDER BY e.id) AS rn
  FROM employees e
  JOIN organizational_units u ON u.id = e.unit_id
),
wybrani AS (
  SELECT * FROM kand WHERE unit_name = 'Region Centrum' AND rn <= 8
  UNION ALL
  SELECT * FROM kand WHERE unit_name = 'Region Północ'  AND rn <= 3
)
INSERT INTO pulse_survey_response (id, employee_id, unit_id, window_start, window_end, score, comment, submitted_at, updated_at)
SELECT
  'ank_demo_' || w.employee_id,
  w.employee_id,
  w.unit_id,
  win.ws,
  win.we,
  -- Rozrzut 2..5, deterministyczny, bez random(): skrypt ma dawać ten sam wynik przy każdym runie.
  2 + ((w.rn * 3) % 4),
  CASE
    WHEN w.unit_name = 'Region Centrum' AND w.rn <= 6
      THEN (ARRAY[
        'Za dużo nadgodzin w tym tygodniu.',
        'Grafik wreszcie stabilny, dużo lepiej.',
        'Brakuje ludzi na zmianie popołudniowej.',
        'Dobra komunikacja od koordynatora.',
        'Dojazdy między lokalizacjami męczą.',
        'Bez uwag.'
      ])[w.rn]
    ELSE NULL
  END,
  now(),
  now()
FROM wybrani w CROSS JOIN ank_win win
ON CONFLICT (employee_id, window_start) DO NOTHING;

COMMIT;
```

- [ ] **Krok 2: Zbuduj obraz tenant-runtime z blokiem F i podnieś usługę.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
docker compose -p hrobot --profile full up -d --build tenant-runtime web
```

Oczekiwane: `Container hrobot-tenant-runtime-1  Started`, `Container hrobot-web-1  Started`.

- [ ] **Krok 3: Wgraj migrację ręcznie i przepisz właściciela (droga sprawdzona w tym repo).**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
Get-Content packages\db\prisma\tenant\migrations\20260812090000_ankieta_pulsowa\migration.sql -Raw | docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -c "ALTER TABLE pulse_survey_response OWNER TO hu_900d948b;"
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -t -A -c "\dt pulse_survey_response"
```

Oczekiwane ostatnie wyjście:
```
public|pulse_survey_response|table|hu_900d948b
```
(rola `hu_900d948b`, nie `postgres` — jeśli jest `postgres`, `ALTER TABLE` nie zadziałał i aplikacja dostanie „permission denied for table").

- [ ] **Krok 4: Zasiej dane demo i sprawdź rozkład.**

```
Get-Content scripts\seed-demo-ankieta.sql -Raw | docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -t -A -F"|" -c "SELECT u.name, count(*), count(r.comment) FROM pulse_survey_response r JOIN organizational_units u ON u.id=r.unit_id GROUP BY 1 ORDER BY 1;"
```

Oczekiwane:
```
Region Centrum|8|6
Region Północ|3|0
```

- [ ] **Krok 5: DOWÓD LICZBOWY — zrzut „po" i porównanie.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
node scripts/composite-score-baseline.mjs --dump docs/raport-km3/evidence/composite-baseline-po.json
node scripts/composite-score-baseline.mjs --compare docs/raport-km3/evidence/composite-baseline-przed.json docs/raport-km3/evidence/composite-baseline-po.json
echo "exit=$LASTEXITCODE"
```

Oczekiwane:
```
✓ docs/raport-km3/evidence/composite-baseline-po.json: 122 wierszy, 39 pracowników, 1558 zmian
✓ compositeScore identyczny: 122 wierszy, 39 pracowników, porównanie tekstowe bez tolerancji
exit=0
```

Jeżeli `exit` ≠ 0 — **zatrzymaj wdrożenie**, skrypt wypisze z nazwy każdy rozjechany wiersz.

- [ ] **Krok 6: Sprawdź, że ŻYWA ścieżka odczytu zwraca te same 39 wyników co fixture.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
$tok = (Invoke-RestMethod -Method Post -Uri "http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token" -Body @{grant_type='password';client_id='hrobot-web';username='demo';password=$env:DEMO_ADMIN_PASSWORD}).access_token
$ov = Invoke-RestMethod -Uri "http://localhost:3001/api/strategic-brain/overview" -Headers @{Authorization="Bearer $tok"}
$live = @{}; $ov.heatmap | ForEach-Object { $live[$_.employeeId] = [string]$_.compositeScore }
$fx = Get-Content apps\tenant-runtime\src\ankieta\__fixtures__\km3-snapshots-39.json -Raw | ConvertFrom-Json
$last = @{}; $fx | Sort-Object windowEnd | ForEach-Object { $last[$_.employeeId] = [string]$_.compositeScore }
$diff = $live.Keys | Where-Object { $live[$_] -ne $last[$_] }
"pracownikow=$($live.Count) rozjazdow=$($diff.Count)"
```

Oczekiwane: `pracownikow=39 rozjazdow=0`

- [ ] **Krok 7: Uruchom E2E bloku F na żywym stacku.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\web
$env:E2E_BASE_URL="http://localhost:8080"; npx playwright test e2e/ankieta-prog-anonimowosci.spec.ts
```

Oczekiwane: `2 passed`.

- [ ] **Krok 8: Commit.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git add scripts/seed-demo-ankieta.sql docs/raport-km3/evidence/composite-baseline-po.json
git commit -m "chore(km3): seed demo ankiety + dowod liczbowy, compositeScore 122/122 wierszy identyczny po wdrozeniu"
```

---

### Zadanie 12: Zapis do raportu KM3 i macierz pokrycia

**Pliki:**
- Zmień: `docs/raport-km3/Raport_KM3_HRobot.md` (§5 — DOPISUJEMY, nie przepisujemy)
- Utwórz: `docs/raport-km3/macierz-pokrycia-ankieta.md`

- [ ] **Krok 1: Napisz macierz pokrycia.** Utwórz `docs/raport-km3/macierz-pokrycia-ankieta.md`:

```markdown
# Macierz pokrycia — Ankieta pulsowa i analiza dobrostanu (M3 b)

| Nr | Kryterium | Dowód | Co dokładnie dowodzi |
|---|---|---|---|
| ANK-1 | Jedno pytanie 1–5 + opcjonalny komentarz | `apps/tenant-runtime/src/ankieta/ankieta.config.ts` (`PULSE_PYTANIE`, `PULSE_SCORE_MIN/MAX`), `dto/odpowiedz-ankiety.dto.ts`, CHECK `pulse_survey_response_score_range` w migracji `20260812090000_ankieta_pulsowa` | Skala jest wymuszona w trzech warstwach: DTO, serwis, baza. Komentarz jest `NULL`-owalny. |
| ANK-2 | Pracownik odpowiada raz na okno; druga próba aktualizuje | `@@unique([employeeId, windowStart])` + `upsert` w `AnkietaService.zapiszOdpowiedz`; testy „druga próba w tym samym oknie AKTUALIZUJE" i „ten sam klucz w obu wywołaniach" (`ankieta.service.spec.ts`) | Niezmiennik jest w BAZIE, nie tylko w kodzie — wyścig kończy się P2002, nie drugim wierszem. |
| ANK-3 | Jednostka poniżej 5 odpowiedzi nie pokazuje żadnej wartości liczbowej | `ankieta.agregacja.spec.ts` („poniżej progu nie zwraca ŻADNEJ wartości wyniku"), `ankieta.rodo.spec.ts` („jednostka z 4 odpowiedziami"), `lib/ankieta.test.ts` („poniżej progu NIGDY nie renderuje liczby"), E2E `ankieta-prog-anonimowosci.spec.ts` | Próg egzekwowany trzy razy: agregacja, API, ekran. Poniżej progu `null`, nigdy `0`. |
| ANK-4 | Manager nie widzi odpowiedzi pojedynczej osoby na żadnym ekranie ani w żadnej odpowiedzi API | `ankieta.rodo.spec.ts` — „ZAPYTANIE do bazy nie prosi o employeeId", „w CAŁEJ odpowiedzi API nie ma ani jednego identyfikatora pracownika", „serwis NIE udostępnia żadnej metody zwracającej cudzą pojedynczą odpowiedź"; E2E: brak nazwisk w `main` | Granica jest PROJEKCJĄ (`select` bez `employeeId`), nie filtrowaniem po fakcie. |
| ANK-5 | **`compositeScore` przed i po wdrożeniu identyczny dla wszystkich 39 pracowników** | `docs/raport-km3/evidence/composite-baseline-przed.json` vs `...-po.json` porównane przez `scripts/composite-score-baseline.mjs --compare` (122 wiersze, porównanie TEKSTOWE bez tolerancji) + `composite-score-nietkniety.spec.ts` (39 wyników przez realny `SnapshotService.overview`) + żywy `GET /api/strategic-brain/overview` (39 wyników, 0 rozjazdów) | Trzy niezależne pomiary tej samej liczby: baza, ścieżka odczytu offline, ścieżka odczytu na żywo. |
| ANK-6 | Dobrostan nie wchodzi do wyniku ani teraz, ani po refaktorze | `scoring-izolacja.spec.ts` — `ScoreDimensions`/`ScoreWeights` mają dokładnie 4 klucze; żaden plik `strategic-brain` nie zna słowa „ankieta"; produkcyjne pliki ankiety nie sięgają do `strategic-brain` | Strażnik strukturalny czyta prawdziwe pliki źródłowe, więc nie da się go uśpić przepisując asercję. |
| ANK-7 | Brak komentarza nie blokuje agregacji | `ankieta.agregacja.spec.ts` — „brak komentarzy NIE blokuje agregacji wyniku" | Średnia i rozkład liczone z samych ocen. |
| ANK-8 | Migracja addytywna, wycofywalna w całości | `20260812090000_ankieta_pulsowa/migration.sql` — same `CREATE TABLE` / `CREATE INDEX` / `ADD CONSTRAINT` na NOWEJ tabeli; zero `ALTER` na istniejących | `DROP TABLE pulse_survey_response;` cofa blok F bez śladu w danych demo. |
| ANK-9 | Kotwice demo nietknięte | `scripts/seed-demo-ankieta.sql` pisze wyłącznie do `pulse_survey_response`; skrypt kotwicy przerywa z kodem 2, gdy liczba pracowników ≠ 39 lub zmian ≠ 1558 | 39 pracowników i 1558 zmian potwierdzone w obu zrzutach (`anchors` w plikach JSON). |
```

- [ ] **Krok 2: DOPISZ jedną pozycję do §5 raportu (istniejące cztery zostają bez zmian).** W `docs/raport-km3/Raport_KM3_HRobot.md`, w sekcji `# 5. Ograniczenia realizacji demonstracyjnej (uczciwość)`, **po** pozycji `[Dane syntetyczne.]{.lbl}` dodaj:

```markdown
- [Ankieta pulsowa w zakresie minimalnym.]{.lbl} Moduł ankiet pracowniczych i
  analizy dobrostanu (harmonogram M3 b) wdrożono w zakresie **jednego pytania
  w skali 1–5 z opcjonalnym komentarzem**, w oknie tygodniowym, z agregacją
  wyłącznie na poziomie jednostki organizacyjnej i **progiem anonimowości
  5 odpowiedzi** (poniżej progu ekran nie pokazuje żadnej wartości liczbowej).
  Poza zakresem demonstracji pozostają: wielopytaniowe kwestionariusze, analiza
  treści komentarzy i trendy międzyokresowe. Wskaźnik dobrostanu jest **osobnym
  sygnałem** i świadomie **nie wchodzi do wyniku zbiorczego** modułu rozwoju —
  liczby rozliczane w macierzy AN-1..AN-13 pozostają niezmienione, co
  potwierdzono porównaniem 122 wierszy ocen dla 39 pracowników przed i po
  wdrożeniu (`docs/raport-km3/macierz-pokrycia-ankieta.md`, poz. ANK-5).
```

- [ ] **Krok 3: Popraw nieaktualne kotwice w §5 (osobna, jednoliniowa poprawka faktograficzna).** W tym samym pliku, w pozycji `[Dane syntetyczne.]{.lbl}` zmień `kotwice demo (36 pracowników, 832 zmiany)` na `kotwice demo (39 pracowników, 1558 zmian)`, oraz to samo w linii 227. Uzasadnienie w commicie: liczby zmierzone w żywym najemcy `hrobot_t_900d948b` (`SELECT count(*) FROM employees` → 39, `FROM shifts` → 1558), zgodne z `docs/demo/2026-08-10-demo-4mobility-parp.md:48`.

- [ ] **Krok 4: Dopisz macierz do wykazu załączników.** W sekcji `# 8. Wykaz załączników` dodaj pozycję w tym samym formacie, co sąsiednie wpisy `macierz-pokrycia-*`:

```markdown
- Macierz pokrycia — Ankieta pulsowa i analiza dobrostanu (M3 b):
  `docs/raport-km3/macierz-pokrycia-ankieta.md`
```

- [ ] **Krok 5: Sprawdź, że §5 ma teraz pięć pozycji i że cztery poprzednie są nietknięte.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
git diff docs/raport-km3/Raport_KM3_HRobot.md
```

Oczekiwane: w §5 wyłącznie **dodane** linie nowej pozycji plus dwie zmiany liczb kotwic — żadna z czterech istniejących pozycji nie ma zmienionej treści merytorycznej.

- [ ] **Krok 6: Uruchom pełną bramkę i zacommituj.**

```
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\tenant-runtime
npx jest src/ankieta src/strategic-brain
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2\apps\web
npx vitest run
cd C:\Users\Wilk\Documents\WORKSPACE\HRobot-m2
pnpm -C apps/tenant-runtime typecheck
pnpm -C apps/web typecheck
git add docs/raport-km3/macierz-pokrycia-ankieta.md docs/raport-km3/Raport_KM3_HRobot.md
git commit -m "docs(km3): macierz pokrycia ankiety (ANK-1..ANK-9) + poz. w §5 + korekta kotwic na 39/1558"
```

Oczekiwane: jest zielony (moduł `ankieta` 40 testów + `strategic-brain` bez zmiany liczby), vitest zielony, oba typechecki bez wyjścia.

---

**Ryzyka:**

1. **`ALTER TABLE … OWNER TO hu_900d948b` pominięte przy ręcznym wgraniu migracji.** Tabela zostaje własnością `postgres`, aplikacja dostaje „permission denied for table pulse_survey_response" przy pierwszym zapisie — czyli błąd pojawia się dopiero na demo, nie przy wdrożeniu. Zadanie 11 Krok 3 kończy się jawnym `\dt`, który pokazuje właściciela; wynik `postgres` zamiast `hu_900d948b` zatrzymuje wdrożenie.
2. **Ktoś „naprawi" czerwony `middleware-matcher.test.ts` po Zadaniu 9, usuwając wpis z matchera** — i ekran `/ankieta` zostanie osiągalny anonimowo, dokładnie tak, jak zdarzyło się to trzem modułom M3. Zadanie 9 Krok 6 opisuje ten czerwony jako oczekiwany i zakazuje tej „naprawy"; Zadanie 10 Krok 5 domyka go ekranem.
3. **Fixture `km3-snapshots-39.json` rozjeżdża się z żywą bazą**, jeśli ktoś przepuści scheduler `strategic-brain` (cron 2:00) albo ponownie uruchomi `seed-demo-strategic-brain-peers.sql`. Wtedy `composite-score-nietkniety.spec.ts` zostanie zielony, ale będzie mierzył nieaktualne dane. Skrypt kotwicy przerywa z kodem 2 przy rozjeździe kotwic, a Zadanie 11 Krok 6 porównuje fixture z ŻYWĄ odpowiedzią API — to jest bramka, która to wykryje.
4. **`comment` to pole swobodnego tekstu wpisywane przez pracownika**, więc może zawierać dane osobowe wpisane przez niego samego. Ograniczają to: własny próg 5 komentarzy, sortowanie leksykograficzne zrywające związek z kolejnością zgłoszeń oraz limit 500 znaków. Nie ograniczają tego automatycznie: treść nie jest filtrowana. To jest świadome i należy to powiedzieć odbiorcy wprost — nie jest to wpisane do §5, bo §5 mówi o ograniczeniach zakresu, a to jest właściwość projektu.
5. **Okno tygodniowe liczone w UTC** — pracownik odpowiadający w niedzielę po 22:00 czasu polskiego (letniego) trafia już do okna poniedziałkowego. Przy jednym pytaniu na tydzień jest to bez znaczenia dla agregatu, ale gdyby ktoś w przyszłości oparł na tym oknie rozliczenie czasu pracy, byłby to błąd. Komentarz w `ankieta.window.ts` mówi to wprost.
6. **`AuditInterceptor` zapisuje ciało POST-a do `audit_log`**, czyli treść komentarza trafia do tabeli append-only, z której nie da się jej usunąć. `redactAuditPayload` nie zna klucza `comment`. Jeżeli odbiorca uzna to za problem RODO, poprawka jest jednoliniowa (dodanie `'comment'` do `SENSITIVE_KEYS` w `audit.interceptor.ts`) — ale zmienia zachowanie audytu dla WSZYSTKICH modułów, więc jest poza zakresem bloku F i wymaga osobnej decyzji.

**Wycofanie:**

Blok F tworzy **nową** tabelę i nie zmienia ani jednego istniejącego obiektu bazy, więc wycofanie jest zupełne i nie dotyka danych demo:

1. Na żywym najemcy: `docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -c "DROP TABLE IF EXISTS pulse_survey_response;"`
2. W repo: `git revert` commitów Zadań 4–12 (kolejność odwrotna). Migracja `20260812090000_ankieta_pulsowa` nigdy nie została wpisana do `_prisma_migrations`, więc jej usunięcie nie zostawia sieroty w historii migracji.
3. `pnpm -C packages/db db:generate` — regeneracja klienta bez modelu `PulseSurveyResponse`.
4. Weryfikacja, że wycofanie niczego nie ruszyło: `node scripts/composite-score-baseline.mjs --compare docs/raport-km3/evidence/composite-baseline-przed.json <świeży zrzut>` musi dać `exit=0` — czyli te same 122 wiersze i te same 39 wyników, co przed blokiem F.

Wycofanie samego **ekranu** bez wycofania backendu (gdyby wystarczyło ukryć funkcję na demo): usuń wpis `Dobrostan` z `apps/web/lib/nav.ts` i katalog `apps/web/app/(tenant)/ankieta/` wraz z wpisem `'/ankieta/:path*'` z `middleware.ts` — oba strażniki parytetu (`middleware-matcher.test.ts`, `api-gate.test.ts`) pilnują, żeby to usunięcie było kompletne.