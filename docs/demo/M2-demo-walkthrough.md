# HRobot M2 — Demo Walkthrough (4Mobility)

> Ścieżka demonstracyjna dla odbiorcy technologii (4Mobility / PARP). Pokazuje moduły M2
> — **Wnioski · Ustawienia · Dostępy · Użytkownicy · Koszty (SP4)** oraz **AI Grafik Manager** —
> na **żywym** systemie z realnymi danymi (36 pracowników, 832 zmiany, 3 regiony), w trzech rolach.
> Każdy krok: **User story → Akcje → Oczekiwany rezultat → Dowód (zrzut ekranu)**.

## Środowisko
- **Web UI:** http://localhost:5601 (Next.js, produkcyjny build) · **API:** tenant-runtime `:3001/api` · **Keycloak:** `:8081` (realm `hrobot-staging`) · **DB:** tenant `hrobot_t_900d948b`.
- **Trzy konta demo** (realm `hrobot-staging`, klient `hrobot-web`):
  | Konto | Hasło | Rola | Zakres |
  |---|---|---|---|
  | `demo` | `demo-staging-2026` | ADMIN_KLIENTA | globalny |
  | `manager.demo` | `Manager!2026` | MANAGER | Region Centrum |
  | `pracownik.demo` | `Pracownik!2026` | PRACOWNIK | własne dane |
- **Dane demo** zaseedowane skryptem [`scripts/seed-demo-m2-modules.sql`](../../scripts/seed-demo-m2-modules.sql): firma 4Mobility, 10 stawek kosztowych (pełne pokrycie stanowisk×umów), 15 dostępów, wnioski (26 zatwierdzonych + 6 oczekujących + 1 odrzucony), 3 konta użytkowników. Kotwice AI-Grafik (26 zatwierdzonych urlopów) nienaruszone.

---

## Scena 1 — ADMIN_KLIENTA (Demo Admin): pełny obraz organizacji

### 1.1 Dashboard — pulpit strategiczny
- **User story:** Jako admin klienta chcę po zalogowaniu zobaczyć stan całej organizacji i status ochrony danych.
- **Akcje:** Zaloguj jako `demo` → `/dashboard`.
- **Oczekiwany rezultat:** Nagłówek „Pulpit 4Mobility"; kafle: 36 pracowników, 832 zmiany w grafiku, 1 zamiana do zatwierdzenia, 3 jednostki; sekcja „Ochrona danych" (DB-per-tenant, PESEL AES-256-GCM, append-only audit); pełna nawigacja (wszystkie moduły + sekcja Administracja).
- **Dowód:** *Zrzut „Dashboard (ADMIN)"* — kafle 36/832/1/3, nazwa firmy „4Mobility", panel RODO, badge „Sesja szyfrowana" i „Dane chronione w UE · EU-CENTRAL".

### 1.2 Pracownicy — kartoteki z ochroną PESEL
- **User story:** Jako admin chcę przeglądać kartoteki, ale dane wrażliwe (PESEL) mają być maskowane.
- **Akcje:** `/pracownicy`.
- **Oczekiwany rezultat:** 36 osób w 3 jednostkach; kolumny Stanowisko / Jednostka / Typ umowy / PESEL / Status; PESEL zamaskowany (••••••), status AKTYWNY.
- **Dowód:** *Zrzut „Pracownicy"* — lista z zamaskowanym PESEL; stanowiska (Kierowca, Serwisant floty, Recepcjonista, Koordynator) i typy umów (UOP/ZLECENIE/DZIEŁO/B2B) zgodne ze stawkami kosztowymi.

### 1.3 Grafik — plan tygodnia
- **User story:** Jako admin chcę zobaczyć wygenerowany grafik tygodnia.
- **Akcje:** `/grafik`.
- **Oczekiwany rezultat:** 52 zmiany / 38 zapotrzebowań w tygodniu; siatka pracownik × dzień z blokami zmian (godziny, lokalizacja, rola, znacznik AUTO); przełącznik AUTO/ręczna, „Generuj grafik".
- **Dowód:** *Zrzut „Grafik"* — tydzień 13–19 lipca 2026, bloki zmian AUTO (np. 08:00–16:00 Stacja Mobilności — KIEROWCA).

### 1.4 AI Grafik Manager — autonomia + **Koszty grafiku (SP4)**
- **User story:** Jako admin chcę ustawić poziom autonomii AI oraz zobaczyć koszt tygodnia i budżet per jednostka.
- **Akcje:** `/ai-grafik-manager` → sekcja „Koszty grafiku" → wybór Jednostka = Region Północ, tydzień 13.07.2026.
- **Oczekiwany rezultat:** Panel konfiguracji (Poziom autonomii „Tylko sugestie", ważność zgody 24 h, cisza nocna). Panel kosztów: **koszt tygodnia liczony z realnych godzin × stawka na stanowisku**, badge „W BUDŻECIE" / „Brak limitu", tabela stawek na stanowisku; brak zmyślonych zer (pełne pokrycie stawek).
- **Dowód:** *Zrzut „AI Grafik — Koszty"* — **Region Północ, 13–19.07.2026 = 6 296,00 zł „W BUDŻECIE"**, tabela stawek (Kierowca 41/43 zł, Koordynator 54/57 zł, Recepcjonista 34 zł…). Backend potwierdza to samo: `GET /koszty/week` → `{cost:"...", missingRates:[]}`.

### 1.5 Zamiany — skrzynka managera + propozycje AI
- **User story:** Jako admin chcę widzieć oczekujące zamiany zmian i ewentualne propozycje AI zastępstw.
- **Akcje:** `/zamiany`.
- **Oczekiwany rezultat:** Sekcja „Propozycje AI — zastępstwo wymaga Twojej zgody"; „Skrzynka managera — do zatwierdzenia" z wnioskiem o zamianę (optymalizator sprawdza H1–H4 przy zatwierdzeniu).
- **Dowód:** *Zrzut „Zamiany"* — zamiana Marek Piotrowski ↔ Łukasz Majewski (KIEROWCA), przyciski Zatwierdź/Odrzuć.

### 1.6 Wnioski — obieg akceptacji (widok globalny)
- **User story:** Jako admin (rola globalna) chcę widzieć wszystkie oczekujące wnioski urlopowe do decyzji.
- **Akcje:** `/wnioski`.
- **Oczekiwany rezultat:** „Moje wnioski" (formularz złożenia) + „Do akceptacji" ze **wszystkimi** oczekującymi wnioskami (globalnie), każdy z Zatwierdź/Odrzuć.
- **Dowód:** *Zrzut „Wnioski (ADMIN)"* — **6 oczekujących** (wszystkie regiony): Adamczyk, Dąbrowski, Wróbel, Lewandowski, Krawczyk, Nowak — rodzaje i terminy widoczne.

### 1.7 Dostępy — karty / klucze / uprawnienia
- **User story:** Jako admin chcę wydawać i odwoływać dostępy fizyczne w zakresie moich jednostek.
- **Akcje:** `/dostepy`.
- **Oczekiwany rezultat:** Formularz „Wydaj dostęp" (pracownik, rodzaj, etykieta, identyfikator, lokalizacja, notatki) + „Lista dostępów" z statusami (AKTYWNY / ODWOŁANY / ZGUBIONY), datami, przyciskiem Odwołaj. RODO: identyfikator nie trafia do audytu.
- **Dowód:** *Zrzut „Dostępy"* — granty `AC-4M-0001…`, rodzaje Karta/Klucz/Uprawnienie, statusy (12 aktywnych, 2 odwołane, 1 zgubiony).

### 1.8 Ustawienia — dane firmy + jednostki
- **User story:** Jako admin klienta chcę zarządzać danymi firmy i strukturą organizacyjną.
- **Akcje:** `/ustawienia`.
- **Oczekiwany rezultat:** Formularz „Dane firmy" (nazwa, strefa czasowa, region, locale) + „Jednostki organizacyjne" (drzewo, Edytuj: nazwa/rodzic/manager, z ochroną przed cyklem). Pusty PATCH odrzucony (walidacja).
- **Dowód:** *Zrzut „Ustawienia"* — **„4Mobility sp. z o.o.", Europe/Warsaw, EU-Central, pl-PL**; drzewo: 4Mobility — Operacje → Region Centrum/Południe/Północ.

### 1.9 Użytkownicy — zaproszenia + role RBAC (dual-write Keycloak↔DB)
- **User story:** Jako admin klienta chcę zapraszać użytkowników i nadawać/odbierać role RBAC.
- **Akcje:** `/ustawienia/uzytkownicy`.
- **Oczekiwany rezultat:** Przycisk „Zaproś użytkownika"; lista kont z rolami (chip roli + jednostka), status, data; nadawanie roli (dual-write: rola realmu KC + wiersz UserRole). Zabezpieczenia: self-escalation, last-admin (po stronie backendu).
- **Dowód:** *Zrzut „Użytkownicy"* — 3 konta: `admin@staging` **ADMIN KLIENTA · GLOBALNIE**, `pracownik.demo` **PRACOWNIK**, `manager.demo` **MENEDŻER** — wszystkie AKTYWNE.

---

## Scena 2 — MANAGER (Marek Manager): operacje w zakresie jednostki

### 2.1 Wnioski — skrzynka **ograniczona do jednostki**
- **User story:** Jako menedżer Regionu Centrum chcę zatwierdzać urlopy tylko moich pracowników.
- **Akcje:** Zaloguj jako `manager.demo` → `/wnioski`.
- **Oczekiwany rezultat:** Nawigacja **bez** sekcji Administracja (brak Ustawień/Użytkowników). „Do akceptacji" pokazuje **tylko wnioski z Regionu Centrum** — mniej niż admin.
- **Dowód:** *Zrzut „Wnioski (MANAGER)"* — użytkownik „Marek Manager · MENEDŻER"; **3 oczekujące** (Dąbrowski, Adamczyk, Wróbel) — vs 6 u admina. Dowód scopingu RBAC.

### 2.2 Użytkownicy — **odmowa dostępu** (RBAC + wejście bezpośrednie)
- **User story:** Jako menedżer nie powinienem mieć dostępu do zarządzania użytkownikami — nawet przez bezpośredni link.
- **Akcje:** Wpisz ręcznie `/ustawienia/uzytkownicy`.
- **Oczekiwany rezultat:** Strona nie renderuje danych — komunikat „Brak dostępu" (backend `GET /uzytkownicy` → 403 dla MANAGER).
- **Dowód:** *Zrzut „Brak dostępu (MANAGER)"* — ikona kłódki, „Ta strona jest dostępna tylko dla admina klienta."

---

## Scena 3 — PRACOWNIK (Anna Kowalska): samoobsługa

### 3.1 Wnioski — **tylko własne**, bez skrzynki akceptacji
- **User story:** Jako pracownik chcę złożyć wniosek urlopowy i widzieć status swoich wniosków — ale nie cudze.
- **Akcje:** Zaloguj jako `pracownik.demo` → `/wnioski`.
- **Oczekiwany rezultat:** Minimalna nawigacja (Dashboard, Pracownicy, Grafik, Zamiany, Wnioski — **bez** AI Grafik / Dostępów / Ustawień / Użytkowników). „Moje wnioski": formularz + **własne** wnioski ze statusami; **brak** sekcji „Do akceptacji".
- **Dowód:** *Zrzut „Wnioski (PRACOWNIK)"* — „Anna Kowalska · PRACOWNIK"; 3 własne urlopy „ZATWIERDZONY"; brak skrzynki managera.

---

## Przekrojowy dowód RBAC (ta sama trasa, trzy role)

| Trasa | ADMIN_KLIENTA | MANAGER | PRACOWNIK |
|---|---|---|---|
| `/wnioski` „Do akceptacji" | 6 (globalnie) | 3 (Region Centrum) | brak (tylko własne) |
| `/dostepy` | pełny | zakres jednostki | **brak w nawigacji** |
| `/ustawienia` | pełny | brak w nawigacji | brak w nawigacji |
| `/ustawienia/uzytkownicy` | pełny | **Brak dostępu** | brak w nawigacji |
| `/ai-grafik-manager` | pełny + koszty | inbox + skan | brak w nawigacji |

Boundary potwierdzona też na poziomie API (bez UI): `GET /uzytkownicy` → ADMIN 200 / MANAGER 403 / PRACOWNIK 403; zapisy stawek i budżetu → 403 dla nie-ADMIN. Zgodne z maszyną RBAC (JWT `hrobot_roles` + scoping `UserRole`).

## RODO / bezpieczeństwo (widoczne w całym demo)
- „Sesja szyfrowana" + „Dane chronione w UE · EU-CENTRAL" w każdym widoku.
- PESEL maskowany na liście pracowników (AES-256-GCM + blind index w DB).
- Append-only audit (ids-only) dla decyzji o urlopie, wydania/odwołania dostępu, zmian ról.
- DB-per-tenant; identyfikatory dostępów nigdy w audycie.

---

### Jak odtworzyć demo
1. Backend + Keycloak + Postgres: stack compose `hrobot` (tenant-runtime `:3001`, keycloak `:8081`).
2. Dane: `docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b < scripts/seed-demo-m2-modules.sql`.
3. Web UI: `node docs/design/web-kit/start-prod.mjs` (build + `next start -p 5601`).
4. Zaloguj kolejno trzema kontami z tabeli powyżej i przejdź sceny 1→3.

> Zrzuty ekranu do tego dokumentu wykonano na żywym systemie w sesji budowy demo (13–14.07.2026);
> wartości w „Dowodach" odpowiadają dokładnie temu, co pokazują zrzuty.
