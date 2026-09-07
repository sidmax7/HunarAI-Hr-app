"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  parseJd,
  findCandidates,
  importCandidates,
  listJobs,
  ApiError,
  type ParsedCriteria,
  type PdlPerson,
  type Job,
} from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";
import {
  PageHeader,
  Panel,
  Textarea,
  Input,
  Button,
  ErrorText,
  Label,
  EmptyState,
  StatRow,
  MonumentalStat,
  toast,
  th,
  td,
  tdIndex,
} from "@/components/ui";

type Stage = "input" | "criteria" | "results";

function formatJobDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Standing context beside the search workbench: every job already in the system, so
 * sourcing doesn't happen blind to what's already been created — and re-sourcing off a
 * job's own JD doesn't require re-pasting it. */
function JobHistoryRail({
  jobs,
  sourcingJobId,
  onSource,
}: {
  jobs: Job[];
  sourcingJobId: string | null;
  onSource: (job: Job) => void;
}) {
  const sorted = [...jobs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return (
    <Panel style={{ padding: 0, position: "sticky", top: 20 }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 13.5, fontWeight: 600 }}>
        Job history
      </div>
      {sorted.length === 0 ? (
        <div style={{ padding: 16 }}>
          <EmptyState>No jobs created yet.</EmptyState>
        </div>
      ) : (
        <div>
          {sorted.map((job) => (
            <div key={job.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              <Link href={`/hiring/${job.id}`} style={{ display: "block", color: "inherit" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{job.title}</span>
                  <StatusPill value={job.status} />
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                  {job.candidate_count ?? 0} candidate{(job.candidate_count ?? 0) === 1 ? "" : "s"} · {formatJobDate(job.created_at)}
                </div>
              </Link>
              <button
                type="button"
                onClick={() => onSource(job)}
                disabled={!job.description.trim() || sourcingJobId === job.id}
                title={job.description.trim() ? undefined : "This job has no description to source from."}
                style={{
                  marginTop: 8,
                  padding: "3px 8px",
                  borderRadius: 0,
                  border: "1px solid var(--border-strong)",
                  background: "transparent",
                  color: "var(--text)",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: !job.description.trim() || sourcingJobId === job.id ? "not-allowed" : "pointer",
                  opacity: !job.description.trim() ? 0.5 : 1,
                }}
              >
                {sourcingJobId === job.id ? "Sourcing…" : "Source from this JD"}
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default function SearchPage() {
  const [stage, setStage] = useState<Stage>("input");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<ParsedCriteria | null>(null);
  const [skillDraft, setSkillDraft] = useState("");
  const [results, setResults] = useState<PdlPerson[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [targetJobId, setTargetJobId] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourcingJobId, setSourcingJobId] = useState<string | null>(null);

  useEffect(() => {
    listJobs().then(setJobs).catch(() => {});
  }, []);

  async function runParse(jd: string) {
    setError(null);
    try {
      const { criteria } = await parseJd(jd);
      setCriteria(criteria);
      setStage("criteria");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to parse job description.");
    }
  }

  async function handleParse(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setLoading(true);
    await runParse(description);
    setLoading(false);
  }

  async function handleSourceFromJob(job: Job) {
    if (!job.description.trim()) return;
    setDescription(job.description);
    setSourcingJobId(job.id);
    await runParse(job.description);
    setSourcingJobId(null);
  }

  async function handleSearch() {
    if (!criteria) return;
    setLoading(true);
    setError(null);
    try {
      const { results } = await findCandidates(criteria, 20);
      setResults(results);
      setStage("results");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!targetJobId || selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const chosen = results.filter((p) => selected.has(p.pdl_id));
      const result = await importCandidates(targetJobId, chosen);
      toast(`Imported ${result.imported} candidate${result.imported === 1 ? "" : "s"} into the job.`);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  function updateCriteria(patch: Partial<ParsedCriteria>) {
    setCriteria((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function addSkill() {
    const skill = skillDraft.trim();
    if (!skill || !criteria) return;
    if (criteria.skills.some((s) => s.toLowerCase() === skill.toLowerCase())) {
      setSkillDraft("");
      return;
    }
    updateCriteria({ skills: [...criteria.skills, skill] });
    setSkillDraft("");
  }

  function removeSkill(skill: string) {
    if (!criteria) return;
    updateCriteria({ skills: criteria.skills.filter((s) => s !== skill) });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === results.length ? new Set() : new Set(results.map((p) => p.pdl_id))));
  }

  return (
    <div>
      <PageHeader
        title="Search & Reachout"
        description="Paste a job description to source passive candidates from People Data Labs, then import the ones you want into a job."
      />

      <div className="two-col-rail">
        <JobHistoryRail jobs={jobs} sourcingJobId={sourcingJobId} onSource={handleSourceFromJob} />
        <div style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
      {error && <ErrorText>{error}</ErrorText>}

      {stage === "input" && (
        <Panel style={{ maxWidth: 720 }}>
          <form onSubmit={handleParse} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <Label>Job description</Label>
              <Textarea
                rows={14}
                placeholder="Paste the job description here…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" disabled={loading || !description.trim()}>
                {loading ? "Parsing…" : "Parse criteria"}
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {stage === "criteria" && criteria && (
        <Panel style={{ maxWidth: 560 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Extracted search criteria</div>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16 }}>
            Gemini read this from the job description. Correct anything before it goes to the search.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <Label>Title</Label>
              <Input value={criteria.title} onChange={(e) => updateCriteria({ title: e.target.value })} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <Label>Seniority</Label>
                <Input value={criteria.seniority} onChange={(e) => updateCriteria({ seniority: e.target.value })} />
              </div>
              <div>
                <Label>Min. experience (years)</Label>
                <Input
                  type="number"
                  min={0}
                  value={criteria.min_experience_years}
                  onChange={(e) => updateCriteria({ min_experience_years: e.target.value === "" ? 0 : Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <Label>Location</Label>
              <Input value={criteria.location} onChange={(e) => updateCriteria({ location: e.target.value })} />
            </div>
            <div>
              <Label>Skills</Label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {criteria.skills.map((skill) => (
                  <span
                    key={skill}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      padding: "3px 6px 3px 9px",
                      border: "1px solid var(--border-strong)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => removeSkill(skill)}
                      aria-label={`Remove ${skill}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 14,
                        height: 14,
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        color: "var(--text-faint)",
                        cursor: "pointer",
                        fontSize: 13,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {criteria.skills.length === 0 && (
                  <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No skills yet.</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Input
                  placeholder="Add a skill…"
                  value={skillDraft}
                  onChange={(e) => setSkillDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSkill();
                    }
                  }}
                />
                <Button type="button" variant="secondary" onClick={addSkill} disabled={!skillDraft.trim()}>
                  Add
                </Button>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <Button variant="secondary" onClick={() => setStage("input")}>
              Back
            </Button>
            <Button onClick={handleSearch} disabled={loading}>
              {loading ? "Searching…" : "Find candidates"}
            </Button>
          </div>
        </Panel>
      )}

      {stage === "results" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <StatRow>
            <MonumentalStat value={results.length} label="Found" />
            <MonumentalStat value={results.filter((p) => p.has_phone).length} label="With phone" />
            <MonumentalStat value={selected.size} label="Selected" />
          </StatRow>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                value={targetJobId}
                onChange={(e) => setTargetJobId(e.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-strong)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontSize: 13.5,
                }}
              >
                <option value="">Import into job…</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}
                  </option>
                ))}
              </select>
              <Button onClick={handleImport} disabled={!targetJobId || selected.size === 0 || importing}>
                {importing ? "Importing…" : `Import ${selected.size || ""}`}
              </Button>
            </div>
          </div>

          {results.length === 0 ? (
            <EmptyState>No candidates matched these criteria.</EmptyState>
          ) : (
            <Panel style={{ padding: 0 }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>№</th>
                      <th style={th}>
                        <input
                          type="checkbox"
                          checked={results.length > 0 && selected.size === results.length}
                          ref={(el) => {
                            if (el) el.indeterminate = selected.size > 0 && selected.size < results.length;
                          }}
                          onChange={toggleAll}
                          aria-label={selected.size === results.length ? "Deselect all" : "Select all"}
                        />
                      </th>
                      <th style={th}>Name</th>
                      <th style={th}>Title</th>
                      <th style={th}>Company</th>
                      <th style={th}>Location</th>
                      <th style={th}>Contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((person, index) => (
                      <tr key={person.pdl_id}>
                        <td style={tdIndex} className="mono">
                          {String(index + 1).padStart(2, "0")}
                        </td>
                        <td style={td}>
                          <input type="checkbox" checked={selected.has(person.pdl_id)} onChange={() => toggle(person.pdl_id)} />
                        </td>
                        <td style={td}>
                          {person.linkedin_url ? (
                            <a href={person.linkedin_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent-strong)" }}>
                              {person.full_name}
                            </a>
                          ) : (
                            person.full_name
                          )}
                        </td>
                        <td style={{ ...td, color: "var(--text-muted)" }}>{person.job_title ?? "—"}</td>
                        <td style={{ ...td, color: "var(--text-muted)" }}>{person.job_company_name ?? "—"}</td>
                        <td style={{ ...td, color: "var(--text-muted)" }}>{person.location_name ?? "—"}</td>
                        <td style={td}>
                          <span style={{ fontSize: 12, color: person.has_phone ? "var(--success)" : "var(--text-faint)" }}>
                            {person.has_phone ? "Phone on file" : "No phone"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
          <div>
            <Button variant="secondary" onClick={() => setStage("criteria")}>
              Back to criteria
            </Button>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
