"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listJobs, type Job } from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";
import { Button, StatRow, MonumentalStat, ServerUnreachableNotice, isBackendUnreachable } from "@/components/ui";

export default function HiringPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    listJobs()
      .then(setJobs)
      .catch((err) => {
        setUnreachable(isBackendUnreachable(err));
        setError(err.message);
      });
  }, []);

  return (
    <div>
      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24, gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.01em" }}>Jobs</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginTop: 4 }}>
            Paste a job description to auto-generate a screening agent and start calling candidates.
          </p>
        </div>
        <Link href="/hiring/new">
          <Button>New job</Button>
        </Link>
      </header>

      {error && unreachable && <ServerUnreachableNotice />}
      {error && !unreachable && <p style={{ color: "var(--danger)" }}>Couldn&apos;t load jobs: {error}</p>}
      {!jobs && !error && <p style={{ color: "var(--text-muted)" }}>Loading…</p>}
      {jobs && jobs.length === 0 && (
        <p style={{ color: "var(--text-muted)" }}>No jobs yet.</p>
      )}

      {jobs && jobs.length > 0 && (
        <StatRow>
          <MonumentalStat value={jobs.length} label="Jobs" />
          <MonumentalStat value={jobs.filter((j) => j.status === "ACTIVE").length} label="Active" />
          <MonumentalStat
            value={jobs.reduce((sum, j) => sum + (j.candidate_count ?? 0), 0)}
            label="Candidates"
          />
        </StatRow>
      )}

      {jobs && jobs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {jobs.map((job, index) => (
            <Link
              key={job.id}
              href={`/hiring/${job.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "14px 16px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
              }}
            >
              <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{job.title}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: 2 }}>
                  {job.candidate_count ?? 0} candidate{job.candidate_count === 1 ? "" : "s"} ·{" "}
                  {job.interviews_completed ?? 0} completed
                </div>
              </div>
              <StatusPill value={job.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
