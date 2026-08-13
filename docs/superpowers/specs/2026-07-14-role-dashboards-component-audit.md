# Rola-zróżnicowane pulpity + audyt komponentów — HRobot web-kit

> **Data:** 2026-07-14 · **Autor:** analiza na żywym demo (:5601, 3 role) + kod web-kit.
> **Status:** DRAFT do Codex crosscheck werdyktów, potem plan implementacyjny.
> **Zakres:** 9 ekranów (Dashboard, Pracownicy, Grafik, AI Grafik Manager, Zamiany, Wnioski, Dostępy, Ustawienia, Użytkownicy) × 3 role (ADMIN_KLIENTA, MANAGER, PRACOWNIK).

---

## A. Rozstrzygnięcie: pulpit MUSI być inny per rola (teza obroniona)

Dziś `/dashboard` jest **identyczny dla wszystkich ról** (nawigacja jest już RBAC-owana, ale sam pulpit nie). Zawartość jest w 100% admino-centryczna: kafle org-wide (36 pracowników / 832 zmiany / 1 zamiana / 3 jednostki), 3 skróty admina (Dodaj pracownika / Skonfiguruj grafik / Zaproś użytkowników), panel RODO.

**To mis-serwuje 2 z 3 person — z dowodem z kodu (skorygowane po Codex; patrz §E):**
- **PRACOWNIK** widzi 3 skróty admina (`quick-actions.tsx` renderuje je bez gate'u roli). W realu tylko „Zaproś użytkowników" to **czysto martwy przycisk** (→ „Brak dostępu"); „Dodaj pracownika" ląduje na scoped rosterze bez przycisku dodawania, „Skonfiguruj grafik" na read-only „Twój grafik". Czyli: **skróty nieadekwatne do roli** (mylące etykiety/afordancje), nie 3× twarde 403. Dodatkowo widzi generyczne kafle i panel RODO nieistotne dla jego zadań.
- **MANAGER** — kafle KPI **są już scoped serwerowo** (backend zawęża `/employees`, `/grafik/shifts`, `/shift-swap` dla ról nie-globalnych), więc widzi SWOJE liczby, nie org-wide. Problem nie w danych, lecz w **generycznej ramie/etykietach i doborze sekcji** — pulpit nie pokazuje jego pierwszorzędnego zadania (wyjątki obsady dziś/tydzień).

**Wniosek:** treść pulpitu musi być persona-specyficzna. **Architektura: JEDEN rola-adaptacyjny `/dashboard`** (sekcje warunkowane `session.roles`), NIE trzy osobne trasy — strona już ma `roles`, a dane płyną z tych samych scoped API; trzy trasy dublowałyby topbar/KPI/loading/error. Rozgałęzienie treści, nie tras.

---

## B. Trzy pulpity (projekt)

### B1. PRACOWNIK — samoobsługa + transparentność (Twój punkt)
Prosto, motywująco, **tylko o sobie**. Sekcje:
1. **Moje najbliższe zmiany** (dziś + 7 dni) — kiedy pracuję, gdzie, rola. CTA: pełny grafik.
2. **Moje godziny** — przepracowane w oknie + trend (spina się z modułem AI wydajności). Nie surowa liczba — z porównaniem do celu/etatu.
3. **Mój urlop** — wykorzystany / pozostały + status moich wniosków (PENDING/APPROVED/REJECTED). CTA: złóż wniosek.
4. **Moje sygnały samoobsługowe (bezpieczne)** — [SKORYGOWANE po Codex, §E-5] **NIE** pokazujemy pracownikowi surowego score'u performance/trajektorii (ryzyko: art. 22 RODO/profilowanie, spory, demotywacja, rada pracownicza — „bramka człowieka" to za mało). Zamiast tego: godziny vs etat, kompletność preferencji, ważność szkoleń/certyfikatów, nadchodzące zmiany. Jeśli w ogóle performance — tylko **jakościowy feedback zatwierdzony przez managera**, ze ścieżką wyjaśnienia/odwołania. Nigdy auto-liczba-wyrocznia dla podmiotu danych.
5. **Sygnały AI dla mnie** — np. „Twój grafik na przyszły tydzień gotowy", „propozycja zamiany czeka na Twoją zgodę".
RODO: zero cudzych danych, zero PII wrażliwego. **Pulpit = kompaktowe „następne akcje"**; pełne formularze/historia zostają w modułach (Wnioski/Zamiany/Grafik) — bez dublowania stanu w 3 miejscach (§E-6).

### B2. MANAGER — operacyjna kolejka + stan zespołu (scoped do jednostek)
1. **Skrzynka decyzji** — JEDNA kolejka „do zrobienia teraz": wnioski PENDING + zamiany do zatwierdzenia + propozycje AI zastępstw. Każdy element = akcja w ≤1 kliknięciu.
2. **Obsada dziś/tydzień** — dziury w grafiku mojej jednostki, dni INFEASIBLE, wypadnięcia (urlop kolidujący ze zmianą).
3. **Koszt jednostki vs budżet** — koszt tygodnia + alert progu (reuse panelu Koszty).
4. **Zespół wymagający uwagi** — kto: performance/terminowość/rozwój/ryzyko rotacji (reuse AI wydajności, scoped).
Gęstość: operacyjna. Wszystko lokalne (unit-scope), nic globalnego.

### B3. ADMIN_KLIENTA — nadzór strategiczny
1. **Zdrowie organizacji** — agregaty (obecne kafle), ale **klikalne** (każdy → moduł) i **z sygnałem** (zielono/ryzyko), nie martwe liczby.
2. **Feed rekomendacji AI** — retencja + rekrutacja per lokalizacja (strategiczny mózg — spina się z promptem AI wydajności/rekrutacji), czeka na decyzję człowieka.
3. **Ryzyka** — luki obsady, koszty ponad budżet, dni INFEASIBLE, rotacja.
4. **Skróty admina** — zostają (to JEGO akcje), ewentualnie zwężone do najczęstszych.

---

## C. Macierz audytu komponentów

Werdykty: **ZOSTAW** / **ZAKTUALIZUJ** (drobna korekta danych/copy) / **PRZEBUDUJ** (dobry cel, zła realizacja) / **WYWAL** (nie napędza żadnej decyzji persony).

### Ekran: Dashboard (obecny, wspólny)
| Komponent | Rola | Werdykt | Dlaczego |
|---|---|---|---|
| 4 kafle org-wide (36/832/1/3) | ADMIN | **PRZEBUDUJ** | Dobre dane, ale statyczne — uczynić klikalne + dodać sygnał zdrowia (ryzyko vs ok). |
| ↳ te same kafle | MANAGER | **PRZEBUDUJ** | Muszą być **unit-scoped** (mój zespół / moje zmiany / moje PENDING), nie globalne. |
| ↳ te same kafle | PRACOWNIK | **WYWAL** | Agregaty org-wide nieistotne — zastąpić statystykami osobistymi (B1). |
| 3 skróty admina (Dodaj prac./Grafik/Zaproś) | ADMIN | **ZOSTAW** | To jego realne akcje. |
| ↳ te same skróty | MANAGER | **ZAKTUALIZUJ** | Zostaw „Skonfiguruj grafik"; wywal „Zaproś użytkowników" (nie jego); „Dodaj pracownika" wg polityki. |
| ↳ te same skróty | PRACOWNIK | **WYWAL** | **Martwe przyciski → 403.** Fałszywa afordancja. Zastąpić „Złóż wniosek / Mój grafik". |
| Panel „Ochrona danych" (RODO) | ADMIN | **PRZEBUDUJ** | Świetny sygnał zaufania na demo, ale statyczny na pulpicie roboczym = vanity. Uczynić realnym (link do audit log / statusu zgodności) albo przenieść do Ustawień. |
| ↳ panel RODO | MANAGER/PRACOWNIK | **WYWAL** | Nie napędza ich decyzji. |
| Topbar „Sesja szyfrowana" + user + logout | wszyscy | **ZOSTAW** | Zaufanie + tożsamość + wylogowanie. |

### Ekran: Pracownicy
| Komponent | Werdykt | Dlaczego |
|---|---|---|
| Nagłówek (36 osób / 3 jednostki) + szukaj + „Dodaj pracownika" | **ZOSTAW** | Core narzędzia HR/admin/manager. |
| Kolumna PESEL (kropki dla wszystkich) | **ZAKTUALIZUJ** | Kolumna samych kropek to prawie vanity — niech zarobi na miejsce: `peselLast4` tylko dla HR/ADMIN (jest w backendzie), inaczej ukryć. |
| Kolumny Stanowisko / Jednostka / Typ / Status | **ZOSTAW** | Istotne dla planowania i kosztów. |

### Ekran: Grafik
| Komponent | Werdykt | Dlaczego |
|---|---|---|
| Nagłówek (52 zmiany / 38 zapotrzebowań) | **ZOSTAW** | Actionable — sygnalizuje luki. |
| „Generuj grafik" + AUTO/ręczna + nawigacja tygodnia + siatka | **ZOSTAW** | Rdzeń produktu. |
| Filtr „Wszystkie jednostki" | **ZAKTUALIZUJ** | Dla MANAGERA domyślnie jego jednostka, nie „wszystkie". |

### Ekran: AI Grafik Manager
| Komponent | Werdykt | Dlaczego |
|---|---|---|
| Panel autonomii (poziom / ważność zgody / cisza nocna) | **ZOSTAW** | Sterowanie AI (HR/ADMIN). |
| Panel „Koszty grafiku" (koszt/budżet/stawki) | **ZOSTAW** | Wzorcowo actionable (koszt + alert progu). |
| Inbox propozycji AI | **ZOSTAW** | Kolejka decyzji managera. |

### Ekran: Zamiany
| Komponent | Werdykt | Dlaczego |
|---|---|---|
| „Propozycje AI — zastępstwo wymaga zgody" | **ZOSTAW** | Sekwencyjna zgoda pracownika. |
| „Zaproponuj zamianę" + „Moje prośby o zamianę" | **ZOSTAW** | Samoobsługa pracownika. |
| „Skrzynka managera — do zatwierdzenia" | **ZOSTAW** | Akcja managera (H1–H4 przy zatwierdzeniu). |
| Badge „AUTO-odświeżanie" | **ZOSTAW** | Drobny, ale komunikuje świeżość. |

### Ekran: Wnioski
| Komponent | Werdykt | Dlaczego |
|---|---|---|
| „Moje wnioski" (formularz + lista) | **ZOSTAW** | Uniwersalne. |
| „Do akceptacji" (inbox) | **ZOSTAW** | Maker-checker, scoped. |

### Ekran: Dostępy
| Komponent | Werdykt | Dlaczego |
|---|---|---|
| Formularz „Wydaj dostęp" | **ZOSTAW** | Core. |
| Lista dostępów (statusy/daty/Odwołaj) | **ZOSTAW** | Core. |
| Input „Lokalizacja" (UUID free-text) | **PRZEBUDUJ** | Wpisywanie UUID to zła afordancja — picker/typeahead lokalizacji. |
| Odwołanie przez `window.prompt` (reason) | **ZAKTUALIZUJ** | Zamienić na modal zgodny z design systemem. |

### Ekran: Ustawienia
| Komponent | Werdykt | Dlaczego |
|---|---|---|
| Formularz „Dane firmy" | **ZOSTAW** | Core (ADMIN). |
| Drzewo jednostek + Edytuj | **ZOSTAW** | Core. |
| Input „managerUserId" (UUID free-text) | **PRZEBUDUJ** | Picker użytkownika (endpoint `/uzytkownicy` już istnieje). |

### Ekran: Użytkownicy
| Komponent | Werdykt | Dlaczego |
|---|---|---|
| „Zaproś użytkownika" | **ZOSTAW** | Core (ADMIN). |
| Tabela + chipy ról + „Nadaj" | **ZOSTAW** | Dual-write RBAC. |
| Input „uuid jednostki" (free-text) | **PRZEBUDUJ** | Picker jednostki. |

---

## D. Backlog zmian (impact × effort)

| # | Zmiana | Impact | Effort | Priorytet |
|---|---|---|---|---|
| 1 | **Rola-aware quick actions** (filtruj/przemianuj skróty per rola) — tani realny bug | Wysoki | **Niski** | **P0** |
| 2 | Rola-adaptacyjny `/dashboard` (sekcje warunkowane rolą, JEDNA trasa) | Wysoki | Śr | **P0** |
| 3 | Pulpit PRACOWNIKA — bezpieczne sygnały samoobsługowe (B1, bez score'u) | Wysoki | Śr | **P1** |
| 4 | Board MANAGERA — **wyjątki obsady dziś/7 dni jako 1. panel** + kolejka decyzji sortowana po ryzyku (B2) | Wysoki | Śr | **P1** |
| 5 | Pickery zamiast UUID (lokalizacja `/api/grafik/lokalizacje`, jednostka `/api/grafik/units`, user `/api/uzytkownicy`) ×3 | Śr | Niski | **P1** |
| 6 | Board ADMINA — **governance/health najpierw** (users bez ról, sieroty bez loginu, jednostki bez managera, prowizja, audyt), feed AI drugi (B3) | Śr | Śr | **P1** |
| 7 | Kolumna PESEL → ukryć dla nie-HR/ADMIN; dla HR/ADMIN `peselLast4` świadomie | Niski | Niski | **P2** |
| 8 | Panel RODO → **przenieść** do Ustawień/About lub mały trust-badge (NIE kasować — atut demo/PARP) | Niski | Niski | **P2** |
| 9 | Filtr grafiku domyślnie na jednostkę managera · modal odwołania zamiast `window.prompt` | Niski | Niski | **P2** |

---

## E. Reconciliacja po Codex (adversarial, czytał kod) — OBOWIĄZUJĄCA

7×[P1] + 3×[P2], wszystkie trafne. Kluczowe korekty względem v1:

1. **[P1] „Manager widzi org-wide KPI" — FAŁSZ.** `dashboard-kpis.tsx` liczy `/api/employees` + `/grafik/shifts` + `/shift-swap?state=PENDING_MANAGER`, a tenant-runtime **już scopuje** te źródła dla ról nie-globalnych. Manager widzi swoje liczby. Poprawka: problem = generyczne etykiety/sekcje, nie wyciek danych. (§A poprawione.)
2. **[P1] „3 martwe skróty → 403" — przesada.** Tylko „Zaproś użytkowników" to czysty dead-end; „Dodaj pracownika"/„Skonfiguruj grafik" mają złe etykiety, ale lądują na użytecznych scoped/read-only stronach. Fix = rola-aware quick actions (P0). (§A poprawione.)
3. **[P1] Split na 3 trasy = over-engineering.** JEDEN rola-adaptacyjny `/dashboard`. (§A, §D poprawione.)
4. **[P1] Backlog źle uszeregowany.** Tani fix afordancji (quick actions) = prawdziwe P0, przed redesignem. (§D poprawione.)
5. **[P1] Pracownik: score performance = niebezpieczny.** Bez surowego score'u — bezpieczne sygnały; performance tylko jako jakościowy feedback zatwierdzony przez managera + odwołanie. (§B1 poprawione.)
6. **[P1] Board managera gubi jego 1. zadanie:** obsługa wyjątków per dzień/zmiana. „Wyjątki dziś/7 dni" jako pierwszy panel; inbox sortowany po ryzyku grafikowym (nie wymieszane PENDING). (§B2 wzmocnione w §D.)
7. **[P1] Board admina zbyt AI-centryczny.** Najpierw governance/health tenanta (users bez ról, sieroty bez loginu, jednostki bez managera, awarie prowizji, anomalie audytu, kompletność danych), feed AI drugi. (§B3 wzmocnione w §D.)
8. **[P2] Panel RODO** — nie kasować (atut demo/PARP); przenieść do Ustawień/About lub trust-badge. (§C/§D poprawione.)
9. **[P2] Redundancja** Zamiany/Wnioski/pulpit — pulpit tylko kompaktowe „następne akcje", formularze/historia w modułach. (§B1 dodane.)
10. **[P2] Pickery** — priorytet w górę (P1), użyj istniejących endpointów.

**Potwierdzone jako poprawne:** body `/dashboard` bez gate'u roli; panel RODO statyczny; kropki PESEL realne; UUID free-text realne; kierunek „treść persona-specyficzna" słuszny.

---

## Zasady i bramki
- **Anty-vanity:** każdy komponent musi napędzać decyzję persony; „ładna liczba bez akcji" → WYWAL.
- **Progressive disclosure:** pulpit = at-a-glance + wejście; głębia w module.
- **Pozycjonowanie:** pulpity eksponują **decyzje i rekomendacje AI**, nie tylko historię (spójne z promptem „strategiczny mózg / AI analiza wydajności").
- **RODO:** pracownik tylko o sobie; manager scoped; brak PII na pulpicie; metryki z wyjaśnieniem.
- **Bramka człowieka:** ostateczny zakres metryk pracownika (co pokazujemy vs prywatność) + progi/wagi performance = decyzja biznesowo-etyczna.

## Metodyka wykonania (po akceptacji)
1. Codex adversarial crosscheck werdyktów (zaatakuj każdy ZOSTAW i każdy WYWAL).
2. `/design-consultation` na 3 pulpity (makieta + design system).
3. Plan (subagent-driven-development): rola-świadomy `/dashboard`, komponenty pulpitów, gate'y, live RBAC na 3 kontach.
