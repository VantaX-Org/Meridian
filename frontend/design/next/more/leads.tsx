"use client";

/**
 * The chart-led lead row over each ported screen (Aletheia, master data, insights, atlas, load plan, S/4, go-live).
 * Each card reads the same endpoint as the screen under it, so the full screen with every action stays below the
 * row. Aletheia cards carry the mark, unaltered, and the evidence behind the figure: Aletheia only sees aggregates.
 */
import { useMemo, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { t } from "@/lib/v2/i18n";
import { fixed, whole } from "@/lib/v2/format";
import { useFixture } from "@/lib/api/v2/fixture";
import { getForesight, getReason, type Evidence, type GoLiveStatus } from "@/lib/api/v2/aletheia-engine";
import { getSurvivorship } from "@/lib/api/v2/aletheia-survivorship";
import { getMdmHistory } from "@/lib/api/v2/mdm-health";
import { getMiningOverview } from "@/lib/api/v2/mining";
import { getScoreHistory } from "@/lib/api/v2/score";
import { getValue } from "@/lib/api/v2/analytics";
import { getLoadPlan } from "@/lib/api/v2/load-plan";
import { getS4Readiness } from "@/lib/api/v2/s4";
import { getWork } from "@/lib/api/v2/work";
import { Chip, PartBar, PointSpark, Ring, type SparkPoint } from "../kit";
import { SegBar } from "../kit/viz";
import { ChartCard, cardState, compact } from "./ChartCard";
import { SystemsCard } from "./cards";
import "./more.css";

const MIN = 60_000;
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

/** A 404 means nothing is there yet: the card shows it as empty, not as a failure. */
async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (isAxiosError(e) && e.response?.status === 404) return null;
    throw e;
  }
}

/** The Aletheia mark as Aletheia ships it, with its name beside it (licence section 6). */
export function AletheiaMark() {
  return (
    <Chip tone="aletheia">
      {/* eslint-disable-next-line @next/next/no-img-element -- the Aletheia mark is served unaltered, docs/diligence/licences.md section 6 */}
      <img src="/brand/aletheia-mark.svg" alt="" width={14} height={14} /> {t("Aletheia")}
    </Chip>
  );
}

/** What an Aletheia figure rests on: its aggregate inputs, method, confidence and the runs it used. */
export function EvidenceNote({ ev, testId }: { ev: Evidence; testId: string }) {
  return (
    <details className="nx-lead-evidence" data-testid={testId}>
      <summary>{t("Evidence")}</summary>
      <dl>
        <dt>{t("Inputs")}</dt><dd>{ev.inputs.join("; ")}</dd>
        <dt>{t("Method")}</dt><dd>{ev.method}</dd>
        <dt>{t("Confidence")}</dt>
        <dd>{ev.confidence == null ? t("Shown per result, as its deviation score") : t("{n} out of 100", { n: whole(ev.confidence) })}</dd>
        {ev.first_run ? <><dt>{t("Runs used")}</dt><dd>{t("{n} runs, {from} to {to}", { n: whole(ev.runs ?? 0), from: day(ev.first_run), to: day(ev.last_run) })}</dd></> : null}
      </dl>
    </details>
  );
}

const GO_LIVE: Record<GoLiveStatus, () => string> = {
  reached: () => t("The go-live target is reached"),
  projected: () => t("The go-live target is projected"),
  not_converging: () => t("The score is not moving toward the go-live target"),
  beyond_horizon: () => t("The go-live target is beyond the projection"),
};

function useForesight() {
  const fixture = useFixture();
  return useQuery({ queryKey: ["aletheia", "foresight", fixture], queryFn: getForesight, staleTime: MIN });
}

/** The composite per run toward the go-live target, with the projected date. */
export function ForesightCard({ title }: { title?: string }) {
  const q = useForesight();
  const d = q.data;
  const pts: SparkPoint[] = useMemo(() => (d?.runs ?? []).filter((r) => r.composite != null).map((r) => ({ label: day(r.run_at), value: r.composite as number })), [d]);
  const last = pts.length ? pts[pts.length - 1].value : null;
  const gl = d?.projection.go_live;
  return (
    <ChartCard title={title ?? t("Foresight")} testId="lead-foresight" state={cardState(q, pts.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No scored run yet.")}
      figure={last == null ? undefined : fixed(last, 1)}
      line={gl ? `${GO_LIVE[gl.status]()}${gl.projected ? ` ${t("by {when}", { when: day(gl.projected) })}` : ""}` : t("Go-live target {n}", { n: fixed(d?.target ?? 0, 1) })}
      chart={<PointSpark points={pts} label={t("Composite score per run")} />}>
      <AletheiaMark />
      {d ? <EvidenceNote ev={d.projection.evidence} testId="lead-foresight-evidence" /> : null}
    </ChartCard>
  );
}

/** The rules and dimensions most likely to move the score, by effect. */
export function ReasonCard() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["aletheia", "reason", fixture], queryFn: getReason, staleTime: MIN });
  const d = q.data;
  const risks = useMemo(() => [...(d?.deterministic.risks ?? [])].sort((a, b) => Math.abs(b.effect ?? 0) - Math.abs(a.effect ?? 0)).slice(0, 4), [d]);
  const anomalies = d?.deterministic.anomalies.length ?? 0;
  return (
    <ChartCard title={t("Reason")} testId="lead-reason" state={cardState(q, risks.length === 0 && anomalies === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No risk or unusual run found.")}
      figure={compact(risks.length)}
      line={t("{count, plural, one {# unusual run} other {# unusual runs}}", { count: anomalies })}
      chart={<PartBar label={t("Risks by effect on the score")} format={(n) => fixed(n, 1)} segments={risks.map((r) => ({ label: r.name || r.driver, value: Math.abs(r.effect ?? 0) }))} />}>
      <AletheiaMark />
      {d ? <EvidenceNote ev={d.deterministic.risk_evidence} testId="lead-reason-evidence" /> : null}
    </ChartCard>
  );
}

/** Golden-value proposals by where they stand. */
export function SurvivorshipCard() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["survivorship", fixture], queryFn: getSurvivorship, staleTime: 15_000 });
  const c = q.data?.counts;
  const total = c ? c.proposed + c.approved + c.rejected + c.auto_applied : 0;
  const domains = q.data?.domains ?? [];
  return (
    <ChartCard title={t("Survivorship")} testId="lead-survivorship" state={cardState(q, total === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No golden value proposed yet.")}
      figure={compact(c?.proposed ?? 0)}
      line={t("{n} waiting for a decision", { n: compact(c?.proposed ?? 0) })}
      chart={<SegBar format={compact} segs={[
        { key: "proposed", label: t("Proposed"), value: c?.proposed ?? 0, tone: "data" },
        { key: "approved", label: t("Approved"), value: c?.approved ?? 0, tone: "good" },
        { key: "auto", label: t("Applied without review"), value: c?.auto_applied ?? 0, tone: "quiet" },
        { key: "rejected", label: t("Rejected"), value: c?.rejected ?? 0, tone: "bad" },
      ]} />}>
      <AletheiaMark />
      <details className="nx-lead-evidence" data-testid="lead-survivorship-evidence">
        <summary>{t("Evidence")}</summary>
        <dl>
          <dt>{t("Inputs")}</dt><dd>{t("Value shape, length and blanks per source system, counted per field")}</dd>
          {domains.map((x) => <div key={x.domain}><dt>{x.domain}</dt><dd>{t("{v} verified, {r} rejected", { v: whole(x.verified), r: whole(x.rejected) })}</dd></div>)}
        </dl>
      </details>
    </ChartCard>
  );
}

/** The master-data health score per day over the last 90 days. */
export function MdmCard() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["mdm-health", fixture, "history"], queryFn: () => getMdmHistory(90), staleTime: MIN });
  const pts = useMemo(() => (q.data?.history ?? []).map((s) => ({ label: day(s.snapshot_date), value: s.mdm_health_score })), [q.data]);
  const last = pts.length ? pts[pts.length - 1].value : null;
  return (
    <ChartCard title={t("Golden records")} testId="lead-mdm" state={cardState(q, pts.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No health snapshot yet.")}
      figure={last == null ? undefined : fixed(last, 1)}
      line={t("Health score, last 90 days")}
      chart={<PointSpark points={pts} label={t("Master-data health score per day")} />} />
  );
}

/** Patterns found by mining, with the share of records they cover. */
export function MiningCard() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["lead", "mining", fixture], queryFn: () => orNull(getMiningOverview), staleTime: MIN });
  const m = q.data;
  return (
    <ChartCard title={t("Mining")} testId="lead-mining" state={cardState(q, !m || m.runs_total === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No mining run yet.")}
      line={t("{p} stable, {a} new anomalies in {d} days", { p: compact(m?.stable_patterns ?? 0), a: compact(m?.new_anomalies ?? 0), d: whole(m?.window_days ?? 30) })}
      chart={<Ring value={m ? m.coverage_pct : null} label={t("{n}% of records covered", { n: fixed(m?.coverage_pct ?? 0, 0) })}><span className="nx-chartcard-figure">{compact(m?.total_patterns ?? 0)}</span></Ring>} />
  );
}

/** The composite per run, re-weighted under today's scoring. */
export function ScoreCard() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["lead", "score-history", fixture], queryFn: () => orNull(getScoreHistory), staleTime: MIN });
  const pts = useMemo(() => [...(q.data?.history ?? [])].reverse().filter((h) => h.under_current.composite != null).map((h) => ({ label: day(h.run_at), value: h.under_current.composite as number })), [q.data]);
  const last = pts.length ? pts[pts.length - 1].value : null;
  return (
    <ChartCard title={t("Score")} testId="lead-score" state={cardState(q, pts.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No scored run yet.")}
      figure={last == null ? undefined : fixed(last, 1)}
      line={t("Composite per run, under today's weights")}
      chart={<PointSpark points={pts} label={t("Composite score per run")} />} />
  );
}

/** Risk mitigated per month. */
export function ValueCard() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["lead", "value", fixture], queryFn: () => orNull(getValue), staleTime: MIN });
  const v = q.data;
  const pts = useMemo(() => (v?.cost_avoidance_history ?? []).map((m) => ({ label: m.period, value: m.risk_mitigated_zar })), [v]);
  return (
    <ChartCard title={t("Value")} testId="lead-value" state={cardState(q, !v || pts.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No value measured yet.")}
      figure={v ? compact(v.roi.risk_mitigated) : undefined}
      line={v?.roi.roi_multiple != null ? t("{n} times the subscription", { n: fixed(v.roi.roi_multiple, 1) }) : t("Risk mitigated per month")}
      chart={<PointSpark points={pts} label={t("Risk mitigated per month")} />} />
  );
}

/** Objects in the load order by whether they may load. */
export function LoadPlanCard() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["load-plan", fixture], queryFn: () => getLoadPlan(), staleTime: MIN });
  const objs = q.data?.objects ?? [];
  const n = (s: string) => objs.filter((o) => o.status === s).length;
  return (
    <ChartCard title={t("Load plan")} testId="lead-load-plan" state={cardState(q, objs.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No object in the load plan.")}
      figure={compact(n("go"))}
      line={t("{n} of {m} objects may load, in {s} steps", { n: compact(n("go")), m: compact(objs.length), s: whole(q.data?.steps ?? 0) })}
      chart={<SegBar format={compact} segs={[
        { key: "go", label: t("Go"), value: n("go"), tone: "good" },
        { key: "no_go", label: t("No go"), value: n("no_go"), tone: "bad" },
        { key: "not_run", label: t("Not run"), value: n("not_run"), tone: "quiet" },
      ]} />} />
  );
}

/** Simplification areas by readiness. */
export function S4Card() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["lead", "s4-readiness", fixture], queryFn: () => orNull(getS4Readiness), staleTime: MIN });
  const areas = q.data?.areas ?? [];
  const n = (s: string) => areas.filter((a) => a.status === s).length;
  return (
    <ChartCard title={t("S/4HANA readiness")} testId="lead-s4" state={cardState(q, areas.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No area measured yet.")}
      figure={compact(q.data?.blocking_failing ?? 0)}
      line={t("{count, plural, one {# blocking rule fails} other {# blocking rules fail}}", { count: q.data?.blocking_failing ?? 0 })}
      chart={<SegBar format={compact} segs={[
        { key: "green", label: t("Ready"), value: n("green"), tone: "good" },
        { key: "amber", label: t("Warnings"), value: n("amber"), tone: "warn" },
        { key: "red", label: t("Blocked"), value: n("red"), tone: "bad" },
        { key: "none", label: t("Not measured"), value: n("not_evaluated"), tone: "quiet" },
      ]} />} />
  );
}

/** The material records with the most serious open findings, by open issues. */
export function MaterialCard() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["material-worst", fixture], queryFn: () => getWork({ module: "material_master", sort: "-severity,-value", limit: 12 }), retry: false });
  const items = q.data?.items ?? [];
  return (
    <ChartCard title={t("Materials")} testId="lead-materials" state={cardState(q, items.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No material has an open finding.")}
      figure={compact(q.data?.total ?? 0)}
      line={t("Materials with the most serious open findings")}
      chart={<PartBar label={t("Open issues per material")} format={compact} segments={items.slice(0, 5).map((r) => ({ label: r.name ?? r.record_key, value: r.issues }))} />} />
  );
}

/** One row of lead cards. */
export function LeadRow({ cards, testId }: { cards: ComponentType[]; testId?: string }) {
  return <div className="nx-chartcards nx-lead-row" data-testid={testId ?? "lead-row"}>{cards.map((C, i) => <C key={i} />)}</div>;
}

const row = (...cards: ComponentType[]) => function Lead() { return <LeadRow cards={cards} />; };

/** The lead row per screen, by its address under /more (group/tab or single) or its Load tab. */
export const LEADS: Record<string, ComponentType> = {
  "aletheia/evidence": row(ForesightCard, ReasonCard, SurvivorshipCard),
  "aletheia/foresight": row(ForesightCard),
  "aletheia/reason": row(ReasonCard),
  "aletheia/survivorship": row(SurvivorshipCard),
  "master-data/golden": row(MdmCard),
  "master-data/mining": row(MiningCard),
  "master-data/materials": row(MaterialCard),
  "insights/score": row(ScoreCard),
  "insights/insights": row(ScoreCard, ValueCard),
  "insights/forecast": row(ForesightCard),
  "insights/value": row(ValueCard),
  atlas: row(SystemsCard),
  "load/plan": row(LoadPlanCard),
  "load/s4": row(S4Card),
  "load/go-live": row(function GoLive() { return <ForesightCard title={t("Go-live")} />; }, S4Card, LoadPlanCard),
};

