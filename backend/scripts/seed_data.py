"""Wipes and reseeds the local dev database with realistic mock data spanning
every module (Hiring, Search-sourced candidates, Attendance) and every state
StatusPill knows how to render, so the UI has something worth looking at
without needing real Hunar/PDL/CAMARA traffic.

Deliberately does NOT set `shift_start` on any seeded employee: that field is
what the attendance reminder scheduler (app/scheduler.py, every 5 minutes)
uses to decide who to call, and a seeded phone number matched against a real
shift time would get auto-dialed the next time the scheduler wakes up. Add a
shift_start to a specific employee by hand (via the UI or PATCH through the
API console) when you actually want to exercise that flow.

Run from backend/: `python -m scripts.seed_data`
"""

import asyncio
from datetime import date, datetime, time, timedelta, timezone

from app.database import async_session, init_db
from app.models.attendance import Attendance, Employee, Location
from app.models.candidate import Candidate, CandidateSource
from app.models.interview import Interview
from app.models.job import Job, JobStatus

NOW = datetime.now(timezone.utc)
TODAY = date.today()

# A real, ACTIVE agent in the Hunar account (the generic "Hiring Screener", whose
# custom variables are candidate_name/job_role/location/company). Hunar validates
# agent_id as a UUID against its own records, so a made-up placeholder makes every
# seeded job fail at "Call selected" with "Validation Failed for fields: agent_id".
# Jobs created through the UI generate their own purpose-built agent instead.
SEED_AGENT_ID = "e8078f74-d05c-4dd3-9e25-cc359274e825"


def days_ago(n: int) -> datetime:
    return NOW - timedelta(days=n)


async def wipe(session):
    # Children before parents: attendance/employees before locations,
    # interviews/candidates before jobs.
    for model in [Attendance, Interview, Candidate, Employee, Location, Job]:
        await session.execute(model.__table__.delete())
    await session.commit()


async def seed_hiring(session) -> None:
    warehouse_job = Job(
        title="Warehouse Operations Associate",
        description=(
            "We're hiring warehouse operations associates for our Bangalore fulfillment site. "
            "Responsibilities include inbound/outbound scanning, pick-pack accuracy, and shift-based "
            "floor work. 1+ years warehouse or logistics experience preferred, willing to work rotating "
            "shifts. Immediate joiners preferred."
        ),
        parsed_criteria={
            "title": "Warehouse Operations Associate",
            "company": "HunarAI Logistics",
            "skills": ["inventory scanning", "pick-pack", "forklift (basic)", "shift work"],
            "min_experience_years": 1,
            "location": "Bangalore",
            "seniority": "Associate",
            "responsibilities": [
                "Scan inbound and outbound shipments",
                "Maintain pick-pack accuracy targets",
                "Follow site safety protocols",
                "Work rotating 8-hour shifts",
            ],
        },
        hunar_agent_id=SEED_AGENT_ID,
        status=JobStatus.ACTIVE,
        created_at=days_ago(18),
    )
    backend_job = Job(
        title="Backend Engineer — Payments",
        description=(
            "Backend engineer to own our payments reconciliation service. Python/FastAPI, Postgres, "
            "event-driven architecture. 3+ years backend experience, prior fintech or payments exposure "
            "a strong plus."
        ),
        parsed_criteria={
            "title": "Backend Engineer — Payments",
            "company": "HunarAI Technologies",
            "skills": ["Python", "FastAPI", "PostgreSQL", "distributed systems"],
            "min_experience_years": 3,
            "location": "Remote (India)",
            "seniority": "Mid-Senior",
            "responsibilities": [
                "Own the payments reconciliation service end to end",
                "Design event-driven ingestion pipelines",
                "Partner with finance ops on settlement accuracy",
            ],
        },
        hunar_agent_id=SEED_AGENT_ID,
        status=JobStatus.ACTIVE,
        created_at=days_ago(11),
    )
    support_job = Job(
        title="Customer Support Executive (Hindi/English)",
        description=(
            "Bilingual customer support executive for our inbound support queue. Handles order issues, "
            "refund requests, and delivery escalations over phone and chat. Hindi and English fluency "
            "required."
        ),
        parsed_criteria=None,  # not parsed yet — job is still in DRAFT before its agent is generated
        hunar_agent_id=None,
        status=JobStatus.DRAFT,
        created_at=days_ago(2),
    )
    fleet_job = Job(
        title="Delivery Fleet Supervisor",
        description=(
            "Supervised a 40-rider last-mile delivery fleet across two zones. Role has since been "
            "filled and this requisition is closed."
        ),
        parsed_criteria={
            "title": "Delivery Fleet Supervisor",
            "company": "HunarAI Logistics",
            "skills": ["fleet management", "route planning", "team supervision"],
            "min_experience_years": 2,
            "location": "Pune",
            "seniority": "Supervisor",
            "responsibilities": ["Supervise delivery riders", "Own route planning", "Track SLA adherence"],
        },
        hunar_agent_id=SEED_AGENT_ID,
        status=JobStatus.ARCHIVED,
        created_at=days_ago(41),
    )
    session.add_all([warehouse_job, backend_job, support_job, fleet_job])
    await session.flush()

    def candidate(job, name, phone, email, source=CandidateSource.MANUAL, **kw):
        return Candidate(job_id=job.id, name=name, phone=phone, email=email, source=source, **kw)

    # --- Warehouse job: every interview lifecycle state StatusPill renders ---
    wh_candidates = [
        candidate(warehouse_job, "Arjun Nair", "+919800000101", "arjun.nair@example.com", current_title="Warehouse Associate", current_company="Delhivery", experience_years=2.5, location="Bangalore"),
        candidate(warehouse_job, "Fathima Rasheed", "+919800000102", "fathima.r@example.com", current_title="Inventory Assistant", current_company="Flipkart", experience_years=1.5, location="Bangalore"),
        candidate(warehouse_job, "Deepak Yadav", "+919800000103", "deepak.yadav@example.com", current_title="Picker", current_company="Amazon", experience_years=3, location="Bangalore"),
        candidate(warehouse_job, "Sunita Rawat", "+919800000104", None, current_title="Floor Associate", current_company="Bigbasket", experience_years=1, location="Bangalore"),
        candidate(warehouse_job, "Manoj Kumble", "+919800000105", "manoj.k@example.com", current_title="Warehouse Lead", current_company="Ecom Express", experience_years=4, location="Bangalore"),
        candidate(warehouse_job, "Priyanka Desai", "+919800000106", "priyanka.d@example.com", current_title="Logistics Trainee", current_company=None, experience_years=0.5, location="Bangalore"),
    ]
    session.add_all(wh_candidates)
    await session.flush()

    session.add_all([
        Interview(
            job_id=warehouse_job.id, candidate_id=wh_candidates[0].id, status="COMPLETED",
            lifecycle_status="ENGAGED", engagement_status="ENGAGED", answered_by="HUMAN",
            call_ended_by="AGENT", duration_seconds=224,
            recording_url="https://recordings.hunar.example/call_wh_001.mp3",
            result={"interest_level": "high", "notice_period_days": 15, "current_ctc": "3.2 LPA", "expected_ctc": "3.8 LPA", "summary": "Strong fit, available for rotating shifts, immediate joiner after notice period."},
            created_at=days_ago(4),
        ),
        Interview(
            job_id=warehouse_job.id, candidate_id=wh_candidates[1].id, status="COMPLETED",
            lifecycle_status="NOT_ENGAGED", engagement_status="NOT_ENGAGED", answered_by="HUMAN",
            call_ended_by="CANDIDATE", duration_seconds=38,
            recording_url="https://recordings.hunar.example/call_wh_002.mp3",
            result={"interest_level": "low", "summary": "Candidate said she's no longer looking for warehouse roles."},
            created_at=days_ago(4),
        ),
        Interview(
            job_id=warehouse_job.id, candidate_id=wh_candidates[2].id, status="NOT_CONNECTED",
            answered_by="VOICEMAIL", call_ended_by="SYSTEM", duration_seconds=0,
            created_at=days_ago(3),
        ),
        Interview(
            job_id=warehouse_job.id, candidate_id=wh_candidates[3].id, status="FAILED",
            result={"error": "carrier_rejected"},
            created_at=days_ago(3),
        ),
        Interview(
            job_id=warehouse_job.id, candidate_id=wh_candidates[4].id, status="SCHEDULED",
            created_at=days_ago(1),
        ),
        # wh_candidates[5] — imported, not screened yet: no interview row at all,
        # so the job detail page renders it as "Not started".
    ])

    # --- Backend job: PDL-sourced, one with a masked phone (a documented PDL
    # free-tier limitation), one completed, one in progress, one cancelled ---
    be_candidates = [
        candidate(backend_job, "Rohit Malhotra", "+919800000201", "rohit.malhotra@example.com", source=CandidateSource.PDL, current_title="Backend Engineer", current_company="Razorpay", experience_years=4, skills=["Python", "FastAPI", "PostgreSQL", "Kafka"], linkedin_url="https://linkedin.com/in/rohit-malhotra-example"),
        candidate(backend_job, "Ananya Krishnan", None, "ananya.k@example.com", source=CandidateSource.PDL, current_title="Software Engineer II", current_company="Cred", experience_years=3.5, skills=["Python", "Django", "AWS"], linkedin_url="https://linkedin.com/in/ananya-krishnan-example"),
        candidate(backend_job, "Vivek Subramaniam", "+919800000203", "vivek.s@example.com", source=CandidateSource.MANUAL, current_title="Senior Backend Engineer", current_company="PhonePe", experience_years=5, skills=["Python", "FastAPI", "distributed systems"]),
    ]
    session.add_all(be_candidates)
    await session.flush()

    session.add_all([
        Interview(
            job_id=backend_job.id, candidate_id=be_candidates[0].id, status="COMPLETED",
            lifecycle_status="ENGAGED", engagement_status="ENGAGED", answered_by="HUMAN",
            call_ended_by="AGENT", duration_seconds=410,
            recording_url="https://recordings.hunar.example/call_be_001.mp3",
            result={"interest_level": "high", "notice_period_days": 60, "current_ctc": "22 LPA", "expected_ctc": "30 LPA", "summary": "Strong payments background, serving notice, open to remote."},
            created_at=days_ago(6),
        ),
        Interview(
            job_id=backend_job.id, candidate_id=be_candidates[1].id, status="IN_PROGRESS",
            answered_by="HUMAN", created_at=days_ago(0),
        ),
        Interview(
            job_id=backend_job.id, candidate_id=be_candidates[2].id, status="CANCELLED",
            result={"reason": "duplicate_active_interview"}, created_at=days_ago(2),
        ),
    ])

    # --- Support job: DRAFT, no agent yet, candidates added but nothing screened ---
    session.add_all([
        candidate(support_job, "Kavya Iyer", "+919800000301", "kavya.iyer@example.com", current_title="Support Associate", current_company="Swiggy", experience_years=2),
        candidate(support_job, "Imran Sheikh", "+919800000302", "imran.sheikh@example.com", current_title="Customer Care Executive", current_company="Zomato", experience_years=1.5),
    ])

    # --- Fleet job: ARCHIVED, past completed round ---
    fleet_candidates = [
        candidate(fleet_job, "Ramesh Pillai", "+919800000401", "ramesh.pillai@example.com", current_title="Fleet Coordinator", current_company="Porter", experience_years=3),
        candidate(fleet_job, "Nisha Bhatt", "+919800000402", "nisha.bhatt@example.com", current_title="Operations Supervisor", current_company="Dunzo", experience_years=2.5),
    ]
    session.add_all(fleet_candidates)
    await session.flush()
    session.add_all([
        Interview(
            job_id=fleet_job.id, candidate_id=fleet_candidates[0].id, status="COMPLETED",
            lifecycle_status="ENGAGED", duration_seconds=301,
            recording_url="https://recordings.hunar.example/call_fleet_001.mp3",
            result={"interest_level": "high", "summary": "Hired — role now filled."},
            created_at=days_ago(35),
        ),
        Interview(
            job_id=fleet_job.id, candidate_id=fleet_candidates[1].id, status="COMPLETED",
            lifecycle_status="NOT_ENGAGED", duration_seconds=52,
            result={"interest_level": "low", "summary": "Wanted a fully remote role."},
            created_at=days_ago(35),
        ),
    ])

    await session.commit()


async def seed_attendance(session) -> None:
    bangalore = Location(
        name="Bangalore Warehouse", site_code="101", latitude=12.9716, longitude=77.5946,
        verification_radius_meters=150, current_pin="4821", pin_updated_at=days_ago(1),
        address="Whitefield Industrial Area, Bangalore",
    )
    pune = Location(
        name="Pune Fulfillment Center", site_code="102", latitude=18.5204, longitude=73.8567,
        verification_radius_meters=200, current_pin="7734", pin_updated_at=days_ago(1),
        address="Hinjewadi Phase 2, Pune",
    )
    hyderabad = Location(
        name="Hyderabad Sort Facility", site_code="103", latitude=17.3850, longitude=78.4867,
        verification_radius_meters=150, current_pin="3390", pin_updated_at=days_ago(1),
        address="Gachibowli, Hyderabad",
    )
    session.add_all([bangalore, pune, hyderabad])
    await session.flush()

    # No shift_start set on any of these — see module docstring: the reminder
    # scheduler polls every 5 minutes and would start auto-dialing these
    # numbers the moment a shift_start plus threshold has passed.
    employees = [
        Employee(employee_org_id="EMP-1001", name="Ganesh Chandran", phone_number="+919800001001", location_id=bangalore.id),
        Employee(employee_org_id="EMP-1002", name="Lakshmi Venkatesh", phone_number="+919800001002", location_id=bangalore.id),
        Employee(employee_org_id="EMP-1003", name="Farhan Ahmed", phone_number="+919800001003", location_id=bangalore.id),
        Employee(employee_org_id="EMP-2001", name="Meera Joshi", phone_number="+919800002001", location_id=pune.id),
        Employee(employee_org_id="EMP-2002", name="Rajesh Kulkarni", phone_number="+919800002002", location_id=pune.id),
        Employee(employee_org_id="EMP-3001", name="Divya Reddy", phone_number="+919800003001", location_id=hyderabad.id),
    ]
    session.add_all(employees)
    await session.flush()

    def at(hour, minute=0):
        return datetime.combine(TODAY, time(hour, minute), tzinfo=timezone.utc)

    # Present, still on-site (no checkout), verified via telecom location.
    session.add(Attendance(
        employee_id=employees[0].id, employee_name=employees[0].name, location_id=bangalore.id,
        date=TODAY, check_in_time=at(3, 12), check_in_method="TELECOM_LOCATION", verified=True,
    ))
    # Present, dialed in and out over USSD.
    session.add(Attendance(
        employee_id=employees[1].id, employee_name=employees[1].name, location_id=bangalore.id,
        date=TODAY, check_in_time=at(3, 5), check_out_time=at(11, 40),
        check_in_method="USSD", check_out_method="USSD", verified=True,
    ))
    # employees[2] (Farhan): no record today — renders as ghost cells, not yet checked in.

    session.add(Attendance(
        employee_id=employees[3].id, employee_name=employees[3].name, location_id=pune.id,
        date=TODAY, check_in_time=at(3, 20), check_in_method="TELECOM_LOCATION", verified=True,
    ))
    # employees[4] (Rajesh): no record today either.

    session.add(Attendance(
        employee_id=employees[5].id, employee_name=employees[5].name, location_id=hyderabad.id,
        date=TODAY, check_in_time=at(2, 55), check_out_time=at(10, 30),
        check_in_method="USSD", check_out_method="USSD", verified=True,
    ))

    # Yesterday, for history depth.
    yesterday = TODAY - timedelta(days=1)
    session.add(Attendance(
        employee_id=employees[0].id, employee_name=employees[0].name, location_id=bangalore.id,
        date=yesterday, check_in_time=at(3, 10) - timedelta(days=1), check_out_time=at(11, 45) - timedelta(days=1),
        check_in_method="TELECOM_LOCATION", check_out_method="TELECOM_LOCATION", verified=True,
    ))

    await session.commit()


async def main() -> None:
    await init_db()
    async with async_session() as session:
        print("Wiping existing rows…")
        await wipe(session)
        print("Seeding hiring data (4 jobs, 13 candidates, 9 interviews)…")
        await seed_hiring(session)
        print("Seeding attendance data (3 locations, 6 employees, 6 attendance rows)…")
        await seed_attendance(session)
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
