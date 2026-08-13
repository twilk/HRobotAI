# Ekspozycja przewag AI — plan wdrożenia (budżet 2 h)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pięć przewag konkurencyjnych, które dziś istnieją wyłącznie w kodzie i testach, staje się widocznych dla użytkownika na ekranie.

**Architecture:** Same zmiany treści w istniejących komponentach — zero nowej logiki, zero migracji, zero zmian API. Każda zmiana jest przypięta **testem strażnikiem** czytającym plik źródłowy i asertującym obecność wymaganego zdania. To istniejąca konwencja tego repozytorium (`apps/web/lib/no-external-assets.test.ts`, `write-boundary.spec.ts`), a nie nowy wynalazek: w projekcie **nie ma testów komponentowych** i wprowadzanie biblioteki testów Reacta na potrzeby tego planu byłoby nieproporcjonalne.

**Tech Stack:** Next.js App Router (`apps/web`), vitest, `readFileSync` do skanowania źródeł.

---

## ⚠ ZANIM ZACZNIESZ — warunek wykonania

**Nie wykonuj tego planu przed prezentacją.** Wszystkie zadania dotykają produktu, a przez ostatnią dobę świadomie tego unikaliśmy: system jest zweryfikowany przemiataczem 17 widoków w czterech rolach i każda zmiana psuje ten dowód. Ryzyko nie leży w trudności zmian — leży w tym, że po nich trzeba przebudować obrazy i przejść weryfikację od nowa.

Warunek startu: **prezentacja się odbyła** albo właściciel świadomie akceptuje przebudowę i ponowną weryfikację.

Po wykonaniu planu **obowiązkowo** uruchom `node scripts/przed-demo.mjs` (Zadanie 7).

## Zakres i to, co ŚWIADOMIE poza nim

Z 25 zadań ekspozycji przewag mieści się w 2 h **pięć**, wybranych po dwóch kryteriach: zmiana jest wyłącznie tekstowa oraz przewaga jest dziś całkowicie niewidoczna dla użytkownika. Szóste (#6) okazało się przy weryfikacji już wykonane — patrz przekreślone Zadanie 4.

**Poza zakresem tego planu** (wymagają zmian logiki albo sprawdzenia, czy ścieżka w ogóle istnieje):
zadanie #14 (lista `unmet[]` w grafiku), #18 (stan `WYCZERPANO` w interfejsie), #19 (cofnięcie propozycji przez managera), #24 (test na wszystkie projekcje typu absencji), #16 (termin odpowiedzi z `expires_at`), #23 (rozróżnienie intencji odczytu i zapisu).

## Struktura plików

| Plik | Odpowiedzialność | Akcja |
|---|---|---|
| `apps/web/components/asystent/ai-notice-banner.tsx` | baner przejrzystości EU AI Act na ekranie asystenta | zmiana: +2 zdania (przewagi #22, #8) |
| `apps/web/components/ai-grafik/ai-consent-section.tsx` | sekcja zgody pracownika na `/zamiany` | zmiana: +1 zdanie (przewaga #10) |
| `apps/web/components/ai-grafik/proposal-inbox.tsx` | skrzynka propozycji managera | zmiana: +1 zdanie nad listą (przewaga #17) |
| `apps/web/lib/przewagi-ui.test.ts` | **nowy** — test strażnik pilnujący, że zdania nie znikną | utworzenie |

Jeden plik testowy dla wszystkich przewag, nie plik na przewagę: to jedna odpowiedzialność (treść wymagana na ekranie ma nie zniknąć), a rozbicie jej na sześć plików utrudniłoby czytanie.

---

### Zadanie 1: Test strażnik — szkielet i pierwsza przewaga (#22)

**Pliki:**
- Utwórz: `apps/web/lib/przewagi-ui.test.ts`
- Zmień: `apps/web/components/asystent/ai-notice-banner.tsx`

- [ ] **Krok 1: Napisz czerwony test.** Utwórz `apps/web/lib/przewagi-ui.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Strażnik treści, która niesie przewagę konkurencyjną.
 *
 * Każde zdanie pilnowane tutaj opisuje gwarancję, która ISTNIEJE w kodzie, ale bez tego tekstu jest
 * dla użytkownika niewidoczna. Test nie sprawdza, czy gwarancja działa — od tego są testy modułów
 * (`write-boundary.spec.ts`, `dokumenty-no-send.spec.ts`). Sprawdza, czy przestaliśmy o niej mówić.
 *
 * Wzorzec skanowania źródeł 1:1 z `no-external-assets.test.ts` — w tym repozytorium nie ma testów
 * komponentowych i ten plan ich nie wprowadza.
 */
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const zrodlo = (sciezka: string) => readFileSync(`${ROOT}${sciezka}`, 'utf8')

describe('przewagi widoczne w interfejsie', () => {
  it('baner asystenta mówi, że agent nie ma własnych uprawnień (przewaga #22)', () => {
    const src = zrodlo('components/asystent/ai-notice-banner.tsx')
    expect(src).toMatch(/działa z Twoimi uprawnieniami/)
    expect(src).toMatch(/nie ma własnych/)
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz, że pada.**

```
cd apps/web
npx vitest run lib/przewagi-ui.test.ts
```

Oczekiwane: `1 failed` z komunikatem, że wzorzec `/działa z Twoimi uprawnieniami/` nie pasuje.

- [ ] **Krok 3: Dopisz zdanie do banera.** W `apps/web/components/asystent/ai-notice-banner.tsx`, wewnątrz `<div className="text-[13px] leading-snug">`, po istniejącym akapicie `<p className="mt-0.5 text-muted">…</p>` dodaj drugi akapit:

```tsx
        <p className="mt-1.5 text-muted">
          Asystent <b className="font-semibold text-navy">działa z Twoimi uprawnieniami</b> — nie ma
          własnych i nie może zrobić nic, czego nie mógłbyś zrobić sam po zalogowaniu.
        </p>
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/web
npx vitest run lib/przewagi-ui.test.ts
```

Oczekiwane: `1 passed`.

- [ ] **Krok 5: Commit.**

```bash
git add apps/web/lib/przewagi-ui.test.ts apps/web/components/asystent/ai-notice-banner.tsx
git commit -m "feat(asystent): baner mowi, ze agent nie ma wlasnych uprawnien"
```

---

### Zadanie 2: Uzasadnienie braku modelu językowego (#8)

**Pliki:**
- Zmień: `apps/web/lib/przewagi-ui.test.ts`
- Zmień: `apps/web/components/asystent/ai-notice-banner.tsx`

- [ ] **Krok 1: Dopisz czerwony test.** Wewnątrz `describe('przewagi widoczne w interfejsie', …)` dodaj:

```ts
  it('baner uzasadnia brak modelu językowego w ścieżce o skutku (przewaga #8)', () => {
    const src = zrodlo('components/asystent/ai-notice-banner.tsx')
    expect(src).toMatch(/nie używamy modelu językowego/)
    expect(src).toMatch(/ten sam tekst zawsze daje ten sam wynik/)
  })
```

- [ ] **Krok 2: Uruchom i zobacz, że pada.**

```
cd apps/web
npx vitest run lib/przewagi-ui.test.ts
```

Oczekiwane: `1 failed | 1 passed`.

- [ ] **Krok 3: Dopisz zdanie.** W tym samym komponencie, po akapicie dodanym w Zadaniu 1:

```tsx
        <p className="mt-1.5 text-muted">
          W poleceniach o skutku kadrowym <b className="font-semibold text-navy">nie używamy modelu
          językowego</b>: ten sam tekst zawsze daje ten sam wynik, więc decyzję da się odtworzyć
          i sprawdzić w audycie.
        </p>
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/web
npx vitest run lib/przewagi-ui.test.ts
```

Oczekiwane: `2 passed`.

- [ ] **Krok 5: Commit.**

```bash
git add apps/web/lib/przewagi-ui.test.ts apps/web/components/asystent/ai-notice-banner.tsx
git commit -m "feat(asystent): baner uzasadnia parser deterministyczny zamiast LLM"
```

---

### Zadanie 3: Prawo do odmowy na ekranie zgody (#10)

**Pliki:**
- Zmień: `apps/web/lib/przewagi-ui.test.ts`
- Zmień: `apps/web/components/ai-grafik/ai-consent-section.tsx:139-141`

- [ ] **Krok 1: Dopisz czerwony test.**

```ts
  it('ekran zgody mówi, że można odmówić bez konsekwencji (przewaga #10)', () => {
    const src = zrodlo('components/ai-grafik/ai-consent-section.tsx')
    expect(src).toMatch(/Możesz odmówić bez podania powodu/)
  })
```

- [ ] **Krok 2: Uruchom i zobacz, że pada.**

```
cd apps/web
npx vitest run lib/przewagi-ui.test.ts
```

Oczekiwane: `1 failed | 2 passed`.

- [ ] **Krok 3: Dopisz zdanie pod nagłówkiem.** W `ai-consent-section.tsx` zamień blok nagłówka:

```tsx
      <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">
        Propozycje AI — zastępstwo wymaga Twojej zgody
      </h2>
```

na:

```tsx
      <h2 className="font-display font-bold text-[17px] text-navy mb-1">
        Propozycje AI — zastępstwo wymaga Twojej zgody
      </h2>
      <p className="mb-2.5 text-[12.5px] text-muted">
        Możesz odmówić bez podania powodu. Odmowa nie ma dla Ciebie konsekwencji — system poszuka
        kogoś innego.
      </p>
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/web
npx vitest run lib/przewagi-ui.test.ts
```

Oczekiwane: `3 passed`.

- [ ] **Krok 5: Commit.**

```bash
git add apps/web/lib/przewagi-ui.test.ts apps/web/components/ai-grafik/ai-consent-section.tsx
git commit -m "feat(zamiany): pracownik widzi, ze moze odmowic bez konsekwencji"
```

---

### ~~Zadanie 4: Wyjaśnienie pustej decyzji przy ESKALOWANA (#6)~~ — USUNIĘTE, PRACA JUŻ WYKONANA

**Nie realizuj tego zadania.** Przy pisaniu planu założyłem, że wiersz `ESKALOWANA` bez kandydata
pokazuje gołe „—". Sprawdzenie `proposal-inbox.tsx:324-342` obaliło to założenie: poprawka opisana
w kodzie jako „Codex F3/F4 copy fix" już zastąpiła myślnik jednym komunikatem rozciągniętym na dwie
kolumny — `NO_CANDIDATE_MESSAGE` = **„Brak dostępnego zastępcy — obsłuż ręcznie w Grafiku"**
(`apps/web/lib/ai-grafik.ts:331`), w kolorze ostrzeżenia.

Komunikat mówi zarówno CO się stało, jak i CO zrobić — czyli więcej, niż zamierzało zadanie #6.

Skutek uboczny tego ustalenia: **karta prowadzącego zawierała nieprawdę** — kazała wyjaśniać
myślnik, którego na ekranie nie ma. Poprawione w `docs/demo/build-karta.mjs` przy okazji pisania
tego planu.

### Zadanie 5: Zgoda pracownika to jeszcze nie przydzielenie (#17)

**Pliki:**
- Zmień: `apps/web/lib/przewagi-ui.test.ts`
- Zmień: `apps/web/components/ai-grafik/proposal-inbox.tsx`

- [ ] **Krok 1: Dopisz czerwony test.**

```ts
  it('skrzynka managera odróżnia zgodę pracownika od przepięcia zmiany (przewaga #17)', () => {
    const src = zrodlo('components/ai-grafik/proposal-inbox.tsx')
    expect(src).toMatch(/zmiana NIE jest jeszcze przepięta/)
  })
```

- [ ] **Krok 2: Uruchom i zobacz, że pada.**

```
cd apps/web
npx vitest run lib/przewagi-ui.test.ts
```

Oczekiwane: `1 failed | 4 passed`.

- [ ] **Krok 3: Dodaj zdanie nad listą propozycji.** W `proposal-inbox.tsx`, bezpośrednio pod nagłówkiem skrzynki (`<h2>` z tekstem „Skrzynka managera"), wstaw:

```tsx
      <p className="mb-3 text-[12.5px] text-muted">
        Zgoda pracownika nie kończy sprawy — zmiana NIE jest jeszcze przepięta. Dopiero Twoje
        zatwierdzenie ją realizuje, a solver sprawdza wtedy twarde reguły prawa pracy.
      </p>
```

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/web
npx vitest run lib/przewagi-ui.test.ts
```

Oczekiwane: `5 passed`.

- [ ] **Krok 5: Commit.**

```bash
git add apps/web/lib/przewagi-ui.test.ts apps/web/components/ai-grafik/proposal-inbox.tsx
git commit -m "feat(ai-grafik): skrzynka odroznia zgode pracownika od przepiecia zmiany"
```

---

### Zadanie 6: Głos nie opuszcza infrastruktury (#7)

**Pliki:**
- Zmień: `apps/web/lib/przewagi-ui.test.ts`
- Zmień: `apps/web/components/asystent/ai-notice-banner.tsx`

Zdanie ląduje w banerze, nie przy samym mikrofonie: baner renderuje się **zawsze**, a przycisk nagrywania tylko przy dostępnym mikrofonie — gwarancja RODO nie może zależeć od tego, czy sprzęt działa.

- [ ] **Krok 1: Dopisz czerwony test.**

```ts
  it('baner mówi, że nagranie głosu nie opuszcza infrastruktury (przewaga #7)', () => {
    const src = zrodlo('components/asystent/ai-notice-banner.tsx')
    expect(src).toMatch(/nie opuszcza Waszej infrastruktury/)
    expect(src).toMatch(/nie rozpoznajemy mówcy/)
  })
```

- [ ] **Krok 2: Uruchom i zobacz, że pada.**

```
cd apps/web
npx vitest run lib/przewagi-ui.test.ts
```

Oczekiwane: `1 failed | 5 passed`.

- [ ] **Krok 3: Dopisz zdanie.** W `ai-notice-banner.tsx`, po akapicie dodanym w Zadaniu 2:

```tsx
        <p className="mt-1.5 text-muted">
          Jeśli mówisz do asystenta, nagranie jest zamieniane na tekst{' '}
          <b className="font-semibold text-navy">na naszym serwerze</b> i nie opuszcza Waszej
          infrastruktury. Służy wyłącznie do odczytania polecenia — nie rozpoznajemy mówcy i nie
          przechowujemy nagrania.
        </p>
```

Ten akapit domyka jednocześnie przewagę #25 (brak profilowania biometrycznego), dlatego test sprawdza oba zdania.

- [ ] **Krok 4: Uruchom test i zobacz zielone.**

```
cd apps/web
npx vitest run lib/przewagi-ui.test.ts
```

Oczekiwane: `6 passed`.

- [ ] **Krok 5: Commit.**

```bash
git add apps/web/lib/przewagi-ui.test.ts apps/web/components/asystent/ai-notice-banner.tsx
git commit -m "feat(asystent): baner deklaruje lokalne przetwarzanie glosu i brak biometrii"
```

---

### Zadanie 7: Weryfikacja na żywym środowisku

**Pliki:** brak zmian w kodzie.

Sześć poprzednich zadań przeszło testy jednostkowe czytające ŹRÓDŁA. To dowodzi, że tekst jest w plikach — nie dowodzi, że dociera na ekran ani że nie rozwalił układu.

- [ ] **Krok 1: Uruchom pełny zestaw testów front-endu.**

```
cd apps/web
npx vitest run
```

Oczekiwane: wszystkie zielone. Jeśli cokolwiek padło — zatrzymaj się i napraw, zanim przebudujesz obrazy.

- [ ] **Krok 2: Przebuduj i wdróż.**

```bash
cd /c/Users/Wilk/Documents/WORKSPACE/HRobot-m2
docker compose -p hrobot --profile full up -d --build web
```

Oczekiwane: `Container hrobot-web-1 Started`.

- [ ] **Krok 3: Uruchom kontrolę przed demo.**

```bash
node scripts/przed-demo.mjs
```

Oczekiwane: `GOTOWE — stan i wszystkie ekrany czyste. Można wpuszczać odbiorcę.` oraz kod wyjścia 0.

Ten skrypt sprawdza dziewięć widoków w czterech rolach i szuka m.in. pustych ekranów i bannerów błędu — czyli dokładnie tego, co mogła zepsuć zmiana układu.

- [ ] **Krok 4: Obejrzyj dwa ekrany, których dotknąłeś najmocniej.** Zaloguj się jako `pracownik.demo` / `Pracownik!2026` i wejdź na `/asystent`; baner ma teraz **cztery** akapity zamiast jednego. Sprawdź, czy nie zepchnął pola polecenia poniżej pierwszego ekranu — jeśli tak, skróć akapit o głosie z Zadania 6 do jednego zdania.

- [ ] **Krok 5: Commit weryfikacji.**

```bash
git add -A
git commit -m "chore(demo): weryfikacja ekspozycji przewag na zywym srodowisku"
```

---

## Nakład

| Zadanie | Czas |
|---|---|
| 1 — szkielet testu + brak uprawnień agenta | 20 min |
| 2 — brak modelu językowego | 12 min |
| 3 — prawo do odmowy | 15 min |
| ~~4~~ — usunięte, praca już wykonana | 0 min |
| 5 — zgoda ≠ przydzielenie | 15 min |
| 6 — głos lokalnie + brak biometrii | 15 min |
| 7 — weryfikacja na żywo | 25 min |
| **Razem** | **1 h 42 min** (20 min odzyskane na Zadaniu 4) |

Zadanie 1 jest najdroższe, bo powstaje w nim szkielet pliku testowego. Odzyskane 20 minut przeznacz na Zadanie 7 — weryfikacja na żywo jest jedynym krokiem, który dowodzi, że zdania docierają na ekran.

## Plan wycofania

Każde zadanie to jeden commit dotykający wyłącznie treści. Wycofanie dowolnego: `git revert <sha>`. Brak migracji, brak zmian API, brak zmian danych — po `revert` i przebudowie `web` system wraca do stanu sprzed planu.

## Definicja ukończenia

1. `npx vitest run` w `apps/web` zielone, w tym **pięć** nowych testów strażników (szósty odpadł wraz z Zadaniem 4).
2. `node scripts/przed-demo.mjs` kończy się kodem 0.
3. Baner asystenta widoczny na `/asystent` nie spycha pola polecenia poniżej pierwszego ekranu.
4. Pięć zdań widocznych na ekranach, nie tylko w plikach — potwierdzone Krokiem 4 Zadania 7.
