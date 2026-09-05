import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.interview import Interview
from app.services.webhook_security import verify_hunar_webhook_signature

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

_TERMINAL_STATUSES = {"COMPLETED", "NOT_CONNECTED", "FAILED", "CANCELLED"}


@router.post("/hunar")
async def receive_hunar_webhook(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    raw_body = await request.body()
    sig_header = request.headers.get("X-Hunar-Signature")
    ts_header = request.headers.get("X-Hunar-Timestamp")

    if not verify_hunar_webhook_signature(
        signature_header=sig_header,
        timestamp_header=ts_header,
        request_body=raw_body,
        trusted_api_keys=[settings.HUNAR_API_KEY],
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")

    payload = await request.json()
    event_type = payload.get("event_type")
    call_id = payload.get("call_id")

    if not call_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing call_id")

    result = await db.execute(select(Interview).where(Interview.hunar_call_id == call_id))
    interview = result.scalar_one_or_none()

    if interview is None:
        logger.warning("Webhook for unknown call_id=%s event=%s", call_id, event_type)
        return {"ok": True, "ignored": True}

    if event_type == "call_status_updated":
        _apply_status_fields(interview, payload)
    elif event_type == "call_recording_done":
        interview.recording_url = payload.get("recording_url")
    elif event_type == "call_result_done":
        interview.result = payload.get("result")
    elif event_type == "call_summary":
        _apply_status_fields(interview, payload)
        interview.recording_url = payload.get("recording_url") or interview.recording_url
        interview.result = payload.get("result") or interview.result
    else:
        logger.info("Unhandled Hunar event_type=%s for call_id=%s", event_type, call_id)
        return {"ok": True, "ignored": True}

    await db.commit()
    return {"ok": True}


def _apply_status_fields(interview: Interview, payload: dict) -> None:
    interview.status = payload.get("status", interview.status)
    interview.lifecycle_status = payload.get("lifecycle_status", interview.lifecycle_status)
    interview.duration_seconds = payload.get("duration_seconds", interview.duration_seconds)
    interview.answered_by = payload.get("answered_by", interview.answered_by)
    interview.call_ended_by = payload.get("call_ended_by", interview.call_ended_by)
