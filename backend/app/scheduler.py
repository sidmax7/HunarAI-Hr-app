import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.database import async_session
from app.services.call_sync import reconcile_stale_calls
from app.services.reminder_service import check_and_send_reminders

logger = logging.getLogger(__name__)

REMINDER_CHECK_INTERVAL_MINUTES = 5
CALL_RECONCILIATION_INTERVAL_MINUTES = 5

scheduler = AsyncIOScheduler()


async def _run_reminder_check() -> None:
    async with async_session() as db:
        result = await check_and_send_reminders(db)
        if result["reminders_triggered"]:
            logger.info("Reminder check: triggered %d call(s)", result["reminders_triggered"])


async def _run_call_reconciliation() -> None:
    async with async_session() as db:
        result = await reconcile_stale_calls(db)
        if result["reconciled"]:
            logger.info(
                "Call reconciliation: self-healed %d of %d stale call(s) (%d lookup error(s))",
                result["reconciled"],
                result["checked"],
                result["errors"],
            )


def start_scheduler() -> None:
    scheduler.add_job(
        _run_reminder_check,
        "interval",
        minutes=REMINDER_CHECK_INTERVAL_MINUTES,
        id="attendance_reminder_check",
        replace_existing=True,
    )
    scheduler.add_job(
        _run_call_reconciliation,
        "interval",
        minutes=CALL_RECONCILIATION_INTERVAL_MINUTES,
        id="call_reconciliation",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
