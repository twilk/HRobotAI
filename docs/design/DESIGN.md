# Design System — HRobot.AI

> **Status:** Proposed (design planning). Supersedes the glassmorphism / Navy-Cyan / Inter
> direction described in `docs/superpowers/specs/2026-05-27-hrobot-foundation-design.md`
> §7 ("Design system migration"). When the Foundation sub-project is implemented, this
> document is promoted to the repo-root `DESIGN.md` and the demo migration adopts these tokens.
>
> **Direction chosen:** *Refit for EU-trust* — keep the Navy brand anchor, retire glassmorphism
> and Inter, build a distinctive, secure, EU-grade system. Core impression: **RODO-native,
> EU-trust**. Canonical token + component source: [`mockups/system.css`](mockups/system.css).

---

## 1. Product Context

- **What this is:** Multi-tenant SaaS HR/workforce platform for the Polish market (kadry,
  grafiki, wnioski, dostępy), built on physically isolated per-tenant infrastructure.
- **Who it's for:** Client admins, HR, managers, and employees at SMB/enterprise companies;
  plus HRobot SaaS operators (global admins).
- **Space:** Polish/EU HR-tech. Buyers are sensitive to data protection (RODO/GDPR) and EU
  data residency.
- **Project type:** Data-dense web application (dashboard + tables + forms) plus a small set
  of marketing/auth surfaces (signup, provisioning, login).
- **The one memorable thing:** *"My data is physically protected and stays in the EU."*
  Every screen earns trust through precision and visible security, not decoration.

## 2. Why we moved off the demo look (anti-slop rationale)

The migrated demo used **glassmorphism + Navy `#0B1F3B` + Cyan `#00C1D4` + Inter**. That
exact combination is the most common output of AI design tools, so it reads as generated,
and frosted glass actively hurts a data-dense HR tool (tables, schedules, forms). We keep
the Navy brand equity and discard the three slop signals:

| Slop signal | Replaced with |
|---|---|
| Glassmorphism / `backdrop-blur` everywhere | Structure: hairline borders + restrained elevation |
| Inter (convergence font) | Cabinet Grotesk + General Sans + IBM Plex Mono |
| Neon cyan `#00C1D4` as a splash | Signal teal `#0C8FA3`, used sparingly + verified green |
| Cold white surfaces | Warm parchment canvas `#F6F4EE` |

## 3. Aesthetic Direction

- **Direction:** Secure operations console with editorial warmth. Precise, calm, trustworthy.
- **Decoration level:** Intentional (not minimal, not expressive). Decoration is reserved for
  brand moments and never sits behind data.
- **Mood:** "Serious software that quietly protects you." Confident, institutional, human.
- **The trust motif (RODO made visible):** a **mono "machine/security" layer** (slugs, IDs,
  crypto specs, region, role tags in IBM Plex Mono), the **Ochrona danych** module (DB-per-tenant,
  AES-256-GCM, immutable audit, EU region shown as live receipts), `Sesja szyfrowana` chips,
  and a faint **engraved guilloché line texture** (`.motif` / `.motif-navy`) reserved for auth
  and provisioning.

## 4. Typography

All three faces are free and CDN-loaded. **Never** use Inter, Roboto, system-ui, or Space
Grotesk as display/body.

| Role | Font | Weights | Notes |
|---|---|---|---|
| Display / headlines | **Cabinet Grotesk** | 700, 800 | Editorial confidence; `letter-spacing:-.02em` |
| UI / body | **General Sans** | 400, 500, 600 | Legible, more character than Inter |
| Machine / security layer | **IBM Plex Mono** | 400, 500 | Slugs, IDs, PESEL mask, crypto, region, role tags, group labels |

**Loading:**
```html
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700&f[]=general-sans@400,500,600&display=swap" rel="stylesheet" />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
```
> Production: self-host via `next/font` (Cabinet Grotesk + General Sans from Fontshare/ITF,
> IBM Plex Mono from Google) to remove the runtime CDN dependency and pin versions.

**Scale (px):** display 30/26/23/21 · h-section 16 · body 14.5 · small 13 · mono-label 10.5–12.
Group/nav labels: 10.5px mono, uppercase, `letter-spacing:.14em`.

## 5. Color

Approach: **restrained/balanced**. Navy anchors, neutrals are warm, teal is a sparing signal,
green means verified/secure. (Hex values are canonical in `mockups/system.css` `:root`.)

| Token | Hex | Usage |
|---|---|---|
| `--navy` | `#0B1F3B` | Brand anchor: sidebar, auth field, wordmark |
| `--navy-700` | `#15355C` | Raised navy (mark gradient, avatars) |
| `--ink` | `#101A2B` | Primary text on light |
| `--muted` / `--muted-2` | `#5B6B82` / `#8A97A8` | Secondary / tertiary text |
| `--canvas` | `#F6F4EE` | Warm parchment app/page background |
| `--card` / `--card-2` | `#FFFFFF` / `#FBFAF6` | Surfaces |
| `--line` / `--line-strong` | `#E7E4DA` / `#D9D5C8` | Warm hairlines / borders |
| `--accent` | `#0C8FA3` | Signal teal: primary CTA, active nav, focus, links |
| `--accent-ink` | `#0A7B8C` | Teal hover / text-on-light |
| `--accent-navy` | `#3CC3D6` | Teal that reads on navy |
| `--verified` | `#2E9E6B` | Compliance / secure / success states |
| `--warn` | `#B8791F` | Attention (e.g. "Urlop") |
| `--error` | `#C2443B` | Errors, destructive |

**Contrast:** body and UI text meet WCAG 2.1 AA on `--canvas`/`--card`. Teal `--accent` is used
for fills and focus rings, not for small body text on light (use `--accent-ink` for text).
**Dark mode:** out of scope for Foundation (Navy shell is fixed); the warm-neutral system has a
clear dark path later (raise navy surfaces, drop saturation 10–20%).

## 6. Spacing, Radius, Elevation

- **Base unit:** 4px. Density: comfortable (app), spacious (auth/marketing).
- **Radius:** `--r-sm` 6 (inputs/buttons) · `--r-md` 10 · `--r-lg` 14 (cards) · `--r-pill` 999.
  Hierarchical, never uniform-bubble.
- **Elevation (no glass):** `--shadow-sm` for resting cards; `--shadow` on hover/raised;
  `--shadow-lift` for auth cards. Always paired with a 1px warm border.

## 7. Layout

- **Approach:** hybrid. Grid-disciplined for the app (sidebar 268px + fluid main, `--wrap` 1120
  max); editorial/centered for auth and provisioning.
- **Hierarchy:** left-aligned, asymmetric. Never centered-everything.
- **App shell:** navy rail (grouped nav, mono group labels, teal active left-border, EU-region
  footer) + sticky topbar (page crumb, `Sesja szyfrowana` chip, notifications, user + role).
- **Responsive:** 375 drawer / 768 sidebar / 1280 table view. Touch targets ≥ 44px.

## 8. Motion

- **Approach:** minimal-functional with a few intentional "verification" moments.
- **Easing:** `--ease cubic-bezier(.2,.7,.3,1)`. **Durations:** micro 120ms · short 150–250ms.
- **Signature:** the provisioning active-step pulse (`@keyframes pulse`), card hover lift (2px),
  focus-ring grow. No bounce, no scroll-jacking, no decorative loops.

## 9. Anti-slop guardrails (hard rules)

Never ship: glassmorphism / `backdrop-blur`; Inter / Roboto / system-ui / Space Grotesk as
display or body; neon-cyan splashes; purple/violet gradients; gradient CTAs; 3-column
icon-in-colored-circle grids; centered-everything; uniform bubble-radius; stock-photo heroes;
"Built for X / Designed for Y" copy. In QA, flag any code that violates these or drifts from
the tokens here.

## 10. Component Inventory

Canonical classes live in [`mockups/system.css`](mockups/system.css).

| Component | Class(es) | Refit notes |
|---|---|---|
| Button | `.btn` `.btn-primary` `.btn-ghost` | Solid teal primary (no gradient); ghost = hairline; `nowrap`; optional mono label for system actions; disabled = 50% + `not-allowed` |
| Card | `.card` | Warm surface, 1px `--line`, `--shadow-sm`; no glass |
| Badge | `.badge` `.badge-role` `.badge-ok` `.badge-warn` | Mono uppercase; semantic color set for status |
| Secured chip | `.chip-secured` | Reusable RODO/encryption trust marker |
| Input | `.input` + `.field` | Label-above (no placeholder-as-label); teal focus ring; `.ok`/`.err` states |
| SlugInput | `.field-ico` + `.slug-prev` | Mono live preview `slug.hrobot.ai` + debounced availability (green check / red X) |
| Password strength | `.pwbar` | 3-segment bar (red 0–1 / amber 2 / green 3–4) |
| Table | `.table` | Mono uppercase headers, hairline rows, tabular-nums, mono ID/masked-PESEL columns |
| EmptyState | `.empty` | Icon tile + heading + body + primary/secondary CTA (disabled w/ tooltip pattern) |
| ProvisioningStatus | `.steps`/`.step`/`.node` | Mono pipeline (CREATE_DB→DONE), verified checks, active pulse, benefit copy |
| App shell | `.shell`/`.rail`/`.topbar` | Navy rail + warm main; grouped nav; secured topbar |
| Mark + wordmark | `.mark`/`.wordmark` | Precise "node" glyph (rounded square + teal dot) + Cabinet wordmark |

New Foundation components inherit these: `SignupForm`, `SlugInput`, `ProvisioningStatus`,
`WelcomeDashboard`, `EmptyState`, `EmployeeDetail` (IdentityPane + AnchoredSections + AuditTimeline,
see `mockups/detail.css`). Migrated demo components (Button, Card, Badge, Input, Modal,
Sidebar, TopBar) are **re-skinned to these tokens**, not migrated verbatim.

## 11. Keycloak theme

The Keycloak realm login/first-password screens use a FreeMarker theme that mirrors `signup`
exactly (navy + `.motif-navy` + crafted card + Cabinet wordmark + General Sans + teal CTA +
mono `realm: hrobot-{slug}` note). First login is unmistakably HRobot, not default Keycloak.

## 12. Mockups (rendered proof)

`docs/design/mockups/` — open `index.html` (served via the `design-mockups` launch config):
`dashboard` · `signup` · `provisioning` · `employees` · `employees-empty` · `mobile` ·
`keycloak-login` · `employee-detail`. These are production-portable HTML/CSS against `system.css`
(the `employee-detail` screen adds `mockups/detail.css` for its identity-pane, anchored-section and
audit-timeline components).

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-01 | Refit, keep Navy brand | Escape AI-slop signals while preserving brand equity (user D1) |
| 2026-06-01 | Core impression = RODO-native EU-trust | Strongest market wedge; aligns with isolation architecture (user D2) |
| 2026-06-01 | Cabinet Grotesk / General Sans / IBM Plex Mono | Distinctive, non-Inter; mono encodes the security/automation identity |
| 2026-06-01 | Warm parchment canvas, structure over glass | Humanises EU-trust; data-dense legibility; retires glassmorphism |
| 2026-06-01 | Supersede Foundation §7 demo migration | Demo design is re-skinned to these tokens, not adopted verbatim |
