# PROMPT (do wykonania PO zakończeniu prac M2) — HRobot jako strategiczny mózg kadrowy: AI analiza rozwoju pracowników + autonomiczna rekomendacja rekrutacji

> **Kiedy odpalić:** po zamknięciu bieżącego cyklu M2 (Wnioski/Ustawienia/Dostępy/Użytkownicy + SP4 koszty + review + wdrożenie). Osobny moduł demo/mock.
> **Repo:** HRobot M2, worktree feat/demo-4mobility. **Metodyka:** spec → crosscheck Claude+Codex → plan (subagent-driven-development) → workflowy (impl ‖ dual-review spec+jakość) → gate'y → live RBAC na 3 kontach → bramka wdrożeniowa (człowiek). Dane **tylko syntetyczne**, nie ruszać kotwic demo (36 pracowników, 832 zmiany).
> **Źródło:** dwie notatki od szefa. (1) AI szybko ocenia nowych w okresie rotacji wg wydajności/terminowości/reklamacji i rekomenduje wstrzymanie/wznowienie rekrutacji. (2) HRobot to **nie kolejny program do grafików** — podejmuje decyzje strategiczne na bazie analizy wydajności agentów, **widzi czy pracownik się rozwija**, a agent **sam** analizuje, czy zatrudniać nowych.
> **Rozstrzygnięcie autonomii vs RODO:** „system podejmuje strategiczne decyzje / agent sam analizuje czy zatrudniamy" realizujemy jako AUTONOMIĘ W ANALIZIE I REKOMENDACJI (agent działa ciągle, sam z siebie, i mówi „zatrudniaj/wstrzymaj/zwolnij-rozważ"), przy czym nieodwracalną akcję kadrową zatwierdza człowiek (art. 22 RODO). Jedyna zgodna z prawem forma „autonomicznego agenta" — i mocniejsza narracyjnie (strategiczny doradca, nie egzekutor).

## 0. Zadanie dla wykonawcy
Zaprojektuj i zamockuj moduł, w którym HRobot występuje jako **strategiczny mózg kadrowy**: ciągle i autonomicznie analizuje wydajność ORAZ **trajektorię rozwoju** pracowników (nacisk na nowych w okresie próbnym) i **sam z siebie** dostarcza rekomendacje strategiczne — o retencji poszczególnych osób i o **wstrzymaniu/wznowieniu rekrutacji** per zespół/lokalizacja. Najpierw rozwiń ten prompt do pełnego SPEC-a, zrób crosscheck Codeksem, potem plan i egzekucję.

## 1. Pozycjonowanie (RDZEŃ NARRACJI — to musi być czuć w demo)
- **HRobot ≠ grafik.** To nie jest kolejne narzędzie do układania zmian. To **system decyzji strategicznych HR**: mierzy, rozumie trend, przewiduje i **rekomenduje ruchy kadrowe** (retencja, rekrutacja, rozwój).
- **AI jest różnicą.** Grafik to tylko jedno ze źródeł danych. Wartość = ciągła, autonomiczna analiza, która zamienia surowe KPI w **decyzję biznesową z uzasadnieniem**.
- **Człowiek w pętli, nie zamiast pętli.** System autonomicznie *analizuje i rekomenduje*; nieodwracalną akcję kadrową (zatrudnienie/zwolnienie) zatwierdza HR/ADMIN (art. 22 RODO — §7). To wzmacnia, nie osłabia narrację: strategiczny doradca, który nigdy nie działa po cichu za plecami człowieka.

## 2. Co system robi AUTONOMICZNIE (warstwa „strategic-brain")
- **Ciągła analiza, nie na żądanie:** agent przelicza snapshoty i trajektorie w tle (harmonogram/scheduler), „sam z siebie", bez klikania przez usera.
- **Proaktywne rekomendacje i alerty:** sam wykrywa i zgłasza — „nowy pracownik X ma płaską/spadającą krzywą rozwoju → obserwuj", „lokalizacja Y ma lukę wydajności → **rozważ rekrutację**", „zespół Z powyżej celu i stabilny → **wstrzymaj rekrutację**".
- **Autonomiczna ocena potrzeby rekrutacji** (realizacja „agent sam analizuje czy zatrudniamy"): per lokalizacja/zespół agent utrzymuje aktualną rekomendację WZNÓW / WSTRZYMAJ / UTRZYMAJ, aktualizowaną gdy zmieniają się dane.
- **Konfigurowalny poziom autonomii/proaktywności** (wzór autonomy-ladder z `AiSchedulingConfig`): `TYLKO_NA_ŻĄDANIE → PROAKTYWNE_REKOMENDACJE → PROAKTYWNE_ALERTY(push do HR)`. **Nigdy** poziomu „auto-akcja kadrowa" — twardy limit (§7).

## 3. Wymiary pomiaru (cztery — trzy operacyjne + rozwój)
1. **Performance (Wydajność)** — liczba wykonanych zadań/zleceń w oknie (throughput), **znormalizowana** per rola/lokalizacja/etat. Metryki: zlecenia/okno, względem mediany peer-group.
2. **Terminowość** — czas od **zlecenia przez operatora** do **wykonania** (cycle time). Metryki: mediana, **% w SLA**, ogon p90. Krócej = lepiej.
3. **Jakość / Reklamacje** — **defect rate = reklamacje / wykonane zlecenia** (nie sama liczba — inaczej karzemy najpracowitszych). Metryki: defect rate, trend, kategorie.
4. **Rozwój / Trajektoria (NOWY, pełnoprawny — realizuje „system widzi czy pracownik się rozwija")** — czy pracownik idzie w górę. Metryki: **learning curve** (nachylenie 3 powyższych w czasie), **velocity poprawy**, ramp-up nowych (jak szybko dochodzą do poziomu zespołu). Kluczowe rozróżnienie: **„słaby, ale szybko rosnący"** (zatrzymać, inwestować) vs **„dobry, ale spadający"** (interweniować) — poziom bez trendu myli. To wymaga **serii czasowej** snapshotów, nie jednego pomiaru.

## 4. Szybka ocena NOWYCH + niepewność (wyróżnik)
- **Fast lane** dla zatrudnionych < N dni: częstsze snapshoty, wczesne sygnały.
- **Confidence:** przy małym N score ma niską pewność — **oznaczaj jawnie, NIE karz za brak danych**. Dla nowych trajektoria (kierunek) waży więcej niż poziom; rekomendacja = „obserwuj + zbieraj dane", dopóki confidence < próg.

## 5. Model danych (do domodelowania / mocka — greenfield)
- **WorkOrder / Zlecenie:** `id, assignedToEmployeeId, assignedByOperatorId?, assignedAt, completedAt?, status, lokalizacjaId?, kind`. (Terminowość = completedAt−assignedAt; Performance = count.)
- **Complaint / Reklamacja:** `id, workOrderId?/employeeId, category, severity?, createdAt`. (Jakość = complaints/completed.)
- **EmployeePerformanceSnapshot (SERIA CZASOWA — wymóg trajektorii):** per pracownik × okno: `throughput, medianCycleMinutes, slaHitRate, defectRate, compositeScore, developmentSlope, confidence, computedAt`. Historia okien = wejście do trajektorii/velocity.
- **RecruitmentRecommendation (autonomiczna, per lokalizacja/zespół):** `scope, verdict(WZNÓW/WSTRZYMAJ/UTRZYMAJ), rationale, computedAt, acknowledgedByUserId?`.
- **Seed syntetyczny** spójny z 36 pracownikami: profile pokazujące wszystkie ścieżki — gwiazda-stabilna, dobry-spadający, słaby-rosnący, słaby-płaski, nowy-rosnący, nowy-płaski. **Zero PII w danych operacyjnych.**

## 6. Silnik: scoring + trajektoria + rekomendacje strategiczne
- **Per-pracownik:** compositeScore + breakdown 4 wymiarów + **developmentSlope (trend)** + confidence + sygnał retencji {UTRZYMAĆ / OBSERWOWAĆ / RYZYKO / INWESTOWAĆ(słaby-rosnący)} — zawsze rekomendacja, nigdy auto-akcja.
- **Autonomiczny agent rekrutacyjny:** utrzymuje per lokalizacja rekomendację WZNÓW/WSTRZYMAJ/UTRZYMAJ z **uzasadnieniem** (luka capacity vs zapotrzebowanie — spinalne z grafikiem/kosztami SP4; jakość; terminowość; udział nowych z niską confidence i ich trajektorie).
- **Pure functions z testami:** cycle-time, defect-rate, normalizacja peer-group, **slope/velocity trajektorii**, agregacja rekomendacji. Materializacja do snapshotów (szybki, audytowalny UI).
- **Konfiguracja** (wzór `AiSchedulingConfig`): wagi 4 wymiarów, progi (SLA, defect, confidence, slope), długość okna, definicja „nowego", **poziom autonomii/proaktywności**. Edycja HR/ADMIN.

## 7. RODO + odpowiedzialna AI (WARUNEK KONIECZNY — produkt RODO-first, deliverable PARP)
- **Art. 22 RODO:** żadnych w pełni zautomatyzowanych decyzji o skutkach prawnych/istotnych (zwolnienie, wstrzymanie rekrutacji) bez człowieka. Autonomia dotyczy **analizy i rekomendacji**; akcję zatwierdza HR/ADMIN. Banner wszędzie: „Rekomendacja AI — decyzję podejmuje człowiek".
- **Wyjaśnialność:** każdy score i każda rekomendacja rekrutacyjna rozbite na czynniki i wagi; żaden black-box. Szczególnie „rozwój" musi być przejrzysty (co znaczy „nie rozwija się").
- **Uczciwość:** normalizacja per peer-group; ochrona nowych (confidence); **brak cech chronionych** (wiek, płeć, pochodzenie, zdrowie, ciąża, związkowość…) w scoringu — tylko metryki operacyjne; **test wymuszający** brak tych cech. Uwaga na proxy-dyskryminację przez „trajektorię" (np. powrót z L4 zaniża trend — wyklucz takie okresy).
- **Minimalizacja + audyt:** allowlist-projekcje (SAFE_SELECT); audit **ids-only** każdej rekomendacji i każdej ludzkiej decyzji na jej podstawie (kto, kiedy, na jakiej rekomendacji).
- **Prawo do wyjaśnienia i odwołania** + ścieżka human-review. **Podstawa prawna** = bramka człowieka (§10).

## 8. RBAC + UI (Polski) — „strategic dashboard", nie tabelka grafiku
- **HR/ADMIN_KLIENTA:** pełny widok + konfiguracja wag/autonomii.
- **MANAGER:** scoped do swoich jednostek. **PRACOWNIK:** opcjonalnie własna karta (transparentność — bramka §10).
- Ekrany: (a) **strategiczny dashboard** — heatmapa wydajności + **feed proaktywnych rekomendacji** agenta (retencja + rekrutacja) z uzasadnieniami; (b) **karta pracownika** — 4 wymiary, **sparkline/trajektoria w czasie**, confidence, sygnał retencji + uzasadnienie; (c) **panel rekrutacji** per lokalizacja (WZNÓW/WSTRZYMAJ/UTRZYMAJ + „zaakceptuj rekomendację" = loguje ludzką decyzję, nie wykonuje zwolnień); (d) banner RODO. Narracja UI ma sprzedawać „strategiczny mózg", nie „grafik".

## 9. Reużycie maszynerii HRobot (replikować, nie zmyślać)
- tenant-runtime: wzór modułu `employees`/`ai-grafik` (controller `@TenantRoute()`+`@Roles`, RbacGuard `hrobot_roles`, `unit-scope`, `AuditService`, SAFE_SELECT).
- Konfiguracja: `AiSchedulingConfig` + partial-unique dla wiersza domyślnego; autonomy-ladder jako wzór poziomu proaktywności.
- Ciągła analiza: scheduler/job (wzór istniejących zadań w tle) do przeliczania snapshotów/trajektorii.
- web-kit: proxy `[[...path]]` + `lib/*.ts` (aiFetch/error-class + pure kalkulatory + vitest) + screeny (wzór `components/ai-grafik/*`), page server-shell z `getSession`+AppShell+RBAC-gate; enrichment id→nazwisko przez `/api/employees`.
- Spięcie ze SP4/grafikiem dla capacity-gap w rekomendacji rekrutacji.

## 10. Bramki człowieka (rozstrzygnąć PRZED egzekucją)
1. **Wagi 4 wymiarów i progi** (w tym: ile waży „rozwój"/trajektoria vs poziom) — decyzja biznesowo-etyczna.
2. **Poziom autonomii/proaktywności** — czy agent tylko rekomenduje na żądanie, czy pushuje alerty do HR (potwierdzić twardy zakaz auto-akcji kadrowej).
3. **Podstawa prawna RODO** + czy pracownik widzi swój score i trajektorię.
4. **Definicja „rozwoju/nie-rozwija-się"** (okno, minimalny slope, wykluczenia: L4, urlop, onboarding) — żeby nie krzywdzić.
5. **Źródło danych** „zleceń" i „reklamacji" w realu (po demo) — na demo mock.
6. **Aplikacja migracji na żywą bazę** = bramka człowieka (+ `ALTER … OWNER TO hu_<id>` po ręcznej aplikacji).

## 11. Kryteria akceptacji / demo
- 4 wymiary liczone i **wyjaśnione**; nowy pracownik oceniony z jawną **confidence**.
- **Trajektoria działa:** demo rozróżnia „słaby-rosnący" od „dobry-spadający" (nie tylko poziom).
- **Autonomiczny feed rekomendacji** (retencja + rekrutacja) generowany bez ręcznego wyzwalania, per lokalizacja, z uzasadnieniem.
- Guardrails RODO widoczne (banner, breakdown, brak cech chronionych — z testem), audit ids-only.
- RBAC na 3 kontach (HR pełny, MANAGER scoped, PRACOWNIK ograniczony/własny). Narracja „to nie grafik, to strategia" czytelna w UI.
- Dane syntetyczne, kotwice nietknięte; gate'y (jest/tsc/vitest) zielone; migracja create-only (bramka wdrożeniowa).

---

### Skrót „co robić najpierw"
1. Rozwiń do pełnego SPEC-a (data-model z serią czasową + kontrakty API + ekrany + guardrails + poziom autonomii).
2. `codex exec` adversarial crosscheck (reużycia vs realny kod; zaatakuj scoring/trajektorię/fairness/RODO/model danych/autonomię).
3. Rekonsyliacja → plan (TDD, subagent-driven-development).
4. Workflowy: backend (model+seed-seria-czasowa+silnik+scheduler+API) → web-kit (dashboard+karta-trajektoria+panel-rekrutacji) → live RBAC na 3 kontach.
5. Bramki człowieka (§10) i wdrożeniowa — przed każdą akcją nieodwracalną zapytaj.
