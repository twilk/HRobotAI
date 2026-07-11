# M2 · Podprojekt #3 — Real-time + pre-uzgadnianie zamian zmian (projekt)

> **Projekt:** HRobot.AI — Kamień Milowy **M2** (odbiór 20.07.2026)
> **Punkt programu:** **c)** mechanizm zamian zmian z pre-uzgadnianiem
> **Beneficjent:** App Pro sp. z o.o. (0035/2026) · **Odbiorca Technologii:** 4Mobility
> **Data:** 2026-07-09 · **Status:** Projekt → plan · **Zależność:** #1 (model `Shift`)
> **Powiązane:** `2026-07-09-m2-roadmap-ukonczenie.md`

---

## 1. Kontekst i zakres M2 (świadomie minimalny)

Punkt c) w pierwotnej ambicji = real-time (WebSocket/SSE) + „pre-uzgadnianie" wspierane AI. Przy 11-dniowym oknie i strategii **deep-2** (priorytet: a Grafik + b Agent), c dostaje **minimalny wykonalny workflow async**, który spełnia punkt programu dla protokołu odbioru, a bogactwo (real-time push, AI-mediacja konfliktów) przechodzi etapowo do M3. Ta decyzja jest jawna i podlega uzgodnieniu z 4Mobility (patrz #5).

**Cel M2:** pracownik może zgłosić chęć zamiany zmiany, druga strona pre-uzgadnia (akceptuje wstępnie), menadżer zatwierdza — wszystko na modelu `Shift` z #1, z audytem, bez WebSocketów.

## 2. Decyzje projektowe

| Decyzja | Wybór (M2) | Etapowo (M3) |
|---------|-----------|-------------|
| Transport | **Async pull** (REST + odświeżanie/polling) | WebSocket/SSE push |
| Pre-uzgadnianie | **Dwustronna akceptacja pracowników → zatwierdzenie menadżera** | AI-mediacja: agent (#2) proponuje najlepsze pary zamian |
| Rozwiązywanie konfliktów | Prosta blokada optymistyczna + walidacja przez solver #1 (zamiana nie może złamać H1-H6) | negocjacja wieloetapowa |
| Model | Osobny `ShiftSwapRequest` (nie mutuje `Shift` do zatwierdzenia) | — |

## 3. Model danych (tenant schema — nowy)

```
ShiftSwapRequest
  id, requesterEmployeeId, requesterShiftId,
  targetEmployeeId?, targetShiftId?,          // zamiana 1:1 lub „oddaj zmianę"
  state (DRAFT|PENDING_PEER|PEER_AGREED|PENDING_MANAGER|APPROVED|REJECTED|CANCELLED),
  reason?, createdAt, updatedAt, decidedByManagerId?
```

Zatwierdzenie (`APPROVED`) → atomowa mutacja `Shift.employeeId` obu zmian + wpis audytu; przedtem **walidacja solverem #1**, że wynik pozostaje wykonalny (nie łamie H1-H6: odpoczynek, kwalifikacje, brak nakładania).

## 4. Maszyna stanów

```
DRAFT ──submit──▶ PENDING_PEER ──peer accept──▶ PEER_AGREED ──submit to mgr──▶ PENDING_MANAGER
   │                   │ peer reject                                              │ approve │ reject
   └── cancel ─────────┴──────────────────────────────────────────────────────▶ CANCELLED/REJECTED
                                                                                  │ approve
                                                                                  ▼
                                                          walidacja solver #1 → APPROVED (mutacja Shift + audyt)
```

Reużywa wzorca state-machine z modułu `wnioski` (LeaveRequest) — istniejący, sprawdzony wzorzec w `apps/tenant-runtime`.

## 5. API (tenant-runtime `src/shift-swap`)

```
POST   /shift-swap                 { requesterShiftId, targetShiftId? }  → ShiftSwapRequest(DRAFT)
POST   /shift-swap/:id/submit                                            → PENDING_PEER
POST   /shift-swap/:id/peer-decision   { accept:bool }                   → PEER_AGREED|REJECTED
POST   /shift-swap/:id/manager-decision{ approve:bool }                  → APPROVED|REJECTED (+ walidacja solver)
GET    /shift-swap?state=&mine=                                          → lista (polling)
```
RBAC: pracownik operuje własnymi zmianami; peer-decision tylko target; manager-decision tylko MANAGER jednostki/HR/ADMIN.

## 6. UI (web-kit, minimalne)
Lista „moje prośby o zamianę" + akcja „zaproponuj zamianę" z siatki grafiku + skrzynka zatwierdzeń menadżera. Odświeżanie przez polling (bez real-time). Ręczne, proste — nie blokuje toru A.

## 7. Kryteria akceptacji

| # | Kryterium | Weryfikacja |
|---|-----------|-------------|
| SW1 | Pełen happy-path DRAFT→APPROVED mutuje obie zmiany + audyt | test integracyjny |
| SW2 | Zamiana łamiąca H1-H6 jest odrzucona przez walidację solvera | test przypadku |
| SW3 | RBAC: obcy pracownik nie zatwierdzi cudzej zamiany; izolacja tenantów | test |
| SW4 | Odrzucenie/anulowanie na każdym etapie zostawia `Shift` nietknięty | test maszyny stanów |

## 8. Poza zakresem M2
WebSocket/SSE real-time push · AI-mediacja par zamian (agent #2) · giełda zmian / marketplace · powiadomienia push (reużyją modułu Komunikacja M1 dopiero w M3).

## 9. Ryzyka
| Ryzyko | Mitygacja |
|--------|-----------|
| c „minimalny" niezgodny z oczekiwaniem 4Mobility | jawne uzgodnienie etapowości w #5 przed demo; protokół z uwagami |
| Zamiana psuje wykonalność grafiku | twarda walidacja solverem #1 przed APPROVED (SW2) |
| Kolizja z torem A (współdzielony `Shift`) | `sm-grafik-core` właścicielem schematu; `ShiftSwapRequest` w osobnej migracji po zamrożeniu modelu `Shift` |
