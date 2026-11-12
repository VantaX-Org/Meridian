"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "@/lib/v2/i18n";
import { Chip, type ChipProps } from "./Chip";
import { Icon } from "../Icon";
import { cx } from "./cx";

export interface RunOption {
  id: string;
  number: number;
  status: "running" | "done" | "failed";
  /** "Extracted", "Cleaned" and so on, already in words. */
  kind: string;
  parentNumber?: number;
  dateLabel: string;
  dqs?: string;
  chips?: Array<Pick<ChipProps, "tone" | "count"> & { label: string }>;
}

const STATUS: Record<RunOption["status"], () => string> = { running: () => t("Running"), done: () => t("Done"), failed: () => t("Failed") };

/** "Run 15, cleaned from run 14, 11 Nov": the sentence that names the run on the button and in its list row. */
export function runSentence(r: RunOption): string {
  const from = r.parentNumber !== undefined ? t("{kind} from run {n}", { kind: r.kind, n: r.parentNumber }) : r.kind;
  return t("Run {n}, {from}, {date}", { n: r.number, from: from.toLowerCase(), date: r.dateLabel });
}

/**
 * The run picker on every run-scoped screen. Left and right arrows on the button step to the older or newer run.
 * The popover lists newest first; typing filters; the last row opens the comparison.
 */
export function RunSwitcher({ runs, value, onChange, onCompare }: { runs: RunOption[]; value: string; onChange: (id: string) => void; onCompare?: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const base = useId();
  const sorted = useMemo(() => [...runs].sort((a, b) => b.number - a.number), [runs]);
  const cur = sorted.find((r) => r.id === value);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? sorted.filter((r) => `${runSentence(r)} ${r.kind} ${STATUS[r.status]()} ${r.dqs ?? ""}`.toLowerCase().includes(n)) : sorted;
  }, [sorted, q]);
  const rows = onCompare ? list.length + 1 : list.length;

  // Reset the filter and selection each time the popover opens, in the handler that opens it.
  const openPop = () => {
    setQ("");
    setAt(Math.max(0, sorted.findIndex((r) => r.id === value)));
    setOpen(true);
  };
  useEffect(() => {
    if (open) filter.current?.focus();
  }, [open]);

  const step = (d: -1 | 1) => {
    const i = sorted.findIndex((r) => r.id === value);
    // Newest first: the next run in time is the previous entry in the list.
    const next = sorted[i - d];
    if (next) onChange(next.id);
  };
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  const choose = (i: number) => {
    if (i < list.length) {
      onChange(list[i].id);
      close();
    } else {
      setOpen(false);
      onCompare?.();
    }
  };
  const onBtnKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      openPop();
    }
  };

  return (
    <div className="nx-runsw">
      <button
        ref={btn}
        type="button"
        className="nx-btn nx-btn-secondary nx-runsw-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${base}-pop`}
        onClick={() => (open ? setOpen(false) : openPop())}
        onKeyDown={onBtnKey}
      >
        <Icon name="history" />
        <span>{cur ? runSentence(cur) : t("Choose a run")}</span>
        <Icon name="chevron-down" />
      </button>
      {open ? (
        <div id={`${base}-pop`} className="nx-menu nx-runsw-pop" onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}>
          <input
            ref={filter}
            className="nx-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${base}-list`}
            aria-activedescendant={`${base}-opt-${at}`}
            aria-label={t("Filter runs")}
            placeholder={t("Filter runs")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((a) => Math.min(rows - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (rows > 0) choose(at);
              } else if (e.key === "Tab") setOpen(false);
            }}
          />
          <div id={`${base}-list`} role="listbox" aria-label={t("Runs, newest first")} className="nx-runsw-list">
            {list.length === 0 ? <p className="nx-palette-empty">{t("No run matches.")}</p> : null}
            {list.map((r, i) => (
              <div key={r.id} id={`${base}-opt-${i}`} role="option" aria-selected={r.id === value} className={cx("nx-runsw-row", i === at && "nx-palette-on")} onMouseMove={() => setAt(i)} onClick={() => choose(i)}>
                <div className="nx-runsw-main">
                  <strong>{t("Run {n}", { n: r.number })}</strong>
                  <span className="nx-runsw-status" data-status={r.status}>{STATUS[r.status]()}</span>
                  <Chip>{r.kind}</Chip>
                  {r.parentNumber !== undefined ? <span className="nx-runsw-parent">{t("from run {n}", { n: r.parentNumber })}</span> : null}
                  <span className="nx-runsw-date">{r.dateLabel}</span>
                  {r.dqs ? <span className="nx-runsw-dqs">{t("DQS {score}", { score: r.dqs })}</span> : null}
                </div>
                {r.chips?.length ? (
                  <div className="nx-runsw-chips">
                    {r.chips.map((c) => (
                      <Chip key={c.label} tone={c.tone} count={c.count}>{c.label}</Chip>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {onCompare ? (
              <div id={`${base}-opt-${list.length}`} role="option" aria-selected={false} className={cx("nx-runsw-row", "nx-runsw-compare", at === list.length && "nx-palette-on")} onMouseMove={() => setAt(list.length)} onClick={() => choose(list.length)}>
                {t("Compare with…")}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
