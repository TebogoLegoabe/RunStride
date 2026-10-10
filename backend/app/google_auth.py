"""Checking Google sign-in ID tokens.

The app gets an ID token from Google; we check Google's signature (with Google's public keys),
that it was issued to one of our OAuth clients, and that it hasn't expired. Only then do we
trust the Google account ID and email in it.
"""

from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

import jwt

GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")


class InvalidGoogleToken(Exception):
    pass


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str  # Google's permanent ID for the account
    email: str | None
    email_verified: bool
    given_name: str | None


class GoogleVerifier(Protocol):
    def verify(self, id_token: str, client_ids: list[str]) -> GoogleIdentity: ...


class JwksGoogleVerifier:
    def __init__(self) -> None:
        self.keys = jwt.PyJWKClient(GOOGLE_KEYS_URL, cache_keys=True)

    def verify(self, id_token: str, client_ids: list[str]) -> GoogleIdentity:
        try:
            key = self.keys.get_signing_key_from_jwt(id_token)
            claims = jwt.decode(
                id_token,
                key.key,
                algorithms=["RS256"],
                audience=client_ids,
                options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            )
        except jwt.PyJWTError as e:
            raise InvalidGoogleToken(str(e)) from e
        if claims.get("iss") not in GOOGLE_ISSUERS:
            raise InvalidGoogleToken("not issued by Google")
        return GoogleIdentity(
            sub=str(claims["sub"]),
            email=claims.get("email"),
            email_verified=bool(claims.get("email_verified")),
            given_name=claims.get("given_name") or claims.get("name"),
        )


@lru_cache
def get_google_verifier() -> GoogleVerifier:
    return JwksGoogleVerifier()
