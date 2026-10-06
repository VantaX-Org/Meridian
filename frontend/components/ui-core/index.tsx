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
import { Button as AuroraButton, Chip as AuroraChip, Input as AuroraInput, Menu, MenuItem } from "@/components/aurora";

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
export type { AuroraColumnMeta, ChipTone, TabsItem } from "@/components/aurora";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── SegmentedControl ──────────────────────────────────────────────── */

/** A few views of one surface, one active. Arrow keys move the choice. */
export function SegmentedControl({ value, options, onChange, ariaLabel }: {
  value: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  const move = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = options[(i + step + options.length) % options.length];
    onChange(next.id);
    (e.currentTarget.parentElement?.querySelector(`[data-id="${next.id}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="ui-segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o, i) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} data-id={o.id}
          tabIndex={o.id === value ? 0 : -1} className="ui-segmented__option aurora-focus-ring"
          onClick={() => onChange(o.id)} onKeyDown={(e) => move(e, i)}>{o.label}</button>
      ))}
    </div>
  );
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

/** One choice in a filter. `count` is how many rows it would show. */
export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

/** Below this many rows in total, options that match nothing are not offered. */
const HIDE_EMPTY_BELOW = 10;

/** Drop zero-count options when the options hold fewer than 10 rows in all. The chosen option always stays. */
export function visibleOptions(options: ReadonlyArray<FilterOption>, selected = ""): FilterOption[] {
  const counted = options.every((o) => o.count !== undefined);
  const total = options.reduce((n, o) => n + (o.count ?? 0), 0);
  if (!counted || total >= HIDE_EMPTY_BELOW) return [...options];
  return options.filter((o) => o.count !== 0 || o.value === selected);
}

/** A menu chip: the filter's name, its choice, and the options with counts. */
export interface FilterGroup {
  id: string;
  label: string;
  /** The chosen option's value, "" for all. */
  value: string;
  options: ReadonlyArray<FilterOption>;
  onChange: (value: string) => void;
  /** Words for "no choice" in the menu. Defaults to "All". */
  allLabel?: string;
}

function FilterMenu({ group }: { group: FilterGroup }) {
  const options = visibleOptions(group.options, group.value);
  const chosen = group.options.find((o) => o.value === group.value);
  const all = group.options.every((o) => o.count !== undefined)
    ? group.options.reduce((n, o) => n + (o.count ?? 0), 0)
    : undefined;
  const entries: FilterOption[] = [{ value: "", label: group.allLabel ?? "All", count: all }, ...options];
  return (
    <Menu
      label={chosen ? `${group.label}: ${chosen.label}` : group.label}
      align="start"
      width={240}
      triggerClassName={cx("aurora-chip ui-filtergroup", chosen && "ui-filtergroup--active")}
      trigger={chosen ? <>{group.label}: {chosen.label}</> : group.label}
    >
      {entries.map((o) => (
        <MenuItem key={o.value || "all"} aria-current={o.value === group.value ? "true" : undefined}
          className="ui-filtergroup__item" onClick={() => group.onChange(o.value)}>
          <span>{o.label}</span>
          {o.count !== undefined ? <span className="ui-chip-count">{o.count.toLocaleString()}</span> : null}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** One row of count chips: "All" plus an option each. Zero-count options hide when the total is small. */
export function CountChips({ value, onChange, options, allLabel = "All", total: allCount }: {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<FilterOption & { count: number }>;
  allLabel?: string;
  /** Rows in all. Defaults to the sum of the options, which is wrong when options overlap. */
  total?: number;
}) {
  const total = allCount ?? options.reduce((n, o) => n + o.count, 0);
  return (
    <>
      <AuroraChip selected={value === ""} onClick={() => onChange("")}>
        {allLabel}<span className="aurora-number ui-chip-count">{total.toLocaleString()}</span>
      </AuroraChip>
      {visibleOptions(options, value).map((o) => (
        <AuroraChip key={o.value} selected={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}<span className="aurora-number ui-chip-count">{(o.count ?? 0).toLocaleString()}</span>
        </AuroraChip>
      ))}
    </>
  );
}

export interface FilterBarProps {
  /** Active filter chips. */
  children?: ReactNode;
  /** Menu chips, one per filter, kept on the same row as the search. */
  groups?: ReadonlyArray<FilterGroup>;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  onClear?: () => void;
  actions?: ReactNode;
}

/** "/" focuses the search field from anywhere on the page. */
export function FilterBar({ children, groups, search, onClear, actions }: FilterBarProps) {
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
      {groups?.length || children ? (
        <div className="ui-filterbar__chips">
          {groups?.map((g) => <FilterMenu key={g.id} group={g} />)}
          {children}
        </div>
      ) : null}
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
export { ScoreRing } from "./score-ring";
export { ScoreTrend, MIN_TREND_POINTS } from "./score-trend";
export type { ScoreTrendPoint } from "./score-trend";
export type { ScoreRingProps } from "./score-ring";
export { OwnerLadder } from "./owner-ladder";
export type { OwnerRung } from "./owner-ladder";
