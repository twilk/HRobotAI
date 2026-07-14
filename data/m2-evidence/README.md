# M2 Evidence Pack — pakiet dowodowy odbioru

> Instrument odbioru M2 (Grafik + Agent AI Grafik Manager) dla 4Mobility. Odbiór: **2026-07-20**.
> **Status:** ✅ pakiet dowodowy kompletny: logi testów (855/51/22), zielone runy CI/CD, zrzuty z żywego API w raporcie KM2 (`HRobot/docs/raport-km2/screenshots/`). Sloty [4M] i protokół — wypełniane na sesji odbiorczej 17–20.07.

## Zawartość
| Plik | Co | Status |
|---|---|:--:|
| `../acceptance-criteria-M2.md` | Kryteria odbioru + mapowanie a–f → dowód | ✅ ([4M] na sesji odbiorczej) |
| `README.md` (ten) | Indeks + dashboard statusu + macierz a–f | ✅ |
| `uat-journeys.md` | 5 user-journey J1–J5 (pass/fail) + skrypt UAT | ✅ (tabela pass/fail wypełniana na sesji) |
| `known-limitations.md` | Uczciwy zakres: H1–H4 twarde, AI=affinity-learner nie SB3/RL, statusy c/d/e (aktualizacja 14.07) | ✅ |
| `rodo-security-checklist.md` | Checklista RODO/bezpieczeństwo stagingu | ✅ |
| `protokol-odbioru-template.md` | Szablon protokołu do podpisu 4Mobility | ✅ (podpis na sesji) |

## Dashboard gotowości (2026-07-11)
| Moduł/punkt | Kod | Demo | Dowód uchwycony | Blokery |
|---|:--:|:--:|:--:|---|
| a Grafik | ✅ | ✅ (:5601, solve OPTIMAL) | ✅ zrzut siatki w raporcie KM2 | — |
| b Agent AI | ✅ | ✅ (:8010 J4) | ✅ zrzut demo po replay (0/100%/v11) + wykres AG2 w raporcie KM2 | ujęcie zgodne z known-limitations |
| c Zamiany | ✅ backend + UI na realnym API | ✅ 62/62 testów (14.07) | ✅ zrzut skrzynki managera (J5) w raporcie KM2 | — |
| d CI | ✅ na main + py-lanes + branch protection | ✅ zielone runy 29166512951 / 29166696122 | ✅ | — |
| e Staging | ✅ auto-deploy end-to-end (run 29374277217, 14/14) | ✅ health-check 6/6 | ✅ | URL tunelu wpisywany na sesji |
| f UAT | ✅ skrypt + dane + wewnętrzny cykl (QA 3 ról, 2 próby generalne) | ✅ dry-runy 12.07 udokumentowane | ✅ | protokół podpisywany na sesji 17–20.07 |

## Jak uchwycić dowody (kapitan)
1. Stack: `docker start hrobot-{postgres,redis,keycloak,rabbitmq,control-plane,optimizer,tenant-runtime}-1`; front: `cd HRobot-m2/docs/design/web-kit && node start-live.mjs`.
2. Screeny (web-kit :5601 / agent :8010) per journey — patrz `uat-journeys.md`, sekcje [CAPTURE]. Wzorzec jak w raportach KM.
3. Zielone runy testów jako artefakt: `apps/tenant-runtime` jest (107) + `agent-service` pytest (51) — zrzut do `evidence/`.
4. URL stagingu (Cloudflare tunnel) + lista kont testowych → wpisać w `uat-journeys.md`.
5. Uzupełnić [4M] w `../acceptance-criteria-M2.md` po rozmowie z 4Mobility (PRE2).

## Dane wyłącznie syntetyczne (RODO)
Wszystkie dowody na danych syntetycznych 4Mobility (15 lok., ~36 prac., PESEL generowany). Zero realnych PII. Patrz `rodo-security-checklist.md`.
