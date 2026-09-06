from types import SimpleNamespace

from app.routers.webhooks import _apply_status_fields


def _interview(**overrides):
    defaults = dict(
        id="interview-1",
        status=None,
        lifecycle_status=None,
        duration_seconds=None,
        answered_by=None,
        call_ended_by=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_applies_status_on_a_fresh_interview():
    interview = _interview()
    _apply_status_fields(interview, {"status": "IN_PROGRESS", "lifecycle_status": "ENGAGED"})
    assert interview.status == "IN_PROGRESS"
    assert interview.lifecycle_status == "ENGAGED"


def test_terminal_status_is_not_regressed_by_a_stale_event():
    # Simulates call_summary (terminal) arriving before a late call_status_updated
    # (still in-flight) event for the same call — a real out-of-order delivery case.
    interview = _interview(status="COMPLETED")
    _apply_status_fields(interview, {"status": "IN_PROGRESS"})
    assert interview.status == "COMPLETED"


def test_another_terminal_status_can_still_overwrite_a_terminal_status():
    interview = _interview(status="FAILED")
    _apply_status_fields(interview, {"status": "CANCELLED"})
    assert interview.status == "CANCELLED"


def test_non_terminal_to_non_terminal_transition_still_applies():
    interview = _interview(status="SCHEDULED")
    _apply_status_fields(interview, {"status": "IN_PROGRESS"})
    assert interview.status == "IN_PROGRESS"


def test_other_fields_still_update_even_when_status_is_held():
    interview = _interview(status="COMPLETED")
    _apply_status_fields(interview, {"status": "IN_PROGRESS", "duration_seconds": 42.0, "answered_by": "HUMAN"})
    assert interview.status == "COMPLETED"
    assert interview.duration_seconds == 42.0
    assert interview.answered_by == "HUMAN"
