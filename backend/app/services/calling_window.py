"""Shared calling-hours guardrail: no outbound call — screening, reminder, or
escalation — should reach a real phone outside a reasonable window in the
candidate/employee's local time. All call-placing code paths must consult
this before dialing, not just display a note about it in the UI."""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.config import settings

CALLING_WINDOW_START_HOUR = 8
CALLING_WINDOW_END_HOUR = 21
CALLING_WINDOW_TIMEZONE = ZoneInfo("Asia/Kolkata")


def is_within_calling_window(at: datetime | None = None) -> bool:
    if not settings.CALLING_WINDOW_ENABLED:
        return True
    now = (at or datetime.now(CALLING_WINDOW_TIMEZONE)).astimezone(CALLING_WINDOW_TIMEZONE)
    return CALLING_WINDOW_START_HOUR <= now.hour < CALLING_WINDOW_END_HOUR


def calling_window_label() -> str:
    return f"{CALLING_WINDOW_START_HOUR} AM–{CALLING_WINDOW_END_HOUR - 12} PM IST"
