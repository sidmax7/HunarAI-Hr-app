import csv
import io
from collections.abc import Iterable

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.candidate import Candidate, CandidateSource
from app.models.interview import Interview
from app.models.job import Job, JobStatus
from app.models.base import new_uuid
from app.services.calling_window import calling_window_label, is_within_calling_window
from app.services.hunar_client import HunarAPIError, hunar_client, webhook_callback_config
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

    candidate_counts_result = await db.execute(
        select(Candidate.job_id, func.count(Candidate.id)).group_by(Candidate.job_id)
    )
    candidate_counts_by_job = dict(candidate_counts_result.all())

    completed_result = await db.execute(
        select(Interview.job_id, func.sum(case((Interview.status == "COMPLETED", 1), else_=0)))
        .group_by(Interview.job_id)
    )
    # SUM() over zero matching rows comes back NULL, not 0 — coalesce so a job with no
    # interviews yet reports interviews_completed: 0 instead of null.
    completed_by_job = {job_id: completed or 0 for job_id, completed in completed_result.all()}

    return [
        {
            **_job_to_dict(job),
            "candidate_count": candidate_counts_by_job.get(job.id, 0),
            "interviews_completed": completed_by_job.get(job.id, 0),
        }
        for job in jobs
    ]


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    job = await _get_job_or_404(job_id, db)

    # Driven off candidates, not interviews: a candidate who has been added but never
    # screened still has to appear in the list, or there is no way to select and call
    # them — which is the whole point of adding them.
    candidates_result = await db.execute(select(Candidate).where(Candidate.job_id == job_id))
    candidates = candidates_result.scalars().all()

    interviews_result = await db.execute(select(Interview).where(Interview.job_id == job_id))
    # Keep the newest interview per candidate: a re-screened candidate has more than one.
    latest_by_candidate: dict[str, Interview] = {}
    for interview in interviews_result.scalars().all():
        existing = latest_by_candidate.get(interview.candidate_id)
        if existing is None or (interview.created_at and existing.created_at and interview.created_at > existing.created_at):
            latest_by_candidate[interview.candidate_id] = interview

    interview_list = []
    for candidate in candidates:
        interview = latest_by_candidate.get(candidate.id)
        interview_list.append(
            {
                "interview_id": interview.id if interview else None,
                "candidate": _candidate_to_dict(candidate),
                "status": interview.status if interview else None,
                "lifecycle_status": interview.lifecycle_status if interview else None,
                "engagement_status": interview.engagement_status if interview else None,
                "result": interview.result if interview else None,
                "recording_url": interview.recording_url if interview else None,
                "duration_seconds": interview.duration_seconds if interview else None,
                "answered_by": interview.answered_by if interview else None,
                "created_at": interview.created_at.isoformat() if interview and interview.created_at else None,
            }
        )

    return {
        **_job_to_dict(job),
        "interviews": interview_list,
        "candidate_count": len(candidates),
        "interviews_completed": sum(1 for i in latest_by_candidate.values() if i.status == "COMPLETED"),
    }


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

    agent_variables = agent.get("custom_variables", [])

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
            "custom_data": _build_custom_data(agent_variables, job, candidate),
        }
        callback_config = webhook_callback_config()
        if callback_config:
            call_payload["callback_config"] = callback_config
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
        "engagement_status": interview.engagement_status,
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


def _build_custom_data(
    custom_variables: list[str], job: Job, candidate: Candidate | None = None
) -> dict[str, str]:
    """Fills an agent's declared custom variables from the job (and the candidate being
    called, for per-person variables). An agent asks for whatever variable names its
    author chose, so the same value is offered under each spelling seen in practice —
    an unfilled variable reaches the callee as a blank in the middle of a sentence."""
    criteria = job.parsed_criteria or {}
    known = {
        "company": criteria.get("company") or "our company",
        "role": job.title,
        "job_role": job.title,
        "job_title": job.title,
        "title": job.title,
        "location": criteria.get("location") or "",
        "job_description": job.description or "",
    }
    if candidate is not None:
        known["candidate_name"] = candidate.name
        known["current_role"] = candidate.current_title or ""
        known["current_company"] = candidate.current_company or ""
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
