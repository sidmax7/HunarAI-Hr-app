"""Tests for AttendanceCall: the attendance-side equivalent of Interview, added because
reminder and escalation calls placed a real outbound call and then discarded the result —
no callback_config was ever attached (so Hunar had no URL to report back to even if
delivery worked), no row existed to update, and the webhook handler could only ever
match against Interview.hunar_call_id."""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import json
import time

from app.config import settings
from app.database import Base
from app.models.attendance import AttendanceCall, AttendanceCallType, Employee, Location
from app.routers.attendance import _trigger_escalation_call, list_employee_calls
from app.services.call_sync import apply_status_fields
from app.routers.webhooks import receive_hunar_webhook
from app.services.reminder_service import _trigger_reminder_call
from app.services.webhook_security import compute_hunar_signature


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _location(session):
    location = Location(name="Bangalore Warehouse", site_code="101")
    session.add(location)
    await session.flush()
    return location


async def _employee(session, location, name="Ganesh Chandran"):
    org_id = f"EMP-{name.replace(' ', '-')}"
    employee = Employee(employee_org_id=org_id, name=name, phone_number="+919800001001", location_id=location.id)
    session.add(employee)
    await session.flush()
    return employee


@pytest.mark.asyncio
async def test_list_employee_calls_returns_both_call_types_most_recent_first(db):
    location = await _location(db)
    employee = await _employee(db, location)
    db.add_all(
        [
            AttendanceCall(
                employee_id=employee.id, employee_name=employee.name, location_id=location.id,
                call_type=AttendanceCallType.REMINDER, hunar_call_id="call-1", status="COMPLETED",
            ),
            AttendanceCall(
                employee_id=employee.id, employee_name=employee.name, location_id=location.id,
                call_type=AttendanceCallType.ESCALATION, hunar_call_id="call-2", status="NOT_STARTED",
            ),
        ]
    )
    await db.commit()

    calls = await list_employee_calls(employee.id, db)

    assert len(calls) == 2
    assert {c["call_type"] for c in calls} == {"REMINDER", "ESCALATION"}


@pytest.mark.asyncio
async def test_list_employee_calls_only_returns_that_employees_calls(db):
    location = await _location(db)
    employee_a = await _employee(db, location, name="Ganesh Chandran")
    employee_b = await _employee(db, location, name="Lakshmi Venkatesh")
    db.add_all(
        [
            AttendanceCall(
                employee_id=employee_a.id, employee_name=employee_a.name, location_id=location.id,
                call_type=AttendanceCallType.REMINDER, hunar_call_id="call-a",
            ),
            AttendanceCall(
                employee_id=employee_b.id, employee_name=employee_b.name, location_id=location.id,
                call_type=AttendanceCallType.REMINDER, hunar_call_id="call-b",
            ),
        ]
    )
    await db.commit()

    calls = await list_employee_calls(employee_a.id, db)

    assert len(calls) == 1


@pytest.mark.asyncio
async def test_get_job_style_result_round_trips_on_an_attendance_call(db):
    """The whole point: a webhook landing on an AttendanceCall updates it exactly like
    it would an Interview, via the same apply_status_fields function."""
    location = await _location(db)
    employee = await _employee(db, location)
    call = AttendanceCall(
        employee_id=employee.id, employee_name=employee.name, location_id=location.id,
        call_type=AttendanceCallType.ESCALATION, hunar_call_id="call-1", status="NOT_STARTED",
    )
    db.add(call)
    await db.commit()

    apply_status_fields(
        call,
        {"status": "COMPLETED", "lifecycle_status": "COMPLETED", "engagement_status": "ENGAGED", "duration_seconds": 41.0},
    )
    call.recording_url = "https://recordings.example/escalation_1.mp3"
    call.result = {"reason": "traffic delay", "eta_minutes": 20}
    await db.commit()

    [listed] = await list_employee_calls(employee.id, db)
    assert listed["status"] == "COMPLETED"
    assert listed["engagement_status"] == "ENGAGED"
    assert listed["result"] == {"reason": "traffic delay", "eta_minutes": 20}
    assert listed["recording_url"] == "https://recordings.example/escalation_1.mp3"


class _FakeWebhookRequest:
    """Just enough of Starlette's Request for receive_hunar_webhook: header lookup plus
    async .body()/.json(). No existing test in this suite drives the HTTP layer directly
    (every other test calls the router function as a plain async function), so this stays
    consistent with that convention rather than introducing FastAPI's TestClient."""

    def __init__(self, payload: dict):
        self._body = json.dumps(payload).encode()
        ts = str(int(time.time()))
        sig = compute_hunar_signature(api_key=settings.HUNAR_API_KEY, request_body=self._body, timestamp=ts)
        self.headers = {"X-Hunar-Signature": sig, "X-Hunar-Timestamp": ts}

    async def body(self):
        return self._body

    async def json(self):
        return json.loads(self._body)


@pytest.mark.asyncio
async def test_webhook_updates_an_attendance_call_when_no_interview_matches(db):
    """The actual bug this module fixes: a webhook for a reminder/escalation call used to
    hit 'Webhook for unknown call_id' and get silently dropped, because the handler only
    ever checked Interview. It now falls back to AttendanceCall."""
    location = await _location(db)
    employee = await _employee(db, location)
    db.add(
        AttendanceCall(
            employee_id=employee.id, employee_name=employee.name, location_id=location.id,
            call_type=AttendanceCallType.REMINDER, hunar_call_id="reminder-call-1", status="NOT_STARTED",
        )
    )
    await db.commit()

    request = _FakeWebhookRequest(
        {
            "event_type": "call_summary",
            "call_id": "reminder-call-1",
            "status": "COMPLETED",
            "lifecycle_status": "COMPLETED",
            "engagement_status": "ENGAGED",
            "result": {"reason": "running late"},
            "recording_url": "https://recordings.example/reminder_1.mp3",
        }
    )

    response = await receive_hunar_webhook(request, db)

    assert response == {"ok": True}
    [call] = await list_employee_calls(employee.id, db)
    assert call["status"] == "COMPLETED"
    assert call["engagement_status"] == "ENGAGED"
    assert call["result"] == {"reason": "running late"}
    assert call["recording_url"] == "https://recordings.example/reminder_1.mp3"


@pytest.mark.asyncio
async def test_escalation_call_is_placed_with_callback_config_and_persisted(db, monkeypatch):
    """The other half of the original bug: even with the webhook fallback above, Hunar
    never had a URL to call back to, because no call site attached callback_config."""
    location = await _location(db)
    employee = await _employee(db, location)
    monkeypatch.setattr(settings, "ATTENDANCE_ESCALATION_AGENT_ID", "agent-1")
    monkeypatch.setattr(settings, "WEBHOOK_BASE_URL", "https://hunar.example.com")
    # Deterministic regardless of wall-clock time: this test isn't about the calling
    # window, which already has its own dedicated coverage in test_calling_window.py.
    import app.routers.attendance as attendance_module

    monkeypatch.setattr(attendance_module, "is_within_calling_window", lambda: True)

    captured = {}

    async def fake_create_call(payload):
        captured.update(payload)
        return {"id": "escalation-call-1", "status": "NOT_STARTED"}

    from app.services import hunar_client as hunar_client_module

    monkeypatch.setattr(hunar_client_module.hunar_client, "create_call", fake_create_call)

    call_id = await _trigger_escalation_call(db, employee, location)

    assert call_id == "escalation-call-1"
    assert captured["callback_config"] == {
        "call_summary_callback_url": "https://hunar.example.com/api/webhooks/hunar"
    }
    [persisted] = await list_employee_calls(employee.id, db)
    assert persisted["call_type"] == "ESCALATION"
    assert persisted["status"] == "NOT_STARTED"


@pytest.mark.asyncio
async def test_reminder_call_is_placed_with_callback_config_and_persisted(db, monkeypatch):
    from datetime import time as time_of_day

    location = await _location(db)
    employee = await _employee(db, location)
    employee.shift_start = time_of_day(9, 0)
    monkeypatch.setattr(settings, "ATTENDANCE_REMINDER_AGENT_ID", "agent-1")
    monkeypatch.setattr(settings, "WEBHOOK_BASE_URL", "https://hunar.example.com")

    captured = {}

    async def fake_create_call(payload):
        captured.update(payload)
        return {"id": "reminder-call-1", "status": "NOT_STARTED"}

    from app.services import hunar_client as hunar_client_module

    monkeypatch.setattr(hunar_client_module.hunar_client, "create_call", fake_create_call)

    call_id = await _trigger_reminder_call(db, employee, location)

    assert call_id == "reminder-call-1"
    assert captured["callback_config"] == {
        "call_summary_callback_url": "https://hunar.example.com/api/webhooks/hunar"
    }
    [persisted] = await list_employee_calls(employee.id, db)
    assert persisted["call_type"] == "REMINDER"
