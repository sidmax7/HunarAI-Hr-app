import logging
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.attendance import Attendance, Employee, Location
from app.services.hunar_client import HunarAPIError, hunar_client

logger = logging.getLogger(__name__)

DEFAULT_THRESHOLD_MINUTES = 15


async def check_and_send_reminders(db: AsyncSession, threshold_minutes: int = DEFAULT_THRESHOLD_MINUTES) -> dict:
    """Calls employees with a shift_start set who haven't checked in `threshold_minutes`
    after that time. Shared by the manually-triggered endpoint and the periodic scheduler
    job so both paths run identical logic."""
    today = date.today()
    now = datetime.now()

    employees_result = await db.execute(select(Employee).where(Employee.shift_start.is_not(None)))
    employees = employees_result.scalars().all()

    attendance_result = await db.execute(select(Attendance).where(Attendance.date == today))
    checked_in_ids = {a.employee_id for a in attendance_result.scalars().all() if a.check_in_time is not None}

    triggered = []
    for employee in employees:
        if employee.id in checked_in_ids:
            continue
        shift_datetime = datetime.combine(today, employee.shift_start)
        if now < shift_datetime + timedelta(minutes=threshold_minutes):
            continue

        location_result = await db.execute(select(Location).where(Location.id == employee.location_id))
        location = location_result.scalar_one_or_none()
        if location is None:
            continue

        call_id = await _trigger_reminder_call(employee, location)
        triggered.append({"employee_id": employee.id, "employee_name": employee.name, "call_id": call_id})

    return {"reminders_triggered": len(triggered), "details": triggered}


async def _trigger_reminder_call(employee: Employee, location: Location) -> str | None:
    if not settings.ATTENDANCE_REMINDER_AGENT_ID or not employee.phone_number:
        return None
    try:
        call = await hunar_client.create_call(
            {
                "agent_id": settings.ATTENDANCE_REMINDER_AGENT_ID,
                "callee_name": employee.name,
                "mobile_number": employee.phone_number,
                "custom_data": {
                    "employee_name": employee.name,
                    "location_name": location.name,
                    "company": settings.ATTENDANCE_COMPANY_NAME,
                    "shift_start": employee.shift_start.strftime("%I:%M %p") if employee.shift_start else "",
                },
            }
        )
        return call.get("id")
    except HunarAPIError as exc:
        logger.warning("Reminder call failed for employee %s: %s", employee.id, exc.message)
        return None
