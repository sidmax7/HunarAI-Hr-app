import enum
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, String, Time
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class Location(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "locations"

    name: Mapped[str] = mapped_column(String(255))
    site_code: Mapped[str] = mapped_column(String(16), unique=True)
    phone_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address: Mapped[str | None] = mapped_column(String(512), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    verification_radius_meters: Mapped[float] = mapped_column(Float, default=150.0)
    current_pin: Mapped[str | None] = mapped_column(String(8), nullable=True)
    pin_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    employee_count: Mapped[int] = mapped_column(Integer, default=0)


class Employee(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "employees"

    employee_org_id: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    phone_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Separate from phone_number so a sandbox test number (whose last 2 digits control the
    # CAMARA mock response) can be used for verification while phone_number stays the real
    # contact number an escalation call goes to. Falls back to phone_number when unset.
    camara_test_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    location_id: Mapped[str] = mapped_column(String(36), ForeignKey("locations.id"))
    shift_start: Mapped[str | None] = mapped_column(Time, nullable=True)
    shift_end: Mapped[str | None] = mapped_column(Time, nullable=True)


class Attendance(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "attendance"

    employee_id: Mapped[str] = mapped_column(String(64))
    employee_name: Mapped[str] = mapped_column(String(255))
    location_id: Mapped[str] = mapped_column(String(36), ForeignKey("locations.id"))
    date: Mapped[date] = mapped_column(Date)
    check_in_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    check_out_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    check_in_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    check_out_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    check_in_call_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    check_out_call_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)


class AttendanceCallType(str, enum.Enum):
    REMINDER = "REMINDER"
    ESCALATION = "ESCALATION"


class AttendanceCall(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A missed-check-in reminder or CAMARA-verification-failure escalation call placed to
    an employee. Interview (app.models.interview) is hiring's equivalent of this table —
    the two are separate because an attendance call has no job/candidate to hang off of,
    but both are updated by the same Hunar webhook events and rendered by the same
    CallResultPanel on the frontend."""

    __tablename__ = "attendance_calls"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"))
    employee_name: Mapped[str] = mapped_column(String(255))
    location_id: Mapped[str] = mapped_column(String(36), ForeignKey("locations.id"))
    call_type: Mapped[AttendanceCallType] = mapped_column(Enum(AttendanceCallType))
    hunar_call_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lifecycle_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    engagement_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    answered_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    call_ended_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    recording_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
