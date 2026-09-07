import asyncio
from typing import Any

import httpx

from app.config import settings


def has_public_webhook_url() -> bool:
    """True when WEBHOOK_BASE_URL is a real, publicly reachable HTTPS host rather than
    the local-dev default — used to gate every outbound call's callback_config, since
    handing Hunar an unreachable URL just means its webhook silently never arrives."""
    url = settings.WEBHOOK_BASE_URL
    return url.startswith("https://") and "your-public-ip" not in url and "localhost" not in url


def webhook_callback_config() -> dict[str, str] | None:
    """The callback_config block to attach to a create_call payload, or None when no
    public webhook URL is configured — every call site should use this rather than
    building the URL itself, so all call types stay wired to the same webhook."""
    if not has_public_webhook_url():
        return None
    return {"call_summary_callback_url": f"{settings.WEBHOOK_BASE_URL}/api/webhooks/hunar"}


class HunarAPIError(Exception):
    def __init__(self, status_code: int, message: str, payload: Any = None):
        self.status_code = status_code
        self.message = message
        self.payload = payload
        super().__init__(f"Hunar API error {status_code}: {message}")


class HunarClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or settings.HUNAR_API_KEY
        self.base_url = (base_url or settings.HUNAR_BASE_URL).rstrip("/")

    def _headers(self) -> dict[str, str]:
        return {"X-API-Key": self.api_key, "Accept": "application/json"}

    async def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        max_retries: int = 3,
    ) -> Any:
        url = f"{self.base_url}{path}"
        last_exc: Exception | None = None

        async with httpx.AsyncClient(timeout=30.0) as client:
            for attempt in range(max_retries):
                try:
                    response = await client.request(
                        method, url, params=params, json=json_body, headers=self._headers()
                    )
                except httpx.RequestError as exc:
                    last_exc = exc
                    await asyncio.sleep(2**attempt)
                    continue

                if response.status_code >= 500:
                    last_exc = HunarAPIError(response.status_code, "Server error", response.text)
                    await asyncio.sleep(2**attempt)
                    continue

                if response.status_code >= 400:
                    try:
                        payload = response.json()
                        message = payload.get("detail") or payload.get("message") or response.text
                    except ValueError:
                        payload = response.text
                        message = response.text
                    raise HunarAPIError(response.status_code, message, payload)

                if response.status_code == 204 or not response.content:
                    return None
                return response.json()

        raise last_exc or HunarAPIError(0, "Request failed after retries")

    async def list_agents(self, **filters: Any) -> dict:
        return await self._request("GET", "/agents/", params=filters)

    async def get_agent(self, agent_id: str) -> dict:
        return await self._request("GET", f"/agents/{agent_id}/")

    async def create_agent(self, payload: dict) -> dict:
        return await self._request("POST", "/agents/", json_body=payload)

    async def update_agent(self, agent_id: str, payload: dict) -> dict:
        return await self._request("PUT", f"/agents/{agent_id}/", json_body=payload)

    async def create_call(self, payload: dict) -> dict:
        return await self._request("POST", "/calls/", json_body=payload)

    async def create_bulk_calls(self, payload: dict) -> dict:
        return await self._request("POST", "/calls/bulk/", json_body=payload)

    async def list_calls(self, **filters: Any) -> dict:
        return await self._request("GET", "/calls/", params=filters)

    async def get_call(self, call_id: str) -> dict:
        return await self._request("GET", f"/calls/{call_id}/")

    async def list_numbers(self) -> dict:
        return await self._request("GET", "/numbers/")


hunar_client = HunarClient()
