# Strategic-Brain — weryfikacja live (T14)

**Data:** 2026-07-14 · **Tenant:** `hrobot_t_900d948b` (37 pracowników, 833 zmiany — kotwice nietknięte) · **Backend:** `:3001/api` · **web-kit:** `:5601`

Migracja (raw SQL) + `ALTER OWNER TO hu_900d948b` + seed zaaplikowane lokalnie na żywy tenant demo (bramka człowieka — zatwierdzona). Backend przebudowany; `StrategicBrainController` zmapował 7 tras; „Nest application successfully started".

## RBAC — macierz na 3 kontach (tokeny KC direct-grant, uderzenie prosto w backend)

| Endpoint | ADMIN (`demo`) | MANAGER (`manager.demo`) | PRACOWNIK (`pracownik.demo`) |
|---|---|---|---|
| `GET /overview` | 200 (pełny heatmap) | 200 (scoped) | **403** „Required roles: [HR, ADMIN_KLIENTA, MANAGER]" |
| `GET /employee/me` | — | 404 (manager nie ma rekordu Employee) | 200 (Anna Kowalska) |
| `GET /employee/:innyId` | — | — | **403** (pracownik nie podejrzy cudzej karty) |
| `GET /recruitment` | 200 (wszystkie 4) | 200 (widzi `sb_rec_centrum_wznow`, Region Centrum) | — |
| `GET /config` | 200 (wagi 0.30/0.25/0.25/0.20) | **403** „Required roles: [HR, ADMIN_KLIENTA]" | — |

- **M16** scope service-level: manager widzi tylko swoją jednostkę; scope↔unit mapowanie z seedu zadziałało (rekomendacja `scope_type=UNIT`, `scope_id` = managedUnitId Marka).
- **M17** `/employee/me` przed `/:id`: self-view pracownika działa, `/:id` dla cudzej karty odrzucone.

## Karta pracownika (self) — dowód RODO/M12 na żywo
`GET /employee/me` jako `pracownik.demo` (Anna Kowalska, `aeac802d-…`):
- `retentionSignal = UTRZYMAC` (profil gwiazda-stabilna)
- Seria 5 okien composite: `83 · 84 · 52[excl=L4] · 83 · 84`

**Okno L4 (spadek do 52) jest oznaczone `excludedReason=L4` i wykluczone z trendu.** Seria bez niego (83·84·83·84) jest stabilna → UTRZYMAC. Gdyby dip z L4 liczył się do slope, pracownica dostałaby fałszywy sygnał spadku. Powrót z L4 nie zaniża oceny rozwoju — zgodnie z §7/§14 M12.

## Profile trajektorii (current window, wszystkie 6 — z bazy)
| Pracownik | composite | slope | confidence | sygnał |
|---|---|---|---|---|
| Anna Kowalska | 84 | +0.20 | 0.90 | UTRZYMAC (gwiazda) |
| Rafał Adamczyk | 66 | −6.70 | 0.85 | RYZYKO (dobry-spadający) |
| Tomasz Nowacki | 47 | +8.50 | 0.30 | OBSERWOWAC (nowy-rosnący) |
| Marcin Dąbrowski | 45 | +6.80 | 0.70 | INWESTOWAC (słaby-rosnący) |
| Andrzej Kowalczyk | 38 | +0.20 | 0.75 | RYZYKO (słaby-płaski) |
| Ewa Lewandowska | 34 | 0.00 | 0.30 | OBSERWOWAC (nowy-płaski) |

Kluczowe rozróżnienie „słaby-rosnący (INWESTUJ) vs dobry-spadający (RYZYKO)" widoczne live.

## Rekomendacje rekrutacji (immutable events)
`WZNOW` (Region Centrum UNIT — widoczne managerowi) · `WZNOW` (lokalizacja, z realnej luki `ShiftDemand−Shift`) · `WSTRZYMAJ` (Region Południe) · `UTRZYMAJ` (Region Północ).

## UI
- `GET :5601/analiza` → **HTTP 200** (renderuje się, brak 500).
- Proxy web-kit → backend: 403 bez sesji = poprawny RBAC (trasa istnieje, guard działa; realna sesja przeglądarki niesie token użytkownika).
- Komponenty: `tsc --noEmit` czysty, 303 testy web-kit zielone.

## Audyt
Brak wpisów audytowych strategic-brain z PII (żaden `acknowledge` nie został jeszcze wywołany live; ids-only wymuszony testem T9 + granica zapisu art. 22 testem T10).

## Nie zweryfikowane headless
Wizualny screenshot renderu `/analiza` — panel przeglądarki nie sięga `localhost`, a login Keycloak to flow w przeglądarce. Kontrakt danych, który UI konsumuje, jest w pełni zweryfikowany per rola; render zwraca 200. Wizualne potwierdzenie do zrobienia w realnej przeglądarce (Chrome) na życzenie.
