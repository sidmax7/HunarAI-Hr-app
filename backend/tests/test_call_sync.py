"""Tests for the reconciliation sweep: self-healing an Interview or AttendanceCall that
never reached a terminal status because its webhook was lost, delayed, or never sent —
found via a real call where Hunar's own get_call confirmed COMPLETED while the webhook
never arrived. Reconciliation is the automatic version of the manual backfill that fixed
that one call, run periodically instead of by hand."""

from datetime import timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models.attendance import AttendanceCall, AttendanceCallType, Employee, Location
from app.models.base import utcnow
from app.models.candidate import Candidate
from app.models.interview import Interview
from app.models.job import Job
from app.services.call_sync import STALE_AFTER_MINUTES, reconcile_stale_calls
from app.services.hunar_client import HunarAPIError


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _job(session):
    job = Job(title="Backend Engineer", description="…")
    session.add(job)
    await session.flush()
    return job


async def _candidate(session, job, name="Sudarshan Nayak"):
    candidate = Candidate(job_id=job.id, name=name, phone="+917653886413")
    session.add(candidate)
    await session.flush()
    return candidate


async def _stale_interview(session, call_id="call-1", minutes_old=STALE_AFTER_MINUTES + 5, status=None):
    job = await _job(session)
    candidate = await _candidate(session, job)
    interview = Interview(
        job_id=job.id,
        candidate_id=candidate.id,
        hunar_call_id=call_id,
        status=status,
        created_at=utcnow() - timedelta(minutes=minutes_old),
    )
    session.add(interview)
    await session.commit()
    await session.refresh(interview)
    return interview


async def _location(session):
    location = Location(name="Bangalore Warehouse", site_code="101")
    session.add(location)
    await session.flush()
    return location


@pytest.mark.asyncio
async def test_reconciles_an_interview_stuck_at_not_started(db, monkeypatch):
    interview = await _stale_interview(db)

    async def fake_get_call(call_id):
        assert call_id == "call-1"
        return {
            "status": "COMPLETED",
            "lifecycle_status": "COMPLETED",
            "engagement_status": "ENGAGED",
            "answered_by": "HUMAN",
            "duration_seconds": 220.0,
            "recording_url": "https://recordings.example/call-1.mp3",
            "result": {"summary": "Two years of backend experience."},
        }

    from app.services import call_sync as call_sync_module

    monkeypatch.setattr(call_sync_module.hunar_client, "get_call", fake_get_call)

    result = await reconcile_stale_calls(db)

    assert result == {"checked": 1, "reconciled": 1, "errors": 0}
    await db.refresh(interview)
    assert interview.status == "COMPLETED"
    assert interview.engagement_status == "ENGAGED"
    assert interview.result == {"summary": "Two years of backend experience."}
    assert interview.recording_url == "https://recordings.example/call-1.mp3"


@pytest.mark.asyncio
async def test_leaves_a_call_untouched_if_hunar_says_its_still_in_progress(db, monkeypatch):
    interview = await _stale_interview(db)

    async def fake_get_call(call_id):
        return {"status": "IN_PROGRESS", "lifecycle_status": "IN_PROGRESS"}

    from app.services import call_sync as call_sync_module

    monkeypatch.setattr(call_sync_module.hunar_client, "get_call", fake_get_call)

    result = await reconcile_stale_calls(db)

    assert result == {"checked": 1, "reconciled": 0, "errors": 0}
    await db.refresh(interview)
    assert interview.status is None


@pytest.mark.asyncio
async def test_ignores_a_call_that_hasnt_been_given_time_to_arrive_yet(db, monkeypatch):
    await _stale_interview(db, minutes_old=1)

    async def fake_get_call(call_id):
        raise AssertionError("should not check a call this recent")

    from app.services import call_sync as call_sync_module

    monkeypatch.setattr(call_sync_module.hunar_client, "get_call", fake_get_call)

    result = await reconcile_stale_calls(db)

    assert result == {"checked": 0, "reconciled": 0, "errors": 0}


@pytest.mark.asyncio
async def test_ignores_an_interview_that_already_has_a_terminal_status(db, monkeypatch):
    await _stale_interview(db, status="NOT_CONNECTED")

    async def fake_get_call(call_id):
        raise AssertionError("should not re-check an already-terminal call")

    from app.services import call_sync as call_sync_module

    monkeypatch.setattr(call_sync_module.hunar_client, "get_call", fake_get_call)

    result = await reconcile_stale_calls(db)

    assert result == {"checked": 0, "reconciled": 0, "errors": 0}


@pytest.mark.asyncio
async def test_a_lookup_failure_is_counted_but_does_not_stop_the_sweep(db, monkeypatch):
    await _stale_interview(db, call_id="call-a")
    await _stale_interview(db, call_id="call-b")

    async def fake_get_call(call_id):
        if call_id == "call-a":
            raise HunarAPIError(500, "upstream unavailable")
        return {"status": "FAILED", "lifecycle_status": "FAILED"}

    from app.services import call_sync as call_sync_module

    monkeypatch.setattr(call_sync_module.hunar_client, "get_call", fake_get_call)

    result = await reconcile_stale_calls(db)

    assert result == {"checked": 2, "reconciled": 1, "errors": 1}


@pytest.mark.asyncio
async def test_reconciles_a_stale_attendance_call_too(db, monkeypatch):
    location = await _location(db)
    employee = Employee(employee_org_id="EMP-1", name="Ganesh Chandran", location_id=location.id)
    db.add(employee)
    await db.flush()
    call = AttendanceCall(
        employee_id=employee.id,
        employee_name=employee.name,
        location_id=location.id,
        call_type=AttendanceCallType.ESCALATION,
        hunar_call_id="escalation-call-1",
        status="NOT_STARTED",
        created_at=utcnow() - timedelta(minutes=STALE_AFTER_MINUTES + 5),
    )
    db.add(call)
    await db.commit()

    async def fake_get_call(call_id):
        return {"status": "NOT_CONNECTED", "lifecycle_status": "NOT_CONNECTED"}

    from app.services import call_sync as call_sync_module

    monkeypatch.setattr(call_sync_module.hunar_client, "get_call", fake_get_call)

    result = await reconcile_stale_calls(db)

    assert result == {"checked": 1, "reconciled": 1, "errors": 0}
    await db.refresh(call)
    assert call.status == "NOT_CONNECTED"
