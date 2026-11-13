"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "@/lib/v2/i18n";
import { runSentence, type RunOption } from "./RunSwitcher";
import { SegmentedControl } from "./SegmentedControl";
import { cx } from "./cx";

export interface SegOption { id: string; label: string }
export interface ObjectSegmentsValue { object: string; version: string; run: string }
const MAX_SEGMENTS = 4;

/** Object, version and run pickers for one object page. Up to four choices is a segmented control, more is a searchable list. */
export function ObjectSegments({ objects, versions, runs, value, onChange, className }: {
  objects: SegOption[];
  versions: SegOption[];
  runs: RunOption[];
  value: ObjectSegmentsValue;
  onChange: (v: ObjectSegmentsValue) => void;
  className?: string;
}) {
  const runOpts = useMemo(() => [...runs].sort((a, b) => b.number - a.number).map((r) => ({ id: r.id, label: runSentence(r) })), [runs]);
  const part = (key: keyof ObjectSegmentsValue, label: string, opts: SegOption[]) =>
    opts.length <= MAX_SEGMENTS ? (
      <SegmentedControl label={label} items={opts.map((o) => ({ value: o.id, label: o.label }))} value={value[key]} onChange={(v) => onChange({ ...value, [key]: v })} />
    ) : (
      <PickList label={label} options={opts} value={value[key]} onChange={(v) => onChange({ ...value, [key]: v })} />
    );
  return (
    <div className={cx("nx-objseg", className)} role="group" aria-label={t("Object, version and run")}>
      {part("object", t("Object"), objects)}
      {part("version", t("Version"), versions)}
      {part("run", t("Run"), runOpts)}
    </div>
  );
}

function PickList({ label, options, value, onChange }: { label: string; options: SegOption[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const rows = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const current = options.find((o) => o.id === value);
  useEffect(() => { if (open) filter.current?.focus(); }, [open]);
  const close = () => { setOpen(false); setQ(""); btn.current?.focus(); };
  const pick = (o: SegOption) => { onChange(o.id); close(); };
  const onKey = (e: KeyboardEvent) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (i <= 0 ? filter.current : items[i - 1])?.focus(); }
    else if (e.key === "Enter" && i < 0 && rows[0]) { e.preventDefault(); pick(rows[0]); }
  };
  return (
    <span className="nx-pick" onKeyDown={open ? onKey : undefined}>
      <button ref={btn} type="button" className="nx-pick-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current?.label ?? ""}`} onClick={() => setOpen(!open)}>
        {current?.label ?? label}
      </button>
      {open ? (
        <div className="nx-pick-pop">
          <input ref={filter} className="nx-pick-q" type="search" aria-label={t("Filter {label}", { label })} placeholder={t("Type to filter")} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul ref={list} id={id} role="listbox" aria-label={label} className="nx-pick-list">
            {rows.map((o) => (
              <li key={o.id} role="option" aria-selected={o.id === value} tabIndex={-1} className="nx-pick-opt"
                onClick={() => pick(o)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(o); } }}>
                {o.label}
              </li>
            ))}
            {rows.length === 0 ? <li className="nx-pick-none">{t("Nothing matches.")}</li> : null}
          </ul>
        </div>
      ) : null}
    </span>
  );
}
