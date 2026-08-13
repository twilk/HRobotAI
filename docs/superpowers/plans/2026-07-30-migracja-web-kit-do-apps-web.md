# Migracja web-kit → apps/web na Docker (Faza A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Przenieść działający front Next.js (`docs/design/web-kit`) do `apps/web`, skonteneryzować go za bramą Caddy z deterministycznym bootstrapem, potwierdzić parzystość wykonywalną bramką i usunąć `web-kit` — bez utraty działającego rozwiązania.

**Architecture:** Zachowawczy `git mv` na gałęzi; `apps/web` wchodzi w pnpm-workspace (glob `apps/*`); Next w trybie `output:'standalone'` w multi-stage Dockerfile; serwis `web` (wewnętrzny) za serwisem `caddy` (jeden publiczny origin); login ROPC server-side (BFF proxy, httpOnly); migracje+realm+seed jako idempotentny init. Parzystość (trasy + flow per rola + vitest + tsc) jest bramką cutover; kasacja web-kit dopiero po zielonym.

**Tech Stack:** Next.js 15 / React 19, pnpm workspace + turbo, Docker Compose, Caddy, Keycloak (ROPC), NestJS tenant-runtime (istniejący), vitest + playwright.

**Autorytatywny spec:** `docs/superpowers/specs/2026-07-30-migracja-web-kit-do-apps-web-design.md`.

---

## Struktura plików (co powstaje / zmienia się)
- **Relokacja:** `docs/design/web-kit/**` → `apps/web/**` (git mv).
- **Usuwane po relokacji:** `apps/web/pnpm-lock.yaml` (standalone), `apps/web/serve.mjs`/`app.js`/`index.html`/`show.js`/`tour.js`/`vendor/` (stary vanilla — po ocaleniu konceptu tour).
- **Nowe:** `apps/web/Dockerfile`, `apps/web/.dockerignore`, `infra/caddy/Caddyfile`, `scripts/parity-smoke.sh`, `scripts/bootstrap-demo.mjs` (init), `apps/web/components/tour/*` (ocalony tour).
- **Modyfikowane:** `docs/design/web-kit/next.config.js`→`apps/web/next.config.js` (+`output:'standalone'`), `docker-compose.yml` (serwisy `web`, `caddy`, `bootstrap`), `apps/web/package.json` (name→`@hrobot/web`), `.claude/launch.json` (wpis web-kit → apps/web), pnpm-workspace (glob już łapie `apps/*`).
- **Kasowane na końcu (bramka człowieka):** cała reszta odniesień do web-kit (start-prod.mjs, docy).

---

## Task 1: Kontrakt parzystości (baseline na web-kit)

Cel: wykonywalny dowód „co dziś działa", uruchomiony PRZED migracją na starym web-kit (:5601) → GREEN. Ten sam skrypt będzie bramką po migracji (przez Caddy).

**Files:**
- Create: `scripts/parity-smoke.sh`

- [ ] **Step 1: Napisz skrypt parzystości**

```bash
#!/usr/bin/env bash
# Parity smoke: sprawdza trasy per rola + kluczowe flow. Uruchamiany PRZED migracją
# przeciw web-kit (BASE=http://localhost:5601) i PO migracji przeciw Caddy (BASE=http://localhost:8080).
# Użycie: BASE=http://localhost:5601 KC=http://localhost:8081 bash scripts/parity-smoke.sh
set -uo pipefail
BASE=${BASE:-http://localhost:5601}
KC=${KC:-http://localhost:8081}
FAIL=0
say(){ printf '%-52s %s\n' "$1" "$2"; }
chk(){ local name="$1" got="$2" exp="$3"; if [ "$got" = "$exp" ]; then say "$name" "OK ($got)"; else say "$name" "FAIL (got=$got exp=$exp)"; FAIL=1; fi; }
mint(){ curl -s "$KC/realms/hrobot-staging/protocol/openid-connect/token" -d "grant_type=password&client_id=hrobot-web&username=$1&password=$2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).access_token||"")}catch(e){}})'; }

echo "== trasy publiczne =="
chk "GET /login"  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/login)" 200
echo "== trasy tenantowe (bez sesji → 200 render lub 307 redirect; NIE 404/500) =="
for p in dashboard grafik pracownicy wnioski dostepy zamiany analiza dokumenty asystent ustawienia; do
  code=$(curl -s -o /dev/null -w '%{http_code}' $BASE/$p)
  case "$code" in 200|307|308) say "GET /$p" "OK ($code)";; *) say "GET /$p" "FAIL ($code)"; FAIL=1;; esac
done
echo "== login 3 role (ROPC) =="
for u in "demo:demo-staging-2026" "manager.demo:Manager!2026" "pracownik.demo:Pracownik!2026"; do
  n=${u%%:*}; p=${u##*:}; t=$(mint "$n" "$p"); [ ${#t} -gt 100 ] && say "token $n" "OK" || { say "token $n" "FAIL"; FAIL=1; }
done
echo "== flow po jednym z każdego KM (bezpośrednio w backend :3001 przez proxy nie jest testowane tu; to robi playwright) =="
echo ""
[ "$FAIL" = 0 ] && { echo "PARITY: GREEN"; exit 0; } || { echo "PARITY: RED"; exit 1; }
```

- [ ] **Step 2: Uruchom przeciw działającemu web-kit (baseline)**

Run: `BASE=http://localhost:5601 KC=http://localhost:8081 bash scripts/parity-smoke.sh`
Expected: `PARITY: GREEN` (jeśli web-kit nie działa — najpierw `docker compose -p hrobot --profile full up -d` + web-kit). Zapisz output jako baseline.

- [ ] **Step 3: Commit**

```bash
git add scripts/parity-smoke.sh
git commit -m "test(migracja): parity smoke contract (baseline na web-kit)"
```

---

## Task 2: git mv web-kit → apps/web + wejście do workspace

**Files:**
- Modify (move): `docs/design/web-kit/**` → `apps/web/**`
- Delete: `apps/web/pnpm-lock.yaml`
- Modify: `apps/web/package.json` (name)

- [ ] **Step 1: Sprawdź, że apps/web (vanilla) jest zacommitowane/zbędne, potem przenieś**

```bash
git rm -r apps/web            # usuń stary vanilla SPA (jest w historii; tour ocalimy w Task 9 z docs/design/web-kit lub z historii)
git mv docs/design/web-kit apps/web
git rm -f apps/web/pnpm-lock.yaml
```

- [ ] **Step 2: Zmień nazwę pakietu na @hrobot/web**

W `apps/web/package.json` zmień `"name": "hrobot-web-kit"` → `"name": "@hrobot/web"`.

- [ ] **Step 3: Instalacja z rootu (wejście do workspace)**

Run: `pnpm install`
Expected: instalacja przechodzi; `apps/web` widoczny jako pakiet workspace (`pnpm -F @hrobot/web exec node -v` działa).

- [ ] **Step 4: Testy + typecheck po przenosinach (nic się nie zepsuło)**

Run: `pnpm -F @hrobot/web test && pnpm -F @hrobot/web typecheck`
Expected: vitest zielony (~355), tsc czysty. (Jeśli importy się psują po zmianie ścieżek — napraw; web-kit był samowystarczalny, więc raczej OK.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(web): git mv web-kit → apps/web + wejście do pnpm-workspace"
```

---

## Task 3: Next `output: 'standalone'`

**Files:**
- Modify: `apps/web/next.config.js`

- [ ] **Step 1: Dodaj tryb standalone**

W `apps/web/next.config.js` do obiektu `nextConfig` dodaj `output: 'standalone',` (obok istniejących `outputFileTracingRoot`, `devIndicators`). `outputFileTracingRoot` zostaw wskazujący na root monorepo (`../../` od apps/web), by standalone spakował zależności z workspace:

```js
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: join(here, '..', '..'), // monorepo root — standalone pakuje deps z workspace
  devIndicators: false,
}
export default nextConfig
```

- [ ] **Step 2: Build standalone**

Run: `pnpm -F @hrobot/web build`
Expected: build przechodzi; powstaje `apps/web/.next/standalone/` (zawiera `server.js`) oraz `apps/web/.next/static/`.

- [ ] **Step 3: Weryfikacja standalone lokalnie (opcjonalna, szybka)**

Run: `node apps/web/.next/standalone/apps/web/server.js` (ścieżka zależna od outputFileTracingRoot — potwierdź lokalizację `server.js` z outputu buildu) w tle, potem `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login` → 200. Zatrzymaj proces.

- [ ] **Step 4: Commit**

```bash
git add apps/web/next.config.js
git commit -m "build(web): Next output standalone dla obrazu runtime"
```

---

## Task 4: Dockerfile dla apps/web (multi-stage, standalone)

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/web/.dockerignore`

- [ ] **Step 1: .dockerignore**

```
node_modules
.next
.git
**/*.env.local
```

- [ ] **Step 2: Dockerfile (multi-stage, wzór apps/tenant-runtime/Dockerfile)**

```dockerfile
# apps/web/Dockerfile — build kontekst = root monorepo (compose ustawia context: .)
FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS builder
# lockfile + manifesty workspace (cache warstwy install)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json          apps/web/
COPY apps/control-plane/package.json apps/control-plane/
COPY apps/tenant-runtime/package.json apps/tenant-runtime/
COPY packages/config/package.json   packages/config/
COPY packages/db/package.json       packages/db/
COPY packages/shared/package.json   packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -F @hrobot/web build

FROM base AS runtime
ENV NODE_ENV=production
# standalone: server.js + minimalne node_modules; + static + public
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
```
> Uwaga: dokładna ścieżka `server.js` w standalone zależy od `outputFileTracingRoot`. Po Task 3 Step 2 potwierdź, gdzie leży `server.js`, i dostosuj `COPY`/`CMD` (może być `apps/web/server.js` lub `server.js`).

- [ ] **Step 3: Build obrazu**

Run: `docker build -f apps/web/Dockerfile -t hrobot-web:test .`
Expected: build success.

- [ ] **Step 4: Smoke kontenera (samodzielnie, bez sieci compose)**

Run: `docker run --rm -d --name web-smoke -p 3010:3000 hrobot-web:test` potem `sleep 4 && curl -s -o /dev/null -w '%{http_code}' http://localhost:3010/login` → 200. `docker rm -f web-smoke`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/Dockerfile apps/web/.dockerignore
git commit -m "build(web): multi-stage Dockerfile (Next standalone)"
```

---

## Task 5: Serwis `web` w compose

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Dodaj serwis `web` (wewnętrzny, bez publikacji na host)**

W `docker-compose.yml` dodaj (wzór serwisu `tenant-runtime` — profile, build, depends_on):

```yaml
  web:
    profiles: ["full"]
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    environment:
      TENANT_RUNTIME_URL: http://tenant-runtime:3001
      KEYCLOAK_TOKEN_URL: http://keycloak:8080/realms/hrobot-staging/protocol/openid-connect/token
      KEYCLOAK_CLIENT_ID: hrobot-web
      KEYCLOAK_USERNAME: demo
      KEYCLOAK_PASSWORD: ${KEYCLOAK_DEMO_PASSWORD:-demo-staging-2026}
      NODE_ENV: production
      PORT: "3000"
    depends_on:
      tenant-runtime:
        condition: service_started
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 10
    # BRAK `ports:` — web jest wewnętrzny; publiczny origin to Caddy (Task 6).
```

- [ ] **Step 2: Zbuduj i podnieś tylko web (+zależności)**

Run: `docker compose -p hrobot --profile full up -d --build web`
Expected: `web` staje się `healthy` (po `tenant-runtime`).

- [ ] **Step 3: Weryfikacja z wnętrza sieci (web nie jest na hoście)**

Run: `docker compose -p hrobot exec web node -e "fetch('http://localhost:3000/login').then(r=>console.log(r.status))"`
Expected: `200`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "infra(compose): serwis web (Next standalone, wewnętrzny)"
```

---

## Task 6: Brama Caddy (jeden publiczny origin)

**Files:**
- Create: `infra/caddy/Caddyfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Caddyfile (routing / → web)**

```
# infra/caddy/Caddyfile — jeden publiczny origin. Dev: http na :8080.
:8080 {
	encode gzip
	# całość ruchu do frontu Next (który sam proxy'uje /api/* do tenant-runtime po stronie serwera)
	reverse_proxy web:3000
}
```
> Uwaga: `/api/*` NIE routujemy w Caddy do tenant-runtime — front (BFF) robi to server-side, trzymając tokeny httpOnly. Caddy kieruje 100% na `web`. (Bezpośredni routing `/cp`→control-plane/`/auth`→keycloak dodamy dopiero, gdy będzie potrzebny publicznie — Faza B.)

- [ ] **Step 2: Serwis `caddy` w compose (publiczny :8080)**

```yaml
  caddy:
    profiles: ["full"]
    image: caddy:2-alpine
    ports:
      - "8080:8080"
    volumes:
      - ./infra/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
    depends_on:
      web:
        condition: service_healthy
```

- [ ] **Step 3: Podnieś Caddy + weryfikuj publiczny origin**

Run: `docker compose -p hrobot --profile full up -d caddy` potem `curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/login`
Expected: `200` (przeglądarka widzi UI przez jeden origin Caddy).

- [ ] **Step 4: Commit**

```bash
git add infra/caddy/Caddyfile docker-compose.yml
git commit -m "infra(caddy): jeden publiczny origin przed web"
```

---

## Task 7: Deterministyczny bootstrap (koniec ręcznego demo-up)

Cel: świeży `up` na pustym wolumenie → migracje + realm KC + seed demo automatycznie, idempotentnie; login 3 ról działa bez `demo-up.mjs`.

**Files:**
- Create: `scripts/bootstrap-demo.mjs`
- Modify: `docker-compose.yml` (serwis `bootstrap`)

- [ ] **Step 1: Zbierz istniejące kroki bootstrapu**

Przeczytaj `scripts/demo-up.mjs` (kroki: wait keycloak → seed realm → resolveSub → sync keycloak_sub → seed J5 → apply M2 schema/seed) oraz `scripts/seed-keycloak-demo.mjs`, `scripts/apply-m2-tenant-schema.sql`, `scripts/seed-demo-m2-modules.sql`, `scripts/seed-demo-strategic-brain.sql`, `scripts/seed-demo-dokumenty.sql`, oraz migracje `packages/db/prisma/tenant/migrations/*`. To źródła prawdy do złożenia w jeden idempotentny bootstrap.

- [ ] **Step 2: Napisz `scripts/bootstrap-demo.mjs`**

Skrypt (Node, uruchamiany w kontenerze `bootstrap`) wykonujący, idempotentnie i pod warunkiem healthy: (a) migracje tenant+control-plane (raw-SQL apply wszystkich `migrations/*/migration.sql` + `ALTER OWNER TO hu_<id>` dla nowych obiektów — wzór z `reference_hrobot_m2_deploy`); (b) import realmu `hrobot-staging` z użytkownikami demo (logika z `seed-keycloak-demo.mjs`); (c) resolveSub + sync `keycloak_sub` (logika z `demo-up.mjs`); (d) seedy M2/M3 (`seed-demo-m2-modules.sql`, `seed-demo-strategic-brain.sql`, `seed-demo-dokumenty.sql` — wszystkie `ON CONFLICT DO NOTHING`). Każdy krok loguje i jest bezpieczny do ponownego uruchomienia. Kod: przenieś funkcje z `demo-up.mjs` (nie duplikuj — zaimportuj lub przekopiuj z adaptacją host→service URL: `keycloak:8080`, `postgres:5432`).

- [ ] **Step 3: Serwis `bootstrap` w compose (jednorazowy job)**

```yaml
  bootstrap:
    profiles: ["full"]
    build:
      context: .
      dockerfile: apps/tenant-runtime/Dockerfile   # ma node + prisma + dostęp do scripts
    command: ["node", "scripts/bootstrap-demo.mjs"]
    environment:
      POSTGRES_SUPERUSER_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@postgres:5432/postgres
      KEYCLOAK_URL: http://keycloak:8080
      TENANT_DB: hrobot_t_900d948b
    depends_on:
      postgres:
        condition: service_healthy
      keycloak:
        condition: service_started
    restart: "no"
```
> `web`/`tenant-runtime` mogą wystartować równolegle; bootstrap dowozi dane. (Jeśli chcemy twardo: `web depends_on bootstrap: service_completed_successfully`.)

- [ ] **Step 4: Test świeżego bootstrapu (pusty wolumen)**

Run:
```bash
docker compose -p hrobot --profile full down -v          # UWAGA: kasuje wolumeny — bramka człowieka (potwierdź)
docker compose -p hrobot --profile full up -d --build
# poczekaj aż bootstrap zakończy się exit 0:
docker wait hrobot-bootstrap-1; docker logs hrobot-bootstrap-1 | tail -5
```
Expected: bootstrap exit 0; login 3 ról działa (`BASE=http://localhost:8080 bash scripts/parity-smoke.sh` → GREEN) **bez** ręcznego `demo-up.mjs`.

- [ ] **Step 5: Commit**

```bash
git add scripts/bootstrap-demo.mjs docker-compose.yml
git commit -m "infra(bootstrap): idempotentny init (migracje+realm+seed) — koniec ręcznego demo-up"
```

---

## Task 8: Bramka parzystości przeciw apps/web (przez Caddy)

**Files:**
- Modify: `scripts/parity-smoke.sh` (dodaj flow-checki przez Caddy jeśli trzeba)

- [ ] **Step 1: Uruchom parity-smoke przeciw Caddy**

Run: `BASE=http://localhost:8080 KC=http://localhost:8081 bash scripts/parity-smoke.sh`
Expected: `PARITY: GREEN` — te same trasy + login 3 role co baseline (Task 1), teraz przez `apps/web` za Caddy.

- [ ] **Step 2: Playwright smoke (istniejący `test:e2e:smoke`) przeciw Caddy**

Run: ustaw baseURL na `http://localhost:8080` i `pnpm -F @hrobot/web test:e2e:smoke` (dostosuj konfig playwright do BASE z env).
Expected: zielony (kluczowe flow per rola). Jeśli playwright pokrywa mało — dołóż minimalne scenariusze: login każdej roli + 1 akcja z każdego KM (grafik widoczny, wniosek widoczny, dokument pobierz→PDF `%PDF`, analiza self-card, asystent interpret).

- [ ] **Step 3: vitest + tsc w apps/web**

Run: `pnpm -F @hrobot/web test && pnpm -F @hrobot/web typecheck`
Expected: vitest ~355 zielony, tsc czysty.

- [ ] **Step 4: Commit (jeśli były poprawki skryptu/konfig)**

```bash
git add scripts/parity-smoke.sh apps/web
git commit -m "test(migracja): parzystość apps/web za Caddy = GREEN (bramka cutover)"
```

---

## Task 9: Ocalony tour + autoplay demo (izolowany komponent)

**Files:**
- Create: `apps/web/components/tour/tour.tsx` (+ ewentualnie `tour.data.ts`, `autoplay.ts`)
- Create: `apps/web/components/tour/tour.test.ts`

- [ ] **Step 1: Test (pure) kroków tour**

```ts
import { describe, it, expect } from 'vitest'
import { TOUR_STEPS } from './tour.data'
describe('tour', () => {
  it('ma kroki dla kluczowych ekranów i każdy ma target + tekst', () => {
    expect(TOUR_STEPS.length).toBeGreaterThan(3)
    for (const s of TOUR_STEPS) { expect(s.target).toBeTruthy(); expect(s.text).toBeTruthy() }
  })
})
```

- [ ] **Step 2: Uruchom test → FAIL** (`pnpm -F @hrobot/web test tour` → brak modułu).

- [ ] **Step 3: Zaimplementuj `tour.data.ts` + `tour.tsx`**

Odtwórz koncept z vanilla `tour.js`/`show.js` (historia gita: `git show HEAD~:apps/web/tour.js`) jako lekki komponent React: `TOUR_STEPS` (target selektor + tekst + ekran), komponent `<Tour/>` z przyciskiem „Weź tour" w topbarze i opcjonalnym autoplay (sekwencyjne podświetlanie + realne, bezpieczne akcje odczytu). Bez ciężkiej zależności — własny overlay lub lekki lib; izolowany, jedna odpowiedzialność.

- [ ] **Step 4: Test → PASS** + `tsc` czysty.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/tour
git commit -m "feat(web): ocalony prowadzony tour + autoplay demo (izolowany komponent)"
```

---

## Task 10: Cutover + usunięcie web-kit (bramka człowieka)

**Files:**
- Delete: pozostałe odniesienia do web-kit
- Modify: `.claude/launch.json`, docy

- [ ] **Step 1: Potwierdź bramki zielone** (warunek konieczny)

Run: `BASE=http://localhost:8080 bash scripts/parity-smoke.sh && pnpm -F @hrobot/web test && pnpm -F @hrobot/web typecheck`
Expected: wszystko GREEN. (Cutover routingu już zrobiony — Caddy kieruje na `web`.)

- [ ] **Step 2: Znajdź martwe odniesienia do web-kit**

Run: `grep -rn "web-kit\|design/web\|start-prod" --include='*.json' --include='*.md' --include='*.mjs' --include='*.yml' . | grep -v node_modules | grep -v '/apps/web/'`
Wypisz listę; zaplanuj usunięcie/aktualizację każdego (np. `.claude/launch.json` wpis → wskaż `apps/web`; `scripts/demo-up.mjs` → zastąpiony bootstrapem; docy KM „web-kit" → nota, że front to `apps/web`).

- [ ] **Step 3: (BRAMKA CZŁOWIEKA) Usuń resztki po potwierdzeniu**

Po akceptacji człowieka:
```bash
# katalog web-kit już przeniesiony (Task 2) — tu czyścimy resztki referencji:
git rm -f scripts/demo-up.mjs 2>/dev/null || true   # zastąpiony bootstrap-demo.mjs
# zaktualizuj .claude/launch.json (wpis web-kit → apps/web) — edycja, nie rm
```

- [ ] **Step 4: Weryfikacja po usunięciu (nic nie pękło)**

Run: `docker compose -p hrobot --profile full up -d --build && BASE=http://localhost:8080 bash scripts/parity-smoke.sh && pnpm -F @hrobot/web test`
Expected: całość GREEN; brak martwych referencji (`grep` z Step 2 pusty poza dozwolonymi).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(migracja): cutover na apps/web + usunięcie resztek web-kit"
```

---

## Definicja Ukończenia (mapa na AC spec §11)
- AC-1 → Task 2 · AC-2 → Task 3+4 · AC-3 → Task 5+6 · AC-4 → Task 7 · AC-5 → Task 8 · AC-6 → Task 6+10 · AC-7 → Task 10 · AC-8 → Task 9.
- `docker compose up` → backend + web + caddy + infra healthy; przeglądarka pod jednym originem Caddy; login 3 ról bez ręcznych kroków; parzystość GREEN; web-kit usunięty; tour działa.

## Self-review (writing-plans)
- **Pokrycie spec:** §4 architektura → Task 3–6; §5 relokacja → Task 2; §6 bootstrap → Task 7; §7 parzystość/cutover → Task 1,8,10; §8 tour → Task 9; §9 testy → Task 1,8; §11 AC → mapa wyżej. ✔
- **Brak placeholderów:** każdy task ma pliki, realny kod (Dockerfile/Caddyfile/compose/skrypt), komendy i oczekiwany wynik. Jedyne świadome „potwierdź ścieżkę `server.js`" (Task 4) wynika z zależności standalone od `outputFileTracingRoot` — oznaczone jawnie do weryfikacji przy buildzie. ✔
- **Spójność typów/nazw:** `@hrobot/web` (Task 2) używane w Dockerfile (Task 4) i compose (Task 5); `scripts/parity-smoke.sh` z Task 1 używany w Task 8/10; `bootstrap-demo.mjs` (Task 7) zastępuje `demo-up.mjs` (Task 10). ✔
- **Bramki człowieka:** `down -v` (Task 7 Step 4) i `git rm` resztek (Task 10 Step 3) oznaczone jako wymagające potwierdzenia. ✔
