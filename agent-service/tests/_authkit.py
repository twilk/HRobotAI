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

_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PRIV_PEM = _key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
).decode()
_PUB_PEM = (
    _key.public_key()
    .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    .decode()
)

# The JWKS document tests point app.deps._jwks at — the public half of the key above.
TEST_JWKS = {"keys": [jwk.construct(_PUB_PEM, "RS256").to_dict()]}


def realm_iss(tenant: str) -> str:
    return f"{KC_URL}/realms/hrobot-{tenant}"


def make_token(tenant: str = "demo-tenant", iss: str | None = None) -> str:
    """A validly-signed RS256 token whose issuer is the given tenant's realm (or a raw ``iss``)."""
    claims = {"iss": iss if iss is not None else realm_iss(tenant), "sub": "test-user"}
    return jwt.encode(claims, _PRIV_PEM, algorithm="RS256")


def auth(tenant: str = "demo-tenant", iss: str | None = None) -> dict[str, str]:
    """Authorization header carrying a token for ``tenant`` (or raw ``iss``)."""
    return {"Authorization": f"Bearer {make_token(tenant, iss)}"}
