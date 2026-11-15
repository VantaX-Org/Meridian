"use client";

/**
 * The lead of each object segment that still mounts an old tab body: a heading, one sentence and a chart drawn from the
 * same queries the body reads (react-query shares them, so nothing is fetched twice). The body below keeps every action,
 * filter, export and link it had.
 */
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaSpark, SegBar, type Seg } from "@/design/next/kit/viz";
import { useBatches } from "@/lib/v2/approvals-queries";
import { useFixture } from "@/lib/api/v2/fixture";
import { getProfile } from "@/lib/api/v2/profile";
import { t } from "@/lib/v2/i18n";
import { buildLineage } from "@/lib/v2/lineage-graph";
import { useGlossary, useGoldenRecords, useProcessDocument } from "@/lib/v2/mdm-queries";
import { useConfigImpact, useReadiness } from "@/lib/v2/object-queries";
import { stepsOf } from "@/lib/v2/process-tree";
import { useObjectRules, useReceipt } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import type { ObjectRun } from "./useObjectRun";
import type { TabId } from "./tabs";

function Lead({ id, heading, sentence, children }: { id: string; heading: string; sentence: string; children: ReactNode }) {
  return (
    <section className="nx-why" aria-labelledby={`nx-lead-${id}`} data-testid={`lead-${id}`}>
      <h2 id={`nx-lead-${id}`} className="nx-sec-h">{heading}</h2>
      <p className="nx-muted">{sentence}</p>
      {children}
    </section>
  );
}

const fmt = (n: number) => int(n);
const SEV_TONE = { critical: "bad", high: "bad", medium: "warn", low: "data", info: "quiet" } as const;
const sevLabel = (s: keyof typeof SEV_TONE) => ({ critical: t("Critical"), high: t("High"), medium: t("Medium"), low: t("Low"), info: t("Info") })[s];

/** Records that fail a rule, by the rule's severity; and the rules themselves, passing or failing. */
function RulesLead({ o, kind }: { o: ObjectRun; kind: "records" | "rules" }) {
  const q = useObjectRules(o.module, o.runId);
  const segs = useMemo<Seg[]>(() => {
    const rows = q.data ?? [];
    if (kind === "rules") {
      const failing = rows.filter((r) => r.affected_count > 0).length;
      return [
        { key: "pass", label: t("Passing"), value: rows.length - failing, tone: "good" },
        { key: "fail", label: t("Failing"), value: failing, tone: "bad" },
      ];
    }
    return (Object.keys(SEV_TONE) as (keyof typeof SEV_TONE)[]).map((s) => ({ key: s, label: sevLabel(s), value: rows.filter((r) => r.severity === s).reduce((n, r) => n + r.affected_count, 0), tone: SEV_TONE[s] }));
  }, [q.data, kind]);
  const total = segs.reduce((n, s) => n + s.value, 0);
  return kind === "rules" ? (
    <Lead id="rules" heading={t("Rules of {object}", { object: o.label })} sentence={q.isLoading ? t("Reading the rules.") : t("{n} rules measured this run, passing and failing.", { n: int(total) })}>
      <SegBar segs={segs} format={fmt} testid="lead-chart-rules" />
    </Lead>
  ) : (
    <Lead id="records" heading={t("Failing records of {object}", { object: o.label })} sentence={q.isLoading ? t("Reading the rules.") : t("Rule failures by severity: {n} in all. A record can fail several rules.", { n: int(total) })}>
      <SegBar segs={segs} format={fmt} testid="lead-chart-records" />
    </Lead>
  );
}

function FixesLead({ o }: { o: ObjectRun }) {
  const q = useBatches();
  const rows = q.rows.filter((b) => b.modules.includes(o.module));
  const by = (s: string) => rows.filter((b) => b.status === s).reduce((n, b) => n + b.records, 0);
  const segs: Seg[] = [
    { key: "draft", label: t("Waiting for approval"), value: by("draft"), tone: "warn" },
    { key: "approved", label: t("Approved"), value: by("approved"), tone: "data" },
    { key: "awaiting_load", label: t("Exported, waiting for the SAP load"), value: by("awaiting_load"), tone: "quiet" },
    { key: "exported", label: t("Sent to SAP"), value: by("exported"), tone: "good" },
  ];
  return (
    <Lead id="fixes" heading={t("Fixes for {object}", { object: o.label })} sentence={t("{n} fix batches, records in each state.", { n: int(rows.length) })}>
      <SegBar segs={segs} format={fmt} testid="lead-chart-fixes" />
    </Lead>
  );
}

function TrendLead({ o }: { o: ObjectRun }) {
  const q = useTimeline(o.systemId, 50, o.module);
  const values = useMemo(() => (q.data?.runs ?? []).map((r) => r.objects[o.module]?.score ?? null).filter((v): v is number => v !== null), [q.data, o.module]);
  return (
    <Lead id="trend" heading={t("Trend of {object}", { object: o.label })} sentence={t("The score over the last {n} runs, oldest on the left.", { n: int(values.length) })}>
      <AreaSpark values={values} label={t("Score of {object}", { object: o.label })} width={640} height={96} testid="lead-chart-trend" />
    </Lead>
  );
}

function ReadinessLead({ o }: { o: ObjectRun }) {
  const q = useReadiness();
  const cells = (q.data?.cells ?? []).filter((c) => c.module === o.module);
  const n = (v: string) => cells.filter((c) => c.verdict === v).length;
  const segs: Seg[] = [
    { key: "go", label: t("Go"), value: n("go"), tone: "good" },
    { key: "at_risk", label: t("At risk"), value: n("at_risk"), tone: "warn" },
    { key: "no_go", label: t("No go"), value: n("no_go"), tone: "bad" },
  ];
  return (
    <Lead id="readiness" heading={t("Readiness of {object}", { object: o.label })} sentence={t("The verdict in each of {n} waves.", { n: int(cells.length) })}>
      <SegBar segs={segs} format={fmt} testid="lead-chart-readiness" />
    </Lead>
  );
}

function ProcessesLead({ o }: { o: ObjectRun }) {
  const receipt = useReceipt(o.module, o.runId);
  const doc = useProcessDocument(receipt.data?.run_id, o.module);
  const steps = useMemo(() => stepsOf(doc.data?.processes ?? []), [doc.data]);
  const n = (s: string) => steps.filter((x) => x.status === s).length;
  const segs: Seg[] = [
    { key: "green", label: t("Ready"), value: n("green"), tone: "good" },
    { key: "amber", label: t("At risk"), value: n("amber"), tone: "warn" },
    { key: "red", label: t("Blocked"), value: n("red"), tone: "bad" },
  ];
  return (
    <Lead id="processes" heading={t("Processes that read {object}", { object: o.label })} sentence={t("{n} process steps, by how ready their data is.", { n: int(steps.length) })}>
      <SegBar segs={segs} format={fmt} testid="lead-chart-processes" />
    </Lead>
  );
}

function GlossaryLead({ o }: { o: ObjectRun }) {
  const q = useGlossary(o.module, "");
  const terms = q.data?.terms ?? [];
  const n = (s: string) => terms.filter((x) => x.status === s).length;
  const segs: Seg[] = [
    { key: "active", label: t("Active"), value: n("active"), tone: "good" },
    { key: "under_review", label: t("Under review"), value: n("under_review"), tone: "warn" },
    { key: "deprecated", label: t("Deprecated"), value: n("deprecated"), tone: "quiet" },
  ];
  return (
    <Lead id="glossary" heading={t("Glossary of {object}", { object: o.label })} sentence={t("{n} terms, by status.", { n: int(terms.length) })}>
      <SegBar segs={segs} format={fmt} testid="lead-chart-glossary" />
    </Lead>
  );
}

function GoldenLead({ o }: { o: ObjectRun }) {
  const q = useGoldenRecords(o.module, 1);
  const rows = q.data?.records ?? [];
  const band = (lo: number, hi: number) => rows.filter((r) => r.overall_confidence >= lo && r.overall_confidence < hi).length;
  const segs: Seg[] = [
    { key: "high", label: t("Confidence 90% or more"), value: band(0.9, 2), tone: "good" },
    { key: "mid", label: t("Confidence 70% to 90%"), value: band(0.7, 0.9), tone: "warn" },
    { key: "low", label: t("Confidence under 70%"), value: band(-1, 0.7), tone: "bad" },
  ];
  return (
    <Lead id="golden" heading={t("Golden records of {object}", { object: o.label })} sentence={t("Showing {n} of {m} golden records, by match confidence.", { n: int(rows.length), m: int(q.data?.total ?? 0) })}>
      <SegBar segs={segs} format={fmt} testid="lead-chart-golden" />
    </Lead>
  );
}

function LineageLead({ o }: { o: ObjectRun }) {
  const receipt = useReceipt(o.module, o.runId);
  const rules = useObjectRules(o.module, o.runId);
  const impact = useConfigImpact(receipt.data?.run_id);
  const graph = useMemo(() => buildLineage(rules.data ?? [], impact.data ?? [], o.module), [rules.data, impact.data, o.module]);
  const n = (k: string) => graph.nodes.filter((x) => x.kind === k).length;
  const segs: Seg[] = [
    { key: "table", label: t("Tables"), value: n("table"), tone: "quiet" },
    { key: "field", label: t("Fields"), value: n("field"), tone: "data" },
    { key: "rule", label: t("Rules"), value: n("rule"), tone: "warn" },
    { key: "feature", label: t("Features"), value: n("feature"), tone: "good" },
  ];
  return (
    <Lead id="lineage" heading={t("Lineage of {object}", { object: o.label })} sentence={t("Where the fields come from and what reads them: {n} nodes.", { n: int(graph.nodes.length) })}>
      <SegBar segs={segs} format={fmt} testid="lead-chart-lineage" />
    </Lead>
  );
}

function ProfileLead({ o }: { o: ObjectRun }) {
  const f = useFixture();
  const receipt = useReceipt(o.module, o.runId);
  const versionId = receipt.data?.run_id ?? "";
  // The same key as the profile body below, so the profile is read once.
  const q = useQuery({ queryKey: ["v2", "profile", f, versionId, o.module], queryFn: () => getProfile(versionId, o.module), enabled: Boolean(versionId), retry: false });
  const fields = (q.data?.tables ?? []).flatMap((x) => x.fields);
  const n = (test: (pct: number) => boolean) => fields.filter((x) => test(x.stats.blank_pct)).length;
  const segs: Seg[] = [
    { key: "full", label: t("Always filled"), value: n((p) => p === 0), tone: "good" },
    { key: "part", label: t("Sometimes blank"), value: n((p) => p > 0 && p < 100), tone: "warn" },
    { key: "empty", label: t("Always blank"), value: n((p) => p >= 100), tone: "quiet" },
  ];
  return (
    <Lead id="profile" heading={t("Profile of {object}", { object: o.label })} sentence={t("{n} profiled fields, by how often they are filled.", { n: int(fields.length) })}>
      <SegBar segs={segs} format={fmt} testid="lead-chart-profile" />
    </Lead>
  );
}

/** The lead for a segment, or null when the segment draws its own. */
export function TabLead({ id, o }: { id: TabId; o: ObjectRun }) {
  switch (id) {
    case "records": return <RulesLead o={o} kind="records" />;
    case "rules": return <RulesLead o={o} kind="rules" />;
    case "fixes": return <FixesLead o={o} />;
    case "trend": return <TrendLead o={o} />;
    case "readiness": return <ReadinessLead o={o} />;
    case "processes": return <ProcessesLead o={o} />;
    case "glossary": return <GlossaryLead o={o} />;
    case "golden": return <GoldenLead o={o} />;
    case "lineage": return <LineageLead o={o} />;
    case "profile": return <ProfileLead o={o} />;
    default: return null;
  }
}
