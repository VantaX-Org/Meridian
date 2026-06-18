"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Sparkline, useCountUp } from "./charts";
import { TrendUp, TrendDown, MinusIcon, ArrowUpRight } from "./icons";

/* ── DeltaPill ─────────────────────────────────────────────────────── */
interface DeltaPillProps {
  delta?: number | null;
  unit?: string;
  invertColors?: boolean;
}
export function DeltaPill({ delta, unit = " pts", invertColors = false }: DeltaPillProps) {
  if (delta === undefined || delta === null) return null;
  let tone: "pos" | "neg" | "neu";
  if (delta === 0) tone = "neu";
  else if (invertColors) tone = delta < 0 ? "pos" : "neg";
  else tone = delta > 0 ? "pos" : "neg";
  const Icon = tone === "pos" ? TrendUp : tone === "neg" ? TrendDown : MinusIcon;
  return (
    <span className={`mn-delta ${tone}`}>
      <Icon />
      {delta > 0 ? "+" : ""}
      {delta}
      {unit}
    </span>
  );
}

/* ── KPI tile ──────────────────────────────────────────────────────── */
interface KPIProps {
  label: string;
  value: ReactNode;
  suffix?: string;
  delta?: number | null;
  deltaUnit?: string;
  spark?: number[];
  hint?: string;
  href?: string;
  tone?: "pos" | "neg" | "warn";
  invertColors?: boolean;
}
export function KPI({
  label,
  value,
  suffix,
  delta,
  deltaUnit,
  spark,
  hint,
  href,
  tone,
  invertColors,
}: KPIProps) {
  const lowerIsBetter = invertColors;
  const improving = delta == null ? null : lowerIsBetter ? delta < 0 : delta > 0;
  const sparkStroke =
    improving === true
      ? "var(--mn-pos)"
      : improving === false
        ? "var(--mn-neg)"
        : tone === "warn"
          ? "var(--mn-warn)"
          : "var(--mn-primary)";

  const body = (
    <>
      <div className="mn-kpi-label">
        <span className="mn-eyebrow">{label}</span>
        {href && <ArrowUpRight size={13} className="mn-kpi-link" />}
      </div>
      <div className="mn-kpi-row">
        <span className="mn-kpi-value mn-tabular">
          {value}
          {suffix && <span className="mn-kpi-suffix">{suffix}</span>}
        </span>
        <DeltaPill delta={delta} unit={deltaUnit ?? ""} invertColors={invertColors} />
      </div>
      <div className="mn-kpi-spark">
        {spark && spark.length > 1 ? (
          <Sparkline data={spark} width={220} height={22} stroke={sparkStroke} />
        ) : hint ? (
          <span className="mn-kpi-hint">{hint}</span>
        ) : null}
      </div>
    </>
  );

  const className = `mn-kpi ${tone ? `tone-${tone}` : ""}`;
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

/* ── SectionHeader ─────────────────────────────────────────────────── */
interface SectionHeaderProps {
  title: string;
  caption?: ReactNode;
  right?: ReactNode;
}
export function SectionHeader({ title, caption, right }: SectionHeaderProps) {
  return (
    <div className="mn-section">
      <div>
        <h2>{title}</h2>
        {caption && <div className="cap">{caption}</div>}
      </div>
      {right}
    </div>
  );
}

/* ── ScoreCell (table) ─────────────────────────────────────────────── */
export function ScoreCell({ value }: { value: number }) {
  const c =
    value >= 90
      ? "var(--mn-pos)"
      : value >= 80
        ? "var(--mn-primary)"
        : value >= 70
          ? "var(--mn-warn)"
          : "var(--mn-neg)";
  return (
    <div className="mn-score">
      <span className="bar" style={{ ["--p" as string]: `${value}%`, ["--c" as string]: c } as React.CSSProperties} />
      <span className="num" style={{ color: c }}>
        {value.toFixed(1)}
      </span>
    </div>
  );
}

/* ── SevPill ───────────────────────────────────────────────────────── */
export function SevPill({ value, severity }: { value: number; severity: "crit" | "high" }) {
  if (value === 0) return <span className="mn-sevpill zero">0</span>;
  return <span className={`mn-sevpill ${severity}`}>{value}</span>;
}

/* ── ActivityTicker ────────────────────────────────────────────────── */
export interface ActivityItem {
  t: string;
  tag: "DRIFT" | "RUN" | "RESOLVED" | "RULE" | "SYNC" | "ALERT" | string;
  module: string;
  msg: string;
}
export function ActivityTicker({ items }: { items: ActivityItem[] }) {
  if (!items || items.length === 0) return null;
  const loop = [...items, ...items];
  const tagClass = (t: string) =>
    ({ ALERT: "alert", RESOLVED: "resolved", DRIFT: "drift", RULE: "rule" }[t] ?? "");
  return (
    <div className="mn-ticker">
      <span className="label">Activity</span>
      <div className="feed">
        <div className="mn-ticker-track">
          {loop.map((it, i) => (
            <span className="item" key={i}>
              <span className="tt">{it.t}</span>
              <span className={`tag ${tagClass(it.tag)}`}>{it.tag}</span>
              <span className="mod">{it.module}</span>
              <span style={{ color: "var(--mn-ink-400)" }}>{it.msg}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── HeroValue (count-up + shimmer) ───────────────────────────────── */
export function HeroValue({ value, decimals = 1 }: { value: number; decimals?: number }) {
  const v = useCountUp(value, 1100, decimals);
  return <span className="mn-hero-value mn-shimmer">{v.toFixed(decimals)}</span>;
}

/* ── SevTag (UPPERCASE mono tag) ───────────────────────────────────── */
const SEV_TAG_MAP: Record<string, string> = {
  critical: "crit",
  high: "high",
  medium: "med",
  low: "low",
};
export function SevTag({ sev }: { sev: string }) {
  const cls = SEV_TAG_MAP[sev] ?? "med";
  return <span className={`mn-sevtag sev-${cls}`}>{sev.toUpperCase()}</span>;
}

/* ── StatusDot ─────────────────────────────────────────────────────── */
const STATUS_MAP: Record<string, { color: string; label: string }> = {
  healthy:    { color: "var(--mn-pos)",     label: "Healthy" },
  degraded:   { color: "var(--mn-warn)",    label: "Degraded" },
  down:       { color: "var(--mn-neg)",     label: "Down" },
  scheduled:  { color: "var(--mn-ink-300)", label: "Scheduled" },
  open:       { color: "var(--mn-neg)",     label: "Open" },
  "in-review":{ color: "var(--mn-warn)",    label: "In review" },
  resolved:   { color: "var(--mn-pos)",     label: "Resolved" },
};
export function StatusDot({ status }: { status: string }) {
  const m = STATUS_MAP[status] ?? { color: "var(--mn-ink-300)", label: status };
  return (
    <span className="mn-status">
      <span
        className="mn-status-dot"
        style={{
          background: m.color,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${m.color} 22%, transparent)`,
        }}
      />
      {m.label}
    </span>
  );
}

/* ── PriorityChip ──────────────────────────────────────────────────── */
export function PriorityChip({ p }: { p: "P1" | "P2" | "P3" }) {
  const tone = p === "P1" ? "neg" : p === "P2" ? "warn" : "neu";
  return <span className={`mn-prio mn-prio-${tone}`}>{p}</span>;
}

/* ── ModChip / OwnerChip ───────────────────────────────────────────── */
export function ModChip({ children }: { children: ReactNode }) {
  return <span className="mn-mod-chip">{children}</span>;
}
export function OwnerChip({ owner }: { owner: string }) {
  if (!owner || owner === "—") return <span style={{ color: "var(--mn-ink-300)" }}>—</span>;
  return <span className="mn-owner-chip" title={owner}>{owner}</span>;
}

/* ── PageHead ──────────────────────────────────────────────────────── */
interface PageHeadProps {
  title: string;
  route?: string;
  sub?: ReactNode;
  actions?: ReactNode;
}
export function PageHead({ title, route, sub, actions }: PageHeadProps) {
  return (
    <div className="mn-page-head">
      <div>
        <h1 className="mn-h1">
          {title}
          {route && <span className="mn-h1-mono">{route}</span>}
        </h1>
        {sub && <p className="mn-sub">{sub}</p>}
      </div>
      {actions && <div className="mn-page-actions">{actions}</div>}
    </div>
  );
}
