"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listJobs, type Job } from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";
import { StatRow, MonumentalStat, ServerUnreachableNotice, isBackendUnreachable } from "@/components/ui";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const handler = () => setReduced(query.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);
  return reduced;
}

function MonumentalNewJobLink() {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const reducedMotion = useReducedMotion();
  const ease = "cubic-bezier(0.16, 1, 0.3, 1)"; // exponential ease-out, no overshoot

  return (
    <Link href="/hiring/new">
      <button
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false);
          setPressed(false);
        }}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        style={{
          display: "flex",
          alignItems: "stretch",
          padding: 0,
          border: `1px solid ${hovered ? "var(--accent-strong)" : "var(--accent)"}`,
          background: "var(--bg-elevated)",
          cursor: "pointer",
          borderRadius: "var(--radius-sm)",
          transform: !reducedMotion && pressed ? "scale(0.97)" : "scale(1)",
          transition: reducedMotion ? "none" : `transform 180ms ${ease}, border-color 180ms ease-out`,
        }}
      >
        <span
          style={{
            width: 38,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: hovered ? "var(--accent-strong)" : "var(--accent)",
            color: "#fff",
            fontSize: 19,
            fontWeight: 700,
            lineHeight: 1,
            transform: !reducedMotion && hovered ? "scale(1.25)" : "scale(1)",
            transition: reducedMotion ? "none" : `transform 240ms ${ease}, background-color 180ms ease-out`,
          }}
        >
          +
        </span>
        <span
          className="mono"
          style={{
            padding: "0 16px",
            display: "flex",
            alignItems: "center",
            fontSize: 11.5,
            fontWeight: 650,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: "var(--text)",
            borderLeft: "1px solid var(--border-strong)",
          }}
        >
          New job
        </span>
      </button>
    </Link>
  );
}

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
        <MonumentalNewJobLink />
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
