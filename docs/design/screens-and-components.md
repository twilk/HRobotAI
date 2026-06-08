# HRobot — Screens & Components Plan

Companion to [`DESIGN.md`](../../DESIGN.md). Applies the *Refit for EU-trust* system to every
Foundation screen and the component kit. Cross-references the Foundation design spec
(`docs/superpowers/specs/2026-05-27-hrobot-foundation-design.md`) and the rendered mockups
in [`mockups/`](mockups/). Polish UI copy throughout.

Legend: 🟢 mockup rendered · ⚪ specified here (build to this) · 🔒 a place the trust motif appears.

---

## A. Auth & onboarding surfaces (navy, editorial)

### A1. Signup — `signup.html` 🟢
Route: `(marketing)/signup/page.tsx`.
- **Layout:** navy field with `.motif-navy` engraved texture; single crafted card (`.auth-card`,
  no glass), `max-w-432`, edge-to-edge at 375px.
- **Order:** wordmark → "Utwórz konto" / "Bezpłatne 14 dni. Bez karty kredytowej." → Nazwa firmy
  → **SlugInput** → Email administratora → Hasło (3-seg strength) → teal CTA "Utwórz konto" →
  "Masz już konto? Zaloguj się".
- 🔒 **Trust line** under the card: `RODO · Dane w UE · Szyfrowanie AES-256` (mono).
- **SlugInput:** auto-lowercase + hyphenate; mono live preview `acme.hrobot.ai`; debounced
  (300ms) `GET /api/slugs/check/{slug}` → green `dostępne` check / red X "Ta nazwa jest już zajęta".
- **States:** field-level inline errors (`.input.err` + `.hint.err`); server error banner atop card;
  CTA spinner + "Tworzenie konta…"; `409` slug race shows the same red message.
- **Anti-slop:** no glass, mono slug preview, engraved motif, warm card, real strength meter.

### A2. Provisioning status — `provisioning.html` 🟢
Route: `(marketing)/signup/status/page.tsx`. Polls `GET /api/provision/status/{jobId}` every 3s.
- **Layout:** card on navy; two columns — left **mono pipeline**, right active-step benefit copy.
  Stacks at 375px.
- 🔒 **Pipeline:** 5 `.step` nodes — CREATE_DB → RUN_MIGRATIONS → SEED → KEYCLOAK_SETUP → DONE.
  Done = teal check + teal connector; active = pulsing teal ring; pending = muted. Each row shows
  a human label, the mono step ID, and status (`Ukończono` / `W toku` / `Oczekuje`).
- **Benefit copy (per active step):** the Polish copy table from the Foundation spec §6, with
  `Krok N z 5` (mono) + `Szyfrowane · RODO` chip.
- **Failure state (`FAILED` after 3 attempts):** heading "Coś poszło nie tak"; body "Twój adres
  email został zapisany — odezwiemy się w ciągu 1 godziny."; support link `pomoc@hrobot.ai`.
  Pipeline shows the failed node in `--error`; no teal.
- **A11y:** `role="progressbar"`, `aria-valuenow/max/text` on the pipeline.

### A3. Keycloak login / first password — `keycloak-login.html` 🟢 (verified; auth treatment = A1)
Realm theme (`apps/web/keycloak-theme/`, FreeMarker, applied in KEYCLOAK_SETUP).
- Mirrors signup: navy + `.motif-navy` + crafted card + Cabinet wordmark + teal CTA.
- **Login:** Email/login + Hasło (with "Zapomniałeś hasła?") + "Zaloguj się"; 🔒 mono footer
  `Zabezpieczone · realm: hrobot-acme`; trust line `RODO · Krótkie sesje · Rotacja tokenów`.
- **First-login (temporaryPassword):** same shell, fields → "Ustaw nowe hasło" + confirm +
  the 3-seg strength bar from A1. First impression is HRobot, never default Keycloak.

---

## B. App shell (navy rail + warm main)

### B1. Sidebar — in every app mockup 🟢
- Brand (mark + wordmark) + tenant name + mono slug; 🔒 faint engraved texture in the brand block.
- Grouped nav, mono uppercase labels: **MODUŁY HR** (Dashboard, Pracownicy, Grafik, Wnioski,
  Dostępy) and **ADMINISTRACJA** (Ustawienia, Użytkownicy). Active = teal left-border + tinted bg.
  `Wnioski` carries a mono count tag.
- **RBAC visibility:** Pracownik sees only role-relevant modules; ADMINISTRACJA hidden for Pracownik;
  `Użytkownicy` ADMIN_KLIENTA-only.
- 🔒 Footer: shield + `Dane chronione w UE` + mono `EU-CENTRAL`.

### B2. TopBar — in every app mockup 🟢
- Left: page crumb (`<b>` + mono slug). Right: 🔒 `Sesja szyfrowana` secured chip, notifications
  (teal dot), user avatar + name + mono role tag.

### B3. Mobile drawer (≤768px) — `mobile.html` 🟢
- Sidebar hides; hamburger in a mobile topbar opens the navy drawer (286px, slide from left, scrim,
  close button). Same nav + secured footer. Closes on item click / scrim tap. Targets ≥44px.

---

## C. Tenant app screens

### C1. Dashboard — `dashboard.html` 🟢
Route: `(tenant)/dashboard/page.tsx`. ADMIN_KLIENTA lands here, never a blank page.
- "Witaj w HRobot, {tenant}!" (Cabinet) + subhead.
- **3 quick-action cards** (line icon, title, desc, "Przejdź →"): Dodaj pracownika · Skonfiguruj
  grafik · Zaproś użytkowników. Icons are hairline tiles, **not** icons-in-colored-circles.
- **Pierwsze kroki** checklist (3 items, mono `0/3 ukończono`, teal progress) bound to
  `tenants.onboarding_checklist`.
- 🔒 **Ochrona danych** panel: Izolowana baza danych (DB-per-tenant), Szyfrowanie PESEL (AES-256-GCM),
  Niezmienny dziennik audytu (append-only), Rotacja tokenów (RODO), Region EU-Central. This module
  is the felt identity — keep it on the dashboard.

### C2. Pracownicy — list — `employees.html` 🟢
Route: `(tenant)/pracownicy/page.tsx`. Proof-of-stack: real `GET /api/employees`.
- Page header: "Pracownicy" (Cabinet) + `N osób · M jednostek`; search; teal "Dodaj pracownika".
- **Table:** mono uppercase headers; columns Pracownik (avatar+name+email), Stanowisko, Jednostka,
  Typ (badge), 🔒 **PESEL** (mono masked `•••••••4821` — plaintext never rendered), Status
  (`Aktywny` green / `Urlop` amber). Hairline rows, tabular-nums, row hover.
- 1280 = table; 768/375 = stacked cards.

### C3. Pracownicy — empty state — `employees-empty.html` 🟢
- `.empty`: icon tile + "Brak pracowników" + "Dodaj pracowników, aby zacząć planować grafiki i
  obsługiwać wnioski urlopowe. PESEL jest szyfrowany automatycznie." + primary "Dodaj pracownika"
  + ghost **disabled** "Importuj z CSV / wkrótce" (`title="Dostępne wkrótce"`, `aria-disabled`).
  Not "No items found."

### C4. Pracownik — detail — `employee-detail.html` 🟢
Route: `pracownicy/[id]/page.tsx`. ADMIN_KLIENTA / HR arrive from the C2 table.
- **Layout:** two-column — a **sticky identity pane** (`.idcard`: avatar, name, status, kontakt,
  masked PESEL reference, `Dane szyfrowane · EU` chip) + a right column of **anchored sections**
  (`.anchorbar` → Dane / Umowa / Grafik / Wnioski / Dziennik). The breadcrumb names the person.
- 🔒 **Sensitive data (RODO):** PESEL is masked everywhere; a **single reveal owner** lives in the
  Dane section (`Ujawnij i zapisz wpis`) — the identity pane shows only a masked reference and points
  to it. The reveal states its consequence before action ("zapisze wpis: imię, czas, adres IP") and
  writes an `audit_log` row. Plaintext PESEL is never rendered until an audited, time-limited reveal.
- 🔒 **Dziennik audytu (grafted from variant E):** the closing section is a semantic `<ol>` audit
  timeline (mono timestamps, actor, IP); the most recent `Ujawniono PESEL` event is highlighted.
  Closes the trust loop: reveal → logged → visible. `Pełny dziennik →` leads to the filterable view.
- **Sections:** Dane podstawowe (`.fields` + reveal), Umowa, Grafik (wzorzec / wymiar / okres /
  przełożony), Wnioski (`.req` rows with `.badge` status). Built on `.card`/`.field`/`.badge` plus the
  new `.idcard` / `.anchorbar` / `.sec-block` / `.tl` components in [`mockups/detail.css`](mockups/detail.css).
- **Provenance:** chosen via `/design-shotgun` (14 variants over 2 rounds) → base **B** (sticky identity
  + anchored sections) grafted with **E** (audit log); a codex outside-voice review was folded in
  (Grafik gap, PESEL de-dup, explicit reveal consequence, mono contrast, person breadcrumb, semantic `<ol>`).
- **Build notes (codex-flagged, address at implementation):** real scroll-spy + `aria-current` on the
  anchor nav; visible focus rings + ≥44px targets on reveal/edit/tabs/menu; responsive (desktop sticky
  pane → tablet summary row → mobile collapsible summary + overflow anchor nav + single column); runtime
  states (`Brak danych`, `Nie masz uprawnień`, loading skeleton, failed audit-write, archived/terminated);
  section-level edit affordances (`Edytuj dane` / `Edytuj umowę` / `Dodaj aneks`); a reveal confirmation
  modal; the full filterable audit view behind `Pełny dziennik`.

### C5. Stubs — Grafik · Wnioski · Dostępy · Ustawienia ⚪
Routes under `(tenant)/`. Each is a "visible future intent" stub: page header + a single `.empty`
(or `.card`) with one line of Polish copy and, where relevant, the disabled-CTA pattern. Never a
blank page or "404 / coming soon" raw text. `Wnioski` shows the same count as the nav tag.

### C6. Użytkownicy (ADMIN_KLIENTA) ⚪
Route: `ustawienia/uzytkownicy`. `.table`: user, email, role badge(s) (Pracownik/Manager/HR/Admin
klienta), status, invite action. Reuses C2 table patterns; role chips use `.badge-role`.

---

## D. System states (build to these)

| State | Treatment |
|---|---|
| Loading (table/list) | `.card` skeleton rows (hairline shimmer), never a bare spinner |
| Empty (any module) | `.empty` pattern (C3) with module-specific copy + primary CTA |
| Error / 503 suspended | Centered `.card` on canvas: "Konto zawieszone" + support contact; no teal |
| 403 cross-tenant | Minimal "Brak dostępu" card; mono `tenant: {slug}`; link back to own space |
| Form errors | Inline `.input.err` + `.hint.err`; server errors as a card-top banner |
| Disabled / soon | Ghost button + `wkrótce` badge + tooltip + `aria-disabled` (C3 pattern) |

---

## E. Component kit — refit checklist

Re-skin the migrated demo components to the [`system.css`](mockups/system.css) tokens (do **not**
migrate verbatim):

- [ ] **Button** — teal primary (no gradient), hairline ghost, mono-label system variant, `nowrap`,
      disabled state, focus ring `rgba(12,143,163,.14)`.
- [ ] **Card** — warm surface + 1px `--line` + `--shadow-sm`; remove all `backdrop-blur`.
- [ ] **Badge** — mono uppercase; `role` / `ok` / `warn` semantic variants.
- [ ] **Input** — label-above, teal focus, `.ok`/`.err`; kill placeholder-as-label.
- [ ] **Modal** — warm card, hairline, navy scrim `rgba(8,16,28,.55)`; no glass.
- [ ] **SlugInput** — mono preview + debounced availability (A1).
- [ ] **Password strength** — 3-segment bar (A1).
- [ ] **Table** — mono headers, hairline rows, tabular-nums, mono ID/PESEL (C2).
- [ ] **EmptyState** — icon tile + heading + body + primary/secondary CTA (C3).
- [ ] **ProvisioningStatus** — mono pipeline + benefit copy (A2).
- [ ] **Secured chip / Ochrona danych** — the reusable trust markers (B2, C1).
- [ ] **Sidebar / TopBar** — grouped nav, mono labels, secured topbar, mobile drawer (B1–B3).

## F. Accessibility (carry from Foundation spec §7)

`<label for>` on all inputs · progressbar ARIA on provisioning · touch targets ≥44px · WCAG 2.1 AA
contrast (verify teal-on-navy and warn/amber) · SkipLink on authenticated pages · visible focus
rings everywhere (teal).
