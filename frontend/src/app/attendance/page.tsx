"use client";

import { Fragment, useEffect, useState } from "react";
import {
  listLocations,
  listEmployees,
  todayAttendance,
  listEmployeeCalls,
  createLocation,
  createEmployee,
  telecomVerify,
  runReminders,
  ApiError,
  type Location,
  type Employee,
  type AttendanceRecord,
  type AttendanceCall,
} from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";
import { CallResultPanel } from "@/components/CallResultPanel";
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
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [callsByEmployee, setCallsByEmployee] = useState<Record<string, AttendanceCall[]>>({});
  const [loadingCalls, setLoadingCalls] = useState<string | null>(null);

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

  // A freshly placed call invalidates that employee's cached call list, so re-expanding
  // fetches the new row instead of showing stale history from before this action.
  function forgetCallsFor(employeeIds: string[]) {
    setCallsByEmployee((current) => {
      const next = { ...current };
      for (const id of employeeIds) delete next[id];
      return next;
    });
  }

  async function handleVerify(employeeId: string) {
    setVerifying(employeeId);
    setError(null);
    try {
      const result = await telecomVerify(employeeId);
      refresh();
      if (!result.verified) {
        if (result.escalation_call_id) {
          forgetCallsFor([employeeId]);
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
      forgetCallsFor(result.details.map((d) => d.employee_id));
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

  async function toggleCalls(employeeId: string) {
    if (expandedEmployee === employeeId) {
      setExpandedEmployee(null);
      return;
    }
    setExpandedEmployee(employeeId);
    if (callsByEmployee[employeeId]) return;
    setLoadingCalls(employeeId);
    try {
      const calls = await listEmployeeCalls(employeeId);
      setCallsByEmployee((current) => ({ ...current, [employeeId]: calls }));
    } catch {
      toast("Couldn't load call history for this employee.", "danger");
      setExpandedEmployee(null);
    } finally {
      setLoadingCalls(null);
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
                  <th style={th}>Calls</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee, index) => {
                  const record = attendanceByEmployeeId.get(employee.id);
                  const location = locationById.get(employee.location_id);
                  const expanded = expandedEmployee === employee.id;
                  const calls = callsByEmployee[employee.id];
                  return (
                    <Fragment key={employee.id}>
                      <tr>
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
                          <button
                            onClick={() => toggleCalls(employee.id)}
                            aria-expanded={expanded}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "2px 8px",
                              borderRadius: 0,
                              border: "1px solid var(--border-strong)",
                              background: expanded ? "var(--bg-hover)" : "transparent",
                              color: "var(--text)",
                              fontSize: 11.5,
                              fontWeight: 600,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span className="mono" style={{ fontSize: 9, color: "var(--text-faint)" }}>
                              {expanded ? "▾" : "▸"}
                            </span>
                            {loadingCalls === employee.id
                              ? "Loading…"
                              : calls
                                ? `${calls.length} call${calls.length === 1 ? "" : "s"}`
                                : "View calls"}
                          </button>
                        </td>
                        <td style={td}>
                          <Button variant="secondary" onClick={() => handleVerify(employee.id)} disabled={verifying === employee.id}>
                            {verifying === employee.id ? "Verifying…" : "Verify location"}
                          </Button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={8} style={{ padding: 0, borderBottom: "1px solid var(--border)" }}>
                            <EmployeeCallHistory calls={calls} loading={loadingCalls === employee.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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

/**
 * A missed-check-in reminder or a CAMARA-verification-failure escalation call — the
 * attendance-side equivalent of a job's screening interviews. Fetched lazily per
 * employee rather than joined into the main table request, since most employees on a
 * given day have zero calls and don't need this round trip at all.
 */
function EmployeeCallHistory({ calls, loading }: { calls: AttendanceCall[] | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ background: "var(--bg)", padding: "16px 18px" }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading call history…</p>
      </div>
    );
  }

  if (!calls || calls.length === 0) {
    return (
      <div style={{ background: "var(--bg)", padding: "16px 18px" }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          No reminder or escalation calls have been placed to this employee.
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      {calls.map((call, i) => (
        <div key={call.id} style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px 0" }}>
            <StatusPill value={call.call_type} />
            <StatusPill value={call.status} fallbackLabel="Not started" />
            {call.engagement_status && <StatusPill value={call.engagement_status} />}
            {call.created_at && (
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                {new Date(call.created_at).toLocaleString()}
              </span>
            )}
          </div>
          <CallResultPanel call={call} />
        </div>
      ))}
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
