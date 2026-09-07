"""Database-backed tests for the job list/detail endpoints.

These endpoints are what feed the screening-result panel, and they were also
where a counting bug lived undetected: candidate_count was actually counting
interviews, so an added-but-unscreened candidate reported zero candidates.
Pure-function tests couldn't catch it, so this module runs the real queries
against an in-memory SQLite database.
"""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models.candidate import Candidate
from app.models.interview import Interview
from app.models.job import Job, JobStatus
from app.routers.hiring import get_job, list_jobs


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _job(session, title="Warehouse Operations Associate", status=JobStatus.ACTIVE):
    job = Job(title=title, description="…", status=status)
    session.add(job)
    await session.flush()
    return job


async def _candidate(session, job, name="Arjun Nair"):
    candidate = Candidate(job_id=job.id, name=name, phone="+919800000101")
    session.add(candidate)
    await session.flush()
    return candidate


@pytest.mark.asyncio
async def test_get_job_returns_the_structured_screening_result(db):
    job = await _job(db)
    candidate = await _candidate(db, job)
    result_payload = {
        "interest_level": "high",
        "notice_period_days": 15,
        "current_ctc": "3.2 LPA",
        "summary": "Strong fit, immediate joiner after notice.",
    }
    db.add(
        Interview(
            job_id=job.id,
            candidate_id=candidate.id,
            status="COMPLETED",
            lifecycle_status="COMPLETED",
            engagement_status="ENGAGED",
            result=result_payload,
            recording_url="https://recordings.example/call_1.mp3",
            duration_seconds=224,
            answered_by="HUMAN",
        )
    )
    await db.commit()

    payload = await get_job(job.id, db)
    interview = payload["interviews"][0]

    # The whole point of the panel: these five have to survive the round trip.
    # engagement_status is what actually answers "did they engage" — lifecycle_status
    # only tracks the call attempt (COMPLETED/FAILED/...), never ENGAGED/NOT_ENGAGED.
    assert interview["result"] == result_payload
    assert interview["recording_url"] == "https://recordings.example/call_1.mp3"
    assert interview["duration_seconds"] == 224
    assert interview["answered_by"] == "HUMAN"
    assert interview["engagement_status"] == "ENGAGED"


@pytest.mark.asyncio
async def test_get_job_returns_nulls_rather_than_omitting_keys_for_an_unfinished_call(db):
    job = await _job(db)
    candidate = await _candidate(db, job)
    db.add(Interview(job_id=job.id, candidate_id=candidate.id, status="SCHEDULED"))
    await db.commit()

    interview = (await get_job(job.id, db))["interviews"][0]

    # The frontend narrows on these being present-but-null; a missing key would
    # read as undefined and skip the "no result yet" branch.
    assert interview["result"] is None
    assert interview["recording_url"] is None
    assert interview["duration_seconds"] is None


@pytest.mark.asyncio
async def test_get_job_includes_candidates_who_have_never_been_screened(db):
    """Regression: the detail endpoint listed interviews, so an added-but-unscreened
    candidate never rendered — and a candidate who never renders can never be selected
    and called, which breaks the core add-then-screen workflow."""
    job = await _job(db)
    screened = await _candidate(db, job, name="Arjun Nair")
    await _candidate(db, job, name="Priyanka Desai")  # added, never screened
    db.add(Interview(job_id=job.id, candidate_id=screened.id, status="COMPLETED"))
    await db.commit()

    payload = await get_job(job.id, db)
    by_name = {row["candidate"]["name"]: row for row in payload["interviews"]}

    assert set(by_name) == {"Arjun Nair", "Priyanka Desai"}
    assert payload["candidate_count"] == 2
    assert payload["interviews_completed"] == 1

    unscreened = by_name["Priyanka Desai"]
    assert unscreened["interview_id"] is None
    assert unscreened["status"] is None


@pytest.mark.asyncio
async def test_get_job_keeps_only_the_latest_interview_per_candidate(db):
    """A re-screened candidate has several interviews but is still one row."""
    from datetime import datetime, timedelta, timezone

    job = await _job(db)
    candidate = await _candidate(db, job)
    earlier = datetime.now(timezone.utc) - timedelta(days=2)
    db.add_all(
        [
            Interview(job_id=job.id, candidate_id=candidate.id, status="NOT_CONNECTED", created_at=earlier),
            Interview(job_id=job.id, candidate_id=candidate.id, status="COMPLETED", lifecycle_status="COMPLETED", engagement_status="ENGAGED"),
        ]
    )
    await db.commit()

    payload = await get_job(job.id, db)

    assert len(payload["interviews"]) == 1
    assert payload["interviews"][0]["status"] == "COMPLETED"
    assert payload["candidate_count"] == 1


@pytest.mark.asyncio
async def test_list_jobs_counts_candidates_not_interviews(db):
    """Regression: a DRAFT job with candidates but no screening calls reported 0."""
    job = await _job(db, title="Customer Support Executive", status=JobStatus.DRAFT)
    await _candidate(db, job, name="Kavya Iyer")
    await _candidate(db, job, name="Imran Sheikh")
    await db.commit()

    [listed] = await list_jobs(db)

    assert listed["candidate_count"] == 2
    assert listed["interviews_completed"] == 0


@pytest.mark.asyncio
async def test_list_jobs_counts_completed_from_status_not_lifecycle_status(db):
    """"Completed" counts by call status, regardless of whether the candidate engaged —
    engagement_status is a separate signal and must not gate this count."""
    job = await _job(db)
    engaged = await _candidate(db, job, name="Arjun Nair")
    not_engaged = await _candidate(db, job, name="Fathima Rasheed")
    unreachable = await _candidate(db, job, name="Deepak Yadav")
    db.add_all(
        [
            Interview(job_id=job.id, candidate_id=engaged.id, status="COMPLETED", lifecycle_status="COMPLETED", engagement_status="ENGAGED"),
            Interview(job_id=job.id, candidate_id=not_engaged.id, status="COMPLETED", lifecycle_status="COMPLETED", engagement_status="NOT_ENGAGED"),
            Interview(job_id=job.id, candidate_id=unreachable.id, status="NOT_CONNECTED"),
        ]
    )
    await db.commit()

    [listed] = await list_jobs(db)

    assert listed["candidate_count"] == 3
    # Both COMPLETED calls count, regardless of whether the candidate engaged.
    assert listed["interviews_completed"] == 2


@pytest.mark.asyncio
async def test_list_jobs_reports_zero_rather_than_null_for_an_empty_job(db):
    await _job(db, title="Brand new job")
    await db.commit()

    [listed] = await list_jobs(db)

    assert listed["candidate_count"] == 0
    assert listed["interviews_completed"] == 0
