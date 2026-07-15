# Checklista RODO / bezpieczeństwo stagingu (M2)

> Staging działa na maszynie prywatnej dewelopera przez tunel → wymóg twardej higieny danych. Spec p5 §7.

## Dane (RODO)
- [x] **Wyłącznie dane syntetyczne** — 15 lokalizacji, ~36 pracowników, PESEL **generowany** (nie realny). Seed odmawia PESEL spoza puli syntetycznej (runtime-guard, testowany).
- [x] Brak importu realnych danych 4Mobility na maszynę deva.
- [x] `homeAddress`/`pesel` szyfrowane AES-256-GCM (mechanizm testowany).
- [x] Potwierdzone na zrzutach z żywego środowiska (Rys. 1–4 raportu KM2): ekrany pokazują wyłącznie dane syntetyczne; zbiór wejściowy zamrożony (canonicalData) z testem niezmienników.

## Uwierzytelnianie / dostęp
- [x] Keycloak realm `hrobot-staging`; walidacja JWT (issuer/JWKS) w tenant-runtime.
- [x] Agent-service: uwierzytelnianie JWT + tenant z issuera (PR #31, C1) — nie ufa client-supplied tenantId.
- [x] Konta testowe trzech ról w realmie `hrobot-staging`: `demo` (ADMIN_KLIENTA), `manager.demo` (MANAGER), `pracownik.demo` (PRACOWNIK); hasła przekazywane uczestnikom odrębnym kanałem.
- [x] Dostęp do środowiska przez tunel sesyjny: URL generowany na czas sesji, przekazywany uczestnikom bezpośrednio i wygasający po jej zakończeniu (naturalna rotacja).
- [x] Web-kit z logowaniem Keycloak (formularz logowania, sesja w ciasteczku httpOnly, middleware wymusza uwierzytelnienie); serwisowy token proxy służy wyłącznie do autoryzacji wywołań API w środowisku demonstracyjnym.

## Runner / infrastruktura
- [x] Self-hosted runner zarejestrowany (2026-07-14) jako użytkownik nieuprzywilejowany, wyłącznie dla tego repozytorium; bramka workflow (sukces CI + `main` + non-fork) zweryfikowana w działaniu (run 29374277217).
- [x] Klucz szyfrujący nie w logach.
- [ ] Rotacja domyślnych haseł compose — wykonywana przed udostępnieniem środowiska poza tunel sesyjny (obecnie usługi zaplecza nie są publikowane, dostęp wyłącznie przez tunel wystawiający port aplikacji webowej).

## Audyt
- [x] Audyt przy generacji grafiku (`grafik.solve`) i zatwierdzeniu zamiany (`shift_swap.approved`).

## Po UAT
- [ ] Czyszczenie danych sesyjnych i zamknięcie tunelu — procedura wykonywana po sesji odbiorczej.
