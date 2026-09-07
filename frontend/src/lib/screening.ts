// Turns the loose `result` JSON a Hunar screening call produces into ordered,
// labeled fields the UI can render.
//
// The payload is third-party and only loosely specified: fields can be absent,
// extra keys can appear, and a failed call carries an error shape instead of an
// outcome. The rule here is that nothing is ever silently dropped — an
// unrecognized key still reaches the screen under a humanized label, because
// this panel is the only place an HR user sees what the call actually produced.

export type ScreeningFieldKind = "pill" | "mono" | "text";

export type ScreeningField = {
  key: string;
  label: string;
  value: string;
  kind: ScreeningFieldKind;
};

export type NormalizedScreening = {
  /** Ordered fields for the detail grid. Excludes the summary, which renders on its own. */
  fields: ScreeningField[];
  summary: string | null;
  /** True when the call produced nothing worth showing. */
  isEmpty: boolean;
};

/** Known keys, in the order an HR user wants to read them. */
// Covers both spellings seen in practice: `interest_level`/`notice_period_days` and the
// live "Hiring Screener" agent's own schema (`interested`, `notice_period`, `qualified`,
// `recommendation`, …). An agent author picks these names, so the list grows rather than
// the payload being forced to match.
const KNOWN_FIELDS: { key: string; label: string; kind: ScreeningFieldKind }[] = [
  { key: "interest_level", label: "Interest", kind: "pill" },
  { key: "interested", label: "Interested", kind: "pill" },
  { key: "qualified", label: "Qualified", kind: "pill" },
  { key: "recommendation", label: "Recommendation", kind: "text" },
  { key: "notice_period_days", label: "Notice period", kind: "mono" },
  { key: "notice_period", label: "Notice period", kind: "mono" },
  { key: "can_join_shift", label: "Can join shift", kind: "mono" },
  { key: "experience_years", label: "Experience", kind: "mono" },
  { key: "current_ctc", label: "Current CTC", kind: "mono" },
  { key: "expected_ctc", label: "Expected CTC", kind: "mono" },
  { key: "current_location", label: "Location", kind: "mono" },
  { key: "languages", label: "Languages", kind: "mono" },
  { key: "error", label: "Error", kind: "mono" },
  { key: "reason", label: "Reason", kind: "mono" },
];

const SUMMARY_KEYS = ["summary", "notes"];

/** `notice_period_days: 0` is meaningful ("immediate"), so only null/undefined/"" drop out. */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "notice_period_days" && typeof value === "number") {
    if (value === 0) return "Immediate";
    return `${value} day${value === 1 ? "" : "s"}`;
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry) => formatValue(key, entry)).join(", ");
  return JSON.stringify(value);
}

export function normalizeScreeningResult(
  result: Record<string, unknown> | null | undefined
): NormalizedScreening {
  if (!result || typeof result !== "object") {
    return { fields: [], summary: null, isEmpty: true };
  }

  const fields: ScreeningField[] = [];
  const consumed = new Set<string>();

  for (const known of KNOWN_FIELDS) {
    const value = result[known.key];
    if (isBlank(value)) continue;
    consumed.add(known.key);
    fields.push({
      key: known.key,
      label: known.label,
      value: formatValue(known.key, value),
      kind: known.kind,
    });
  }

  let summary: string | null = null;
  for (const key of SUMMARY_KEYS) {
    consumed.add(key);
    const value = result[key];
    if (summary === null && typeof value === "string" && value.trim() !== "") {
      summary = value.trim();
    }
  }

  // Anything the call returned that this UI doesn't know about still gets shown,
  // rather than being hidden behind a schema it was never promised to match.
  for (const [key, value] of Object.entries(result)) {
    if (consumed.has(key) || isBlank(value)) continue;
    fields.push({
      key,
      label: humanizeKey(key),
      value: formatValue(key, value),
      kind: "text",
    });
  }

  return { fields, summary, isEmpty: fields.length === 0 && summary === null };
}

/** Maps a free-text interest level onto the StatusPill tones already in the system. */
export function interestTone(value: string | null | undefined): "success" | "warning" | "neutral" {
  const normalized = (value ?? "").trim().toLowerCase();
  // The live agent returns these as free-text yes/no strings, not an enum.
  if (["high", "very high", "strong", "interested", "yes", "true"].includes(normalized)) return "success";
  if (["low", "very low", "weak", "not interested", "no", "false"].includes(normalized)) return "warning";
  return "neutral";
}

/** 224 -> "3m 44s". Call length is real signal: a 38-second call went differently than a 7-minute one. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}
