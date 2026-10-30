"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatDate } from "@/lib/format";
import type { TimelineRun } from "@/lib/api/v2/runs";
import { useV2Href } from "@/lib/v2/hooks";
import { useCanvasRun, useRunPicker, useScopeSystem } from "@/lib/v2/scope";
import { useTimeline } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { IconDown } from "./marks";
import "./runs.css";
import { t as tr } from "@/lib/v2/i18n";

/** "16 Oct", the date on the axis. */
export function shortDate(iso: string | null | undefined): string {
  return formatDate(iso, "date").replace(/\s+\d{4}$/, "");
}

export interface TimelinePoint {
  id: string;
  x: number;
  /** Axis label, or null where it would touch a neighbour's. */
  label: string | null;
  selected: boolean;
  baseline: boolean;
}

export interface TimelineGeometry {
  width: number;
  height: number;
  axisY: number;
  left: number;
  right: number;
  points: TimelinePoint[];
}

const LABEL_GAP = 46;

/**
 * Lays the runs out on a date axis: x is proportional to the time between the first and the last run, so a gap of a
 * month looks like a month. The selected run and the baseline always keep their label; the others keep theirs when
 * there is room. Pure, so the axis can be tested without a DOM.
 */
export function timelineLayout(runs: readonly Pick<TimelineRun, "id" | "run_at" | "baseline">[], width: number, selectedId: string | null): TimelineGeometry {
  const left = 28;
  const right = 28;
  const times = runs.map((r) => (r.run_at ? new Date(r.run_at).getTime() : 0));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = Math.max(1, width - left - right);
  const xs = times.map((t) => (t1 === t0 ? left + span / 2 : left + (span * (t - t0)) / (t1 - t0)));
  const shown = new Set<number>();
  const must = runs.map((r, i) => (r.id === selectedId || r.baseline ? i : -1)).filter((i) => i >= 0);
  must.forEach((i) => shown.add(i));
  runs.forEach((_, i) => {
    if (shown.has(i)) return;
    if ([...shown].every((j) => Math.abs(xs[j] - xs[i]) >= LABEL_GAP)) shown.add(i);
  });
  return {
    width,
    height: 100,
    axisY: 52,
    left,
    right,
    points: runs.map((r, i) => ({ id: r.id, x: xs[i], label: shown.has(i) ? shortDate(r.run_at) : null, selected: r.id === selectedId, baseline: r.baseline })),
  };
}

/** The width of an element, kept up to date; `fallback` until it has a size (and in tests, which have no layout). */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => {
      const x = Math.round(el.getBoundingClientRect().width);
      if (x > 0) setW(x);
    };
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export interface RunTimelineChartProps {
  runs: readonly TimelineRun[];
  selectedId: string | null;
  onPick: (id: string) => void;
  /** Accessible name of the group. */
  label?: string;
  fallbackWidth?: number;
}

/**
 * The timeline: a date axis with one square per run, the baseline marked by a rule and the word, the selected run
 * in the data hue with a bold label. Every run is a button; Enter or Space picks it, the arrow keys move between them.
 */
export function RunTimelineChart({ runs, selectedId, onPick, label = tr("Runs on a date axis"), fallbackWidth = 520 }: RunTimelineChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(box, fallbackWidth);
  const g = useMemo(() => timelineLayout(runs, width, selectedId), [runs, width, selectedId]);
  const runOf = (id: string) => runs.find((r) => r.id === id);
  const onKey = (e: ReactKeyboardEvent<SVGGElement>, i: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(g.points[i].id);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = box.current?.querySelectorAll<SVGGElement>("[data-run-id]")[i + (e.key === "ArrowRight" ? 1 : -1)];
      next?.focus();
    }
  };
  return (
    <div ref={box} className="m2-tl-box">
      <svg className="m2-tl" width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} role="group" aria-label={label} data-testid="run-timeline">
        <line className="m2-tl-ax" x1={g.left} x2={g.width - g.right} y1={g.axisY} y2={g.axisY} />
        {g.points
          .filter((p) => p.baseline)
          .map((p) => (
            <g key={`b${p.id}`} data-testid="tl-baseline">
              <line className="m2-tl-base" x1={p.x} x2={p.x} y1={26} y2={74} />
              <text className="m2-tl-t" x={p.x} y={16} textAnchor="middle">
                {tr("baseline")}
              </text>
            </g>
          ))}
        {g.points.map((p, i) => {
          const r = runOf(p.id);
          const full = tr("Run {run_at}{value}{value2}", { run_at: formatDate(r?.run_at, "datetime"), value: p.baseline ? tr(", baseline") : "", value2: p.selected ? tr(", selected") : "" });
          return (
            <g
              key={p.id}
              className={`m2-tl-r${p.selected ? " m2-on" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={full}
              aria-pressed={p.selected}
              data-run-id={p.id}
              data-selected={p.selected ? "true" : undefined}
              onClick={() => onPick(p.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <title>{full}</title>
              <rect className="m2-tl-hit" x={p.x - 16} y={30} width={32} height={50} />
              <rect className="m2-tl-mk" x={p.x - (p.selected ? 6 : 4)} y={g.axisY - (p.selected ? 6 : 4)} width={p.selected ? 12 : 8} height={p.selected ? 12 : 8} />
              {p.label ? (
                <text className="m2-tl-t" x={p.x} y={92} textAnchor="middle">
                  {p.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const KIND_WORD: Record<string, string> = { get scheduled() { return tr("Scheduled"); }, get manual() { return tr("Started by hand"); }, get recheck() { return tr("Recheck"); }, get upload() { return tr("Upload"); } };
export const kindWord = (kind: string | null | undefined): string => (kind ? (KIND_WORD[kind] ?? kind) : "—");

/** Orders two run ids by date: [earlier, later]. */
function inOrder(runs: readonly TimelineRun[], x: string, y: string): [string, string] {
  const t = (id: string) => new Date(runs.find((r) => r.id === id)?.run_at ?? 0).getTime();
  return t(x) <= t(y) ? [x, y] : [y, x];
}

/**
 * The run control in the top bar. The button names the run the canvas shows; it opens a timeline of the last eight
 * runs of the scope. Picking one sets the run in the URL (or, on a run page, goes to that run), and "Compare with…"
 * opens /run/{a}/vs/{b} for the two. Esc closes it and gives focus back.
 */
export function RunTimelineMenu({ compact }: { compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const onObject = pathname.startsWith("/o/");
  const [asOfPick, setAsOfPick] = useState<string>("");
  const v2Href = useV2Href();
  const system = useScopeSystem();
  const canvasRun = useCanvasRun();
  const timeline = useTimeline(system?.id ?? null, 8).data?.runs;
  const runs = useMemo(() => timeline ?? [], [timeline]);
  const latest = runs.length ? runs[runs.length - 1] : null;
  const selected = runs.find((r) => r.id === canvasRun) ?? latest;
  const pick = useRunPicker(latest?.id ?? null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [picked, setPicked] = useState<string>("");
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const baseline = runs.find((r) => r.baseline);
  const others = useMemo(() => runs.filter((r) => r.id !== selected?.id).reverse(), [runs, selected?.id]);
  const defaultOther = (baseline && baseline.id !== selected?.id ? baseline : others[0])?.id ?? "";
  const other = others.some((r) => r.id === picked) ? picked : defaultOther;

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 8 - 560)) });
    setOpen(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const target = panel.current?.querySelector<HTMLElement>('[data-selected="true"]') ?? panel.current?.querySelector<HTMLElement>("[data-run-id]");
    target?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const onPick = (id: string) => {
    setOpen(false);
    pick(id);
  };
  const goCompare = () => {
    if (!selected || !other) return;
    const [a, b] = inOrder(runs, selected.id, other);
    setOpen(false);
    router.push(v2Href(`/run/${a}/vs/${b}`));
  };

  const asOfRun = runs.some((r) => r.id === asOfPick) ? asOfPick : (selected?.id ?? "");
  const goAsOf = () => {
    if (!asOfRun) return;
    const next = new URLSearchParams(search.toString());
    next.set("as_of", asOfRun);
    setOpen(false);
    router.push(v2Href(`${pathname}?${next.toString()}`));
  };

  const first = runs[0]?.run_at;
  const last = latest?.run_at;
  const heading = runs.length ? tr("Runs, {first} to {last}", { first: formatDate(first, "date"), last: formatDate(last, "date") }) : tr("Runs");
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={compact ? "m2-btn m2-sm" : "m2-tbtn m2-runsw"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        {selected ? tr("Run {run_at}", { run_at: formatDate(selected.run_at, "datetime") }) : tr("No run yet")}
        <IconDown />
      </button>
      {open ? (
        <div ref={panel} className="m2-tlpop" role="dialog" aria-labelledby={titleId} style={pos ?? undefined} data-testid="run-popover">
          <h4 id={titleId} className="m2-pop-h">
            {heading}
          </h4>
          {runs.length === 0 ? (
            <p className="m2-pop-p">{tr("No run has finished for this scope yet. Extract a system and run an analysis to see it here.")}</p>
          ) : (
            <>
              <RunTimelineChart runs={runs} selectedId={selected?.id ?? null} onPick={onPick} />
              <p className="m2-pop-p" data-testid="tl-selected">
                {selected
                  ? tr("Selected: run {run_at}, {keysCount} objects scored{value}. Choosing a run re-scopes every score on the canvas.", { run_at: formatDate(selected.run_at, "datetime"), keysCount: Object.keys(selected.objects).length, value: selected.records_checked ? tr(", {records_checked} records checked", { records_checked: int(selected.records_checked) }) : "" })
                  : ""}
              </p>
              <div className="m2-pop-cmp">
                <label htmlFor={`${titleId}-cmp`}>{tr("Compare with")}</label>
                <select id={`${titleId}-cmp`} className="m2-sel" value={other} onChange={(e) => setPicked(e.target.value)}>
                  {others.map((r) => (
                    <option key={r.id} value={r.id}>
                      {`${formatDate(r.run_at, "datetime")}${r.baseline ? tr(" (baseline)") : ""}`}
                    </option>
                  ))}
                </select>
                <button type="button" className="m2-btn m2-sm m2-strong" onClick={goCompare} disabled={!other}>
                  {tr("Compare with…")}
                </button>
              </div>
              {onObject ? (
                <div className="m2-pop-cmp" data-testid="as-of-picker">
                  <label htmlFor={`${titleId}-asof`}>{tr("As of")}</label>
                  <select id={`${titleId}-asof`} className="m2-sel" value={asOfRun} onChange={(e) => setAsOfPick(e.target.value)}>
                    {[...runs].reverse().map((r) => (
                      <option key={r.id} value={r.id}>
                        {formatDate(r.run_at, "datetime")}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="m2-btn m2-sm" onClick={goAsOf} disabled={!asOfRun}>
                    {tr("Show the object as it stood")}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
