import enum

from sqlalchemy import JSON, Enum, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class CandidateSource(str, enum.Enum):
    MANUAL = "MANUAL"
    PDL = "PDL"
    APOLLO = "APOLLO"


class Candidate(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "candidates"

    job_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("jobs.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    linkedin_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    skills: Mapped[list | None] = mapped_column(JSON, nullable=True)
    experience_years: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    current_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source: Mapped[CandidateSource] = mapped_column(Enum(CandidateSource), default=CandidateSource.MANUAL)
    source_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
