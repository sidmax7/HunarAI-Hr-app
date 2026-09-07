export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      // response wasn't JSON
    }
    throw new ApiError(response.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

// ---- Hiring ----

export type ParsedCriteria = {
  title: string;
  company: string;
  skills: string[];
  min_experience_years: number;
  location: string;
  seniority: string;
  responsibilities: string[];
};

export type Job = {
  id: string;
  title: string;
  description: string;
  parsed_criteria: ParsedCriteria | null;
  hunar_agent_id: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  created_at: string;
  candidate_count?: number;
  interviews_completed?: number;
};

export type Candidate = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: "MANUAL" | "PDL" | "APOLLO";
  linkedin_url?: string;
  camara_test_number?: string;
};

export type Interview = {
  /** Null when the candidate has been added but never screened. */
  interview_id: string | null;
  candidate: Candidate | null;
  status: string | null;
  lifecycle_status: string | null;
  engagement_status: string | null;
  result: Record<string, unknown> | null;
  recording_url: string | null;
  duration_seconds: number | null;
  answered_by: string | null;
  created_at: string | null;
};

/** One entry per candidate on the job, carrying its latest interview when there is one. */
export type JobDetail = Job & { interviews: Interview[] };

export const listJobs = () => request<Job[]>("/api/jobs");
export const getJob = (jobId: string) => request<JobDetail>(`/api/jobs/${jobId}`);
export const createJob = (description: string) =>
  request<Job>("/api/jobs", { method: "POST", body: JSON.stringify({ description }) });
export const listJobCandidates = (jobId: string) =>
  request<Candidate[]>(`/api/jobs/${jobId}/candidates`);
export const addCandidate = (jobId: string, name: string, phone: string) =>
  request<Candidate>(`/api/jobs/${jobId}/candidates`, {
    method: "POST",
    body: JSON.stringify({ name, phone }),
  });
export const uploadCandidatesCsv = async (jobId: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_URL}/api/jobs/${jobId}/candidates/csv`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return response.json() as Promise<{ imported: number; skipped: number; candidates: Candidate[] }>;
};
export const screenCandidates = (jobId: string, candidateIds: string[]) =>
  request<{ scheduled: number; skipped_already_active: number }>(`/api/jobs/${jobId}/screen`, {
    method: "POST",
    body: JSON.stringify({ candidate_ids: candidateIds }),
  });

// ---- Search & Reachout ----

export const parseJd = (description: string) =>
  request<{ criteria: ParsedCriteria }>("/api/search/parse-jd", {
    method: "POST",
    body: JSON.stringify({ description }),
  });

export type PdlPerson = {
  pdl_id: string;
  full_name: string;
  linkedin_url: string | null;
  job_title: string | null;
  job_company_name: string | null;
  location_name: string | null;
  skills: string[];
  phone: string | null;
  has_phone: boolean;
  email: string | null;
  has_email: boolean;
  raw: Record<string, unknown>;
};

export const findCandidates = (criteria: ParsedCriteria, size = 10) =>
  request<{ total: number; results: PdlPerson[] }>("/api/search/find-candidates", {
    method: "POST",
    body: JSON.stringify({ criteria, size }),
  });

export const importCandidates = (jobId: string, candidates: PdlPerson[]) =>
  request<{ imported: number; candidates: Candidate[] }>("/api/search/import", {
    method: "POST",
    body: JSON.stringify({ job_id: jobId, candidates }),
  });

export const updateCandidatePhone = (candidateId: string, phone: string) =>
  request<{ id: string; phone: string }>(`/api/search/candidates/${candidateId}/phone`, {
    method: "PATCH",
    body: JSON.stringify({ phone }),
  });

// ---- Attendance ----

export type Location = {
  id: string;
  name: string;
  site_code: string;
  phone_number: string | null;
  latitude: number | null;
  longitude: number | null;
  verification_radius_meters: number;
  current_pin: string | null;
  pin_updated_at: string | null;
};

export type Employee = {
  id: string;
  employee_org_id: string;
  name: string;
  phone_number: string | null;
  camara_test_number: string | null;
  location_id: string;
  shift_start: string | null;
};

export type AttendanceRecord = {
  id: string;
  employee_id: string;
  employee_name: string;
  location_id: string;
  date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  check_in_method: string | null;
  check_out_method: string | null;
  verified: boolean;
};

export type AttendanceCall = {
  id: string;
  call_type: "REMINDER" | "ESCALATION";
  status: string | null;
  lifecycle_status: string | null;
  engagement_status: string | null;
  answered_by: string | null;
  duration_seconds: number | null;
  result: Record<string, unknown> | null;
  recording_url: string | null;
  created_at: string | null;
};

export const listLocations = () => request<Location[]>("/api/attendance/locations");
export const createLocation = (payload: {
  name: string;
  site_code: string;
  latitude?: number;
  longitude?: number;
  verification_radius_meters?: number;
}) => request<Location>("/api/attendance/locations", { method: "POST", body: JSON.stringify(payload) });
export const setLocationPin = (locationId: string, pin: string) =>
  request<Location>(`/api/attendance/locations/${locationId}/pin`, {
    method: "PATCH",
    body: JSON.stringify({ pin }),
  });

export const listEmployees = (locationId?: string) =>
  request<Employee[]>(`/api/attendance/employees${locationId ? `?location_id=${locationId}` : ""}`);
export const createEmployee = (payload: {
  employee_org_id: string;
  name: string;
  phone_number?: string;
  camara_test_number?: string;
  location_id: string;
  shift_start?: string;
}) => request<Employee>("/api/attendance/employees", { method: "POST", body: JSON.stringify(payload) });

export const todayAttendance = () => request<AttendanceRecord[]>("/api/attendance/today");

export const listEmployeeCalls = (employeeId: string) =>
  request<AttendanceCall[]>(`/api/attendance/employees/${employeeId}/calls`);

export const telecomVerify = (employeeId: string) =>
  request<{ verified: boolean; camara_result: Record<string, unknown>; escalation_call_id?: string | null }>(
    "/api/attendance/telecom-verify",
    { method: "POST", body: JSON.stringify({ employee_id: employeeId }) }
  );

export const runReminders = (thresholdMinutes = 15) =>
  request<{
    reminders_triggered: number;
    details: { employee_id: string; employee_name: string; call_id: string | null }[];
    skipped_outside_calling_window?: boolean;
  }>("/api/attendance/reminders/run", {
    method: "POST",
    body: JSON.stringify({ threshold_minutes: thresholdMinutes }),
  });
