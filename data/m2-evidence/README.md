# M2 Evidence Pack — pakiet dowodowy odbioru

> Instrument odbioru M2 (Grafik + Agent AI Grafik Manager) dla 4Mobility. Odbiór: **2026-07-20**.
> **Status:** 🟡 szkielet gotowy; sloty „[CAPTURE]"/„[4M]" do uzupełnienia (żywe screeny, URL, dosłowne kryteria).

## Zawartość
| Plik | Co | Status |
|---|---|:--:|
| `../acceptance-criteria-M2.md` | Kryteria odbioru + mapowanie a–f → dowód | 🟡 (sloty [4M]) |
| `README.md` (ten) | Indeks + dashboard statusu + macierz a–f | 🟡 |
| `uat-journeys.md` | 5 user-journey J1–J5 (pass/fail) + skrypt UAT + gdzie robić screeny | 🟡 [CAPTURE] |
| `known-limitations.md` | Uczciwy zakres: H1–H4 twarde, AI=affinity-learner nie SB3/RL, UI Zamian mock, CI status | ✅ |
| `rodo-security-checklist.md` | Checklista RODO/bezpieczeństwo stagingu | ✅ |
| `protokol-odbioru-template.md` | Szablon protokołu do podpisu 4Mobility | 🟡 [4M] |

## Dashboard gotowości (2026-07-11)
| Moduł/punkt | Kod | Demo | Dowód uchwycony | Blokery |
|---|:--:|:--:|:--:|---|
| a Grafik | ✅ | ✅ (:5601, solve OPTIMAL) | 🟡 screeny do zrobienia | — |
| b Agent AI | ✅ | ✅ (:8010 J4) | 🟡 wykres AG2 istnieje w repo | ujęcie „nie SB3/RL" |
| c Zamiany | ✅ backend | ⚠️ UI mock | ❌ | podłączyć UI |
| d CI | 🟡 napisane | — | ❌ | PR #9 niezmergowany (scope `workflow`) |
| e Staging | ✅ stoi | ✅ | 🟡 URL do wpisania | auto-deploy/runner |
| f UAT | 🟡 skrypt | — | ❌ | sesja z 4Mobility |

## Jak uchwycić dowody (kapitan)
1. Stack: `docker start hrobot-{postgres,redis,keycloak,rabbitmq,control-plane,optimizer,tenant-runtime}-1`; front: `cd HRobot-m2/docs/design/web-kit && node start-live.mjs`.
2. Screeny (web-kit :5601 / agent :8010) per journey — patrz `uat-journeys.md`, sekcje [CAPTURE]. Wzorzec jak w raportach KM.
3. Zielone runy testów jako artefakt: `apps/tenant-runtime` jest (107) + `agent-service` pytest (51) — zrzut do `evidence/`.
4. URL stagingu (Cloudflare tunnel) + lista kont testowych → wpisać w `uat-journeys.md`.
5. Uzupełnić [4M] w `../acceptance-criteria-M2.md` po rozmowie z 4Mobility (PRE2).

## Dane wyłącznie syntetyczne (RODO)
Wszystkie dowody na danych syntetycznych 4Mobility (15 lok., ~36 prac., PESEL generowany). Zero realnych PII. Patrz `rodo-security-checklist.md`.
