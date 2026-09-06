import csv
import io
from collections.abc import Iterable

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.candidate import Candidate, CandidateSource
from app.models.interview import Interview
from app.models.job import Job, JobStatus
from app.models.base import new_uuid
from app.services.calling_window import calling_window_label, is_within_calling_window
from app.services.hunar_client import HunarAPIError, hunar_client
from app.services.llm_service import llm_service

router = APIRouter(prefix="/api", tags=["hiring"])

# Interview.status values (set from Hunar's own call-status enum, see webhooks.py) that
# mean a call is still pending or in flight for a candidate — used to stop the same
# candidate being dialed twice from an accidental double-click or re-selection.
_ACTIVE_INTERVIEW_STATUSES = {"SCHEDULED", "IN_PROGRESS", "RINGING", "QUEUED"}


class CreateJobRequest(BaseModel):
    description: str


class AddCandidateRequest(BaseModel):
    name: str
    phone: str


class ScreenRequest(BaseModel):
    candidate_ids: list[str]


@router.post("/jobs")
async def create_job(body: CreateJobRequest, db: AsyncSession = Depends(get_db)) -> dict:
    parsed = await llm_service.parse_job_description(body.description)
    agent_config = await llm_service.generate_agent_prompt(parsed)

    try:
        hunar_agent = await hunar_client.create_agent(
            {
                "name": agent_config["name"],
                "language": "ENGLISH",
                "voice_persona": "NEHA",
                "persona_name": agent_config["persona_name"],
                "objective": agent_config["objective"],
                "agent_prompt": agent_config["agent_prompt"],
                "introduction": agent_config["introduction"],
                "result_prompt": agent_config["result_prompt"],
                "result_schema": agent_config["result_schema"],
            }
        )
    except HunarAPIError as exc:
        raise HTTPException(status_code=502, detail=f"Hunar agent creation failed: {exc.message}") from exc

    job = Job(
        title=parsed.get("title", "Untitled Role"),
        description=body.description,
        parsed_criteria=parsed,
        hunar_agent_id=hunar_agent["id"],
        status=JobStatus.ACTIVE,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    return _job_to_dict(job)


@router.get("/jobs")
async def list_jobs(db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(select(Job).order_by(Job.created_at.desc()))
    jobs = result.scalars().all()

    counts_result = await db.execute(
        select(
            Interview.job_id,
            func.count(Interview.id),
            func.sum(case((Interview.lifecycle_status == "COMPLETED", 1), else_=0)),
        ).group_by(Interview.job_id)
    )
    # SUM() over zero matching rows comes back NULL, not 0 — coalesce so a job with no
    # candidates yet reports interviews_completed: 0 instead of null.
    counts_by_job = {job_id: (total, completed or 0) for job_id, total, completed in counts_result.all()}

    return [
        {
            **_job_to_dict(job),
            "candidate_count": counts_by_job.get(job.id, (0, 0))[0],
            "interviews_completed": counts_by_job.get(job.id, (0, 0))[1],
        }
        for job in jobs
    ]


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    job = await _get_job_or_404(job_id, db)

    interviews_result = await db.execute(select(Interview).where(Interview.job_id == job_id))
    interviews = interviews_result.scalars().all()

    candidate_ids = [i.candidate_id for i in interviews]
    candidates_by_id = {}
    if candidate_ids:
        candidates_result = await db.execute(select(Candidate).where(Candidate.id.in_(candidate_ids)))
        candidates_by_id = {c.id: c for c in candidates_result.scalars().all()}

    interview_list = []
    for interview in interviews:
        candidate = candidates_by_id.get(interview.candidate_id)
        interview_list.append(
            {
                "interview_id": interview.id,
                "candidate": _candidate_to_dict(candidate) if candidate else None,
                "status": interview.status,
                "lifecycle_status": interview.lifecycle_status,
                "result": interview.result,
                "recording_url": interview.recording_url,
                "created_at": interview.created_at.isoformat() if interview.created_at else None,
            }
        )

    return {**_job_to_dict(job), "interviews": interview_list}


@router.post("/jobs/{job_id}/candidates")
async def add_candidate(job_id: str, body: AddCandidateRequest, db: AsyncSession = Depends(get_db)) -> dict:
    await _get_job_or_404(job_id, db)

    candidate = Candidate(job_id=job_id, name=body.name, phone=body.phone, source=CandidateSource.MANUAL)
    db.add(candidate)
    await db.commit()
    await db.refresh(candidate)
    return _candidate_to_dict(candidate)


@router.post("/jobs/{job_id}/candidates/csv")
async def upload_candidates_csv(job_id: str, file: UploadFile, db: AsyncSession = Depends(get_db)) -> dict:
    await _get_job_or_404(job_id, db)

    raw = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))

    required_cols = {"name", "phone"}
    if reader.fieldnames is None or not required_cols.issubset({f.strip().lower() for f in reader.fieldnames}):
        raise HTTPException(status_code=400, detail="CSV must have 'name' and 'phone' columns")

    total_rows, normalized_rows = normalize_candidate_csv_rows(reader)

    created = []
    for row in normalized_rows:
        candidate = Candidate(
            job_id=job_id,
            name=row["name"],
            phone=row["phone"],
            email=row.get("email") or None,
            source=CandidateSource.MANUAL,
        )
        db.add(candidate)
        created.append(candidate)

    await db.commit()
    for c in created:
        await db.refresh(c)

    return {
        "imported": len(created),
        "skipped": total_rows - len(created),
        "candidates": [_candidate_to_dict(c) for c in created],
    }


@router.get("/jobs/{job_id}/candidates")
async def list_job_candidates(job_id: str, db: AsyncSession = Depends(get_db)) -> list[dict]:
    await _get_job_or_404(job_id, db)

    candidates_result = await db.execute(select(Candidate).where(Candidate.job_id == job_id))
    return [_candidate_to_dict(c) for c in candidates_result.scalars().all()]


@router.post("/jobs/{job_id}/screen")
async def screen_candidates(job_id: str, body: ScreenRequest, db: AsyncSession = Depends(get_db)) -> dict:
    if not is_within_calling_window():
        raise HTTPException(
            status_code=400,
            detail=f"Outside the calling window ({calling_window_label()}). Try again during those hours.",
        )

    job = await _get_job_or_404(job_id, db)

    if not job.hunar_agent_id:
        raise HTTPException(status_code=400, detail="Job has no associated Hunar agent")

    candidates_result = await db.execute(select(Candidate).where(Candidate.id.in_(body.candidate_ids)))
    candidates = candidates_result.scalars().all()

    # Skip anyone with a call already scheduled or in flight for this job, so a
    # double-click or re-selecting the same row doesn't dial them twice.
    existing_result = await db.execute(
        select(Interview.candidate_id).where(
            Interview.job_id == job_id,
            Interview.candidate_id.in_(body.candidate_ids),
            Interview.status.in_(_ACTIVE_INTERVIEW_STATUSES),
        )
    )
    already_active = set(existing_result.scalars().all())
    candidates = [c for c in candidates if c.id not in already_active]

    if not candidates:
        return {"scheduled": 0, "skipped_already_active": len(already_active)}

    try:
        agent = await hunar_client.get_agent(job.hunar_agent_id)
    except HunarAPIError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to load Hunar agent: {exc.message}") from exc

    custom_data = _build_custom_data(agent.get("custom_variables", []), job)

    # Commit after each call instead of once at the end: if a call three of five fails,
    # the exception below must not lose the record of the two calls that already went
    # out for real — those would otherwise reach the webhook with no matching Interview
    # row and be silently dropped (see webhooks.py).
    scheduled = 0
    for candidate in candidates:
        request_id = f"screen-{job_id[:8]}-{candidate.id[:8]}-{new_uuid()[:8]}"[:64]
        call_payload = {
            "agent_id": job.hunar_agent_id,
            "callee_name": candidate.name,
            "mobile_number": candidate.phone,
            "request_id": request_id,
            "custom_data": custom_data,
        }
        if _has_public_webhook_url():
            call_payload["callback_config"] = {
                "call_summary_callback_url": f"{settings.WEBHOOK_BASE_URL}/api/webhooks/hunar"
            }
        try:
            call = await hunar_client.create_call(call_payload)
        except HunarAPIError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Hunar call creation failed after scheduling {scheduled} call(s): {exc.message}",
            ) from exc

        interview = Interview(
            job_id=job_id,
            candidate_id=candidate.id,
            hunar_call_id=call["id"],
            request_id=request_id,
            status=call.get("status"),
        )
        db.add(interview)
        await db.commit()
        scheduled += 1

    return {"scheduled": scheduled, "skipped_already_active": len(already_active)}


@router.get("/interviews/{interview_id}")
async def get_interview(interview_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Interview).where(Interview.id == interview_id))
    interview = result.scalar_one_or_none()
    if interview is None:
        raise HTTPException(status_code=404, detail="Interview not found")

    candidate_result = await db.execute(select(Candidate).where(Candidate.id == interview.candidate_id))
    candidate = candidate_result.scalar_one_or_none()

    return {
        "interview_id": interview.id,
        "candidate": _candidate_to_dict(candidate) if candidate else None,
        "status": interview.status,
        "lifecycle_status": interview.lifecycle_status,
        "result": interview.result,
        "recording_url": interview.recording_url,
        "duration_seconds": interview.duration_seconds,
    }


def normalize_candidate_csv_rows(rows: Iterable[dict]) -> tuple[int, list[dict]]:
    """Lower-cases/trims column names and values, and drops any row missing a
    name or phone. Returns (total_rows_seen, kept_rows) so callers can report
    a skipped count without re-deriving it from a length difference."""
    total_rows = 0
    normalized_rows = []
    for row in rows:
        total_rows += 1
        normalized = {k.strip().lower(): (v or "").strip() for k, v in row.items()}
        if normalized.get("name") and normalized.get("phone"):
            normalized_rows.append(normalized)
    return total_rows, normalized_rows


def _has_public_webhook_url() -> bool:
    url = settings.WEBHOOK_BASE_URL
    return url.startswith("https://") and "your-public-ip" not in url and "localhost" not in url


def _build_custom_data(custom_variables: list[str], job: Job) -> dict[str, str]:
    criteria = job.parsed_criteria or {}
    known = {
        "company": criteria.get("company") or "our company",
        "role": job.title,
        "job_title": job.title,
        "title": job.title,
        "location": criteria.get("location") or "",
    }
    return {var: known.get(var, "") for var in custom_variables}


async def _get_job_or_404(job_id: str, db: AsyncSession) -> Job:
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _job_to_dict(job: Job) -> dict:
    return {
        "id": job.id,
        "title": job.title,
        "description": job.description,
        "parsed_criteria": job.parsed_criteria,
        "hunar_agent_id": job.hunar_agent_id,
        "status": job.status,
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }


def _candidate_to_dict(candidate: Candidate) -> dict:
    return {
        "id": candidate.id,
        "name": candidate.name,
        "phone": candidate.phone,
        "email": candidate.email,
        "source": candidate.source,
    }
