# Protokół odbioru — Kamień Milowy M2 (SZABLON)

> Do podpisu przez Odbiorcę Technologii (4Mobility). Pola `[…]` uzupełnić; brzmienie dostosować do wzoru z umowy (patrz `../acceptance-criteria-M2.md` §1 [4M-3]).

---

**Projekt:** HRobot.AI — Indywidualny Plan Akceleracji (Poland Prize / PARP)
**Beneficjent:** App Pro sp. z o.o. (0035/2026) **Odbiorca Technologii:** 4Mobility
**Kamień milowy:** M2 — Moduł Grafik + Agent AI Grafik Manager
**Data odbioru:** [2026-07-__] **Miejsce/forma:** [zdalnie / …]
**Transza:** II — 129 600 PLN

## 1. Przedmiot odbioru (wskaźnik: 2 moduły)
| # | Moduł/punkt | Zakres dostarczony | Zademonstrowano | Wynik |
|:--:|---|---|:--:|:--:|
| a | Moduł Grafik (auto-scheduler CP-SAT) | H1–H4 twarde, metryki, web-kit na realnym API | ☐ | ☐ przyjęty |
| b | Agent AI Grafik Manager (pilot uczący się) | pętla uczenia, /agent/*, wersjonowana polityka | ☐ | ☐ przyjęty |
| c | Zamiany zmian | backend + walidacja + RBAC (UI: [status]) | ☐ | ☐ przyjęty / z uwagą |
| d | CI/CD | [status: zmergowane / etap] | ☐ | ☐ |
| e | Środowisko testowe Etapu 2 | staging + tunel | ☐ | ☐ |
| f | UAT | sesja J1–J5 | ☐ | ☐ |

## 2. Wynik UAT (J1–J5)
| Journey | Pass/Fail | Uwaga |
|---|:--:|---|
| J1 tworzenie zapotrzebowania | ☐ | |
| J2 generowanie grafiku (OPTIMAL) | ☐ | |
| J3 metryki + edycja ręczna | ☐ | |
| J4 agent uczący się + rationale | ☐ | |
| J5 zamiana zmian (peer→manager) | ☐ | |

## 3. Uwagi i etapowość (protokół z uwagami)
Odbiorca przyjmuje do wiadomości zakres dostarczony w M2 oraz elementy odroczone do M3 (zgodnie z `known-limitations.md`), w szczególności:
- H5/H6/fairness solvera — pełna implementacja w M3;
- Agent AI dostarczony jako **pilot uczący się** (nie produkcyjny RL) — pełna autonomia/RL na żywych danych w M3;
- Zamiany real-time + AI-mediacja — M3;
- [inne uwagi 4Mobility: … ]

## 4. Decyzja
☐ **Odbiór bez uwag** ☐ **Odbiór z uwagami** (lista w §3) ☐ **Odmowa odbioru** (uzasadnienie: …)

## 5. Podpisy
Beneficjent (App Pro): ______________________ data: __________
Odbiorca Technologii (4Mobility): ______________________ data: __________

## Załączniki
- Macierz a–f + kryteria: `../acceptance-criteria-M2.md`
- Dowody journeyów (screeny/nagrania): `./` (pliki [CAPTURE])
- Znane ograniczenia: `./known-limitations.md`
- Checklista RODO: `./rodo-security-checklist.md`
- Dowód testów: 107 TS + 51 py zielonych (PR #31, twilk/HRobotAI)
