// Product usage events, emitted from the ONE place every screen and every BFF call already passes
// through: the session gate in middleware.ts.
//
// WHY. The product had no instrumentation of any kind — no posthog/mixpanel/amplitude/gtag anywhere
// in the repo — so nobody could say which of the fourteen tenant screens is opened and which is
// decoration. Fourteen screens were built and shipped on the assumption that all fourteen matter.
//
// WHY NOT AN ANALYTICS SDK. This is an HR system holding Polish employees' personal data. Adding a
// third-party analytics vendor means a new data processor, a new RODO basis, and a new external host
// in the browser — the exact class of problem just removed by self-hosting the fonts. This writes one
// JSON line to stdout, which Docker already collects. No SDK, no vendor, no new egress.
//
// WHAT IS DELIBERATELY NOT RECORDED. No `sub`, no username, no display name, no IP, no user agent,
// no query string. The question being answered is "is this screen used", not "what did this person
// do" — the audit_log already exists for the latter, is append-only, and is the RIGHT place for
// person-level accountability. Recording behaviour per employee here would build a second, weaker
// surveillance trail nobody asked for.
//
// The route is NORMALISED before it is written: `/pracownicy/8f2c…` carries an employee id, which is
// itself an identifier for a natural person. Collapsing dynamic segments to `:id` keeps the metric
// (which screen) and drops the identifier (whose record).

/** One usage event. Deliberately flat and small — this is a log line, not a document. */
export interface UsageEvent {
  evt: 'app_usage'
  ts: string
  /** Keycloak realm from the token issuer — the tenant, not the person. `null` when unauthenticated. */
  tenant: string | null
  /** RBAC roles from `hrobot_roles`. A role is a category, not an identity. */
  roles: string[]
  /** `screen` = a page navigation, `api` = a BFF call. Only the gate sees both. */
  surface: 'screen' | 'api'
  route: string
  method: string
  status: number
}

/** The application's own RBAC roles. Mirrors KNOWN_ROLES in lib/session.ts. */
const APP_ROLES = new Set(['PRACOWNIK', 'MANAGER', 'HR', 'ADMIN_KLIENTA'])

/** Segments that are identifiers rather than route structure. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMERIC = /^\d+$/

/**
 * A route-shaped segment: lowercase words joined by hyphens (`grafik`, `shift-swap`,
 * `ai-grafik-manager`). Next.js route folders in this app all take this shape.
 *
 * This is an ALLOWLIST for a reason. The first version of this function collapsed any segment of 16+
 * characters from `[A-Za-z0-9_-]`, which swallowed `ai-grafik-manager` (17 chars) and reported it as
 * `:id` — merging a real screen into the identifier bucket and destroying exactly the metric this
 * module exists to produce. Caught by the "keeps real route structure" test below. Deciding what a
 * route looks like is tractable; deciding what an opaque id looks like is not.
 */
const ROUTE_WORD = /^[a-z]+(?:-[a-z0-9]+)*$/

/** Beyond this length an unrecognised segment is treated as an identifier rather than a route. */
const OPAQUE_MIN_LENGTH = 16

/**
 * Collapse identifier-bearing path segments to `:id`.
 *
 * Two failure modes, both real. Under-collapsing leaks an identifier for a natural person into the
 * log (`/pracownicy/<employee uuid>`). Over-collapsing merges two distinct screens into one row and
 * silently destroys the metric. So: keep anything that is shaped like a route, collapse uuids and
 * numbers outright, and treat anything else long enough to be a token as an id.
 */
export function normaliseRoute(pathname: string): string {
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      if (UUID.test(seg) || NUMERIC.test(seg)) return ':id'
      if (ROUTE_WORD.test(seg)) return seg
      return seg.length >= OPAQUE_MIN_LENGTH ? ':id' : seg
    })

  return '/' + segments.join('/')
}

/** Base64url-decode a JWT payload without Buffer — middleware runs on the Edge runtime. */
function decodePayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Build the event. Pure — takes what it needs and returns a value, so the whole thing is testable
 * without a request object, a clock, or a console.
 */
export function buildUsageEvent(input: {
  pathname: string
  method: string
  status: number
  token: string | undefined
  now: Date
}): UsageEvent {
  const claims = input.token ? decodePayload(input.token) : null
  const iss = typeof claims?.iss === 'string' ? claims.iss : undefined
  const realm = iss ? /\/realms\/([^/?#]+)/.exec(iss)?.[1] ?? null : null
  // Filtered to the app's OWN roles. Live traffic showed the `hrobot_roles` claim also carries
  // Keycloak's built-ins (`default-roles-<realm>`, `offline_access`, `uma_authorization`), which are
  // noise in a usage metric and data we have no reason to keep. Same allowlist as lib/session.ts.
  const roles = Array.isArray(claims?.hrobot_roles)
    ? (claims.hrobot_roles as unknown[]).filter((r): r is string => typeof r === 'string' && APP_ROLES.has(r))
    : []

  return {
    evt: 'app_usage',
    ts: input.now.toISOString(),
    tenant: realm,
    roles,
    surface: input.pathname === '/api' || input.pathname.startsWith('/api/') ? 'api' : 'screen',
    route: normaliseRoute(input.pathname),
    method: input.method,
    status: input.status,
  }
}

/**
 * Emit one line. Never throws and never awaits: the gate is on the hot path for every request, and a
 * logging failure must not turn into a failed page load.
 */
export function logUsageEvent(event: UsageEvent): void {
  try {
    console.log(JSON.stringify(event))
  } catch {
    /* metrics are best-effort; a request must never fail because of them */
  }
}
