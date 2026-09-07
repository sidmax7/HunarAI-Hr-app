import { formatDuration, interestTone, normalizeScreeningResult } from "@/lib/screening";

export type CallOutcome = {
  result: Record<string, unknown> | null;
  recording_url: string | null;
  duration_seconds: number | null;
};

/**
 * The structured outcome of a Hunar call: what the backend has been storing from
 * `call_result_done` / `call_summary` webhooks. Reading this is the point of the
 * product — the recording is the fallback, not the deliverable. Shared between a job's
 * screening interviews and an employee's attendance calls (reminder/escalation), which
 * carry the same result/recording_url/duration_seconds shape from the same webhook.
 */
export function CallResultPanel({ call }: { call: CallOutcome }) {
  const { fields, summary, isEmpty } = normalizeScreeningResult(call.result);
  const duration = formatDuration(call.duration_seconds);

  return (
    <div style={{ background: "var(--bg)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
      {isEmpty && !call.recording_url && (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>This call didn&apos;t return a result.</p>
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

      {call.recording_url && (
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
          <audio controls preload="none" src={call.recording_url} style={{ width: "100%", maxWidth: 420 }}>
            <a href={call.recording_url}>Download the recording</a>
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
