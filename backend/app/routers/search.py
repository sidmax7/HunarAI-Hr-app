from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.candidate import Candidate, CandidateSource
from app.models.job import Job
from app.services.jd_parser import jd_parser
from app.services.pdl_client import PDLAPIError, pdl_client

router = APIRouter(prefix="/api/search", tags=["search"])


class ParseJDRequest(BaseModel):
    description: str


class FindCandidatesRequest(BaseModel):
    criteria: dict
    size: int = 10


class ImportCandidatesRequest(BaseModel):
    job_id: str
    candidates: list[dict]


class UpdatePhoneRequest(BaseModel):
    phone: str


@router.post("/parse-jd")
async def parse_jd(body: ParseJDRequest) -> dict:
    criteria = await jd_parser.parse_to_search_criteria(body.description)
    return {"criteria": criteria}


@router.post("/find-candidates")
async def find_candidates(body: FindCandidatesRequest) -> dict:
    query = jd_parser.criteria_to_pdl_query(body.criteria)
    try:
        result = await pdl_client.search_people(query, size=body.size)
    except PDLAPIError as exc:
        raise HTTPException(status_code=502, detail=f"PDL search failed: {exc.message}") from exc
    return result


@router.post("/import")
async def import_candidates(body: ImportCandidatesRequest, db: AsyncSession = Depends(get_db)) -> dict:
    job_result = await db.execute(select(Job).where(Job.id == body.job_id))
    if job_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Job not found")

    imported = []
    for person in body.candidates:
        candidate = Candidate(
            job_id=body.job_id,
            name=person.get("full_name") or "Unknown",
            phone=person.get("phone"),
            email=person.get("email"),
            linkedin_url=person.get("linkedin_url"),
            skills=person.get("skills"),
            current_company=person.get("job_company_name"),
            current_title=person.get("job_title"),
            location=person.get("location_name"),
            source=CandidateSource.PDL,
            source_data=person.get("raw"),
        )
        db.add(candidate)
        imported.append(candidate)

    await db.commit()
    for c in imported:
        await db.refresh(c)

    return {
        "imported": len(imported),
        "candidates": [
            {"id": c.id, "name": c.name, "phone": c.phone, "linkedin_url": c.linkedin_url} for c in imported
        ],
    }


@router.patch("/candidates/{candidate_id}/phone")
async def update_candidate_phone(
    candidate_id: str, body: UpdatePhoneRequest, db: AsyncSession = Depends(get_db)
) -> dict:
    result = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    candidate = result.scalar_one_or_none()
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")

    candidate.phone = body.phone
    await db.commit()
    return {"id": candidate.id, "phone": candidate.phone}
