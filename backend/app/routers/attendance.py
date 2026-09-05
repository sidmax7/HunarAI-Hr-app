import logging
from datetime import date, datetime, time, timezone

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.attendance import Attendance, Employee, Location
from app.services.hunar_client import HunarAPIError, hunar_client
from app.services.reminder_service import check_and_send_reminders
from app.services.telecom_location_client import (
    TelecomLocationError,
    TelecomLocationNotConfigured,
    camara_location_client,
)
from app.services.ussd_sandbox import InvalidUSSDString, parse_ussd_string

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/attendance", tags=["attendance"])


class CreateLocationRequest(BaseModel):
    name: str
    site_code: str
    phone_number: str | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    verification_radius_meters: float = 150.0


class SetPinRequest(BaseModel):
    pin: str


class CreateEmployeeRequest(BaseModel):
    employee_org_id: str
    name: str
    phone_number: str | None = None
    camara_test_number: str | None = None
    location_id: str
    shift_start: time | None = None


class RunRemindersRequest(BaseModel):
    threshold_minutes: int = 15


class USSDSimulateRequest(BaseModel):
    """Simulates what a real USSD aggregator webhook would forward once a short code is leased."""

    mobile_number: str
    dialed_string: str


class TelecomVerifyRequest(BaseModel):
    employee_id: str


@router.post("/locations")
async def create_location(body: CreateLocationRequest, db: AsyncSession = Depends(get_db)) -> dict:
    location = Location(
        name=body.name,
        site_code=body.site_code,
        phone_number=body.phone_number,
        address=body.address,
        latitude=body.latitude,
        longitude=body.longitude,
        verification_radius_meters=body.verification_radius_meters,
    )
    db.add(location)
    await db.commit()
    await db.refresh(location)
    return _location_to_dict(location)


@router.get("/locations")
async def list_locations(db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(select(Location))
    return [_location_to_dict(loc) for loc in result.scalars().all()]


@router.patch("/locations/{location_id}/pin")
async def set_location_pin(location_id: str, body: SetPinRequest, db: AsyncSession = Depends(get_db)) -> dict:
    location = await _get_location_or_404(location_id, db)
    location.current_pin = body.pin
    location.pin_updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"id": location.id, "current_pin": location.current_pin, "pin_updated_at": location.pin_updated_at}


@router.post("/employees")
async def create_employee(body: CreateEmployeeRequest, db: AsyncSession = Depends(get_db)) -> dict:
    await _get_location_or_404(body.location_id, db)
    employee = Employee(
        employee_org_id=body.employee_org_id,
        name=body.name,
        phone_number=body.phone_number,
        camara_test_number=body.camara_test_number,
        location_id=body.location_id,
        shift_start=body.shift_start,
    )
    db.add(employee)
    await db.commit()
    await db.refresh(employee)
    return _employee_to_dict(employee)


@router.get("/employees")
async def list_employees(location_id: str | None = None, db: AsyncSession = Depends(get_db)) -> list[dict]:
    query = select(Employee)
    if location_id:
        query = query.where(Employee.location_id == location_id)
    result = await db.execute(query)
    return [_employee_to_dict(e) for e in result.scalars().all()]


@router.post("/ussd/simulate")
async def simulate_ussd(body: USSDSimulateRequest, db: AsyncSession = Depends(get_db)) -> dict:
    try:
        parsed = parse_ussd_string(body.dialed_string)
    except InvalidUSSDString as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    employee_result = await db.execute(select(Employee).where(Employee.phone_number == body.mobile_number))
    employee = employee_result.scalar_one_or_none()
    if employee is None:
        raise HTTPException(status_code=404, detail=f"No employee registered with phone {body.mobile_number}")

    location = await _get_location_or_404(employee.location_id, db)
    if location.site_code != parsed["site_code"]:
        raise HTTPException(
            status_code=422,
            detail=f"Site code {parsed['site_code']} does not match employee's registered site {location.site_code}",
        )

    if not location.current_pin:
        raise HTTPException(status_code=422, detail="This site has no active PIN set")
    if parsed["pin"] != location.current_pin:
        return {"verified": False, "reason": "PIN mismatch"}

    record = await _mark_attendance(db, employee, method="USSD")
    return {"verified": True, "attendance": _attendance_to_dict(record)}


@router.post("/telecom-verify")
async def telecom_verify(body: TelecomVerifyRequest, db: AsyncSession = Depends(get_db)) -> dict:
    employee_result = await db.execute(select(Employee).where(Employee.id == body.employee_id))
    employee = employee_result.scalar_one_or_none()
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    verify_number = employee.camara_test_number or employee.phone_number
    if not verify_number:
        raise HTTPException(status_code=422, detail="Employee has no phone number on file")

    location = await _get_location_or_404(employee.location_id, db)
    if location.latitude is None or location.longitude is None:
        raise HTTPException(status_code=422, detail="Location has no coordinates set")

    try:
        result = await camara_location_client.verify(
            phone_number=verify_number,
            latitude=location.latitude,
            longitude=location.longitude,
            radius_meters=location.verification_radius_meters,
        )
    except TelecomLocationNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except TelecomLocationError as exc:
        raise HTTPException(status_code=502, detail=exc.message) from exc

    if result.get("verificationResult") != "TRUE":
        escalation_call_id = await _trigger_escalation_call(employee, location)
        return {"verified": False, "camara_result": result, "escalation_call_id": escalation_call_id}

    record = await _mark_attendance(db, employee, method="TELECOM_LOCATION")
    return {"verified": True, "camara_result": result, "attendance": _attendance_to_dict(record)}


async def _trigger_escalation_call(employee: Employee, location: Location) -> str | None:
    """Fires when a CAMARA check comes back non-TRUE. Calls the employee's real contact
    number (distinct from any camara_test_number) so verification-failure handling is
    testable end-to-end without a real telecom deal — the agent says the employee's name
    so multiple test employees sharing one real number can still be told apart."""
    if not settings.ATTENDANCE_ESCALATION_AGENT_ID or not employee.phone_number:
        return None
    try:
        call = await hunar_client.create_call(
            {
                "agent_id": settings.ATTENDANCE_ESCALATION_AGENT_ID,
                "callee_name": employee.name,
                "mobile_number": employee.phone_number,
                "custom_data": {
                    "employee_name": employee.name,
                    "location_name": location.name,
                    "company": settings.ATTENDANCE_COMPANY_NAME,
                },
            }
        )
        return call.get("id")
    except HunarAPIError as exc:
        logger.warning("Escalation call failed for employee %s: %s", employee.id, exc.message)
        return None


@router.get("/today")
async def today_attendance(db: AsyncSession = Depends(get_db)) -> list[dict]:
    today = date.today()
    result = await db.execute(select(Attendance).where(Attendance.date == today))
    return [_attendance_to_dict(a) for a in result.scalars().all()]


@router.post("/reminders/run")
async def run_reminders(body: RunRemindersRequest, db: AsyncSession = Depends(get_db)) -> dict:
    """Manual trigger for the same logic the background scheduler runs periodically
    (see app.scheduler) — useful for testing without waiting for the next tick."""
    return await check_and_send_reminders(db, threshold_minutes=body.threshold_minutes)


async def _mark_attendance(db: AsyncSession, employee: Employee, method: str) -> Attendance:
    today = date.today()
    result = await db.execute(
        select(Attendance).where(Attendance.employee_id == employee.id, Attendance.date == today)
    )
    record = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if record is None:
        record = Attendance(
            employee_id=employee.id,
            employee_name=employee.name,
            location_id=employee.location_id,
            date=today,
            check_in_time=now,
            check_in_method=method,
            verified=True,
        )
        db.add(record)
    elif record.check_out_time is None:
        record.check_out_time = now
        record.check_out_method = method
    # else: already checked in and out today — dial/verify again is a no-op re-confirmation

    await db.commit()
    await db.refresh(record)
    return record


async def _get_location_or_404(location_id: str, db: AsyncSession) -> Location:
    result = await db.execute(select(Location).where(Location.id == location_id))
    location = result.scalar_one_or_none()
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")
    return location


def _location_to_dict(location: Location) -> dict:
    return {
        "id": location.id,
        "name": location.name,
        "site_code": location.site_code,
        "phone_number": location.phone_number,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "verification_radius_meters": location.verification_radius_meters,
        "current_pin": location.current_pin,
        "pin_updated_at": location.pin_updated_at.isoformat() if location.pin_updated_at else None,
    }


def _employee_to_dict(employee: Employee) -> dict:
    return {
        "id": employee.id,
        "employee_org_id": employee.employee_org_id,
        "name": employee.name,
        "phone_number": employee.phone_number,
        "camara_test_number": employee.camara_test_number,
        "location_id": employee.location_id,
        "shift_start": employee.shift_start.isoformat() if employee.shift_start else None,
    }


def _attendance_to_dict(record: Attendance) -> dict:
    return {
        "id": record.id,
        "employee_id": record.employee_id,
        "employee_name": record.employee_name,
        "location_id": record.location_id,
        "date": record.date.isoformat(),
        "check_in_time": record.check_in_time.isoformat() if record.check_in_time else None,
        "check_out_time": record.check_out_time.isoformat() if record.check_out_time else None,
        "check_in_method": record.check_in_method,
        "check_out_method": record.check_out_method,
        "verified": record.verified,
    }
