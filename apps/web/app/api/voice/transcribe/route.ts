// Same-origin proxy for the LOCAL speech-to-text service: POST /api/voice/transcribe →
// ${STT_SERVICE_URL}/voice/transcribe.
//
// Why a proxy rather than a direct browser call, exactly as for tenant-runtime (lib/tenant-runtime.ts):
// the Keycloak bearer stays server-side and there is no CORS surface. The STT service verifies that
// same token against the realm JWKS and derives the tenant from `iss` (stt-service/app/deps.py — the
// pattern copied from agent-service), so forwarding the bearer is all it needs.
//
// RODO: the audio is streamed straight through — this route never buffers it to disk, never logs it,
// and the STT service processes it in memory and does not persist it. Speech-to-text runs on our own
// infrastructure (faster-whisper `small`, CPU) precisely so a voice recording — personal data — never
// leaves EU infra; see docs/superpowers/specs/2026-07-21-agent-glosowy-poc.md §3.
//
// "Processes it in memory" on the STT side holds because that service (a) requires this proxy's
// Content-Length and rejects anything over STT_MAX_AUDIO_BYTES BEFORE parsing the upload, and
// (b) raises its multipart parser's in-memory ceiling to match that same limit — otherwise
// Starlette's default 1 MB per-part threshold would spool any larger, still-accepted upload to
// disk regardless of this check. See stt-service/app/main.py (`_InMemoryMultiPartParser`,
// the Content-Length guard ahead of `_parse_multipart_bounded`) — that is where the guarantee
// this comment states is actually enforced; keep the two in sync if either changes.
//
// The transcript then goes BACK to the browser and into the existing POST /api/agent-glosowy/interpret
// path. There is deliberately no intent parsing here: intent.util.ts is the single source of truth.

import { resolveAuthorization } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

/**
 * Base URL of the local STT service. Compose default; override per environment.
 *
 * 8011, NOT 8010 (finding W14). On the host, 8010 belongs to `agent-service` — it starts outside
 * docker-compose (its own `docker run` in agent-service/demo/up.sh) and the J4 demo runbook
 * documents it on that port. While this default said 8010, a voice recording was proxied to the
 * SCHEDULING agent instead of the speech service: not a connection error the user would notice,
 * but audio delivered to the wrong service. The container port stays 8010; only the host mapping
 * differs (docker-compose.yml `stt`).
 */
function sttBaseUrl(): string {
  const raw = process.env.STT_SERVICE_URL ?? 'http://localhost:8011'
  return raw.replace(/\/+$/, '')
}

export async function POST(req: Request): Promise<Response> {
  const resolved = await resolveAuthorization(req)
  if (!resolved) {
    return Response.json(
      {
        error: 'unauthenticated',
        message:
          'Brak tokenu do przekazania. Zaloguj się albo skonfiguruj zmienne KEYCLOAK_* / TENANT_RUNTIME_DEV_TOKEN.',
      },
      { status: 401 },
    )
  }

  // Forward the multipart body verbatim. `content-type` MUST be carried over untouched — it holds
  // the multipart boundary, and regenerating it would corrupt the upload.
  const contentType = req.headers.get('content-type')
  let upstream: Response
  try {
    upstream = await fetch(`${sttBaseUrl()}/voice/transcribe`, {
      method: 'POST',
      headers: {
        authorization: resolved.authorization,
        ...(contentType ? { 'content-type': contentType } : {}),
      },
      body: await req.arrayBuffer(),
      cache: 'no-store',
    })
  } catch {
    return Response.json(
      { error: 'stt_unreachable', message: 'Usługa rozpoznawania mowy jest niedostępna.' },
      { status: 503 },
    )
  }

  const body = await upstream.text()
  return new Response(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  })
}
