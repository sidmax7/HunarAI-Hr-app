"use client";

import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { ApiError } from "@/lib/api";

// ---- Toast ----
// A minimal pub-sub instead of a Context provider: any page can call toast(...) without
// being wrapped in a provider, and <ToastHost /> (mounted once in the root layout) is the
// only subscriber. Replaces window.alert(), which is jarring against a hand-built design
// system and blocks the page until dismissed.

type Toast = { id: number; message: string; variant: "success" | "danger" };
type ToastListener = (toasts: Toast[]) => void;

let toastId = 0;
let toasts: Toast[] = [];
const toastListeners = new Set<ToastListener>();

function notifyToastListeners() {
  for (const listener of toastListeners) listener(toasts);
}

export function toast(message: string, variant: Toast["variant"] = "success") {
  const id = ++toastId;
  toasts = [...toasts, { id, message, variant }];
  notifyToastListeners();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notifyToastListeners();
  }, 4000);
}

export function ToastHost() {
  const [current, setCurrent] = useState<Toast[]>([]);

  useEffect(() => {
    toastListeners.add(setCurrent);
    return () => {
      toastListeners.delete(setCurrent);
    };
  }, []);

  if (current.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 1000,
        maxWidth: 360,
      }}
    >
      {current.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{
            border: `1px solid ${t.variant === "danger" ? "var(--danger)" : "var(--border-strong)"}`,
            background: t.variant === "danger" ? "var(--danger-soft)" : "var(--bg-elevated)",
            color: t.variant === "danger" ? "var(--danger)" : "var(--text)",
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 550,
            boxShadow: "var(--shadow-elevated)",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

export const SUPPORT_PHONE = "+919686204007";
export const SUPPORT_PHONE_DISPLAY = "+91 96862 04007";

// ApiError is only thrown once a real HTTP response comes back; anything else
// (fetch itself rejecting) means the request never reached a server at all.
export function isBackendUnreachable(err: unknown): boolean {
  return !(err instanceof ApiError);
}

export function ServerUnreachableNotice() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(SUPPORT_PHONE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the tel: link below still works.
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--danger)",
        background: "var(--danger-soft)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 650, color: "var(--danger)" }}>Can&apos;t reach the server</div>
      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
        The backend isn&apos;t responding. If this doesn&apos;t clear up on its own, let Raihaan know so he can restart it.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <a href={`tel:${SUPPORT_PHONE}`}>
          <Button type="button" variant="danger">
            Call Raihaan
          </Button>
        </a>
        <Button type="button" variant="secondary" onClick={handleCopy}>
          {copied ? "Copied" : "Copy number"}
        </Button>
        <span className="mono" style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
          {SUPPORT_PHONE_DISPLAY}
        </span>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.01em" }}>{title}</h1>
        {description && (
          <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginTop: 4, maxWidth: 560 }}>{description}</p>
        )}
      </div>
      {action}
    </header>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Button({
  variant = "primary",
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: "var(--accent)", color: "var(--text)", border: "1px solid var(--accent)" },
    secondary: { background: "transparent", color: "var(--text)", border: "1px solid var(--border-strong)" },
    danger: { background: "var(--danger-soft)", color: "var(--danger)", border: "1px solid transparent" },
  };
  return (
    <button
      {...props}
      style={{
        padding: "8px 14px",
        borderRadius: "var(--radius-sm)",
        fontSize: 13.5,
        fontWeight: 600,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
        ...variants[variant],
        ...style,
      }}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        padding: "8px 10px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-strong)",
        background: "var(--bg)",
        color: "var(--text)",
        fontSize: 13.5,
        width: "100%",
        ...props.style,
      }}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{
        padding: "10px 12px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-strong)",
        background: "var(--bg)",
        color: "var(--text)",
        fontSize: 13.5,
        width: "100%",
        resize: "vertical",
        fontFamily: "inherit",
        ...props.style,
      }}
    />
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 1, marginBottom: 24, flexWrap: "wrap" }}>{children}</div>;
}

export function MonumentalStat({ value, label }: { value: string | number; label: string }) {
  const digits = String(value).split("");
  return (
    <div style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
      <div style={{ display: "flex" }}>
        {digits.map((digit, i) => (
          <div
            key={i}
            className="mono"
            style={{
              width: 38,
              height: 88,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 52,
              fontWeight: 700,
              color: "var(--text)",
              borderRight: i < digits.length - 1 ? "1px solid var(--grid-line-strong)" : "none",
            }}
          >
            {digit}
          </div>
        ))}
      </div>
      <div
        style={{
          padding: "9px 14px 11px",
          borderTop: "1px solid var(--border)",
          fontSize: 10.5,
          fontWeight: 650,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--text-faint)",
        }}
      >
        {label}
      </div>
    </div>
  );
}

export function GhostCell({ title = "Pending" }: { title?: string }) {
  return <span className="ghost-cell" title={title} aria-label={title} />;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "36px 20px",
        textAlign: "center",
        color: "var(--text-muted)",
        fontSize: 13.5,
        border: "1px dashed var(--border-strong)",
        borderRadius: "var(--radius-md)",
      }}
    >
      {children}
    </div>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--danger)", fontSize: 13.5 }}>{children}</p>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
      {children}
    </label>
  );
}

export const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: 11.5,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-faint)",
  borderBottom: "1px solid var(--border)",
};

export const tdIndex: React.CSSProperties = {
  padding: "10px 4px 10px 12px",
  fontSize: 12,
  color: "var(--text-faint)",
  borderBottom: "1px solid var(--border)",
  width: 1,
  whiteSpace: "nowrap",
};

export const td: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13.5,
  borderBottom: "1px solid var(--border)",
};
