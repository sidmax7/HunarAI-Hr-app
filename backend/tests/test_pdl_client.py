import httpx
import pytest

from app.services.pdl_client import PDLAPIError, PDLClient


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


def _patch_post(monkeypatch, response: _FakeResponse):
    async def fake_post(self, url, json=None, headers=None):
        return response

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)


@pytest.mark.asyncio
async def test_pdl_not_found_404_returns_an_empty_result_instead_of_raising(monkeypatch):
    """PDL returns HTTP 404 (not 200) when a query is valid but matches nothing — this is
    a normal "zero candidates" outcome, not an API failure, and must not surface as an error."""
    _patch_post(
        monkeypatch,
        _FakeResponse(
            404,
            {
                "status": 404,
                "error": {"type": "not_found", "message": "No records were found matching your search"},
                "total": 0,
            },
        ),
    )
    client = PDLClient(api_key="test-key")
    result = await client.search_people({"bool": {"must": []}}, size=20)
    assert result == {"total": 0, "scroll_token": None, "results": []}


@pytest.mark.asyncio
async def test_a_genuine_404_that_is_not_the_not_found_error_type_still_raises(monkeypatch):
    _patch_post(monkeypatch, _FakeResponse(404, {"status": 404, "error": {"type": "invalid_route"}}))
    client = PDLClient(api_key="test-key")
    with pytest.raises(PDLAPIError):
        await client.search_people({"bool": {"must": []}}, size=20)


@pytest.mark.asyncio
async def test_other_error_status_codes_still_raise(monkeypatch):
    _patch_post(monkeypatch, _FakeResponse(401, {"error": {"type": "unauthorized"}}))
    client = PDLClient(api_key="bad-key")
    with pytest.raises(PDLAPIError):
        await client.search_people({"bool": {"must": []}}, size=20)


@pytest.mark.asyncio
async def test_a_successful_search_still_normalizes_results_as_before(monkeypatch):
    _patch_post(
        monkeypatch,
        _FakeResponse(
            200,
            {
                "total": 1,
                "scroll_token": "abc",
                "data": [
                    {
                        "id": "p1",
                        "full_name": "Jane Doe",
                        "linkedin_url": "https://linkedin.com/in/janedoe",
                        "job_title": "Backend Engineer",
                        "job_company_name": "Acme",
                        "location_name": "Bangalore, India",
                        "skills": ["python"],
                        "mobile_phone": True,
                        "work_email": True,
                    }
                ],
            },
        ),
    )
    client = PDLClient(api_key="test-key")
    result = await client.search_people({"bool": {"must": []}}, size=20)
    assert result["total"] == 1
    assert result["scroll_token"] == "abc"
    assert result["results"][0]["full_name"] == "Jane Doe"
    assert result["results"][0]["has_phone"] is True
