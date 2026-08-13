"""Test auth kit — a throwaway RSA keypair plus helpers to mint realm-issuer JWTs.

``app.deps.require_tenant`` verifies the bearer token against a realm's JWKS (fetched via
``app.deps._jwks``) and derives the tenant slug from the ``iss`` claim. In tests we point ``_jwks`` at
:data:`TEST_JWKS` (see ``conftest``) and hand out tokens signed by this in-process key, so the real
verification path runs without a live Keycloak.
"""

from __future__ import annotations

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwk, jwt

KC_URL = "http://keycloak:8080"


def _keypair() -> tuple[str, str]:
    """A throwaway RSA keypair as (private PEM, public PEM)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    pub = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    return priv, pub


_PRIV_PEM, _PUB_PEM = _keypair()

# The JWKS document tests point app.deps._jwks at — the public half of the key above.
TEST_JWKS = {"keys": [jwk.construct(_PUB_PEM, "RS256").to_dict()]}

# ---------------------------------------------------------------------------
# Attacker material — a SECOND, unrelated keypair (track J).
#
# The JWKS-from-unverified-iss bug is only demonstrable with a key our Keycloak has never seen: the
# attacker signs a token with `_ATT_PRIV_PEM`, publishes :data:`ATTACKER_JWKS` on a host they own,
# and puts that host in `iss`. A service that resolves its verification key from the token's own
# `iss` will happily confirm the attacker's signature. See tests/test_auth_issuer.py.
# ---------------------------------------------------------------------------
_ATT_PRIV_PEM, _ATT_PUB_PEM = _keypair()

#: JWKS an attacker-controlled host would serve — the public half of a key WE never issued.
ATTACKER_JWKS = {"keys": [jwk.construct(_ATT_PUB_PEM, "RS256").to_dict()]}

#: A realm on a host the attacker owns; the tail still looks like a legitimate tenant realm.
EVIL_ISS = "https://zlosliwy.example/realms/hrobot-victim"


def realm_iss(tenant: str) -> str:
    return f"{KC_URL}/realms/hrobot-{tenant}"


def make_token(tenant: str = "demo-tenant", iss: str | None = None) -> str:
    """A validly-signed RS256 token whose issuer is the given tenant's realm (or a raw ``iss``)."""
    claims = {"iss": iss if iss is not None else realm_iss(tenant), "sub": "test-user"}
    return jwt.encode(claims, _PRIV_PEM, algorithm="RS256")


def auth(tenant: str = "demo-tenant", iss: str | None = None) -> dict[str, str]:
    """Authorization header carrying a token for ``tenant`` (or raw ``iss``)."""
    return {"Authorization": f"Bearer {make_token(tenant, iss)}"}


def make_attacker_token(iss: str = EVIL_ISS) -> str:
    """A well-formed RS256 token signed by a key Keycloak never issued.

    It verifies ONLY against :data:`ATTACKER_JWKS` — i.e. only if the service can be talked into
    fetching its verification key from the host named in this token's own ``iss``.
    """
    return jwt.encode({"iss": iss, "sub": "attacker"}, _ATT_PRIV_PEM, algorithm="RS256")
