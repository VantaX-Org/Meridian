"use client";

/**
 * Which run an object loads from. Lists the object's finished runs, newest first, as "Run 15, 11 Nov, DQS 77".
 * Until the user picks, the newest finished run is the source; the picker reports it so the caller always holds a run id.
 */
import { useEffect } from "react";
import { useRunsPage } from "@/lib/api/next/runs";
import type { VersionHead } from "@/lib/api/v2/runs";
import { dqsOf, numberOf, score } from "@/design/next/object/model";
import { shortDate } from "@/design/v2/RunTimeline";
import { t } from "@/lib/v2/i18n";

/** "Run 15, 11 Nov, DQS 77": a run in words, never its id. */
export function runLabel(h: VersionHead, module: string): string {
  const d = dqsOf(h, module);
  const n = numberOf(h);
  const head = n === null ? t("Run") : t("Run {n}", { n });
  return d === null ? t("{run}, {date}", { run: head, date: shortDate(h.run_at) }) : t("{run}, {date}, DQS {dqs}", { run: head, date: shortDate(h.run_at), dqs: score(d) });
}

/** The newest finished run: highest run number, else latest date. */
export function newestRun(runs: VersionHead[]): VersionHead | null {
  return [...runs].sort((a, b) => (b.run_number ?? 0) - (a.run_number ?? 0) || Date.parse(b.run_at ?? "") - Date.parse(a.run_at ?? ""))[0] ?? null;
}

export function SourceRunPicker({ system, module, label, value, onChange }: {
  system: string;
  module: string;
  label: string;
  /** The picked run id; null while the default stands. */
  value: string | null;
  onChange: (runId: string) => void;
}) {
  const q = useRunsPage({ system_id: system, module, status: "complete", limit: 30 });
  const runs = q.data?.versions ?? [];
  const sorted = [...runs].sort((a, b) => (b.run_number ?? 0) - (a.run_number ?? 0));
  const def = newestRun(runs)?.id ?? null;
  useEffect(() => {
    if (!value && def) onChange(def);
  }, [value, def, onChange]);
  if (q.isLoading) return <span className="nx-ld-note">{t("Loading runs")}</span>;
  if (sorted.length === 0) return <span className="nx-ld-note">{t("No finished run to load from")}</span>;
  return (
    <label className="nx-field nx-ld-pick">
      <span>{t("Source run for {object}", { object: label })}</span>
      <select className="nx-input" value={value ?? def ?? ""} onChange={(e) => onChange(e.target.value)}>
        {sorted.map((h) => (
          <option key={h.id} value={h.id}>{runLabel(h, module)}</option>
        ))}
      </select>
    </label>
  );
}
