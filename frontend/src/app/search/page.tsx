"use client";

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
import { PageHeader, Panel, Textarea, Button, ErrorText, Label, EmptyState, StatRow, MonumentalStat, toast, th, td, tdIndex } from "@/components/ui";

type Stage = "input" | "criteria" | "results";

export default function SearchPage() {
  const [stage, setStage] = useState<Stage>("input");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<ParsedCriteria | null>(null);
  const [results, setResults] = useState<PdlPerson[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [targetJobId, setTargetJobId] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listJobs().then(setJobs).catch(() => {});
  }, []);

  async function handleParse(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { criteria } = await parseJd(description);
      setCriteria(criteria);
      setStage("criteria");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to parse job description.");
    } finally {
      setLoading(false);
    }
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

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <PageHeader
        title="Search & Reachout"
        description="Paste a job description to source passive candidates from People Data Labs, then import the ones you want into a job."
      />

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
        <Panel style={{ maxWidth: 720 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Extracted search criteria</div>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", rowGap: 10, fontSize: 13.5 }}>
            <div style={{ color: "var(--text-muted)" }}>Title</div>
            <div>{criteria.title}</div>
            <div style={{ color: "var(--text-muted)" }}>Seniority</div>
            <div>{criteria.seniority}</div>
            <div style={{ color: "var(--text-muted)" }}>Min. experience</div>
            <div>{criteria.min_experience_years} years</div>
            <div style={{ color: "var(--text-muted)" }}>Location</div>
            <div>{criteria.location}</div>
            <div style={{ color: "var(--text-muted)" }}>Skills</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {criteria.skills.map((skill) => (
                <span
                  key={skill}
                  style={{ fontSize: 12, padding: "3px 9px", border: "1px solid var(--border-strong)", color: "var(--text-muted)" }}
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
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
                      <th style={th}></th>
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
  );
}
