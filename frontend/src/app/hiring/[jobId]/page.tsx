"use client";

import { Fragment, use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getJob,
  addCandidate,
  uploadCandidatesCsv,
  screenCandidates,
  ApiError,
  type JobDetail,
  type Interview,
} from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";
import { formatDuration, interestTone, normalizeScreeningResult } from "@/lib/screening";
import {
  Button,
  Input,
  Panel,
  EmptyState,
  ErrorText,
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

const GUARDRAIL_START_HOUR = 8;
const GUARDRAIL_END_HOUR = 21;

// Mirrors app.services.calling_window on the backend, which is what actually enforces
// this — this copy is only so the button can be disabled before a click round-trips to
// a 400, not the source of truth for whether a call is allowed to go out.
function currentIstHour(): number {
  return (
    Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date())
    ) % 24
  );
}

function isWithinCallingWindow(): boolean {
  const hour = currentIstHour();
  return hour >= GUARDRAIL_START_HOUR && hour < GUARDRAIL_END_HOUR;
}

function guardrailNote(interview: Interview): string | null {
  if (interview.status !== "SCHEDULED") return null;
  if (isWithinCallingWindow()) return null;
  return "Waiting for calling window (8 AM–9 PM IST)";
}

export default function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [screening, setScreening] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [expandedInterview, setExpandedInterview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    getJob(jobId)
      .then(setJob)
      .catch((err) => {
        setUnreachable(isBackendUnreachable(err));
        setError(err instanceof ApiError ? err.message : "Failed to load job.");
      });
  }, [jobId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleAddCandidate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setAdding(true);
    try {
      await addCandidate(jobId, name, phone);
      setName("");
      setPhone("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add candidate.");
    } finally {
      setAdding(false);
    }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadCandidatesCsv(jobId, file);
      refresh();
      setError(null);
      toast(`Imported ${result.imported} candidate${result.imported === 1 ? "" : "s"}, skipped ${result.skipped}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "CSV import failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleScreen() {
    if (selected.size === 0) return;
    setScreening(true);
    try {
      const result = await screenCandidates(jobId, Array.from(selected));
      setSelected(new Set());
      refresh();
      const skippedNote =
        result.skipped_already_active > 0
          ? ` (${result.skipped_already_active} already had a call in progress)`
          : "";
      toast(`Scheduled ${result.scheduled} call${result.scheduled === 1 ? "" : "s"}.${skippedNote}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to schedule calls.");
    } finally {
      setScreening(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (error && !job && unreachable) return <ServerUnreachableNotice />;
  if (error && !job) return <ErrorText>{error}</ErrorText>;
  if (!job) return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <Link href="/hiring" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          ← All jobs
        </Link>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", marginTop: 8, gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.01em" }}>{job.title}</h1>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <StatusPill value={job.status} />
              {job.parsed_criteria && (
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  {job.parsed_criteria.seniority} · {job.parsed_criteria.min_experience_years}+ yrs ·{" "}
                  {job.parsed_criteria.location}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <Button
              onClick={handleScreen}
              disabled={selected.size === 0 || screening || !isWithinCallingWindow()}
            >
              {screening ? "Scheduling…" : `Call ${selected.size || ""} selected`}
            </Button>
            {!isWithinCallingWindow() && (
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                Outside calling window (8 AM–9 PM IST)
              </span>
            )}
          </div>
        </div>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      <StatRow>
        <MonumentalStat value={job.candidate_count ?? job.interviews.length} label="Candidates" />
        <MonumentalStat value={job.interviews_completed ?? 0} label="Completed" />
      </StatRow>

      {job.parsed_criteria && job.parsed_criteria.skills.length > 0 && (
        <Panel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {job.parsed_criteria.skills.map((skill) => (
              <span
                key={skill}
                style={{
                  fontSize: 12,
                  padding: "3px 9px",
                  border: "1px solid var(--border-strong)",
                  color: "var(--text-muted)",
                }}
              >
                {skill}
              </span>
            ))}
          </div>
        </Panel>
      )}

      <div className="two-col-320">
        <Panel style={{ padding: 0 }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 13.5, fontWeight: 600 }}>
            Candidates ({job.candidate_count ?? job.interviews.length})
          </div>
          {job.interviews.length === 0 ? (
            <div style={{ padding: 20 }}>
              <EmptyState>No candidates yet. Add one manually or upload a CSV.</EmptyState>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>№</th>
                    <th style={th}></th>
                    <th style={th}>Name</th>
                    <th style={th}>Phone</th>
                    <th style={th}>Call status</th>
                    <th style={th}>Engagement</th>
                    <th style={th}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {job.interviews.map((interview, index) => {
                    const candidate = interview.candidate;
                    if (!candidate) return null;
                    // Keyed by candidate, not interview: an unscreened candidate has no
                    // interview id, and every one of them would share a null key.
                    const expanded = expandedInterview === candidate.id;
                    const hasDetail = Boolean(interview.result) || Boolean(interview.recording_url);
                    return (
                      <Fragment key={candidate.id}>
                        <tr>
                          <td style={tdIndex} className="mono">
                            {String(index + 1).padStart(2, "0")}
                          </td>
                          <td style={td}>
                            <input
                              type="checkbox"
                              checked={selected.has(candidate.id)}
                              onChange={() => toggle(candidate.id)}
                              disabled={!candidate.phone}
                            />
                          </td>
                          <td style={td}>{candidate.name}</td>
                          <td style={{ ...td, color: "var(--text-muted)" }} className="mono">
                            {candidate.phone || <GhostCell title="No phone on file" />}
                          </td>
                          <td style={td}>
                            <StatusPill value={interview.status} fallbackLabel="Not started" />
                            {guardrailNote(interview) && (
                              <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-faint)" }}>
                                {guardrailNote(interview)}
                              </div>
                            )}
                          </td>
                          <td style={td}>
                            <StatusPill value={interview.lifecycle_status} fallbackLabel="—" />
                          </td>
                          <td style={td}>
                            {hasDetail ? (
                              <button
                                onClick={() => setExpandedInterview(expanded ? null : candidate.id)}
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
                                {expanded ? "Hide" : "View"}
                              </button>
                            ) : (
                              <GhostCell title="No screening result yet" />
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={7} style={{ padding: 0, borderBottom: "1px solid var(--border)" }}>
                              <ScreeningResultPanel interview={interview} />
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

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Add candidate</div>
            <form onSubmit={handleAddCandidate} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
              <Input placeholder="+91…" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <Button type="submit" variant="secondary" disabled={adding || !name.trim() || !phone.trim()}>
                {adding ? "Adding…" : "Add"}
              </Button>
            </form>
          </Panel>

          <Panel>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Bulk import</div>
            <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12 }}>
              CSV with <span className="mono">name</span> and <span className="mono">phone</span> columns.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              disabled={uploading}
              style={{ fontSize: 12.5, color: "var(--text-muted)", width: "100%" }}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/**
 * The structured outcome of a screening call: what the backend has been storing from
 * Hunar's `call_result_done` / `call_summary` webhooks all along. Reading this is the
 * point of the product — the recording is the fallback, not the deliverable.
 */
function ScreeningResultPanel({ interview }: { interview: Interview }) {
  const { fields, summary, isEmpty } = normalizeScreeningResult(interview.result);
  const duration = formatDuration(interview.duration_seconds);

  return (
    <div style={{ background: "var(--bg)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
      {isEmpty && !interview.recording_url && (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          This call didn&apos;t return a screening result.
        </p>
      )}

      {fields.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          {fields.map((field) => (
            <div
              key={field.key}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-elevated)",
                padding: "9px 12px",
                minWidth: 128,
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 650,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "var(--text-faint)",
                  marginBottom: 5,
                }}
              >
                {field.label}
              </div>
              {field.kind === "pill" ? (
                <InterestPill value={field.value} />
              ) : (
                <div
                  className={field.kind === "mono" ? "mono" : undefined}
                  style={{ fontSize: 13, color: "var(--text)" }}
                >
                  {field.value}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {summary && (
        <div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 650,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--text-faint)",
              marginBottom: 6,
            }}
          >
            Summary
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text)", maxWidth: "68ch" }}>{summary}</p>
        </div>
      )}

      {interview.recording_url && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              fontSize: 10.5,
              fontWeight: 650,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--text-faint)",
              marginBottom: 6,
            }}
          >
            Recording
            {duration && (
              <span className="mono" style={{ letterSpacing: 0, textTransform: "none", fontWeight: 500 }}>
                {duration}
              </span>
            )}
          </div>
          <audio controls preload="none" src={interview.recording_url} style={{ width: "100%", maxWidth: 420 }}>
            <a href={interview.recording_url}>Download the recording</a>
          </audio>
        </div>
      )}
    </div>
  );
}

function InterestPill({ value }: { value: string }) {
  const tone = interestTone(value);
  const colors = {
    success: { bg: "var(--success-soft)", fg: "var(--success)", border: "var(--success)" },
    warning: { bg: "var(--warning-soft)", fg: "var(--warning)", border: "var(--warning)" },
    neutral: { bg: "var(--bg-hover)", fg: "var(--text-muted)", border: "var(--border-strong)" },
  }[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 0,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.fg,
        fontSize: 11.5,
        fontWeight: 600,
        lineHeight: 1.6,
        textTransform: "capitalize",
      }}
    >
      {value}
    </span>
  );
}
