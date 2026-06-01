# HRobot web-kit — portable Next.js + Tailwind components

Production React/Tailwind implementation of the HRobot design system
([`../DESIGN.md`](../DESIGN.md)), derived 1:1 from the rendered-verified mockups in
[`../mockups/`](../mockups/). Drop these into the Foundation `apps/web` (Next.js 16 App
Router). Server Components by default; only `mobile-drawer`, `slug-input`,
`password-strength`, and `signup-form` are client components.

> **Verification:** every file here is syntax-checked with esbuild. It is **not** compiled in
> this docs repo (there is no Next.js project here) — type-checking happens when you integrate
> it into `apps/web` with the deps + tsconfig path alias below. The visuals are proven by the
> mockups this was ported from.

## Integrate into apps/web

1. **Copy** preserving paths:
   - `app/globals.css`, `app/fonts.ts`, `tailwind.config.ts`
   - `lib/cn.ts`, `lib/nav.ts`
   - `components/**`
   - example pages: `app/(tenant)/dashboard/page.tsx`, `app/(marketing)/signup/page.tsx`
2. **Dependencies:** `pnpm add clsx tailwind-merge` (and `tailwindcss postcss autoprefixer` if
   not present). Optional: `pnpm add zxcvbn` to replace the demo heuristic in `password-strength.tsx`.
3. **Path alias** — `tsconfig.json` (Next default):
   ```json
   { "compilerOptions": { "paths": { "@/*": ["./*"] } } }
   ```
4. **Fonts** — download the Fontshare woff2 into `app/fonts/` (free, ITF license):
   `CabinetGrotesk-Bold.woff2`, `CabinetGrotesk-Extrabold.woff2`,
   `GeneralSans-Regular.woff2`, `GeneralSans-Medium.woff2`, `GeneralSans-Semibold.woff2`.
   IBM Plex Mono loads from `next/font/google` (no files). Wire the variables onto `<html>`:
   ```tsx
   // app/layout.tsx
   import './globals.css'
   import { fontVars } from './fonts'

   export default function RootLayout({ children }: { children: React.ReactNode }) {
     return (
       <html lang="pl" className={fontVars}>
         <body>{children}</body>
       </html>
     )
   }
   ```
   No woff2 yet? Temporary fallback: load Cabinet Grotesk + General Sans from the Fontshare CDN
   via a `<link>` (as the mockups do) and set `font-display`/`font-sans` to those names.
5. **Tailwind** — `tailwind.config.ts` here is **v3** (matches the Foundation spec). On Tailwind
   v4, port the `theme.extend` values into an `@theme` block in CSS — the token values are identical.
6. **Wire real data** — the example pages use placeholder identity. Replace with the Auth.js
   session + tenant context:
   ```ts
   const session = await auth()
   const tenant  = await getTenantForRequest() // from x-tenant-id header
   const roles   = session.user.roles as Role[]
   ```
   Endpoints the client components expect:
   - `GET /api/slugs/check/{slug}` → `{ available: boolean }`
   - `POST /api/auth/signup` → `202 { jobId }` (redirects to `/signup/status?job=…`) or `409`

## File map

| Path | What |
|---|---|
| `tailwind.config.ts` | Design tokens (colors, fonts, radius, shadow, animation) |
| `app/globals.css` | Base layer + the engraved `motif-navy` / `motif-brand` utilities |
| `app/fonts.ts` | `next/font` setup (Cabinet Grotesk, General Sans, IBM Plex Mono) |
| `lib/cn.ts` | `cn()` class-merge helper |
| `lib/nav.ts` | Typed nav config + `visibleGroups(roles)` RBAC filter |
| `components/icons.tsx` | Hoisted line-icon set (decorative, `aria-hidden`) |
| `components/ui/*` | Button, Card, Badge, Input + Field, SecuredChip, BrandMark + Wordmark |
| `components/layout/*` | Sidebar, TopBar, AppShell, MobileNav (drawer) |
| `components/dashboard/*` | QuickActions, SetupChecklist, DataProtectionPanel |
| `components/auth/*` | SlugInput, PasswordField, SignupForm |
| `app/(tenant)/dashboard/page.tsx` | Dashboard, composed (Server Component) |
| `app/(marketing)/signup/page.tsx` | Signup (Server shell + client form) |

## Not yet ported (do the same way)

Provisioning status (mono pipeline), the employees table + empty state, mobile drawer page, and
the Keycloak FreeMarker theme exist as mockups in [`../mockups/`](../mockups/). Port them with the
same primitives (`Card`, `Badge`, `Table` pattern, `AppShell`, `motif-navy`).

## Guardrails

Keep the [`../DESIGN.md`](../DESIGN.md) anti-slop rules: no glassmorphism, no Inter/system-ui as
display/body, no neon cyan, no gradient CTAs, no centered-everything, no icon-in-colored-circle
grids. Teal is a sparing signal; green means verified; mono is the machine/security layer.
