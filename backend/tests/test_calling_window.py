from datetime import datetime
from zoneinfo import ZoneInfo

from app.services.calling_window import is_within_calling_window

IST = ZoneInfo("Asia/Kolkata")


def _at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 1, 15, hour, minute, tzinfo=IST)


def test_just_before_window_opens_is_blocked():
    assert not is_within_calling_window(_at(7, 59))


def test_window_opens_at_8am():
    assert is_within_calling_window(_at(8, 0))


def test_midday_is_within_window():
    assert is_within_calling_window(_at(14, 30))


def test_just_before_window_closes_is_allowed():
    assert is_within_calling_window(_at(20, 59))


def test_window_closes_at_9pm():
    assert not is_within_calling_window(_at(21, 0))


def test_late_night_is_blocked():
    assert not is_within_calling_window(_at(23, 30))


def test_converts_other_timezones_to_ist():
    # 23:30 UTC is 05:00 IST the next day — outside the window even though the
    # naive hour-of-day in UTC (23) might look "late but plausible" out of context.
    utc_late = datetime(2026, 1, 15, 23, 30, tzinfo=ZoneInfo("UTC"))
    assert not is_within_calling_window(utc_late)
