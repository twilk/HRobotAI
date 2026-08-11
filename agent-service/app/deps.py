"""Keycloak bearer auth for the ``/agent/*`` surface.

Verifies the incoming JWT against the caller's realm JWKS and derives the **tenant slug from the
token issuer** (``iss`` → ``…/realms/hrobot-<slug>``), matching how ``tenant-runtime`` resolves the
tenant. Handlers must trust this value, never a ``tenantId`` supplied in the request body/query —
that is the M2 tenant-isolation fix (AG6): any authenticated caller could otherwise read or mutate
another tenant's learning state.

TRUSTED ISSUERS (track J). The JWKS address is derived from ``iss``, which at that point is still an
UNVERIFIED, caller-supplied string. Left unchecked that is a full authentication bypass: an attacker
signs a token with their own RSA key, serves a JWKS on a host they control, sets
``iss = https://their-host/realms/hrobot-<any-tenant>``, and the service fetches their key and
confirms their own signature — then reads a tenant slug out of that same issuer. The outbound fetch
to an attacker-chosen address is an SSRF on top. So ``iss`` is matched against a server-side
allowlist of issuer bases BEFORE any network call, and the verified ``iss`` is pinned back to the
same value via ``jwt.decode(issuer=…)``. This mirrors FIX-P3-1 in
``apps/tenant-runtime/src/tenant-runtime/keycloak/keycloak-jwt.strategy.ts``, which fixed the same
bug on the TypeScript side; the Python services had not received the equivalent guard.

The JWKS per realm is fetched once and cached. Signature verification is delegated to ``python-jose``
(``RS256``); ``verify_aud`` is disabled because the agent-service is not itself an audience of the
Keycloak access token (same posture as tenant-runtime's resource-server check).
"""

from __future__ import annotations

import os
import re

import httpx
from fastapi import Header, HTTPException
from jose import jwt

# Issuer must be exactly a trusted base plus a single realm segment. Anchored on purpose: a bare
# ``startswith`` would admit ``http://keycloak:8080.zlosliwy.example/…`` and path traversal such as
# ``…/realms/hrobot-x/../../evil``.
_REALM_TAIL_RE = re.compile(r"^/realms/[A-Za-z0-9_-]+$")
_ISS_RE = re.compile(r"/realms/hrobot-(?P<slug>[a-zA-Z0-9_-]+)$")

# realm-issuer -> JWKS document. Simple process-lifetime cache (Keycloak key rotation is rare and a
# restart re-primes it); kept module-level so it survives across requests.
_jwks_cache: dict[str, dict] = {}


def _trusted_bases() -> tuple[str, ...]:
    """Issuer base URLs whose JWKS we are willing to fetch, most specific config first.

    ``KEYCLOAK_TRUSTED_ISSUERS`` is a comma-separated list because one Keycloak legitimately stamps
    more than one issuer. A realm with ``frontendUrl`` pinned (the seeded ``hrobot-staging`` demo
    realm pins ``http://keycloak:8080``) always issues that address, while a realm without one
    issues whatever host the caller reached it through — the browser sees ``http://localhost:8081``,
    compose-internal callers see ``http://keycloak:8080``. A single-valued setting cannot cover a
    deployment that has both.

    Falls back to the addresses the project already configures, so the default compose setup keeps
    working with no new variable: ``KEYCLOAK_URL`` (compose sets ``http://keycloak:8080``) plus the
    optional ``KEYCLOAK_PUBLIC_URL`` for the externally-reachable address, when set.

    Read per call rather than at import so the value can be changed without rebuilding the image and
    so tests can exercise several configurations; the parsing is a string split on a cached env dict.
    """
    raw = os.environ.get("KEYCLOAK_TRUSTED_ISSUERS", "")
    if not raw.strip():
        raw = ",".join(
            filter(
                None,
                [
                    os.environ.get("KEYCLOAK_URL", "http://keycloak:8080"),
                    os.environ.get("KEYCLOAK_PUBLIC_URL", ""),
                ],
            )
        )
    bases = (b.strip().rstrip("/") for b in raw.split(","))
    # dict.fromkeys de-duplicates while preserving order (KEYCLOAK_URL may equal the public URL).
    return tuple(dict.fromkeys(b for b in bases if b))


def _trusted_issuer(iss: str) -> bool:
    """True only for ``<trusted base>/realms/<realm>`` — nothing else may drive a key fetch."""
    if not isinstance(iss, str):
        return False
    for base in _trusted_bases():
        if iss.startswith(base) and _REALM_TAIL_RE.match(iss[len(base) :]):
            return True
    return False


def _jwks(realm_iss: str) -> dict:
    """Return (and memoise) the JWKS document for a realm issuer URL.

    Re-checks the allowlist rather than trusting its caller: this function turns a string into an
    outbound request, so it owns the guarantee that the string was vetted.
    """
    if not _trusted_issuer(realm_iss):
        raise ValueError("refusing to fetch JWKS from an untrusted issuer")
    cached = _jwks_cache.get(realm_iss)
    if cached is None:
        cached = httpx.get(
            f"{realm_iss}/protocol/openid-connect/certs", timeout=5
        ).json()
        _jwks_cache[realm_iss] = cached
    return cached


def require_tenant(authorization: str = Header(default="")) -> str:
    """FastAPI dependency: authenticate the bearer token and return the caller's tenant slug.

    * 401 — no/invalid bearer token, an issuer outside the trusted allowlist, or a token that fails
      signature/claims verification.
    * 403 — a validly-signed token from a trusted issuer whose realm is not ``hrobot-<slug>``.
    """
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[7:].strip()

    try:
        iss = jwt.get_unverified_claims(token).get("iss")
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")

    # Nothing below this line may run for an unknown issuer — in particular no network call.
    if not _trusted_issuer(iss):
        raise HTTPException(status_code=401, detail="untrusted token issuer")

    try:
        # issuer=iss pins the verified claim to the value we just vetted, so a token cannot carry
        # one issuer past the allowlist and a different one into the slug derivation below.
        claims = jwt.decode(
            token,
            _jwks(iss),
            algorithms=["RS256"],
            issuer=iss,
            options={"verify_aud": False},
        )
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")

    m = _ISS_RE.search(claims.get("iss", ""))
    if not m:
        raise HTTPException(status_code=403, detail="issuer is not an hrobot realm")
    return m.group("slug")
