# Design — Migracja frontu `web-kit → apps/web` na Docker (Faza A, zachowawcza)

> **Status:** design zaakceptowany (brainstorming). Następne: `writing-plans` → plan TDD → egzekucja.
> **Kamień/kontekst:** porządkowanie po KM1–KM3; front produktowy = `apps/web`.
> **Beneficjent:** App Pro sp. z o.o. · **Odbiorca:** 4Mobility. Repo: HRobot-m2, worktree `feat/demo-4mobility`.

---

## 1. Cel (jedno zdanie)
Przenieść działający front Next.js (`docs/design/web-kit`, całe UI M1+M2+M3) do docelowej lokalizacji `apps/web`, uczynić go pełnoprawnym serwisem w Dockerze za bramą Caddy z deterministycznym bootstrapem, i **usunąć** `web-kit` — **bez utraty działającego rozwiązania**, z parzystością potwierdzoną wykonywalną bramką przed jakąkolwiek kasacją.

## 2. Kontekst i uzasadnienie (dlaczego tak)
- **Stan wyjściowy (fakt):** `apps/web` to dziś mały, zależnościowo-czysty **vanilla-JS SPA onboardingu** (`index.html`+`app.js`+`serve.mjs`+`tour.js`/`show.js`, tour Shepherd.js) pokrywający flow KM1 (signup/provisioning/katalog). `docs/design/web-kit` to **pełna aplikacja Next.js 15 / React 19** ze wszystkimi ekranami tenantowymi M1+M2+M3 (dashboard, grafik, ai-grafik, pracownicy, wnioski, dostępy, zamiany, analiza, dokumenty, asystent, ustawienia) + ekrany publiczne (login/signup/status), z RBAC, warstwą proxy/lib i testami vitest. **To web-kit niesie działającą funkcjonalność.**
- **Decyzja kierunkowa (A):** „`apps/web` jako front docelowy" = cel **lokalizacyjny/produktowy** — realny front ma żyć pod `apps/web` (właściwe miejsce w monorepo, w deliverables), a referencyjny `docs/design/web-kit` znika. Dlatego **przenosimy stack Next.js** (zero przepisywania), nie adaptujemy do vanilla.
- **Problem operacyjny do usunięcia:** żaden front nie jest dziś w `docker-compose` (stack = tylko backend+infra), więc `docker compose up` daje API, ale **nie UI** — web-kit trzeba odpalać ręcznie (`start-prod.mjs`). To sprzeczne z „wszystko jednym `up`".
- **Podejście: 1 (`git mv` + weryfikacja parzystości przed usunięciem)**, wersja **senioralna** (Caddy + deterministyczny bootstrap + bramka parzystości + fazowanie). Siatka bezpieczeństwa = git (praca na gałęzi; web-kit odtwarzalny z historii).

## 3. Zakres
**W zakresie (Faza A — zachowawcza, behavior-preserving):**
- Relokacja `web-kit → apps/web` z zachowaniem historii; integracja z pnpm-workspace + turbo.
- Konteneryzacja Next (multi-stage, `output: 'standalone'`); serwis `web` w compose.
- Brama **Caddy** jako jeden publiczny origin.
- Deterministyczny bootstrap (migracje + import realmu KC + seed demo 4Mobility jako idempotentne init-joby).
- Wykonywalny **kontrakt parzystości** + cutover blue-green + usunięcie katalogu `web-kit` i resztek.
- Ocalenie **tour + autoplay demo** jako izolowanego komponentu w nowej apce.

**Poza zakresem (świadomie):**
- **Faza B (osobny spec):** usunięcie nieprodukcyjnej wydmuszki (dev-auth-bypass, self-mint tokenów, stubowe ekrany), **ujednolicenie auth-gate** (rozjazd 200-vs-307 na ekranach), hardening sesji/cookie.
- Realna domena / TLS produkcyjny (Caddy przygotowany, ale prod-TLS/HTTPS-na-domenie to później).
- Migracja LOGIKI z vanilla `apps/web` (odrzucona — zastępujemy; ocalamy jedynie koncept tour/demo).

## 4. Architektura docelowa

### 4.1 Topologia (Caddy — jeden origin)
```
przeglądarka ──▶ Caddy (jedyny publiczny origin, np. http://hrobot.localhost)
                  │  /            → web (Next: UI + trasy BFF /api/*)
                  ▼
                web (Next.js standalone)
                  │  server-side (BFF proxy):
                  │   /api/*   → tenant-runtime:3001/api   (dane, RBAC, logika)
                  │   ROPC     → keycloak:8080             (mint tokenu, server-side)
                  ▼
   sieć wewnętrzna: tenant-runtime · control-plane · keycloak · postgres · redis · rabbitmq · optimizer · agent
```
- **Login = ROPC/direct-grant server-side** (istniejący wzorzec web-kit: server action mintuje token przez `KEYCLOAK_TOKEN_URL`, ustawia cookie httpOnly). Przeglądarka **nie** przekierowuje do KC → znika problem SSR-vs-przeglądarka i domeny cookie.
- **Issuer JWT spójny** wewnątrz sieci: Next mintuje z `http://keycloak:8080/realms/hrobot-staging`, `tenant-runtime` waliduje JWKS z tego samego adresu (obie usługi w sieci kontenerów).
- **Ekspozycja portów backendu tylko dla dev/debug**; ścieżka demo/prod to wyłącznie przeglądarka→Caddy→web.
- **Wzorzec BFF-proxy zostaje** (tokeny httpOnly poza JS — właściwe pod RODO); to celowa decyzja, nie dług.

### 4.2 Komponenty (granice, jedna odpowiedzialność)
| Komponent | Odpowiedzialność | Zależy od |
|---|---|---|
| `caddy` (serwis) | jeden publiczny origin, routing `/`→web | web |
| `apps/web` (Next standalone) | UI (M1–M3) + BFF proxy `/api/*` + sesja httpOnly + RBAC-gate | tenant-runtime, keycloak (server-side) |
| `Dockerfile` (apps/web) | multi-stage build → obraz runtime standalone | pnpm-workspace, turbo |
| init-boot (bootstrap) | idempotentne: migracje + realm KC + seed demo 4Mobility | postgres/keycloak healthy |
| `Caddyfile` | konfiguracja routingu (kilkanaście linii) | — |

### 4.3 Przepływ danych
1. Przeglądarka → Caddy → `web` (SSR strony + assety).
2. Akcje danych: przeglądarka → `/api/...` na `web` → Next BFF proxy → `tenant-runtime:3001/api` (z tokenem z cookie).
3. Login: form → server action → ROPC do `keycloak:8080` → cookie httpOnly ustawione przez Next.
4. Bootstrap (raz, przy `up`): init-joby dowożą schemat + realm + dane; potem `web` startuje zdrowy.

## 5. Mechanika relokacji (zachowawcza)
1. Gałąź robocza. `git mv docs/design/web-kit apps/web` (historia zachowana).
2. **Integracja z workspace:** `apps/web` łapie się globem `apps/*` w `pnpm-workspace.yaml`; usuwamy samodzielny `apps/web/pnpm-lock.yaml`; `pnpm install` z rootu; build wchodzi w `turbo` (dodać `apps/web` do pipeline'u jeśli trzeba).
3. **Next config:** włączyć `output: 'standalone'`; sprawdzić `basePath`/assetPrefix pod jeden origin.
4. **Env:** `.env.local`(sekrety) → `.env.example` + zmienne serwisu w compose: `TENANT_RUNTIME_URL=http://tenant-runtime:3001`, `KEYCLOAK_TOKEN_URL=http://keycloak:8080/realms/hrobot-staging/protocol/openid-connect/token`, `KEYCLOAK_CLIENT_ID`, publiczny origin. Zero sekretów w repo.
5. **Dockerfile (apps/web):** multi-stage (deps → build `pnpm --filter @hrobot/web build` → runtime kopiuje `.next/standalone` + `.next/static` + `public`). Uruchomienie `node server.js` (standalone). Osadzić font PL już nie dotyczy frontu (to backend), ale sprawdzić fonty UI (fontshare/google) — dopuszczalne przez CSP/sieć.
6. **Compose:** serwis `web` (build z `apps/web/Dockerfile`), `depends_on: tenant-runtime: service_healthy`, healthcheck (`/` 200). **`web` słucha wyłącznie w sieci wewnętrznej** (port kontenera, np. 3000) — NIE publikujemy go na host. Jedynym publicznym wejściem jest serwis `caddy` (host `:8080`, docelowo `:80`/`:443`), który routuje `/`→`web`. (Opcjonalnie na czas dev można wystawić `web` na dodatkowym porcie, ale ścieżka kanoniczna to przeglądarka→Caddy.)

## 6. Deterministyczny bootstrap (koniec ręcznego `demo-up.mjs`)
- Migracje (tenant + control-plane), import realmu Keycloak (`hrobot-staging` z użytkownikami demo), seed demo 4Mobility (M1+M2+M3, idempotentnie) — jako **init-joby/entrypointy** uruchamiane pod warunkiem `service_healthy`, **idempotentne** (`IF NOT EXISTS`/`ON CONFLICT`).
- Efekt: `docker compose up` → pełny, powtarzalny system i **żywe demo na tych samych instancjach**, bez ręcznych kroków i bez rozjazdu `keycloak_sub`.
- Wchłania to logikę istniejącego `scripts/demo-up.mjs` (resolveSub + seedy) do zautomatyzowanego bootstrapu; `demo-up.mjs` zostaje ewentualnie jako cienki wrapper lub znika (Faza A: zautomatyzować; nie mnożyć ścieżek).

## 7. Bramka parzystości + cutover
- **Kontrakt parzystości (wykonywalny):** skrypt/e2e, który dla `apps/web` w Dockerze potwierdza:
  - każda trasa publiczna i tenantowa odpowiada poprawnie (200/oczekiwany redirect) — bez 404/500;
  - kluczowe przepływy per rola działają (login 3 role; przykładowy odczyt/akcja na module z każdego KM: np. grafik, wnioski, dokumenty-pobierz-otwieralny-PDF, analiza-self, asystent-interpret);
  - vitest przeniesiony z apką **zielony** (~355), `tsc` czysty.
- **Cutover blue-green:** Caddy kieruje na nowy `web`; stary `web-kit` (host-proces) wygaszony.
- **Usunięcie:** katalog `docs/design/web-kit` + resztki (`start-prod.mjs`, wpisy w `.claude/launch.json`, `.env.example` referencje, docy) **kasujemy dopiero po zielonej parzystości**. Po usunięciu: build + testy + `compose up` nadal zielone (usunięcie niczego nie psuje). **Usunięcie katalogu = bramka człowieka** (potwierdzenie przed `git rm -r`).

## 8. Tour/demo (ocalony)
- Odtworzyć prowadzony **tour + autoplay demo** jako izolowany, opcjonalny komponent w `apps/web` (koncept z vanilla `tour.js`/`show.js`; obecnie brak kodu Shepherd w web-kit — budujemy świeżo, mały zakres). Wpięty jako feature (np. „Take the tour"/autoplay), nie osobny SPA. Wartość: demo 4Mobility.
- Jedna odpowiedzialność, dobrze odizolowany (własny komponent + hooki), testowalny niezależnie.

## 9. Testowanie
- **vitest** (przeniesiony) — zielony; ewentualne poprawki ścieżek importów po `git mv`.
- **tsc `--noEmit`** — czysty.
- **Skrypt parzystości** (§7) — nowy artefakt, uruchamiany w CI/lokalnie przeciw Dockerowi.
- **Smoke `docker compose up`** — wszystkie serwisy healthy w kolejności zależności; `web` za Caddy odpowiada; login 3 role.
- Zasada: żadne usunięcie web-kit bez kompletu zielonych bramek.

## 10. Ryzyka i mitygacje
| Ryzyko | Mitygacja |
|---|---|
| Rozjazd URL/cookie/issuer przy konteneryzacji | Caddy (jeden origin) + ROPC server-side + spójny issuer w sieci; init-boot (sub-sync automatyczny) |
| Różnice ścieżek Git Bash↔Windows przy `git mv`/buildzie | Weryfikacja buildu w kontenerze (Linux), nie na hoście |
| `output: 'standalone'` gubi assety/env | Jawne kopiowanie `.next/static`+`public`; test smoke `/` + assety |
| Utrata działającego rozwiązania | Praca na gałęzi + bramka parzystości; usunięcie web-kit dopiero po zielonym; git jako fallback |
| Secure-cookie/dev vs prod | Faza A zachowuje bieżące zachowanie; ujednolicenie (TLS/secure) → Faza B |
| Fonty UI z zewn. CDN a CSP/sieć w kontenerze | Sprawdzić ładowanie fontów; w razie potrzeby self-host (jak Noto w backendzie) — drobne |

## 11. Kryteria akceptacji (mierzalne)
- **AC-1:** `git mv` wykonany; `apps/web` w pnpm-workspace (jeden lockfile w root); `pnpm install` + `turbo build` przechodzą.
- **AC-2:** `apps/web/Dockerfile` (standalone) buduje się; obraz runtime startuje `node server.js`.
- **AC-3:** serwis `web` + `caddy` w compose; `docker compose up` → wszystkie serwisy healthy w kolejności zależności; przeglądarka pod jednym originem Caddy widzi UI.
- **AC-4:** deterministyczny bootstrap: świeży `up` (pusty wolumen) → migracje+realm+seed automatycznie; login 3 ról działa **bez** ręcznego `demo-up.mjs`.
- **AC-5:** kontrakt parzystości zielony (wszystkie trasy + kluczowe flow per rola + vitest ~355 + tsc).
- **AC-6:** cutover: Caddy kieruje na `web`; `web-kit` host-proces zbędny.
- **AC-7:** po usunięciu `docs/design/web-kit` (bramka człowieka) — build + testy + `compose up` nadal zielone; brak martwych referencji.
- **AC-8:** tour/demo działa jako opcjonalny komponent w `apps/web`.

## 12. Bramki człowieka
- Usunięcie katalogu `web-kit` (`git rm -r`) — potwierdzenie.
- Migracje/seed na inne niż lokalne środowisko — potwierdzenie.
- `git push` — zostaje lokalne, chyba że wprost pozwolisz.

## 13. Nie-cele (przypomnienie)
Faza B (de-wydmuszka, auth-gate 200vs307, hardening cookie/TLS), realna domena/prod-TLS, przenoszenie logiki vanilla `apps/web`.
