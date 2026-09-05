type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TONE_STYLES: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: "var(--bg-hover)", fg: "var(--text-muted)", border: "var(--border-strong)" },
  success: { bg: "var(--success-soft)", fg: "var(--success)", border: "var(--success)" },
  warning: { bg: "var(--warning-soft)", fg: "var(--warning)", border: "var(--warning)" },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)", border: "var(--danger)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)", border: "var(--info)" },
  accent: { bg: "var(--accent-soft)", fg: "var(--accent-strong)", border: "var(--accent)" },
};

// Maps the real states this system actually produces (Hunar call statuses, CAMARA
// verification results, attendance methods) to a tone + human label. Every distinct
// backend state gets its own row here rather than falling through to a generic default,
// per this product's principle: never let an ambiguous state render as a plain success/fail.
const STATE_MAP: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "success" },
  ARCHIVED: { label: "Archived", tone: "neutral" },

  NOT_STARTED: { label: "Not started", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  NOT_CONNECTED: { label: "Not connected", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },

  ENGAGED: { label: "Engaged", tone: "success" },
  NOT_ENGAGED: { label: "Not engaged", tone: "warning" },

  TRUE: { label: "Verified", tone: "success" },
  FALSE: { label: "Not verified", tone: "danger" },
  PARTIAL: { label: "Partially verified", tone: "warning" },
  UNKNOWN: { label: "Inconclusive", tone: "warning" },

  USSD: { label: "USSD", tone: "accent" },
  TELECOM_LOCATION: { label: "Telecom location", tone: "accent" },
};

export function StatusPill({ value, fallbackLabel }: { value: string | null | undefined; fallbackLabel?: string }) {
  const mapped = value ? STATE_MAP[value] ?? { label: value, tone: "neutral" as Tone } : null;
  const label = mapped?.label ?? fallbackLabel ?? "—";
  const style = TONE_STYLES[mapped?.tone ?? "neutral"];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 0,
        border: `1px solid ${style.border}`,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: "0.01em",
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        background: style.bg,
        color: style.fg,
      }}
    >
      {label}
    </span>
  );
}
