# HRobot — Keycloak login theme

A login theme that puts the HRobot **"Refit for EU-trust"** design system ([/DESIGN.md](../../../DESIGN.md))
onto Keycloak's first-login / sign-in / password screens, so auth feels like HRobot, not stock Keycloak.
Matches the auth mockup ([../mockups/keycloak-login.html](../mockups/keycloak-login.html)) and the
web-kit auth screens.

It's a **CSS overlay** on the stock `keycloak` login theme (no FreeMarker template overrides), so it
survives Keycloak upgrades: navy + engraved-motif background, warm crafted card (no glass), teal CTA,
Cabinet Grotesk / General Sans / IBM Plex Mono.

```
keycloak-theme/
└── login/
    ├── theme.properties              # parent=keycloak; loads css/login.css + css/hrobot.css
    └── resources/css/hrobot.css      # the HRobot overrides
```

## Deploy
1. Copy this folder into Keycloak as a theme named `hrobot`:
   `cp -r keycloak-theme  $KEYCLOAK_HOME/themes/hrobot`  (so `themes/hrobot/login/...`).
   In containers: bind-mount or bake it into the image at `/opt/keycloak/themes/hrobot`.
2. Set the realm's **Login theme** to `hrobot`: Admin Console → Realm settings → Themes,
   or via the Admin REST API in the `KEYCLOAK_SETUP` provisioning step (per the Foundation spec).
3. Dev: disable theme caching so edits show immediately — `KC_SPI_THEME_CACHE_THEMES=false`
   (or `--spi-theme-cache-themes=false`).

## ⚠ Validate against your Keycloak version (not tested live here)
This CSS was authored from the design system and is **not yet tested against a running Keycloak**.
Check it against your version before shipping:
- **Classic `keycloak`** (PatternFly 3: `.btn-primary`, `.form-control`, `.login-pf-page .card-pf`) —
  what `theme.properties` targets by default. Should mostly "just work".
- **`keycloak.v2`** (PatternFly 5: `.pf-v5-c-button`, `.pf-v5-c-form-control`, `.pf-v5-c-login__main`) —
  newer default. `hrobot.css` includes some v5 selectors, but switch `parent=keycloak.v2` and verify the
  card/button/input classes match your build.

## Follow-ups for full branding (out of CSS-only scope)
- **Wordmark / logo:** CSS can't replace the realm-name text or inject the brand mark. For the full
  HRobot wordmark, add an `img/` asset + a small `login/login.ftl` (or `template.ftl`) override.
- **Air-gapped Keycloak:** vendor the woff2 into `login/resources/fonts/` and replace the `@import`
  font lines in `hrobot.css` with `@font-face` (relative URLs).
