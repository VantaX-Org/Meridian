"use client";

/**
 * Every run of the object, 50 to a page from the server. Cleaned runs sit under the run they were cleaned from
 * (a "Flat" switch lists them by date). Pick two to compare; a row opens that run.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, DataTable, SegmentedControl, type Column } from "@/design/next/kit";
import { RunTimelineChart, shortDate } from "@/design/v2/RunTimeline";
import { useCompareSummary, useRunsPage, type Change, type RunStatusFilter } from "@/lib/api/next/runs";
import type { VersionHead } from "@/lib/api/v2/runs";
import { usePhone, useUrlParam } from "@/lib/v2/hooks";
import { useTimeline } from "@/lib/v2/runs-queries";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { csvCell, dqsOf, duration, isCleaned, kindOf, score, signed, statusOf } from "./model";
import type { ObjectRun } from "./useObjectRun";

export const RUNS_PAGE = 50;
type StatusP = "all" | RunStatusFilter;
type KindP = "all" | "cleaned" | "pulled";
const STATUSES: readonly StatusP[] = ["all", "complete", "active", "failed"];
const KINDS: readonly KindP[] = ["all", "pulled", "cleaned"];

interface Row { h: VersionHead; prev: VersionHead | null; depth: 0 | 1 }

function Counts({ a, b, k }: { a: string | null; b: string; k: Change }) {
  const s = useCompareSummary(a, b);
  const n = s.data?.totals[k];
  return <span className="nx-num">{n === undefined ? "—" : int(n)}</span>;
}

/** A page of runs as rows: newest first, each cleaned run under its parent when the parent is on the page. */
export function nestRuns(heads: VersionHead[], flat: boolean): Row[] {
  const prevOf = (h: VersionHead, i: number) => (h.parent_version_id ? (heads.find((x) => x.id === h.parent_version_id) ?? null) : (heads[i + 1] ?? null));
  if (flat) return heads.map((h, i) => ({ h, prev: prevOf(h, i), depth: 0 }));
  const ids = new Set(heads.map((h) => h.id));
  const kids = new Map<string, Row[]>();
  heads.forEach((h, i) => {
    if (h.parent_version_id && ids.has(h.parent_version_id)) {
      const l = kids.get(h.parent_version_id) ?? [];
      l.push({ h, prev: prevOf(h, i), depth: 1 });
      kids.set(h.parent_version_id, l);
    }
  });
  const out: Row[] = [];
  heads.forEach((h, i) => {
    if (h.parent_version_id && ids.has(h.parent_version_id)) return;
    out.push({ h, prev: prevOf(h, i), depth: 0 });
    out.push(...(kids.get(h.id) ?? []));
  });
  return out;
}

export function RunsTab({ o, onOpen }: { o: ObjectRun; onOpen: (runId: string) => void }) {
  const router = useRouter();
  const phone = usePhone();
  const [status, setStatus] = useUrlParam<StatusP>("status", "all", STATUSES);
  const [kind, setKind] = useState<KindP>("all");
  const [from, setFrom] = useState("");
  const [flat, setFlat] = useState(false);
  const [offset, setOffset] = useState(0);
  const page = useRunsPage({ system_id: o.systemId, module: o.module, status: status === "all" ? null : status, limit: RUNS_PAGE, offset }, Boolean(o.systemId));
  const timeline = useTimeline(o.systemId, RUNS_PAGE, o.module);
  const tl = useMemo(() => new Map((timeline.data?.runs ?? []).map((r) => [r.id, r])), [timeline.data]);

  const heads = useMemo(
    () => (page.data?.versions ?? []).filter((h) => (kind === "all" ? true : kind === "cleaned" ? isCleaned(h) : !isCleaned(h))).filter((h) => !from || h.run_at >= from),
    [page.data, kind, from],
  );
  const rows = useMemo(() => nestRuns(heads, flat), [heads, flat]);
  const total = page.data?.total ?? 0;
  const filtered = kind !== "all" || Boolean(from);

  const columns: Column<Row>[] = [
    { id: "run", label: t("Run"), cell: (r) => <span className="nx-runs-run" data-depth={r.depth}>{r.depth ? <span aria-hidden="true">└ </span> : null}<span className="nx-num">{t("Run {n}", { n: r.h.run_number ?? "" })}</span>{r.h.id === o.runId ? <span className="nx-sr"> {t("(open)")}</span> : null}</span>, compare: (a, b) => (a.h.run_number ?? 0) - (b.h.run_number ?? 0) },
    { id: "kind", label: t("Kind"), cell: (r) => kindOf(r.h) },
    { id: "started", label: t("Started"), cell: (r) => shortDate(r.h.run_at), compare: (a, b) => a.h.run_at.localeCompare(b.h.run_at) },
    { id: "duration", label: t("Duration"), cell: (r) => duration(tl.get(r.h.id)?.duration_s), align: "end", hidden: phone },
    { id: "status", label: t("Status"), cell: (r) => { const s = statusOf(r.h); return <Chip tone={s === "failed" ? "bad" : s === "running" ? "warn" : "good"}>{s === "failed" ? t("Failed") : s === "running" ? t("Running") : t("Done")}</Chip>; } },
    { id: "dqs", label: t("DQS"), cell: (r) => { const d = dqsOf(r.h, o.module); return <span className="nx-num">{d === null ? "—" : score(d)}</span>; }, align: "end", compare: (a, b) => (dqsOf(a.h, o.module) ?? -1) - (dqsOf(b.h, o.module) ?? -1) },
    { id: "delta", label: t("Delta"), cell: (r) => { const d = dqsOf(r.h, o.module); const p = dqsOf(r.prev, o.module); return <span className="nx-num">{d === null || p === null ? "—" : signed(d - p)}</span>; }, align: "end" },
    { id: "new", label: t("New"), cell: (r) => <Counts a={r.prev?.id ?? null} b={r.h.id} k="new" />, align: "end", hidden: phone },
    { id: "resolved", label: t("Resolved"), cell: (r) => <Counts a={r.prev?.id ?? null} b={r.h.id} k="resolved" />, align: "end", hidden: phone },
    { id: "regressed", label: t("Regressed"), cell: (r) => <Counts a={r.prev?.id ?? null} b={r.h.id} k="regressed" />, align: "end", hidden: phone },
    { id: "records", label: t("Records"), cell: (r) => <span className="nx-num">{int(tl.get(r.h.id)?.records_checked ?? null)}</span>, align: "end", hidden: phone },
    { id: "rules", label: t("Rules"), cell: (r) => <span className="nx-num">{int(r.h.dqs_summary?.[o.module]?.total_checks ?? null)}</span>, align: "end", hidden: true },
    { id: "by", label: t("Started by"), cell: (r) => r.h.metadata?.trigger ?? "—", hidden: true },
  ];

  const exportCsv = () => {
    const head = ["run", "kind", "started", "status", "dqs", "delta", "records", "rules", "started_by"]; // i18n-ignore
    const lines = rows.map((r) => {
      const d = dqsOf(r.h, o.module);
      const p = dqsOf(r.prev, o.module);
      return [r.h.run_number, kindOf(r.h), r.h.run_at, r.h.status, d === null ? "" : score(d), d === null || p === null ? "" : signed(d - p), tl.get(r.h.id)?.records_checked ?? "", r.h.dqs_summary?.[o.module]?.total_checks ?? "", r.h.metadata?.trigger ?? ""].map(csvCell).join(",");
    });
    const url = URL.createObjectURL(new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `runs_${o.module}_${offset + 1}.csv`; // i18n-ignore
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="nx-stack" data-testid="runs-tab">
      {timeline.data?.runs.length ? (
        <RunTimelineChart runs={timeline.data.runs} selectedId={o.runId} onPick={(id) => onOpen(id)} label={t("Runs of {object} on a date axis", { object: o.label })} />
      ) : null}
      <div className="nx-runs-filters">
        <SegmentedControl items={STATUSES.map((s) => ({ value: s, label: s === "all" ? t("All") : s === "complete" ? t("Done") : s === "active" ? t("Running") : t("Failed") }))} value={status} onChange={(v) => { setStatus(v); setOffset(0); }} label={t("Status")} />
        <SegmentedControl items={KINDS.map((k) => ({ value: k, label: k === "all" ? t("Every kind") : k === "cleaned" ? t("Cleaned") : t("Pulled") }))} value={kind} onChange={setKind} label={t("Kind")} />
        <label className="nx-field-label">
          {t("From")}
          <input type="date" className="nx-field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="nx-check">
          <input type="checkbox" checked={flat} onChange={(e) => setFlat(e.target.checked)} /> {t("Flat")}
        </label>
        <Button variant="secondary" size={32} icon="download" disabled={rows.length === 0} onClick={exportCsv}>{t("Export CSV")}</Button>
      </div>
      {filtered ? <p className="nx-muted">{t("Kind and date filter this page of {n} runs only.", { n: page.data?.versions.length ?? 0 })}</p> : null}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.h.id}
        rowLabel={(r) => t("Run {n}", { n: r.h.run_number ?? "" })}
        caption={t("Runs of {object}", { object: o.label })}
        total={total}
        selectable
        bulkActions={(keys) =>
          keys.length === 2 ? (
            <Button variant="primary" size={32} onClick={() => {
              const [x, y] = keys.map((k) => rows.find((r) => r.h.id === k)?.h).sort((a, b) => (a?.run_number ?? 0) - (b?.run_number ?? 0));
              router.push(o.hrefWith(`/next/o/${o.systemSeg}/${o.moduleSeg}/cycle`, { step: "compare", before: x?.id ?? null, after: y?.id ?? null, run: y?.id ?? null }));
            }}>
              {t("Compare these two")}
            </Button>
          ) : (
            <span className="nx-muted">{t("Pick two runs to compare them.")}</span>
          )
        }
        onOpenRow={(r) => onOpen(r.h.id)}
        loading={page.isLoading}
        error={page.error ? { sentence: t("The runs could not be loaded."), onRetry: () => void page.refetch() } : undefined}
        empty={{ heading: filtered || status !== "all" ? t("No run matches the filters") : t("No run yet"), text: t("Pull the object on the Cycle tab to make the first run.") }}
      />
      <div className="nx-pager">
        <Button variant="secondary" size={32} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - RUNS_PAGE))}>{t("Previous")}</Button>
        <span className="nx-num nx-muted" data-testid="runs-range">{total ? t("{from} to {to} of {total}", { from: int(offset + 1), to: int(Math.min(offset + RUNS_PAGE, total)), total: int(total) }) : null}</span>
        <Button variant="secondary" size={32} disabled={!page.data || page.data.next_offset === null} onClick={() => page.data?.next_offset != null && setOffset(page.data.next_offset)}>{t("Next")}</Button>
      </div>
    </div>
  );
}
