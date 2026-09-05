from typing import Any

import httpx

from app.config import settings

PDL_SEARCH_URL = "https://api.peopledatalabs.com/v5/person/search"


class PDLAPIError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(f"PDL API error {status_code}: {message}")


class PDLClient:
    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or settings.PDL_API_KEY

    async def search_people(self, query: dict[str, Any], size: int = 10) -> dict:
        payload = {"query": query, "size": size}
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                PDL_SEARCH_URL,
                json=payload,
                headers={"X-Api-Key": self.api_key, "Content-Type": "application/json"},
            )
        if response.status_code >= 400:
            raise PDLAPIError(response.status_code, response.text)

        data = response.json()
        results = [_normalize_person(p) for p in data.get("data", [])]
        return {
            "total": data.get("total", 0),
            "scroll_token": data.get("scroll_token"),
            "results": results,
        }


def _normalize_person(person: dict) -> dict:
    """PDL free-tier plans mask contact fields (mobile_phone, emails, street address) as
    booleans indicating presence rather than the real value. Pro plans return the actual
    string/array. Handle both shapes so this keeps working if the plan is upgraded later.
    """

    def contact_value(raw: Any) -> tuple[str | None, bool]:
        if isinstance(raw, bool):
            return None, raw
        if isinstance(raw, list) and raw:
            return raw[0], True
        if isinstance(raw, str):
            return raw, True
        return None, False

    phone, has_phone = contact_value(person.get("mobile_phone") or person.get("phone_numbers"))
    email, has_email = contact_value(person.get("work_email") or person.get("emails"))

    return {
        "pdl_id": person.get("id"),
        "full_name": person.get("full_name"),
        "linkedin_url": person.get("linkedin_url"),
        "job_title": person.get("job_title"),
        "job_company_name": person.get("job_company_name"),
        "location_name": person.get("location_name") if isinstance(person.get("location_name"), str) else None,
        "skills": person.get("skills") or [],
        "phone": phone,
        "has_phone": has_phone,
        "email": email,
        "has_email": has_email,
        "raw": person,
    }


pdl_client = PDLClient()
