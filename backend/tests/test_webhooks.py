from types import SimpleNamespace

from app.services.call_sync import apply_status_fields


def _interview(**overrides):
    defaults = dict(
        id="interview-1",
        status=None,
        lifecycle_status=None,
        engagement_status=None,
        duration_seconds=None,
        answered_by=None,
        call_ended_by=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_applies_status_on_a_fresh_interview():
    interview = _interview()
    apply_status_fields(interview, {"status": "IN_PROGRESS", "lifecycle_status": "IN_PROGRESS"})
    assert interview.status == "IN_PROGRESS"
    assert interview.lifecycle_status == "IN_PROGRESS"


def test_engagement_status_is_persisted_separately_from_lifecycle_status():
    # Regression: engagement_status (ENGAGED/NOT_ENGAGED — whether the candidate actually
    # spoke) was being silently dropped. lifecycle_status never holds that value per
    # Hunar's docs — it only ever tracks the call attempt (COMPLETED/FAILED/...).
    interview = _interview()
    apply_status_fields(
        interview,
        {"status": "COMPLETED", "lifecycle_status": "COMPLETED", "engagement_status": "ENGAGED"},
    )
    assert interview.lifecycle_status == "COMPLETED"
    assert interview.engagement_status == "ENGAGED"


def test_terminal_status_is_not_regressed_by_a_stale_event():
    # Simulates call_summary (terminal) arriving before a late call_status_updated
    # (still in-flight) event for the same call — a real out-of-order delivery case.
    interview = _interview(status="COMPLETED")
    apply_status_fields(interview, {"status": "IN_PROGRESS"})
    assert interview.status == "COMPLETED"


def test_another_terminal_status_can_still_overwrite_a_terminal_status():
    interview = _interview(status="FAILED")
    apply_status_fields(interview, {"status": "CANCELLED"})
    assert interview.status == "CANCELLED"


def test_non_terminal_to_non_terminal_transition_still_applies():
    interview = _interview(status="SCHEDULED")
    apply_status_fields(interview, {"status": "IN_PROGRESS"})
    assert interview.status == "IN_PROGRESS"


def test_other_fields_still_update_even_when_status_is_held():
    interview = _interview(status="COMPLETED")
    apply_status_fields(interview, {"status": "IN_PROGRESS", "duration_seconds": 42.0, "answered_by": "HUMAN"})
    assert interview.status == "COMPLETED"
    assert interview.duration_seconds == 42.0
    assert interview.answered_by == "HUMAN"
