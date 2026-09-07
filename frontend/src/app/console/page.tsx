"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  API_URL,
  listEmployees,
  listJobs,
  listLocations,
  type Employee,
  type Job,
  type Location,
} from "@/lib/api";
import {
  coerceFieldValue,
  defaultFieldText,
  FieldValueError,
  GROUP_LABELS,
  groupOperations,
  parseOperations,
  baseSchema,
  type OpenApiSpec,
  type Operation,
  type SchemaObject,
} from "@/lib/openapi";
import {
  Button,
  EmptyState,
  ErrorText,
  Input,
  Label,
  PageHeader,
  Panel,
  ServerUnreachableNotice,
} from "@/components/ui";

// The calls worth reaching for without hunting the rail: the ones actually used
// to exercise this system by hand.
const PINNED: { id: string; label: string }[] = [
  { id: "POST /api/attendance/telecom-verify", label: "Check an employee in" },
  { id: "POST /api/attendance/reminders/run", label: "Run missed check-in reminders" },
  { id: "POST /api/attendance/ussd/simulate", label: "Simulate a USSD dial" },
  { id: "GET /api/attendance/today", label: "Today's attendance" },
  { id: "GET /api/health", label: "Backend health" },
];

// Endpoints that can put a real outbound phone call on someone's handset. The
// console fires against the same backend the product uses, so this is worth
// saying out loud before someone presses Send to see what happens.
const DIALS_REAL_PHONES = new Set([
  "POST /api/jobs/{job_id}/screen",
  "POST /api/attendance/reminders/run",
  "POST /api/attendance/telecom-verify",
]);

const METHOD_COLOR: Record<string, string> = {
  GET: "var(--info)",
  POST: "var(--success)",
  PATCH: "var(--warning)",
  PUT: "var(--warning)",
  DELETE: "var(--danger)",
};

function methodColor(method: string): string {
  return METHOD_COLOR[method] ?? "var(--text-muted)";
}

function statusColor(status: number | null): string {
  if (status === null) return "var(--danger)";
  if (status >= 500) return "var(--danger)";
  if (status >= 400) return "var(--warning)";
  if (status >= 300) return "var(--info)";
  return "var(--success)";
}

type EntityOptions = { value: string; label: string }[];

type Entities = {
  employees: EntityOptions;
  jobs: EntityOptions;
  locations: EntityOptions;
  firstEmployee: Employee | null;
  firstLocation: Location | null;
};

const NO_ENTITIES: Entities = {
  employees: [],
  jobs: [],
  locations: [],
  firstEmployee: null,
  firstLocation: null,
};

function optionsFor(fieldName: string, entities: Entities): EntityOptions | null {
  if (fieldName === "employee_id") return entities.employees.length ? entities.employees : null;
  if (fieldName === "job_id") return entities.jobs.length ? entities.jobs : null;
  if (fieldName === "location_id") return entities.locations.length ? entities.locations : null;
  return null;
}

type ConsoleResponse = {
  seq: number;
  status: number | null;
  statusText: string;
  ms: number;
  body: string;
};

export default function ConsolePage() {
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [entities, setEntities] = useState<Entities>(NO_ENTITIES);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [queryValues, setQueryValues] = useState<Record<string, string>>({});
  const [bodyValues, setBodyValues] = useState<Record<string, string>>({});
  const [jsonDraft, setJsonDraft] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [response, setResponse] = useState<ConsoleResponse | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    fetch(`${API_URL}/openapi.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`The spec returned ${res.status}.`);
        return (await res.json()) as OpenApiSpec;
      })
      .then((spec) => {
        const parsed = parseOperations(spec);
        setOperations(parsed);
        const pinnedFirst = parsed.find((op) => op.id === PINNED[0].id);
        setSelectedId(pinnedFirst?.id ?? parsed[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        // A thrown fetch (rather than a bad status) means nothing answered at all.
        setUnreachable(!(err instanceof Error) || err.message.startsWith("NetworkError") || err.name === "TypeError");
        setSpecError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  // Real values for the id fields, so a testing call is two clicks rather than a
  // hunt for a UUID. Each list is optional — the console still works without them.
  useEffect(() => {
    Promise.all([
      listEmployees().catch(() => [] as Employee[]),
      listJobs().catch(() => [] as Job[]),
      listLocations().catch(() => [] as Location[]),
    ]).then(([employees, jobs, locations]) => {
      setEntities({
        employees: employees.map((e) => ({
          value: e.id,
          label: e.phone_number ? `${e.name} — ${e.phone_number}` : e.name,
        })),
        jobs: jobs.map((j) => ({ value: j.id, label: j.title })),
        locations: locations.map((l) => ({ value: l.id, label: `${l.name} (${l.site_code})` })),
        firstEmployee: employees[0] ?? null,
        firstLocation: locations[0] ?? null,
      });
    });
  }, []);

  const selected = useMemo(
    () => operations?.find((op) => op.id === selectedId) ?? null,
    [operations, selectedId]
  );

  const bodyProperties = useMemo(() => {
    if (!selected?.bodySchema?.properties) return [];
    return Object.entries(selected.bodySchema.properties);
  }, [selected]);

  // Selecting an operation starts its fields from the schema's own defaults.
  useEffect(() => {
    if (!selected) return;
    const nextPath: Record<string, string> = {};
    const nextQuery: Record<string, string> = {};
    for (const param of selected.params) {
      const text = defaultFieldText(param.schema);
      if (param.in === "path") nextPath[param.name] = text;
      else nextQuery[param.name] = text;
    }
    const nextBody: Record<string, string> = {};
    for (const [name, schema] of Object.entries(selected.bodySchema?.properties ?? {})) {
      nextBody[name] = defaultFieldText(schema);
    }
    setPathValues(nextPath);
    setQueryValues(nextQuery);
    setBodyValues(nextBody);
    setJsonDraft(selected.freeformBody ? "{}" : null);
    setResponse(null);
    setSendError(null);
  }, [selected]);

  // Fill still-empty fields from what the system actually holds right now. Only
  // blanks are touched, so anything typed by hand survives.
  useEffect(() => {
    if (!selected) return;

    const fill = (name: string): string | null => {
      const options = optionsFor(name, entities);
      if (options?.length) return options[0].value;
      if (name === "mobile_number") return entities.firstEmployee?.phone_number ?? null;
      if (name === "dialed_string") {
        const site = entities.firstLocation;
        if (site?.site_code && site.current_pin) return `*805*${site.site_code}*${site.current_pin}#`;
      }
      return null;
    };

    setPathValues((current) => {
      let changed = false;
      const next = { ...current };
      for (const param of selected.params) {
        if (param.in !== "path" || next[param.name]) continue;
        const value = fill(param.name);
        if (value) {
          next[param.name] = value;
          changed = true;
        }
      }
      return changed ? next : current;
    });

    setBodyValues((current) => {
      let changed = false;
      const next = { ...current };
      for (const name of Object.keys(selected.bodySchema?.properties ?? {})) {
        if (next[name]) continue;
        const value = fill(name);
        if (value) {
          next[name] = value;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [selected, entities]);

  const send = useCallback(async () => {
    if (!selected) return;
    setSendError(null);

    let url = `${API_URL}${selected.path}`;
    for (const param of selected.params.filter((p) => p.in === "path")) {
      const value = pathValues[param.name]?.trim() ?? "";
      if (!value) {
        setSendError(`${param.name} is part of the path — fill it in before sending.`);
        return;
      }
      url = url.replace(`{${param.name}}`, encodeURIComponent(value));
    }

    const query = new URLSearchParams();
    for (const param of selected.params.filter((p) => p.in === "query")) {
      const value = queryValues[param.name]?.trim() ?? "";
      if (value) query.set(param.name, value);
    }
    if ([...query].length) url += `?${query.toString()}`;

    let payload: string | undefined;
    if (jsonDraft !== null) {
      try {
        JSON.parse(jsonDraft);
      } catch {
        setSendError("The request body isn't valid JSON yet.");
        return;
      }
      payload = jsonDraft;
    } else if (selected.bodySchema) {
      const body: Record<string, unknown> = {};
      const required = selected.bodySchema.required ?? [];
      try {
        for (const [name, schema] of bodyProperties) {
          const text = bodyValues[name] ?? "";
          if (!text.trim()) {
            if (required.includes(name)) {
              setSendError(`${name} is required — fill it in before sending.`);
              return;
            }
            continue;
          }
          body[name] = coerceFieldValue(schema, name, text);
        }
      } catch (err) {
        setSendError(err instanceof FieldValueError ? err.message : String(err));
        return;
      }
      payload = JSON.stringify(body);
    }

    setSending(true);
    const started = performance.now();
    try {
      const res = await fetch(url, {
        method: selected.method,
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload,
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON — show exactly what came back.
      }
      seq.current += 1;
      setResponse({
        seq: seq.current,
        status: res.status,
        statusText: res.statusText,
        ms: Math.round(performance.now() - started),
        body: pretty || "(empty response body)",
      });
    } catch {
      seq.current += 1;
      setResponse({
        seq: seq.current,
        status: null,
        statusText: "No response",
        ms: Math.round(performance.now() - started),
        body: `The request never reached ${API_URL}. Check that the backend is running.`,
      });
    } finally {
      setSending(false);
    }
  }, [selected, pathValues, queryValues, bodyValues, bodyProperties, jsonDraft]);

  const grouped = useMemo(() => (operations ? groupOperations(operations) : []), [operations]);
  const pinnedOperations = useMemo(
    () =>
      PINNED.map((pin) => ({ pin, operation: operations?.find((op) => op.id === pin.id) })).filter(
        (entry): entry is { pin: (typeof PINNED)[number]; operation: Operation } => Boolean(entry.operation)
      ),
    [operations]
  );

  return (
    <div>
      <PageHeader
        title="API console"
        description="Every endpoint the backend currently exposes, read from its live OpenAPI spec. Pick a call, fill the fields, and read the raw response."
      />

      {specError && unreachable && <ServerUnreachableNotice />}
      {specError && !unreachable && <ErrorText>Couldn&apos;t read the API spec: {specError}</ErrorText>}
      {!operations && !specError && <p style={{ color: "var(--text-muted)" }}>Loading the spec…</p>}

      {operations && (
        <div className="two-col-rail">
          <Panel style={{ padding: 0, position: "sticky", top: 20, maxHeight: "calc(100vh - 40px)", overflowY: "auto" }}>
            {pinnedOperations.length > 0 && (
              <RailGroup label="Testing calls">
                {pinnedOperations.map(({ pin, operation }) => (
                  <RailRow
                    key={pin.id}
                    method={operation.method}
                    label={pin.label}
                    selected={operation.id === selectedId}
                    onSelect={() => setSelectedId(operation.id)}
                  />
                ))}
              </RailGroup>
            )}

            {grouped.map(({ group, operations: groupOps }) => (
              <RailGroup key={group} label={GROUP_LABELS[group] ?? group}>
                {groupOps.map((operation) => (
                  <RailRow
                    key={operation.id}
                    method={operation.method}
                    label={operation.path}
                    mono
                    selected={operation.id === selectedId}
                    onSelect={() => setSelectedId(operation.id)}
                  />
                ))}
              </RailGroup>
            ))}
          </Panel>

          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            {selected && (
              <Panel>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span
                    className="mono"
                    style={{
                      padding: "2px 8px",
                      border: `1px solid ${methodColor(selected.method)}`,
                      color: methodColor(selected.method),
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    {selected.method}
                  </span>
                  <span className="mono" style={{ fontSize: 13, wordBreak: "break-all" }}>
                    {selected.path}
                  </span>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8 }}>{selected.summary}</p>

                {DIALS_REAL_PHONES.has(selected.id) && (
                  <p
                    style={{
                      marginTop: 12,
                      padding: "8px 10px",
                      border: "1px solid var(--warning)",
                      background: "var(--warning-soft)",
                      color: "var(--warning)",
                      fontSize: 12.5,
                    }}
                  >
                    Sending this can place a real outbound phone call.
                  </p>
                )}

                {selected.fileUpload ? (
                  <p style={{ marginTop: 16, color: "var(--text-muted)", fontSize: 13 }}>
                    This endpoint takes a file upload, which this console can&apos;t compose. Use the CSV import on the
                    job&apos;s own page instead.
                  </p>
                ) : (
                  <>
                    {selected.params.filter((p) => p.in === "path").length > 0 && (
                      <FieldSection title="Path">
                        {selected.params
                          .filter((p) => p.in === "path")
                          .map((param) => (
                            <FieldControl
                              key={param.name}
                              name={param.name}
                              schema={param.schema}
                              required={param.required}
                              value={pathValues[param.name] ?? ""}
                              options={optionsFor(param.name, entities)}
                              onChange={(value) => setPathValues((c) => ({ ...c, [param.name]: value }))}
                            />
                          ))}
                      </FieldSection>
                    )}

                    {selected.params.filter((p) => p.in === "query").length > 0 && (
                      <FieldSection title="Query">
                        {selected.params
                          .filter((p) => p.in === "query")
                          .map((param) => (
                            <FieldControl
                              key={param.name}
                              name={param.name}
                              schema={param.schema}
                              required={param.required}
                              value={queryValues[param.name] ?? ""}
                              options={optionsFor(param.name, entities)}
                              onChange={(value) => setQueryValues((c) => ({ ...c, [param.name]: value }))}
                            />
                          ))}
                      </FieldSection>
                    )}

                    {(selected.bodySchema || selected.freeformBody) && (
                      <FieldSection
                        title="Body"
                        action={
                          selected.bodySchema ? (
                            <div style={{ display: "flex", gap: 1 }}>
                              <ModeTab
                                label="Fields"
                                active={jsonDraft === null}
                                onClick={() => setJsonDraft(null)}
                              />
                              <ModeTab
                                label="JSON"
                                active={jsonDraft !== null}
                                onClick={() => {
                                  const draft: Record<string, unknown> = {};
                                  for (const [name, schema] of bodyProperties) {
                                    const text = bodyValues[name] ?? "";
                                    if (!text.trim()) continue;
                                    try {
                                      draft[name] = coerceFieldValue(schema, name, text);
                                    } catch {
                                      draft[name] = text;
                                    }
                                  }
                                  setJsonDraft(JSON.stringify(draft, null, 2));
                                }}
                              />
                            </div>
                          ) : undefined
                        }
                      >
                        {jsonDraft !== null ? (
                          <textarea
                            className="mono"
                            value={jsonDraft}
                            onChange={(e) => setJsonDraft(e.target.value)}
                            spellCheck={false}
                            rows={Math.min(18, Math.max(6, jsonDraft.split("\n").length + 1))}
                            style={{
                              padding: "10px 12px",
                              border: "1px solid var(--border-strong)",
                              background: "var(--bg)",
                              color: "var(--text)",
                              fontSize: 12.5,
                              width: "100%",
                              resize: "vertical",
                              lineHeight: 1.6,
                            }}
                          />
                        ) : (
                          bodyProperties.map(([name, schema]) => (
                            <FieldControl
                              key={name}
                              name={name}
                              schema={schema}
                              required={(selected.bodySchema?.required ?? []).includes(name)}
                              value={bodyValues[name] ?? ""}
                              options={optionsFor(name, entities)}
                              onChange={(value) => setBodyValues((c) => ({ ...c, [name]: value }))}
                            />
                          ))
                        )}
                      </FieldSection>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
                      <Button onClick={send} disabled={sending}>
                        {sending ? "Sending…" : "Send request"}
                      </Button>
                      {sendError && <ErrorText>{sendError}</ErrorText>}
                    </div>
                  </>
                )}
              </Panel>
            )}

            <Panel style={{ padding: 0, minWidth: 0 }}>
              <div
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: "var(--text-faint)",
                  }}
                >
                  Response
                </span>
                {response && (
                  <span className="mono" style={{ fontSize: 12.5, color: statusColor(response.status) }}>
                    {response.status ?? "—"} {response.statusText} · {response.ms} ms
                  </span>
                )}
              </div>

              {response ? (
                <pre
                  key={response.seq}
                  className="mono response-settle"
                  style={{
                    margin: 0,
                    padding: "14px 16px",
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    color: "var(--text)",
                    maxHeight: 460,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {response.body}
                </pre>
              ) : (
                <div style={{ padding: 16 }}>
                  <EmptyState>Nothing sent yet — the response will print here.</EmptyState>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function RailGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-faint)",
          background: "var(--bg-sidebar)",
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function RailRow({
  method,
  label,
  mono,
  selected,
  onSelect,
}: {
  method: string;
  label: string;
  mono?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={selected ? undefined : "rail-row"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        textAlign: "left",
        padding: "8px 14px",
        borderRadius: 0,
        border: "none",
        borderBottom: "1px solid var(--border)",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        background: selected ? "var(--bg-hover)" : undefined,
        color: selected ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: 12.5,
        fontWeight: selected ? 600 : 500,
      }}
    >
      <span
        className="mono"
        style={{ width: 40, flexShrink: 0, fontSize: 10, color: methodColor(method), letterSpacing: "0.04em" }}
      >
        {method}
      </span>
      <span
        className={mono ? "mono" : undefined}
        style={{ fontSize: mono ? 11.5 : 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {label}
      </span>
    </button>
  );
}

function FieldSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--text-faint)",
          }}
        >
          {title}
        </span>
        {action}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}

function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px",
        borderRadius: 0,
        border: `1px solid ${active ? "var(--border-strong)" : "var(--border)"}`,
        background: active ? "var(--bg-hover)" : "transparent",
        color: active ? "var(--text)" : "var(--text-faint)",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function FieldControl({
  name,
  schema,
  required,
  value,
  options,
  onChange,
}: {
  name: string;
  schema: SchemaObject;
  required: boolean;
  value: string;
  options: EntityOptions | null;
  onChange: (value: string) => void;
}) {
  const base = baseSchema(schema);
  const isStructured = base.type === "array" || base.type === "object";

  const selectStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 0,
    border: "1px solid var(--border-strong)",
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 13.5,
    width: "100%",
  };

  return (
    <div>
      <Label>
        <span className="mono">{name}</span>
        {required && <span style={{ color: "var(--danger)" }}> *</span>}
        <span style={{ color: "var(--text-faint)", fontWeight: 500 }}>
          {" "}
          {base.type ?? "string"}
          {base.format ? ` · ${base.format}` : ""}
        </span>
      </Label>

      {options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
          <option value="">— select —</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : base.type === "boolean" ? (
        <select value={value || "false"} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      ) : isStructured ? (
        <textarea
          className="mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          rows={4}
          style={{ ...selectStyle, fontSize: 12.5, resize: "vertical", lineHeight: 1.6 }}
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={base.type === "integer" || base.type === "number" ? "numeric" : undefined}
          placeholder={base.format === "time" ? "HH:MM:SS" : ""}
        />
      )}
    </div>
  );
}
