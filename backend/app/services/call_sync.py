import logging
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attendance import AttendanceCall
from app.models.base import utcnow
from app.models.interview import Interview
from app.services.hunar_client import HunarAPIError, hunar_client

logger = logging.getLogger(__name__)

TERMINAL_STATUSES = {"COMPLETED", "NOT_CONNECTED", "FAILED", "CANCELLED"}

# How long a call is given to reach us on its own (Hunar's own retry schedule for a
# failed webhook delivery runs out to +15 minutes after the first attempt) before the
# reconciliation sweep treats it as possibly stuck and asks Hunar directly.
STALE_AFTER_MINUTES = 10


def apply_status_fields(record: "Interview | AttendanceCall", payload: dict) -> None:
    """Write a Hunar call-status payload (from a webhook, or from get_call ground
    truth — both use the same field names) onto an Interview or AttendanceCall row."""
    new_status = payload.get("status", record.status)
    # Delivery order isn't guaranteed (webhook) and ground-truth polls can race a
    # webhook that lands in between (reconciliation) — once a record has reached a
    # terminal status, a non-terminal status must never regress it; only another
    # terminal status can still land.
    if record.status in TERMINAL_STATUSES and new_status not in TERMINAL_STATUSES:
        logger.info(
            "Ignoring stale status=%s for already-terminal record=%s (status=%s)",
            new_status,
            record.id,
            record.status,
        )
    else:
        record.status = new_status
    # `lifecycle_status` tracks the call attempt (NOT_STARTED/IN_PROGRESS/COMPLETED/...),
    # not whether the candidate engaged — that signal is the separate `engagement_status`
    # field (ENGAGED/NOT_ENGAGED).
    record.lifecycle_status = payload.get("lifecycle_status", record.lifecycle_status)
    record.engagement_status = payload.get("engagement_status", record.engagement_status)
    record.duration_seconds = payload.get("duration_seconds", record.duration_seconds)
    record.answered_by = payload.get("answered_by", record.answered_by)
    record.call_ended_by = payload.get("call_ended_by", record.call_ended_by)


def apply_call_summary(record: "Interview | AttendanceCall", call_data: dict) -> None:
    """Status fields plus recording/result — what a `call_summary` webhook event
    carries, and exactly what Hunar's `get_call` ground truth also returns."""
    apply_status_fields(record, call_data)
    record.recording_url = call_data.get("recording_url") or record.recording_url
    record.result = call_data.get("result") or record.result


async def reconcile_stale_calls(db: AsyncSession) -> dict:
    """Self-heal any Interview or AttendanceCall that never reached a terminal status,
    for calls old enough that a webhook should have arrived by now (including Hunar's
    own retries). Asks Hunar's own `get_call` for ground truth and applies it through
    the same field-mapping a real webhook uses — a fallback for whenever the webhook
    itself is lost, delayed, or never sent, rather than a permanent extra call path.
    """
    cutoff = utcnow() - timedelta(minutes=STALE_AFTER_MINUTES)
    reconciled = 0
    checked = 0
    errors = 0

    for model in (Interview, AttendanceCall):
        result = await db.execute(
            select(model).where(
                model.hunar_call_id.is_not(None),
                or_(model.status.is_(None), model.status.not_in(TERMINAL_STATUSES)),
                model.created_at < cutoff,
            )
        )
        stale_records = result.scalars().all()

        for record in stale_records:
            checked += 1
            try:
                call_data = await hunar_client.get_call(record.hunar_call_id)
            except HunarAPIError as exc:
                errors += 1
                logger.warning(
                    "Reconciliation: couldn't fetch call_id=%s for %s=%s: %s",
                    record.hunar_call_id,
                    type(record).__name__,
                    record.id,
                    exc.message,
                )
                continue

            if call_data.get("status") in TERMINAL_STATUSES:
                apply_call_summary(record, call_data)
                reconciled += 1
                logger.info(
                    "Reconciliation: self-healed %s=%s (call_id=%s) to status=%s",
                    type(record).__name__,
                    record.id,
                    record.hunar_call_id,
                    call_data.get("status"),
                )

    if reconciled:
        await db.commit()

    return {"checked": checked, "reconciled": reconciled, "errors": errors}
