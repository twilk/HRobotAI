# M2 · Podprojekt #4 — CI/CD + Środowisko testowe Etapu 2 (projekt)

> **Projekt:** HRobot.AI — Kamień Milowy **M2** (odbiór 20.07.2026)
> **Punkty programu:** **d)** konfiguracja CI/CD z automatycznym uruchamianiem pipeline'ów testowych przy każdym merge do gałęzi głównej · **e)** konfiguracja środowiska testowego Etapu 2
> **Beneficjent:** App Pro sp. z o.o. (0035/2026) · **Odbiorca Technologii:** 4Mobility
> **Repozytorium:** `github.com/twilk/HRobotAI` · **Gałąź główna:** `main`
> **Data:** 2026-07-06 · **Status:** Projekt zaakceptowany (brainstorming) → wejście w plan implementacyjny
> **Autor cyklu:** superpowers/brainstorming

---

## 1. Kontekst M2 i dekompozycja

Punkty **a–f** Etapu 2 to **6 niezależnych podsystemów**, nie jeden projekt. Nie mieszczą się w jednej specyfikacji — każdy dostaje własny cykl **spec → plan → implementacja**. Dekompozycja i kolejność krytyczna:

| # | Podprojekt | Punkty | Zależności | Ryzyko |
|---|------------|--------|------------|--------|
| 1 | **Rdzeń Grafiku** — model domenowy + formalizacja problemu (constraints/cel) + persystencja (`tenant-runtime/src/grafik`) + solver OR-Tools CP-SAT | a | — (fundament) | Średnie |
| 2 | **Agent AI Grafik Manager** — serwis Python, Gym-env (reużywa formalizacji z #1), RL (Stable-Baselines3), prognozowanie, pipeline treningowy | b | #1 | **Wysokie** |
| 3 | **Real-time + pre-uzgadnianie zamian zmian** — WebSocket/SSE + workflow negocjacji | c | #1 | Średnie |
| 4 | **CI/CD + Środowisko testowe Etapu 2** *(NINIEJSZA SPEC)* | d + e | — (równoległy tor DevOps) | Niskie |
| 5 | **UAT Etapu 2** — sesje z użytkownikami 4Mobility | f | #1–#4 | Niskie |

**Kolejność:** #1 → (#2 ‖ #3), tor #4 **równolegle od dnia 1**, #5 na końcu.
**Ambicja Agenta AI (#2), ustalona:** cel = **produkcyjny system ML** (Stable-Baselines3, realny Gym-env, serwowanie, pipeline treningowy). Ryzyko harmonogramowe = pełny trening na żywych danych 4Mobility; mitygacja = bootstrap danymi syntetycznymi/historycznymi + **imitation learning z solvera (#1)**. Szczegóły w osobnej specyfikacji #2.

**Niniejszy dokument obejmuje wyłącznie podprojekt #4.** Zaprojektowano go tak, by chronił i odblokowywał #1–#3 oraz #5.

## 2. Decyzje projektowe (ustalone w brainstormingu)

| Decyzja | Wybór | Uzasadnienie |
|---------|-------|--------------|
| Platforma CI | **GitHub Actions** | Repo na GitHub; zgodne z budżetem (rola DevOps → GitHub Actions) |
| Gałąź główna | **`main`** | Punkt d; martwa gałąź `master` do usunięcia |
| Kształt środowiska testowego (e) | **Trwały staging przez tunel** | Zawsze-dostępny URL dla UAT 4Mobility (f), realny w oknie M2 |
| Host staging | **Maszyna deva + Cloudflare tunnel** | Zero kosztu chmury; wzorzec już w repo (`docker/web-tunnel`, raporty KM) |
| Głębokość CI (d) | **Smoke E2E (złoty środek)** | Dowód end-to-end + zrzut na raport KM bez kosztu pełnej suity |
| Mechanizm deployu | **Self-hosted runner (auto)** | Pełna automatyzacja „merge → staging", zgodnie z literą punktu d |
| Dane na stagingu | **Syntetyczne/anonimizowane w kształcie 4Mobility** | Dane pracownicze na maszynie prywatnej ⇒ RODO; zarazem zbiór dla #2 |

## 3. Architektura

```
PR ──▶ ci.yml (GitHub-hosted, ubuntu-latest) ──▶ zielone = merge dozwolony (branch protection)
                                                    │
merge → main ──▶ ci.yml ──(workflow_run: success)──▶ deploy-staging.yml
                                                        │  (self-hosted runner na maszynie Windows deva)
                                                        ▼
                                    git pull → docker compose --profile full up -d --build
                                    → migracje (control-plane + fan-out tenant) → seed UAT
                                    → health-check → Cloudflare tunnel (stały URL)
                                                        ▼
                                            4Mobility klika → sesje UAT (punkt f)
```

Dwa workflowy (`.github/workflows/`): **`ci.yml`** (bramka jakości) i **`deploy-staging.yml`** (dostarczenie na staging). Rozdzielone, bo mają różne runnery (hosted vs self-hosted) i różne triggery.

## 4. `ci.yml` — pipeline testowy (punkt d)

- **Trigger:** `pull_request` → `main` oraz `push` → `main`.
- **Runner:** `ubuntu-latest` (Linux). Dev pracuje na Windows — CI na Linux świadomie wychwytuje różnice cross-platform. Konfiguracja Jest jest już Windows/Linux-safe (`jest.config.cjs`, bez `--experimental-vm-modules`).
- **Cache:** pnpm store + Turbo lokalny cache (klucz `pnpm-lock.yaml`).
- **Bramki (kolejność wg dok. `g`, każda musi przejść przed następną):**

| Etap | Komenda / mechanizm | Weryfikuje |
|------|---------------------|-----------|
| Lint + typecheck | `turbo run lint typecheck` | statyczna poprawność wszystkich pakietów |
| Unit | `turbo run test` (Jest, bez DB) | Encryption, TenantPrismaManager, state machine, DTO, outbox |
| Integration | Jest + **Postgres service container** | izolacja tenantów, pipeline provisioningu, throttler (Redis service) |
| Smoke E2E | **Playwright** + stack przez `docker compose` | login ADMIN_KLIENTA → `/grafik` renderuje się, 0 błędów konsoli |
| Fan-out migracji | `packages/db/scripts/migrate-all-tenants.ts` | migracje aplikują się czysto na ≥2 bazach tenantów |

- **Branch protection** na `main`: wymagany zielony `ci.yml`. Bezpośredni push blokowany — tylko przez PR.

Szkic (ilustracyjny, nie finalny):

```yaml
name: ci
on:
  pull_request: { branches: [main] }
  push: { branches: [main] }
jobs:
  quality:
    runs-on: ubuntu-latest
    services:
      postgres: { image: postgres:16, env: { POSTGRES_PASSWORD: postgres }, ports: ['5432:5432'],
                  options: >-  --health-cmd "pg_isready" --health-interval 10s --health-retries 5 }
      redis:    { image: redis:7, ports: ['6379:6379'] }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint typecheck
      - run: pnpm turbo run test               # unit
      - run: pnpm turbo run test:integration    # Postgres/Redis service
      - run: pnpm turbo run test:e2e:smoke      # Playwright, docker compose stack
      - run: pnpm tsx packages/db/scripts/migrate-all-tenants.ts
```

## 5. `deploy-staging.yml` — staging Etapu 2 (punkt e)

- **Trigger:** `workflow_run` po sukcesie `ci.yml` na `main` (deploy tylko z zielonego `main`).
- **Runner:** **self-hosted**, zarejestrowany jednorazowo na maszynie Windows deva (label `staging-dev-box`).
- **Reuse istniejącego:** `docker-compose.yml --profile full` (PG×2, Redis, RabbitMQ, Keycloak, control-plane, tenant-runtime, web) + `docker/web-tunnel` (Cloudflare → stały URL).
- **Kroki:** `git pull` → `docker compose --profile full up -d --build` → migracje (control-plane + fan-out tenant) → **seed danych UAT** → health-check każdego serwisu → weryfikacja/utrzymanie tunelu.
- **Idempotencja:** ponowny deploy tej samej rewizji nie psuje stanu; seed jest upsert/reset-em znanego zbioru, nie ślepym insertem.

## 6. Dane UAT — syntetyczne/anonimizowane (RODO)

Staging działa na maszynie prywatnej ⇒ **żadnych realnych PESEL-i ani danych osobowych 4Mobility**. Skrypt seedujący generuje dane **w kształcie organizacji 4Mobility**:
- struktura oddziałów/lotnisk/punktów z `docs/design/web-kit/lib/facilities.ts` (~15 lokalizacji),
- ~36 pracowników (imiona/nazwiska syntetyczne, PESEL generowany, nie prawdziwy),
- `Lokalizacja` + `Pojazd` (migracja `20260609000000`),
- przykładowe grafiki (shifts) pod demonstrację Grafiku.

Istniejący `4mobility-import.cjs` (root, nietrackowany) traktujemy **wyłącznie jako źródło struktury** → powstaje wariant anonimizujący/syntetyczny. Ten sam zbiór zasili ewaluację/trening Agenta RL (#2).

## 7. Slot na serwis Python ML (pod #2 — placeholder, nie budujemy teraz)

Struktura CI/compose z góry przewiduje serwis ML, by #2 nie wymagał przemeblowania:
- `ci.yml` — later matrix lane `python` (pytest + ruff); teraz tylko notatka/komentarz,
- `docker-compose.yml` — zarezerwowany serwis `agent` (Python/Stable-Baselines3), zakomentowany placeholder.

## 8. Kryteria akceptacji (odbiorowe — wzór GT-1…GT-7 z dok. `g`)

| # | Kryterium | Weryfikacja |
|---|-----------|-------------|
| CI-1 | PR z błędem lint/typecheck/testu = czerwony, merge zablokowany | branch protection + czerwony run |
| CI-2 | Integration: test izolacji tenantów zielony | run CI (Postgres service) |
| CI-3 | Smoke E2E: login → `/grafik` bez błędów w konsoli | artefakt Playwright (zrzut na raport KM) |
| CI-4 | Fan-out migracji zielony na ≥2 bazach | run CI |
| ENV-1 | Merge do `main` → staging auto-aktualizuje się w ≤ ~10 min | `deploy-staging.yml` run + health |
| ENV-2 | Staging pod stałym URL Cloudflare, zaseedowany danymi syntetycznymi | ręczna weryfikacja URL |
| ENV-3 | 4Mobility loguje się i dochodzi do Grafiku (gotowe pod UAT / f) | scenariusz smoke ręczny |

## 9. Ryzyka i mitygacje

| Ryzyko | Mitygacja |
|--------|-----------|
| Maszyna deva offline → staging niedostępny w UAT | Sesje UAT umawiane; health-check + alert; ścieżka awaryjna: ręczny `docker compose up` |
| Self-hosted runner na Windows — bezpieczeństwo/uprawnienia | Runner tylko dla tego repo, ograniczony user, brak sekretów prod na boxie |
| Keycloak w E2E wolny/niestabilny w CI | Mock (WireMock) dla Keycloak w smoke E2E, jak w dok. `g` §3.3 |
| Docker Desktop na Windows — różnice od Linux CI | CI na Linux jest źródłem prawdy; staging tylko serwuje, nie bramkuje |
| Seed z realnymi danymi przez pomyłkę (RODO) | Skrypt seedujący twardo odmawia danych z PESEL-em spoza puli syntetycznej |

## 10. Poza zakresem (YAGNI dla M2)

Pełna suita E2E · produkcyjny K8s/Terraform (dok. `h`/M3) · Turbo **remote** cache · obrazy multi-arch · środowiska preview per-PR · realny trening RL (to #2).

## 11. Powiązania / identyfikowalność

- Środowisko i piramida testów: `docs/HRobotDocs/g-srodowisko-testowe.md`
- Środowisko produkcyjne (kontekst, poza zakresem): `docs/HRobotDocs/h-srodowisko-produkcyjne-testy-smoke.md`
- Harmonogram / kamienie: `docs/HRobotDocs/f-harmonogram-wdrozenia.md`
- Stack lokalny: `docker-compose.yml`, `docker/web-tunnel/`
- Fan-out migracji: `packages/db/scripts/migrate-all-tenants.ts`

## 12. Otwarte kwestie do kolejnych cykli (nie blokują #4)

- #1 Rdzeń Grafiku: formalizacja twardych/miękkich ograniczeń i funkcji celu (dojazdy/etaty/godziny) — osobny brainstorming.
- #2 Agent AI: definicja Gym-env, kształt nagrody, źródło i wolumen danych treningowych.
- #3 Zamiany: model workflow pre-uzgadniania (kto akceptuje, jak rozwiązywane konflikty).
- #5 UAT: scenariusze testowe i kryteria akceptacji użytkownika z 4Mobility.
