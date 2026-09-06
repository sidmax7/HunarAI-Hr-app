"use client";

import { useEffect, useState } from "react";
import {
  listLocations,
  listEmployees,
  todayAttendance,
  createLocation,
  createEmployee,
  telecomVerify,
  runReminders,
  ApiError,
  type Location,
  type Employee,
  type AttendanceRecord,
} from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";
import {
  PageHeader,
  Panel,
  Button,
  Input,
  ErrorText,
  EmptyState,
  Label,
  StatRow,
  MonumentalStat,
  GhostCell,
  ServerUnreachableNotice,
  isBackendUnreachable,
  toast,
  th,
  td,
  tdIndex,
} from "@/components/ui";

export default function AttendancePage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [runningReminders, setRunningReminders] = useState(false);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);

  function refresh() {
    Promise.all([listLocations(), listEmployees(), todayAttendance()])
      .then(([locs, emps, att]) => {
        setLocations(locs);
        setEmployees(emps);
        setAttendance(att);
        setError(null);
      })
      .catch((err) => {
        setUnreachable(isBackendUnreachable(err));
        setError(err instanceof ApiError ? err.message : "Failed to load attendance data.");
      });
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 20000);
    return () => clearInterval(interval);
  }, []);

  async function handleVerify(employeeId: string) {
    setVerifying(employeeId);
    setError(null);
    try {
      const result = await telecomVerify(employeeId);
      refresh();
      if (!result.verified) {
        if (result.escalation_call_id) {
          toast("Location could not be verified — an escalation call has been placed.", "danger");
        } else {
          toast("Location could not be verified. No escalation call was placed (outside calling hours or not configured).", "danger");
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
    } finally {
      setVerifying(null);
    }
  }

  async function handleRunReminders() {
    setRunningReminders(true);
    setError(null);
    try {
      const result = await runReminders();
      refresh();
      if (result.skipped_outside_calling_window) {
        toast("Skipped — outside the calling window (8 AM–9 PM IST).", "danger");
      } else {
        toast(`Triggered ${result.reminders_triggered} reminder call${result.reminders_triggered === 1 ? "" : "s"}.`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to run reminders.");
    } finally {
      setRunningReminders(false);
    }
  }

  const attendanceByEmployeeId = new Map(attendance.map((a) => [a.employee_id, a]));
  const locationById = new Map(locations.map((l) => [l.id, l]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <PageHeader
        title="Attendance"
        description="Workforce presence verified by telecom device-location (GSMA CAMARA sandbox) with a USSD fallback path kept in reserve."
        action={
          <Button onClick={handleRunReminders} disabled={runningReminders}>
            {runningReminders ? "Checking…" : "Run missed check-in reminders"}
          </Button>
        }
      />

      {error && unreachable && locations.length === 0 && employees.length === 0 && <ServerUnreachableNotice />}
      {error && (!unreachable || locations.length > 0 || employees.length > 0) && <ErrorText>{error}</ErrorText>}

      <StatRow>
        <MonumentalStat value={attendance.length} label="Checked in" />
        <MonumentalStat value={employees.length} label="Employees" />
        <MonumentalStat value={attendance.filter((a) => a.verified).length} label="Verified" />
      </StatRow>

      <Panel style={{ padding: 0 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 13.5, fontWeight: 600 }}>
          Today
        </div>
        {employees.length === 0 ? (
          <div style={{ padding: 20 }}>
            <EmptyState>No employees yet. Add a location and employees below.</EmptyState>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>№</th>
                  <th style={th}>Employee</th>
                  <th style={th}>Location</th>
                  <th style={th}>Check-in</th>
                  <th style={th}>Method</th>
                  <th style={th}>Verified</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee, index) => {
                  const record = attendanceByEmployeeId.get(employee.id);
                  const location = locationById.get(employee.location_id);
                  return (
                    <tr key={employee.id}>
                      <td style={tdIndex} className="mono">
                        {String(index + 1).padStart(2, "0")}
                      </td>
                      <td style={td}>{employee.name}</td>
                      <td style={{ ...td, color: "var(--text-muted)" }}>{location?.name ?? "—"}</td>
                      <td style={{ ...td, color: "var(--text-muted)" }} className="mono">
                        {record?.check_in_time ? (
                          new Date(record.check_in_time).toLocaleTimeString()
                        ) : (
                          <GhostCell title="Not checked in yet" />
                        )}
                      </td>
                      <td style={td}>
                        {record ? <StatusPill value={record.check_in_method} fallbackLabel="—" /> : <GhostCell title="Not checked in yet" />}
                      </td>
                      <td style={td}>
                        {record ? (
                          <StatusPill value={record.verified ? "TRUE" : "FALSE"} />
                        ) : (
                          <GhostCell title="Not checked in yet" />
                        )}
                      </td>
                      <td style={td}>
                        <Button variant="secondary" onClick={() => handleVerify(employee.id)} disabled={verifying === employee.id}>
                          {verifying === employee.id ? "Verifying…" : "Verify location"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="two-col-even">
        <Panel>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Locations ({locations.length})</div>
            <Button variant="secondary" onClick={() => setShowLocationForm((v) => !v)}>
              {showLocationForm ? "Cancel" : "Add location"}
            </Button>
          </div>
          {showLocationForm && <LocationForm onCreated={() => { setShowLocationForm(false); refresh(); }} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: showLocationForm ? 14 : 0 }}>
            {locations.map((loc) => (
              <div
                key={loc.id}
                style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 550 }}>{loc.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }} className="mono">
                    {loc.site_code} · {loc.verification_radius_meters}m radius
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Employees ({employees.length})</div>
            <Button variant="secondary" onClick={() => setShowEmployeeForm((v) => !v)} disabled={locations.length === 0}>
              {showEmployeeForm ? "Cancel" : "Add employee"}
            </Button>
          </div>
          {locations.length === 0 && <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Add a location first.</p>}
          {showEmployeeForm && (
            <EmployeeForm locations={locations} onCreated={() => { setShowEmployeeForm(false); refresh(); }} />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: showEmployeeForm ? 14 : 0 }}>
            {employees.map((emp) => (
              <div
                key={emp.id}
                style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 550 }}>{emp.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }} className="mono">
                    {emp.employee_org_id}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function LocationForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("150");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createLocation({
        name,
        site_code: siteCode,
        latitude: latitude ? parseFloat(latitude) : undefined,
        longitude: longitude ? parseFloat(longitude) : undefined,
        verification_radius_meters: radius ? parseFloat(radius) : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create location.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <Label>Site code</Label>
        <Input value={siteCode} onChange={(e) => setSiteCode(e.target.value)} required />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <Label>Latitude</Label>
          <Input value={latitude} onChange={(e) => setLatitude(e.target.value)} />
        </div>
        <div>
          <Label>Longitude</Label>
          <Input value={longitude} onChange={(e) => setLongitude(e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Radius (meters)</Label>
        <Input value={radius} onChange={(e) => setRadius(e.target.value)} />
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create location"}
      </Button>
    </form>
  );
}

function EmployeeForm({ locations, onCreated }: { locations: Location[]; onCreated: () => void }) {
  const [employeeOrgId, setEmployeeOrgId] = useState("");
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [camaraTestNumber, setCamaraTestNumber] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [shiftStart, setShiftStart] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createEmployee({
        employee_org_id: employeeOrgId,
        name,
        phone_number: phoneNumber || undefined,
        camara_test_number: camaraTestNumber || undefined,
        location_id: locationId,
        shift_start: shiftStart || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create employee.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
      <div>
        <Label>Employee ID</Label>
        <Input value={employeeOrgId} onChange={(e) => setEmployeeOrgId(e.target.value)} required />
      </div>
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <Label>Location</Label>
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-strong)", background: "var(--bg)", color: "var(--text)", fontSize: 13.5, width: "100%" }}
        >
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>Phone number</Label>
        <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+91…" />
      </div>
      <div>
        <Label>CAMARA sandbox test number (optional)</Label>
        <Input value={camaraTestNumber} onChange={(e) => setCamaraTestNumber(e.target.value)} placeholder="Last 2 digits drive the sandbox result" />
      </div>
      <div>
        <Label>Shift start</Label>
        <Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <Button type="submit" disabled={submitting || !locationId}>
        {submitting ? "Creating…" : "Create employee"}
      </Button>
    </form>
  );
}
