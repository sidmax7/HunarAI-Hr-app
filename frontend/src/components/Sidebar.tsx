"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/hiring", label: "Hiring", icon: IconBriefcase },
  { href: "/search", label: "Search & Reachout", icon: IconSearch },
  { href: "/attendance", label: "Attendance", icon: IconMapPin },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      className="sidebar"
      style={{
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: "18px 12px",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 22px" }}>
        <IconWaveform />
        <span style={{ fontWeight: 650, fontSize: 15, letterSpacing: "-0.01em" }}>HunarAI HR</span>
      </div>

      {SECTIONS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 10px",
              borderRadius: "var(--radius-sm)",
              fontSize: 13.5,
              fontWeight: active ? 600 : 500,
              color: active ? "var(--text)" : "var(--text-muted)",
              background: active ? "var(--bg-hover)" : "transparent",
            }}
          >
            <Icon active={active} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function IconWaveform() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="8" width="2.4" height="4" rx="1.2" fill="var(--accent)" />
      <rect x="6.4" y="4" width="2.4" height="12" rx="1.2" fill="var(--accent)" />
      <rect x="10.8" y="1.5" width="2.4" height="17" rx="1.2" fill="var(--accent-strong)" />
      <rect x="15.2" y="6" width="2.4" height="8" rx="1.2" fill="var(--accent)" />
    </svg>
  );
}

function iconColor(active?: boolean) {
  return active ? "var(--accent-strong)" : "var(--text-faint)";
}

function IconBriefcase({ active }: { active?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="5" width="13" height="8.5" rx="1.5" stroke={iconColor(active)} strokeWidth="1.4" />
      <path d="M5.5 5V3.5C5.5 2.67 6.17 2 7 2H9C9.83 2 10.5 2.67 10.5 3.5V5" stroke={iconColor(active)} strokeWidth="1.4" />
      <path d="M1.5 9H14.5" stroke={iconColor(active)} strokeWidth="1.4" />
    </svg>
  );
}

function IconSearch({ active }: { active?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke={iconColor(active)} strokeWidth="1.4" />
      <path d="M10.3 10.3L14 14" stroke={iconColor(active)} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconMapPin({ active }: { active?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 14.5C8 14.5 13 10.2 13 6.5C13 3.74 10.76 1.5 8 1.5C5.24 1.5 3 3.74 3 6.5C3 10.2 8 14.5 8 14.5Z"
        stroke={iconColor(active)}
        strokeWidth="1.4"
      />
      <circle cx="8" cy="6.5" r="1.8" stroke={iconColor(active)} strokeWidth="1.4" />
    </svg>
  );
}
