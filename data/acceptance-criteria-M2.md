# Kryteria odbioru M2 — źródło prawdy (acceptance-criteria)

> **Cel:** jeden dokument, w którym dosłowne kryteria odbioru M2 z **umowy PARP** i **wzoru protokołu 4Mobility** są zmapowane 1:1 na artefakt/krok demo. Warunek wstępny D0-2 z review (był oznaczony jako CRITICAL bloker).
> **Status:** 🟡 SZKIELET — sekcje „[4M]" wymagają dosłownego brzmienia od 4Mobility/umowy (akcja kapitana, PRE1/PRE2). Reszta wyprowadzona z kodu + specyfikacji.
> **Data:** 2026-07-11 · **Odbiór:** 2026-07-20

---

## 1. Dosłowne brzmienie z umowy/protokołu (DO UZUPEŁNIENIA — [4M])

> **[4M-1]** Wklej tu VERBATIM definicję wskaźnika M2 z umowy PARP (liczba i nazwy modułów: „2 moduły — Grafik + Agent AI Grafik Manager").
> **[4M-2]** Wklej VERBATIM opis punktów programu a–f dla Etapu 2.
> **[4M-3]** Wklej wzór/pola protokołu odbioru 4Mobility (co dokładnie podpisują).
> **[4M-4]** KLUCZOWE: czy umowa wymaga dosłownie „system uczący się / RL / Stable-Baselines3" ORAZ „real-time" dla modułu b/c? Od tego zależy, czy pilotowa głębia (agent = affinity-learner z pętlą uczenia; c = async) jest zgodna z protokołem, czy wymaga aneksu/etapowości.

Do czasu uzupełnienia [4M] poniższe mapowanie zakłada odbiór na poziomie UAT/demo (nie hardening produkcyjny) i strategię **deep-2 + renegocjacja etapowości**.

## 2. Mapowanie punktów a–f → dostarczone → dowód

| Pkt | Nazwa | Dostarczone (kod na `main`) | Dowód (evidence) | Status |
|:--:|------|------------------------------|------------------|:------:|
| **a** | Moduł Grafik (auto-scheduler) | solver CP-SAT (H1–H4 twarde, H5 miękki proxy, dojazdy haversine, odchyłka etatu), tenant-runtime `/grafik/*`, web-kit siatka | `m2-evidence/uat-journeys.md` J1–J3 + screeny; żywy solve `201 OPTIMAL, 0 unmet` | ✅ demonstrowalne |
| **b** | Agent AI Grafik Manager | serwis Python: `/agent/propose|feedback|heal|explain|forecast`, pętla uczenia (affinity-learner + batch re-fit), wersjonowana polityka | J4 (live demo + Reset&Replay), wykres AG2 spadku edit-distance | ✅ demo · ⚠️ ujęcie uczciwe (patrz known-limitations) |
| **c** | Zamiany zmian | model `ShiftSwapRequest` + state machine + endpointy + walidacja solverem (H1–H4) | J5; **UWAGA: UI Zamian obecnie na mocku** (patrz known-limitations) | ⚠️ backend gotowy, UI do podłączenia |
| **d** | CI/CD | `ci.yml` napisany (turbo targety + gates) | **⚠️ niezmergowany na `main` (PR #9, token bez scope `workflow`)** | ❌ do domknięcia |
| **e** | Środowisko testowe Etapu 2 | `docker-compose --profile full` + `deploy-staging.yml` + Cloudflare tunnel; stack stoi (7 kontenerów) | URL stagingu + health; runner do rejestracji | 🟡 stack działa, auto-deploy do domknięcia |
| **f** | UAT Etapu 2 | scenariusze J1–J5 + skrypt UAT | sesja z 4Mobility + protokół | 🟡 przygotowane, sesja do przeprowadzenia |

## 3. Kryteria techniczne (z specyfikacji) — stan po testach

| Kryterium | Stan | Uwaga / dowód |
|---|:--:|---|
| G1 pokrycie H1–H6 | ⚠️ zmienione | **H1–H4 twarde** (zweryfikowane testami); H5 miękki proxy; H6/fairness → M3. Roadmapa/spec przeredagowane (commit D1). |
| G2 metryki (dojazdy/etaty/fairness) | ✅/⚠️ | commute+etatDeviation realne; `fairnessScore=0.0` (deferral M3) |
| G3 determinizm | ⚠️ | single-worker + seed; nie bit-identyczność przy time-limit/FEASIBLE |
| G4 INFEASIBLE jawnie | ✅ | zwraca `unmet[]` |
| G5 web-kit na realnym API | ✅ | zweryfikowane wizualnie (:5601, 52 AUTO-zmiany) |
| G6 izolacja tenantów | ⚠️ | tylko unit-test mock; **brak testu integracyjnego na ≥2 bazach** |
| AG1–AG5 (agent) | ✅ | 51 testów pytest zielonych (po fixach PR #31) |
| SW1–SW4 (zamiany) | ✅ | testy zielone; H3/rest/RBAC/race naprawione w PR #31 |
| CI-1..4, ENV-1..3 | ❌/🟡 | zależne od domknięcia CI (pkt d) + rejestracji runnera |

## 4. Powiązane
- Pełny Evidence Pack: `data/m2-evidence/` (README, uat-journeys, known-limitations, rodo-security-checklist, protokol-odbioru-template).
- Review przedodbiorowe: `docs/superpowers/specs/2026-07-11-m2-review-findings.md`.
- Fixy correctness/security: PR #31 (twilk/HRobotAI) — 107 TS + 51 py testów zielonych.
