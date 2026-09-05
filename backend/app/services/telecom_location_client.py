import time
import uuid
from typing import Literal

import httpx
import jwt

from app.config import settings

VerificationResult = Literal["TRUE", "FALSE", "PARTIAL", "UNKNOWN"]


class TelecomLocationNotConfigured(Exception):
    pass


class TelecomLocationError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(f"CAMARA location verification error {status_code} {code}: {message}")


class CamaraLocationClient:
    """Client for the CAMARA Device Location Verification API (GSMA Open Gateway).

    Written against the public spec (github.com/camaraproject/DeviceLocation): POST
    {base_url}/verify with a device identifier (phoneNumber) and a circular area
    (lat/long/radius); returns TRUE/FALSE/PARTIAL/UNKNOWN. Swapping `CAMARA_BASE_URL` /
    credentials from this sandbox to a real operator's Open Gateway endpoint requires no
    code changes, only .env values — as long as that operator also uses private_key_jwt
    auth (RFC 7523); a client-secret-based operator would need a different auth method here.

    Auth: private_key_jwt, not a plain client secret. We sign a short-lived JWT (iss/sub
    = client ID, aud = token endpoint, jti = fresh UUID) with the private key and send it
    as `client_assertion` per RFC 7523 / OpenID Connect client credentials with JWT bearer.
    """

    def __init__(self):
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    def is_configured(self) -> bool:
        return bool(
            settings.CAMARA_TOKEN_URL
            and settings.CAMARA_BASE_URL
            and settings.CAMARA_CLIENT_ID
            and settings.CAMARA_PRIVATE_KEY_PEM
        )

    def _build_client_assertion(self) -> str:
        now = int(time.time())
        payload = {
            "iss": settings.CAMARA_CLIENT_ID,
            "sub": settings.CAMARA_CLIENT_ID,
            "aud": settings.CAMARA_TOKEN_URL,
            "exp": now + 120,
            "nbf": now - 120,
            "iat": now,
            "jti": str(uuid.uuid4()),
        }
        headers = {"typ": "JWT"}
        if settings.CAMARA_KEY_ID:
            headers["kid"] = settings.CAMARA_KEY_ID

        return jwt.encode(
            payload,
            settings.CAMARA_PRIVATE_KEY_PEM,
            algorithm=settings.CAMARA_KEY_ALG,
            headers=headers,
        )

    async def _get_token(self) -> str:
        if self._token and time.time() < self._token_expires_at - 30:
            return self._token

        client_assertion = self._build_client_assertion()

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                settings.CAMARA_TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "scope": settings.CAMARA_SCOPE,
                    "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                    "client_assertion": client_assertion,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        response.raise_for_status()
        data = response.json()
        self._token = data["access_token"]
        self._token_expires_at = time.time() + data.get("expires_in", 300)
        return self._token

    async def verify(
        self,
        phone_number: str,
        latitude: float,
        longitude: float,
        radius_meters: float,
        max_age_seconds: int | None = None,
    ) -> dict:
        if not self.is_configured():
            raise TelecomLocationNotConfigured(
                "CAMARA_TOKEN_URL/BASE_URL/CLIENT_ID/PRIVATE_KEY_PEM not set in .env"
            )

        token = await self._get_token()
        body: dict = {
            "device": {"phoneNumber": phone_number},
            "area": {
                "areaType": "CIRCLE",
                "center": {"latitude": latitude, "longitude": longitude},
                "radius": radius_meters,
            },
        }
        if max_age_seconds is not None:
            body["maxAge"] = max_age_seconds

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{settings.CAMARA_BASE_URL}/verify",
                json=body,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )

        if response.status_code >= 400:
            try:
                payload = response.json()
                code = payload.get("code", "UNKNOWN")
                message = payload.get("message", response.text)
            except ValueError:
                code, message = "UNKNOWN", response.text
            raise TelecomLocationError(response.status_code, code, message)

        return response.json()


camara_location_client = CamaraLocationClient()
