"""Track J — the JWKS URL must come from server-side config, never from the token being verified.

THE BUG THIS PINS DOWN. ``require_tenant`` used to read ``iss`` out of an UNVERIFIED token and fetch
the signing keys from that address:

    unverified = jwt.get_unverified_claims(token)   # attacker-controlled
    claims = jwt.decode(token, _jwks(unverified["iss"]), ...)

So the material used to check a signature was chosen by whoever produced the signature. An attacker
generates their own RSA pair, serves a JWKS on a host they own, signs a token with
``iss = https://zlosliwy.example/realms/hrobot-victim`` — and the service fetches the attacker's key
and confirms the attacker's own signature. ``_ISS_RE`` then reads ``victim`` out of that issuer and
hands it back as the trusted tenant slug: full authentication bypass plus impersonation of any
tenant, and an outbound HTTP request to an address the attacker picked (SSRF) on the way.

The same class of bug was found and fixed on the TypeScript side (FIX-P3-1 in
``apps/tenant-runtime/src/tenant-runtime/keycloak/keycloak-jwt.strategy.ts``); the two Python
services never got the equivalent guard. This module is the regression net for both halves of the
fix: the token is rejected, AND it is rejected *before* any network call is made.

These tests drive ``require_tenant`` directly rather than through a TestClient, because ``conftest``
deliberately stubs ``app.deps._jwks`` for the app fixtures — and it is precisely the real ``_jwks``
path that must be exercised here.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

import app.deps as deps
from tests._authkit import (
    ATTACKER_JWKS,
    EVIL_ISS,
    KC_URL,
    TEST_JWKS,
    make_attacker_token,
    make_token,
)


@pytest.fixture(autouse=True)
def _clean_jwks_state(monkeypatch):
    """Empty the process-lifetime JWKS cache and pin the trusted base to the compose default."""
    monkeypatch.setattr(deps, "_jwks_cache", {})
    monkeypatch.setenv("KEYCLOAK_URL", KC_URL)
    monkeypatch.delenv("KEYCLOAK_TRUSTED_ISSUERS", raising=False)
    monkeypatch.delenv("KEYCLOAK_PUBLIC_URL", raising=False)


class _Tripwire:
    """Stands in for ``httpx``. Records every fetch, and serves whatever JWKS it was handed.

    Recording rather than raising is deliberate: a stub that merely explodes would be swallowed by
    ``require_tenant``'s ``except Exception`` and turned into the very 401 the test wants, so the
    test would pass against the vulnerable code. The call log is checked explicitly instead.
    """

    def __init__(self, jwks: dict):
        self._jwks = jwks
        self.calls: list[str] = []

    def get(self, url: str, **_kwargs):
        self.calls.append(url)
        jwks = self._jwks
        return type("_Resp", (), {"json": staticmethod(lambda: jwks)})()


def _install(monkeypatch, jwks: dict) -> _Tripwire:
    tripwire = _Tripwire(jwks)
    monkeypatch.setattr(deps, "httpx", tripwire)
    return tripwire


def test_token_signed_by_an_attacker_key_is_rejected(monkeypatch):
    """The exploit itself: attacker key + attacker JWKS host must NOT authenticate anyone.

    Against the vulnerable code this returns the slug ``victim`` instead of raising.
    """
    _install(monkeypatch, ATTACKER_JWKS)

    with pytest.raises(HTTPException) as exc:
        deps.require_tenant(f"Bearer {make_attacker_token()}")

    assert exc.value.status_code == 401


def test_untrusted_issuer_is_rejected_without_any_network_call(monkeypatch):
    """The SSRF half: an untrusted ``iss`` must be refused before a single byte goes out."""
    tripwire = _install(monkeypatch, ATTACKER_JWKS)

    with pytest.raises(HTTPException):
        deps.require_tenant(f"Bearer {make_attacker_token()}")

    assert tripwire.calls == [], f"fetched key material from an untrusted host: {tripwire.calls}"


def test_a_host_that_merely_starts_with_the_trusted_base_is_not_trusted(monkeypatch):
    """``iss.startswith(base)`` alone would admit ``keycloak:8080.zlosliwy.example``."""
    tripwire = _install(monkeypatch, ATTACKER_JWKS)
    lookalike = f"{KC_URL}.zlosliwy.example/realms/hrobot-victim"

    with pytest.raises(HTTPException) as exc:
        deps.require_tenant(f"Bearer {make_attacker_token(lookalike)}")

    assert exc.value.status_code == 401
    assert tripwire.calls == []


def test_a_path_suffix_on_the_trusted_base_is_not_trusted(monkeypatch):
    """Only ``<base>/realms/<realm>`` counts — no traversal, no extra path segments."""
    tripwire = _install(monkeypatch, ATTACKER_JWKS)
    traversal = f"{KC_URL}/realms/hrobot-victim/../../evil"

    with pytest.raises(HTTPException):
        deps.require_tenant(f"Bearer {make_attacker_token(traversal)}")

    assert tripwire.calls == []


def test_a_real_token_from_the_trusted_issuer_still_authenticates(monkeypatch):
    """The demo must keep working: the live realm's issuer resolves to its tenant slug."""
    tripwire = _install(monkeypatch, TEST_JWKS)

    # Verbatim shape of a live demo token's `iss`, read off Keycloak on 2026-08-03.
    slug = deps.require_tenant(
        f"Bearer {make_token(iss='http://keycloak:8080/realms/hrobot-staging')}"
    )

    assert slug == "staging"
    assert tripwire.calls == [
        "http://keycloak:8080/realms/hrobot-staging/protocol/openid-connect/certs"
    ]


def test_trusted_issuer_outside_the_hrobot_realm_pattern_is_still_403(monkeypatch):
    """Our own Keycloak, but not a tenant realm — authenticated, not authorised."""
    _install(monkeypatch, TEST_JWKS)

    with pytest.raises(HTTPException) as exc:
        deps.require_tenant(f"Bearer {make_token(iss=f'{KC_URL}/realms/master')}")

    assert exc.value.status_code == 403


def test_several_trusted_bases_can_be_configured(monkeypatch):
    """Internal and external Keycloak addresses coexist — a realm's `iss` depends on its frontendUrl.

    ``hrobot-staging`` pins ``frontendUrl=http://keycloak:8080`` so its tokens carry the internal
    address, while a realm without one carries whatever host the browser used (``localhost:8081``).
    A single-valued setting cannot cover both.
    """
    monkeypatch.setenv("KEYCLOAK_TRUSTED_ISSUERS", f"{KC_URL}, http://localhost:8081/ ")
    tripwire = _install(monkeypatch, TEST_JWKS)

    internal = f"{KC_URL}/realms/hrobot-staging"
    assert deps.require_tenant(f"Bearer {make_token(iss=internal)}") == "staging"
    external = "http://localhost:8081/realms/hrobot-4mobility"
    assert deps.require_tenant(f"Bearer {make_token(iss=external)}") == "4mobility"

    # Still nothing outside the configured bases.
    with pytest.raises(HTTPException):
        deps.require_tenant(f"Bearer {make_attacker_token(EVIL_ISS)}")
    assert all("zlosliwy.example" not in url for url in tripwire.calls)
