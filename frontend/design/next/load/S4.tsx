"use client";

/**
 * S/4HANA readiness, native: the conversion-readiness pack rolled up per SAP simplification area over every object at
 * its latest run (api/services/s4_readiness.py), and the source, projected and actual target quality of the newest
 * analysed migration run. A failing blocking rule makes its area red; an area none of whose rules ran shows as not
 * measured, never as ready.
 */
import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getMigrationRuns, getReconciliation } from "@/lib/api/v2/migration";
import { getS4Readiness, type S4Area, type S4Check, type S4Readiness as S4Data, type S4Status } from "@/lib/api/v2/s4";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { pairQuality, type PairedRow } from "@/lib/v2/paired-quality";
import { DQ_WORD } from "@/lib/v2/process-tree";
import { f1, int, pct1 } from "@/lib/v2/score";
import { useRuleList } from "@/lib/v2/sys-queries";
import { Chip, Code, DataTable, EmptyState, ErrorState, Skeleton, type ChipTone, type Column } from "../kit";
import { About, Banner, Disclose, HBars, Panel } from "./parts";

const httpStatus = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = httpStatus(e); return s !== 403 && s !== 404 && n < 2; };
/** The backend gives pass rates as percentages; pct1 takes a share of one. */
const pctOf = (n: number | null | undefined) => (n == null ? pct1(null) : pct1(n / 100));
const signed = (n: number) => `${n > 0 ? "+" : ""}${f1(n)}`;

const RANK: Record<S4Status, number> = { red: 0, amber: 1, green: 2, not_evaluated: 3 };
const TONE: Record<S4Status, ChipTone> = { red: "bad", amber: "warn", green: "good", not_evaluated: "neutral" };
const EMPTY: S4Data = {
  version_id: null, status: "not_evaluated", ready: false, rules: 0, evaluated: 0, failing: 0, failing_records: 0,
  blocking_failing: 0, warning_failing: 0, areas: [],
};
const ACTUAL_WHY: Record<string, () => string> = {
  no_target_analysis: () => t("The target system has no completed analysis."),
  no_target_findings_for_module: () => t("The target analysis has no findings for this object."),
};

function Word({ s }: { s: S4Status }) {
  return <Chip tone={TONE[s]}>{s === "not_evaluated" ? t("Not measured") : DQ_WORD[s]}</Chip>;
}

/** A rule's name is "CHECK_ID: text", so the code is the part before the colon. */
function useRuleText() {
  const rules = useRuleList();
  return useMemo(() => new Map((rules.data?.rules ?? []).map((r) => {
    const i = r.name.indexOf(":");
    return i > 0 ? [r.name.slice(0, i), r.name.slice(i + 1).trim()] as const : [r.name, r.name] as const;
  })), [rules.data]);
}

type Blocker = S4Check & { label: string };

function Blockers({ areas }: { areas: S4Area[] }) {
  const names = useRuleText();
  const rows: Blocker[] = areas
    .flatMap((a) => a.checks.filter((c) => c.status === "red" || c.status === "amber").map((c) => ({ ...c, label: a.label })))
    .sort((a, b) => (a.impact === b.impact ? 0 : a.impact === "blocking" ? -1 : 1) || b.affected_count - a.affected_count);
  const cols: Column<Blocker>[] = [
    { id: "rule", label: t("Rule"), cell: (c) => <Link className="nx-link" href={`/r/${encodeURIComponent(c.check_id)}`}><Code code={c.check_id} text={names.get(c.check_id)} /></Link> },
    { id: "area", label: t("Area"), cell: (c) => c.label },
    { id: "impact", label: t("Impact"), cell: (c) => <Chip tone={c.impact === "blocking" ? "bad" : "warn"}>{c.impact === "blocking" ? t("Blocks the conversion") : t("Needs cleansing")}</Chip> },
    { id: "records", label: t("Records"), align: "end", cell: (c) => int(c.affected_count), compare: (a, b) => a.affected_count - b.affected_count },
    { id: "pass", label: t("Pass rate"), align: "end", cell: (c) => pctOf(c.pass_rate), compare: (a, b) => (a.pass_rate ?? -1) - (b.pass_rate ?? -1) },
  ];
  return (
    <Panel title={t("What stands in the way")} meta={t("Failing rules, blocking first, then by records affected")} testId="s4-blockers">
      <DataTable rows={rows} columns={cols} rowKey={(c) => `${c.label}:${c.check_id}`} rowLabel={(c) => c.check_id} caption={t("What stands in the way")}
        empty={{ heading: t("No conversion-readiness rule is failing.") }} />
    </Panel>
  );
}

function Areas({ areas }: { areas: S4Area[] }) {
  const rows = [...areas].sort((a, b) => RANK[a.status] - RANK[b.status] || b.failing_records - a.failing_records);
  const cols: Column<S4Area>[] = [
    { id: "area", label: t("Area"), cell: (a) => <strong>{a.label}</strong> },
    { id: "item", label: t("Simplification item"), cell: (a) => <span className="nx-ld-meta">{a.simplification_item ?? f1(null)}</span> },
    { id: "status", label: t("Status"), cell: (a) => <Word s={a.status} /> },
    { id: "run", label: t("Rules run"), align: "end", cell: (a) => t("{a} of {b}", { a: int(a.evaluated), b: int(a.rules) }) },
    { id: "blocking", label: t("Blocking"), align: "end", cell: (a) => int(a.blocking_failing), compare: (a, b) => a.blocking_failing - b.blocking_failing },
    { id: "warnings", label: t("Warnings"), align: "end", cell: (a) => int(a.warning_failing), compare: (a, b) => a.warning_failing - b.warning_failing },
    { id: "records", label: t("Records to fix"), align: "end", cell: (a) => int(a.failing_records), compare: (a, b) => a.failing_records - b.failing_records },
  ];
  return (
    <Panel title={t("Simplification areas")} meta={t("Worst first, each with the SAP simplification item it answers")} testId="s4-areas">
      {rows.some((a) => a.failing_records > 0) ? (
        <HBars
          label={t("Records to fix by area")}
          testId="s4-area-bars"
          rows={rows.filter((a) => a.status !== "not_evaluated").map((a) => ({
            key: a.area, label: a.label, value: a.failing_records, text: int(a.failing_records),
            tone: a.status === "red" ? "bad" : a.status === "amber" ? "warn" : "good",
          }))}
        />
      ) : null}
      <DataTable rows={rows} columns={cols} rowKey={(a) => a.area} rowLabel={(a) => a.label} caption={t("Simplification areas")}
        empty={{ heading: t("No conversion-readiness rule has run yet.") }} />
    </Panel>
  );
}

/** Source, projected and actual target quality per object, with the rules that moved the score. */
export function PairedQuality() {
  const fixture = useFixture();
  const q = useQuery({
    queryKey: ["paired-quality", fixture],
    queryFn: async () => {
      const runs = await getMigrationRuns();
      const run = runs.runs.find((r) => r.status === "analysed" || r.status === "exported");
      if (!run) return null;
      try {
        return { run, rec: await getReconciliation(run.id) };
      } catch (e) {
        if (httpStatus(e) === 404) return { run, rec: null };
        throw e;
      }
    },
    staleTime: 60_000,
    retry,
  });
  const title = t("Quality in the source and in the target");
  const meta = t("Per object: the score before the move, the score the load should reach, and the score measured after");
  const cols: Column<PairedRow>[] = [
    { id: "object", label: t("Object"), cell: (m) => <Code code={m.module} text={moduleText(m.module)} /> },
    { id: "source", label: t("Source"), align: "end", cell: (m) => f1(m.source) },
    { id: "projected", label: t("Projected"), align: "end", cell: (m) => f1(m.projected) },
    {
      id: "actual", label: t("Actual in target"), align: "end", cell: (m) => (
        <>
          {m.actual === null ? <span className="nx-ld-meta">{f1(null)} {m.actualReason ? ACTUAL_WHY[m.actualReason]?.() ?? m.actualReason : ""}</span> : f1(m.actual)}
          {m.moved !== null ? <span className="nx-ld-meta"> {t("{n} from the source", { n: signed(m.moved) })}</span> : null}
        </>
      ),
    },
    {
      id: "why", label: t("Why they differ"), cell: (m) => m.reasons.length === 0 ? <span className="nx-ld-meta">{f1(null)} {t("Reasons are not yet calculated")}</span> : (
        <ul className="nx-ld-list">
          {m.reasons.map((r) => <li key={r.check_id}><Link className="nx-link" href={`/r/${encodeURIComponent(r.check_id)}`}><Code code={r.check_id} text={r.description} /></Link> {signed(r.change)}</li>)}
        </ul>
      ),
    },
  ];
  let body;
  if (q.isPending) body = <Skeleton lines={4} label={title} />;
  else if (q.isError) body = <ErrorState sentence={t("The quality figures could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  else if (!q.data) body = <p className="nx-ld-meta">{t("No migration analysis has finished yet. Start one in Migration to see source and target quality side by side.")}</p>;
  else {
    const rows = pairQuality(q.data.rec?.scores ?? []);
    body = rows.length === 0
      ? <p className="nx-ld-meta">{t("The newest analysis has not been reconciled against the target system, so only the source score exists.")}</p>
      : <DataTable rows={rows} columns={cols} rowKey={(m) => m.module} rowLabel={(m) => moduleText(m.module)} caption={title} />;
  }
  return <Panel title={title} meta={meta} testId="paired-quality">{body}</Panel>;
}

export function S4() {
  const fixture = useFixture();
  const q = useQuery({
    queryKey: ["s4-readiness", fixture],
    queryFn: async () => {
      try {
        return await getS4Readiness();
      } catch (e) {
        if (httpStatus(e) === 404) return EMPTY;
        throw e;
      }
    },
    staleTime: 60_000,
    retry,
  });
  const title = t("S/4HANA readiness");

  if (q.isPending) return <Skeleton lines={8} label={title} />;
  if (q.isError) {
    return httpStatus(q.error) === 403
      ? <EmptyState heading={title}>{t("Your role cannot read the S/4HANA readiness.")}</EmptyState>
      : <ErrorState sentence={t("The S/4HANA readiness could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  }
  const d = q.data;
  const measured = d.areas.filter((a) => a.status !== "not_evaluated");
  // A blocking rule that was not evaluated is unknown, not passed: no go verdict until every one has run.
  const unevaluated = d.blocking_unevaluated ?? 0;
  const headline = d.evaluated === 0
    ? t("Nothing measured yet")
    : d.blocking_failing > 0
      ? t("{n} blocking rules stand in the way", { n: int(d.blocking_failing) })
      : unevaluated > 0
        ? t("Not fully assessed: {n} blocking rules not evaluated", { n: int(unevaluated) })
        : d.ready
          ? t("Ready to convert")
          : t("{n} blocking rules stand in the way", { n: int(d.blocking_failing) });

  return (
    <div className="nx-ld-step" data-testid="nx-load-s4">
      <Banner
        testId="s4-banner"
        eyebrow={title}
        verdict={d.evaluated === 0 ? undefined : d.ready ? (d.warning_failing ? "at-risk" : "go") : d.blocking_failing > 0 ? "no-go" : "at-risk"}
        headline={headline}
        why={t("The conversion-readiness rules are grouped by SAP simplification area. A failing blocking rule stops the conversion; a failing warning rule needs cleansing but does not stop it.")}
        figs={[
          { label: t("Areas ready"), value: t("{a} of {b}", { a: int(measured.filter((a) => a.status === "green").length), b: int(measured.length) }), note: d.areas.length > measured.length ? t("{n} not measured", { n: int(d.areas.length - measured.length) }) : undefined },
          { label: t("Blocking rules failing"), value: int(d.blocking_failing), tone: d.blocking_failing > 0 ? "bad" : undefined, note: unevaluated > 0 ? t("{n} not evaluated", { n: int(unevaluated) }) : undefined },
          { label: t("Warning rules failing"), value: int(d.warning_failing) },
          { label: t("Records to fix"), value: int(d.failing_records) },
        ]}
        action={<Link className="nx-btn nx-btn-primary" href="/load/analysis">{t("Open the migration analysis")}</Link>}
      />
      <About
        shows={t("Shows whether your data meets the conversion rules, by SAP simplification area, and how quality changes between the source and the target.")}
        steps={[t("Read the verdict"), t("Fix the blocking rules"), t("Check again"), t("Convert")]}
        current={d.evaluated === 0 ? 0 : d.ready ? 3 : 1}
        means={[
          [t("Blocking rules failing"), t("Rules that stop the conversion until their records are fixed.")],
          [t("Warning rules failing"), t("Rules that need cleansing but do not stop the conversion.")],
          [t("Records to fix"), t("Records that fail at least one failing rule.")],
        ]}
        next={<span className="nx-ld-meta">{t("The analysis gives the projected and actual target scores shown below.")}</span>}
      />
      <Blockers areas={d.areas} />
      <Disclose summary={t("Quality in the source and in the target")}><PairedQuality /></Disclose>
      <Disclose summary={t("Readiness by SAP simplification area")}><Areas areas={d.areas} /></Disclose>
    </div>
  );
}
