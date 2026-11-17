"use client";

import { useChangedChecks, useTimeline } from "@/lib/v2/object-queries";
import { t } from "@/lib/v2/i18n";
import { Card, DataTable, EmptyState, ErrorState, FieldChip, Skeleton, StatTile, TrendArea, type Column } from "@/ui/kit";
import type { ChangedCheck } from "@/lib/api/v2/object";
import { dqsOf, score, signed } from "@/ui/screens/object/format";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { sevLabel } from "./Records";
import { useTabChat } from "./TabFrame";

const day = (s: string | null) => (s ? s.slice(0, 10) : "");

/** Data quality score over the object's runs, and what changed against the run before. */
export function Trend({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const tl = useTimeline(o.systemId);
  const ch = useChangedChecks(o.runId, o.previous?.id ?? null, module);
  const runs = (tl.data?.runs ?? []).filter((r) => r.objects[module]);
  const now = dqsOf(o.run, module);
  const was = dqsOf(o.previous, module);
  useTabChat(system, module, "trend", o.label, [t("Why did the score move?"), t("Which rules got worse?")], () => ({
    text: now === null ? t("There is no score for this object yet.") : t("The score is {now}; the run before had {was}.", { now: score(now), was: was === null ? "-" : score(was) }),
    evidence: runs.slice(-3).map((r) => `${day(r.run_at)}: ${score(r.objects[module]?.score ?? 0)}`),
  }));
  if (tl.isLoading) return <Skeleton lines={5} label={t("Loading the trend")} />;
  if (tl.isError) return <ErrorState heading={t("The trend could not be loaded.")} />;
  const groups = ch.data ?? null;
  const rows: (ChangedCheck & { kind: string })[] = groups ? (Object.entries(groups) as [string, ChangedCheck[]][]).flatMap(([kind, list]) => list.map((c) => ({ ...c, kind }))) : [];
  const KIND: Record<string, string> = { newly_failing: t("Newly failing"), fixed: t("Fixed"), worse: t("Worse"), better: t("Better") };
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "check", label: t("Rule"), render: (r) => <><FieldChip code={r.check_id} description={r.message ?? undefined} /></> },
    { key: "kind", label: t("Change"), render: (r) => KIND[r.kind] ?? r.kind },
    { key: "sev", label: t("Severity"), render: (r) => <span className="mx-sev" data-sev={r.severity}>{sevLabel(r.severity)}</span> },
    { key: "a", label: t("Records before"), align: "end", render: (r) => <span className="mx-num">{r.v1_affected}</span> },
    { key: "b", label: t("Records now"), align: "end", render: (r) => <span className="mx-num">{r.v2_affected}</span> },
  ];
  type RunRow = { id: string; run_at: string | null; n: number; score: number; move: number | null };
  const runRows: RunRow[] = runs.map((r, i) => ({ id: r.id, run_at: r.run_at, n: i + 1, score: r.objects[module]?.score ?? 0, move: i ? (r.objects[module]?.score ?? 0) - (runs[i - 1].objects[module]?.score ?? 0) : null })).reverse();
  const runCols: Column<RunRow>[] = [
    { key: "run", label: t("Run"), render: (r) => <span className="mx-num">{r.n}</span> },
    { key: "at", label: t("Run date"), render: (r) => day(r.run_at) },
    { key: "score", label: t("Score"), align: "end", render: (r) => <span className="mx-num">{score(r.score)}</span> },
    { key: "move", label: t("Change"), align: "end", render: (r) => <span className="mx-num">{r.move === null ? "-" : signed(r.move)}</span> },
  ];
  return (
    <div className="mx-col">
      <dl className="mx-tiles">
        <StatTile label={t("Score now")} value={now === null ? "-" : score(now)} />
        <StatTile label={t("Run before")} value={was === null ? "-" : score(was)} note={now !== null && was !== null ? signed(now - was) : undefined} />
        <StatTile label={t("Runs in the trend")} value={String(runs.length)} />
      </dl>
      <Card title={t("Score by run")}>
        <TrendArea
          points={runs.map((r) => ({ axis: r.id, title: `${day(r.run_at)}: ${score(r.objects[module]?.score ?? 0)}`, value: r.objects[module]?.score ?? null }))}
          label={t("Score by run")} emptyLabel={t("Not enough runs to draw a trend yet")} height={160}
        />
        {runRows.length ? <DataTable columns={runCols} rows={runRows} rowKey={(r) => r.id} label={t("Score by run")} height={240} /> : null}
      </Card>
      <Card title={t("What changed since the run before")} sub={o.previous ? undefined : t("This is the first run, so there is nothing to compare.")}>
        {ch.isLoading ? <Skeleton lines={3} label={t("Loading changes")} /> : rows.length ? <DataTable columns={cols} rows={rows} rowKey={(r) => `${r.kind}:${r.check_id}`} label={t("Changed rules")} height={280} /> : <EmptyState heading={t("No rule changed between these two runs.")} />}
      </Card>
    </div>
  );
}
