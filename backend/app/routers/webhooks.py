import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.attendance import AttendanceCall
from app.models.interview import Interview
from app.services.call_sync import apply_status_fields
from app.services.webhook_security import verify_hunar_webhook_signature

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


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
    record: Interview | AttendanceCall | None = result.scalar_one_or_none()

    if record is None:
        # Not every call this product places is a screening interview — a missed-check-in
        # reminder or a CAMARA-failure escalation call also gets a hunar_call_id, tracked
        # in AttendanceCall instead. Same webhook events, different table.
        result = await db.execute(select(AttendanceCall).where(AttendanceCall.hunar_call_id == call_id))
        record = result.scalar_one_or_none()

    if record is None:
        logger.warning("Webhook for unknown call_id=%s event=%s", call_id, event_type)
        return {"ok": True, "ignored": True}

    if event_type == "call_status_updated":
        apply_status_fields(record, payload)
    elif event_type == "call_recording_done":
        record.recording_url = payload.get("recording_url")
    elif event_type == "call_result_done":
        record.result = payload.get("result")
    elif event_type == "call_summary":
        apply_status_fields(record, payload)
        record.recording_url = payload.get("recording_url") or record.recording_url
        record.result = payload.get("result") or record.result
    else:
        logger.info("Unhandled Hunar event_type=%s for call_id=%s", event_type, call_id)
        return {"ok": True, "ignored": True}

    await db.commit()
    return {"ok": True}
