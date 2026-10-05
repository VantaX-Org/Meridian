/**
 * ui-core — the page-level kit every rebuilt route is assembled from.
 *
 * Aurora owns the primitives (DataTable, Drawer, Tabs, Button, Chip …);
 * ui-core adds the handful of compositions that DESIGN.md names and
 * nothing else. Read frontend/DESIGN.md before adding to this file.
 *
 * Styles: app/styles/ui-core.css (`ui-` prefix, Aurora tokens only).
 */

"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button as AuroraButton, Input as AuroraInput } from "@/components/aurora";

export {
  Banner,
  Button,
  Chip,
  DataTable,
  Drawer as DetailDrawer,
  Input,
  Pager,
  Tabs,
  useDrawerParam,
} from "@/components/aurora";
export type { AuroraColumnMeta, TabsItem } from "@/components/aurora";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── PageHeader ────────────────────────────────────────────────────── */

export interface PageHeaderProps {
  title: ReactNode;
  /** One factual line: scope, counts, freshness. Not a tagline. */
  summary?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, summary, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header__text">
        <h1 className="ui-page-header__title">{title}</h1>
        {summary ? <p className="ui-page-header__summary">{summary}</p> : null}
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}

/* ── Metric ────────────────────────────────────────────────────────── */

export interface MetricDelta {
  value: number;
  unit?: string;
  /** Which direction is an improvement. */
  good: "up" | "down";
}

export interface MetricProps {
  label: string;
  /** null renders an em dash — never a made-up number. */
  value: number | string | null;
  unit?: string;
  delta?: MetricDelta | null;
  href?: string;
  tone?: "default" | "danger" | "warning";
}

// Fixed locale so server and client render the same string.
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function Metric({ label, value, unit, delta, href, tone = "default" }: MetricProps) {
  const body = (
    <>
      <dt className="ui-metric__label">{label}</dt>
      <dd className="ui-metric__value aurora-number" data-tone={tone}>
        {typeof value === "number" ? fmt(value) : (value ?? "—")}
        {value != null && unit ? <span className="ui-metric__unit">{unit}</span> : null}
        {delta && delta.value !== 0 ? (
          <span
            className="ui-metric__delta"
            data-good={(delta.value > 0) === (delta.good === "up")}
          >
            {delta.value > 0 ? "+" : "−"}
            {fmt(Math.abs(delta.value))}
            {delta.unit ?? ""}
          </span>
        ) : null}
      </dd>
    </>
  );
  return href ? (
    <Link href={href} className="ui-metric ui-metric--link">
      {body}
    </Link>
  ) : (
    <div className="ui-metric">{body}</div>
  );
}

/** A row of metrics separated by hairlines — not a grid of cards. */
export function MetricStrip({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <dl className="ui-metric-strip" aria-label={label}>
      {children}
    </dl>
  );
}

/* ── StatusBadge ───────────────────────────────────────────────────── */

export type Status =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "ok"
  | "running"
  | "failed"
  | "idle";

export function StatusBadge({ status, children }: { status: Status; children?: ReactNode }) {
  return (
    <span className="ui-status" data-status={status}>
      <span className="ui-status__dot" aria-hidden />
      {children ?? status}
    </span>
  );
}

/* ── EmptyState ────────────────────────────────────────────────────── */

/** One line saying why it is empty, and the next action. No icon. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-empty" role="status">
      <span>{children}</span>
      {action}
    </div>
  );
}

/* ── FilterBar ─────────────────────────────────────────────────────── */

export interface FilterBarProps {
  /** Active filter chips. */
  children?: ReactNode;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  onClear?: () => void;
  actions?: ReactNode;
}

/** "/" focuses the search field from anywhere on the page. */
export function FilterBar({ children, search, onClear, actions }: FilterBarProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!search) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || t?.closest("input,textarea,select,[contenteditable=true]")) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search]);

  return (
    <div className="ui-filterbar" role="search">
      {search ? (
        <label className="ui-filterbar__search">
          <span className="ui-visually-hidden">Search</span>
          <input
            ref={ref}
            type="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? "Filter"}
          />
          <kbd aria-hidden>/</kbd>
        </label>
      ) : null}
      <div className="ui-filterbar__chips">{children}</div>
      {onClear ? (
        <button type="button" className="ui-link-button" onClick={onClear}>
          Clear filters
        </button>
      ) : null}
      {actions ? <div className="ui-filterbar__actions">{actions}</div> : null}
    </div>
  );
}

/* ── SectionCard ───────────────────────────────────────────────────── */

export interface SectionCardProps {
  title: ReactNode;
  /** Right-of-title fact: a count, a timestamp. */
  meta?: ReactNode;
  action?: ReactNode;
  /** Drop body padding so a table runs edge to edge. */
  flush?: boolean;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ title, meta, action, flush, children, className }: SectionCardProps) {
  return (
    <section className={cx("ui-section", className)}>
      <header className="ui-section__head">
        <h2 className="ui-section__title">{title}</h2>
        {meta ? <span className="ui-section__meta aurora-number">{meta}</span> : null}
        {action ? <div className="ui-section__action">{action}</div> : null}
      </header>
      <div className={cx("ui-section__body", flush && "ui-section__body--flush")}>{children}</div>
    </section>
  );
}

/* ── KeyValue ──────────────────────────────────────────────────────── */

export function KeyValue({
  rows,
}: {
  rows: ReadonlyArray<{ k: string; v: ReactNode; mono?: boolean }>;
}) {
  return (
    <dl className="ui-kv">
      {rows.map((r) => (
        <div key={r.k} className="ui-kv__row">
          <dt>{r.k}</dt>
          <dd data-mono={r.mono || undefined}>{r.v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── FieldChip / Mono ──────────────────────────────────────────────── */

/** An SAP table.field reference, e.g. LFA1.STCD1. */
export function FieldChip({ table, field }: { table?: string | null; field: string }) {
  return (
    <code className="ui-field">
      {table ? <span className="ui-field__table">{table}.</span> : null}
      {field}
    </code>
  );
}

/** Any SAP identifier: check ID, document number, vendor number. */
export function Mono({ children }: { children: ReactNode }) {
  return <span className="ui-mono">{children}</span>;
}

/* ── TableSkeleton ─────────────────────────────────────────────────── */

export function TableSkeleton({ rows = 8, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="ui-skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ui-skeleton__row" />
      ))}
    </div>
  );
}

/* ── ReasonButton ──────────────────────────────────────────────────── */

/** An action the API refuses without a written reason (false positive,
 * suppression). Opens an inline field; the confirm stays disabled until
 * the reason has text. */
export function ReasonButton({ label, prompt, onConfirm, disabled, size }: {
  label: string;
  /** Field label, e.g. "Why is this not an issue?" */
  prompt: string;
  onConfirm: (reason: string) => void;
  disabled?: boolean;
  size?: "sm";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const id = useId();
  if (!open) {
    return <AuroraButton size={size} variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>{label}</AuroraButton>;
  }
  const text = reason.trim();
  const submit = () => {
    if (!text) return;
    onConfirm(text);
    setOpen(false);
    setReason("");
  };
  return (
    <form className="ui-reason" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label htmlFor={id} className="ui-reason__label">{prompt}</label>
      <AuroraInput id={id} autoFocus required maxLength={2000} value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      <AuroraButton size={size} type="submit" disabled={!text || disabled}>{label}</AuroraButton>
      <AuroraButton size={size} variant="ghost" type="button" onClick={() => setOpen(false)}>Keep as is</AuroraButton>
    </form>
  );
}

/* ── Forms (batch: settings) ───────────────────────────────────────── */

export { Field, Select, Textarea } from "@/components/aurora";
export type { SelectOption } from "@/components/aurora";

/* ── DiffView: a unified diff, line by line ────────────────────────── */

/** Renders a unified-diff string. Added and removed lines differ by sign
 *  and by hue, so the change reads without colour as well. */
export function DiffView({ diff, label = "Changes" }: { diff: string; label?: string }) {
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <pre className="ui-diff" aria-label={label}>
      {lines.map((line, i) => {
        const kind = line.startsWith("+++") || line.startsWith("---") ? "file"
          : line.startsWith("@@") ? "hunk"
          : line.startsWith("+") ? "add"
          : line.startsWith("-") ? "del" : "ctx";
        return <span key={i} className="ui-diff__line" data-kind={kind}>{line || " "}{"\n"}</span>;
      })}
    </pre>
  );
}

export { Tally, TallyFigure } from "./tally";
export type { TallyProps, TallyFigureProps } from "./tally";
export { Verdict } from "./verdict";
