# Checklista RODO / bezpieczeństwo stagingu (M2)

> Staging działa na maszynie prywatnej dewelopera przez tunel → wymóg twardej higieny danych. Spec p5 §7.

## Dane (RODO)
- [x] **Wyłącznie dane syntetyczne** — 15 lokalizacji, ~36 pracowników, PESEL **generowany** (nie realny). Seed odmawia PESEL spoza puli syntetycznej (runtime-guard, testowany).
- [x] Brak importu realnych danych 4Mobility na maszynę deva.
- [x] `homeAddress`/`pesel` szyfrowane AES-256-GCM (mechanizm testowany).
- [ ] `[CAPTURE]` potwierdzenie w demo: żaden ekran nie pokazuje realnych PII.

## Uwierzytelnianie / dostęp
- [x] Keycloak realm `hrobot-staging`; walidacja JWT (issuer/JWKS) w tenant-runtime.
- [x] Agent-service: uwierzytelnianie JWT + tenant z issuera (PR #31, C1) — nie ufa client-supplied tenantId.
- [ ] Lista kont testowych: `demo`/`demo-staging-2026` (ADMIN_KLIENTA). `[CAPTURE]` pełna lista, jeśli więcej ról.
- [ ] Polityka dostępu do tunelu (kto zna URL; rotacja po UAT).
- [ ] **Znane (do produkcji, nie blokuje UAT):** web-kit bez realnego logowania (proxy mintuje token serwisowy) — akceptowalne tylko na lokalnym demo jednego użytkownika; przed hostingiem: sesja Keycloak + middleware.

## Runner / infrastruktura
- [ ] Self-hosted runner **tylko `main`/`workflow_run`, nigdy fork-PR**; user nieuprzywilejowany (do konfiguracji przy rejestracji).
- [x] Klucz szyfrujący nie w logach.
- [ ] Niedomyślne hasła na stagingu (compose ma dev `admin/admin`, `postgres/postgres` — bezpieczne tylko za tunelem wystawiającym sam web-port; do zmiany przed szerszym dostępem).

## Audyt
- [x] Audyt przy generacji grafiku (`grafik.solve`) i zatwierdzeniu zamiany (`shift_swap.approved`).

## Po UAT
- [ ] Polityka czyszczenia danych/tunelu po sesji.
