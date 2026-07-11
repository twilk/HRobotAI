"""Keycloak bearer auth for the ``/agent/*`` surface.

Verifies the incoming JWT against the caller's realm JWKS and derives the **tenant slug from the
token issuer** (``iss`` → ``…/realms/hrobot-<slug>``), matching how ``tenant-runtime`` resolves the
tenant. Handlers must trust this value, never a ``tenantId`` supplied in the request body/query —
that is the M2 tenant-isolation fix (AG6): any authenticated caller could otherwise read or mutate
another tenant's learning state.

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

# Base Keycloak URL is only used as a sanity anchor for logging; the realm issuer inside the token is
# the authority we actually fetch keys from (a token's ``iss`` is the realm base).
_KC = os.environ.get("KEYCLOAK_URL", "http://keycloak:8080").rstrip("/")
_ISS_RE = re.compile(r"/realms/hrobot-(?P<slug>[a-z0-9-]+)$")

# realm-issuer -> JWKS document. Simple process-lifetime cache (Keycloak key rotation is rare and a
# restart re-primes it); kept module-level so it survives across requests.
_jwks_cache: dict[str, dict] = {}


def _jwks(realm_iss: str) -> dict:
    """Return (and memoise) the JWKS document for a realm issuer URL."""
    cached = _jwks_cache.get(realm_iss)
    if cached is None:
        cached = httpx.get(
            f"{realm_iss}/protocol/openid-connect/certs", timeout=5
        ).json()
        _jwks_cache[realm_iss] = cached
    return cached


def require_tenant(authorization: str = Header(default="")) -> str:
    """FastAPI dependency: authenticate the bearer token and return the caller's tenant slug.

    * 401 — no/invalid bearer token or a token that fails signature/claims verification.
    * 403 — a validly-signed token whose issuer is not an ``hrobot-<slug>`` realm.
    """
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[7:].strip()
    try:
        unverified = jwt.get_unverified_claims(token)
        iss = unverified["iss"]
        claims = jwt.decode(
            token, _jwks(iss), algorithms=["RS256"], options={"verify_aud": False}
        )
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")
    m = _ISS_RE.search(claims.get("iss", ""))
    if not m:
        raise HTTPException(status_code=403, detail="issuer is not an hrobot realm")
    return m.group("slug")
