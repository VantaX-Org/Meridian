"use client";

import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { getAnomalies, getDuplicates, getMiningOverview, getPatterns, getRelationships, LIMITS, runMining, type AnomalyItem, type DuplicatePair, type MiningPattern, type RelationshipItem } from "@/lib/api/v2/mining";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { f1, int, pct1 } from "@/lib/v2/score";
import { V2Link } from "@/design/v2/parts";
import { byObject, runsToMine } from "@/design/v2/screens/Mining";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, PartBar, Skeleton, StatCard, useToast, type Column } from "../../kit";
import { ChartCard, compact } from "../ChartCard";
import { TableSave } from "./TableSave";
import { httpStatus, noRetry4xx, sevTone, sevWord } from "./util";

/**
 * Data mining, native: likely duplicate records, values far outside their field's usual range and fields whose values
 * move together, from the latest run of every object. Each list reads on its own, so one that fails leaves the others.
 */

const METHOD: Record<string, () => string> = { iqr: () => t("Outside the usual range"), zscore: () => t("Far from the average") };
const LINK: Record<string, () => string> = { correlation: () => t("Move together"), functional_dependency: () => t("One decides the other") };

function useMining<T>(name: string, fn: () => Promise<T>) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["mining", fixture, name], queryFn: fn, staleTime: 60_000, retry: noRetry4xx });
}

const more = (n: number | undefined, limit: number) => (n == null ? "-" : n >= limit ? t("{n} or more", { n: int(n) }) : int(n));
const field = (code: string, text?: string | null) => <Code code={code} text={text ?? undefined} />;

function usual(a: AnomalyItem): string {
  if (a.lower_bound != null && a.upper_bound != null) return t("{lo} to {hi}", { lo: int(a.lower_bound), hi: int(a.upper_bound) });
  if (a.z_score != null) return t("{z} standard deviations away", { z: f1(Math.abs(a.z_score)) });
  return "-";
}

/** One list's loading, refusal, failure and empty states, then the table. */
function List<R>({ q, rows, empty, what, children }: { q: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; rows: readonly R[] | undefined; empty: string; what: string; children: (rows: R[]) => ReactNode }) {
  if (q.isPending) return <Skeleton lines={4} label={what} />;
  if (httpStatus(q.error) === 403) return <p className="nx-sub">{t("Your role cannot read the mining results.")}</p>;
  if (q.isError || !rows) return <ErrorState sentence={what} error={q.error} onRetry={() => void q.refetch()} />;
  return rows.length === 0 ? <EmptyState heading={empty} /> : <>{children([...rows])}</>;
}

function Section({ title, meta, testId, children }: { title: string; meta?: string; testId: string; children: ReactNode }) {
  return (
    <section aria-label={title} data-testid={testId}>
      <h3>{title}</h3>
      {meta ? <p className="nx-sub">{meta}</p> : null}
      {children}
    </section>
  );
}

export function DataMining() {
  const overview = useMining("summary", getMiningOverview);
  const dupes = useMining("duplicates", getDuplicates);
  const outliers = useMining("anomalies", getAnomalies);
  const links = useMining("relationships", getRelationships);
  const patterns = useMining("patterns", getPatterns);

  if (overview.isPending) return <div className="nx-body"><Skeleton lines={8} label={t("Data mining")} /></div>;
  if (overview.isError) {
    return (
      <div className="nx-body" data-testid="mining-page">
        {httpStatus(overview.error) === 403 ? <EmptyState heading={t("Your role cannot read the mining results.")} /> : (
          <ErrorState sentence={t("The mining figures could not be read.")} error={overview.error} onRetry={() => void overview.refetch()} />
        )}
      </div>
    );
  }
  const o = overview.data;
  const nd = dupes.data?.length;
  const no = outliers.data?.length;
  const objects = dupes.data && outliers.data ? byObject(dupes.data, outliers.data) : [];

  const dupeCols: Column<DuplicatePair>[] = [
    { id: "obj", label: t("Object"), cell: (d) => <Code code={d.module_id} text={moduleText(d.module_id)} /> },
    { id: "a", label: t("Record"), cell: (d) => <span className="nx-mono">{d.record_a}</span> },
    { id: "b", label: t("Looks like"), cell: (d) => <span className="nx-mono">{d.record_b}</span> },
    { id: "match", label: t("Match"), align: "end", compare: (a, b) => a.match_score - b.match_score, cell: (d) => pct1(d.match_score) },
    { id: "same", label: t("Same values in"), cell: (d) => d.matched_fields?.length ? <span className="nx-cell-stack">{d.matched_fields.map((c) => <span key={c}>{field(c, d.field_texts?.[c])}</span>)}</span> : "-" },
    { id: "found", label: t("Found"), compare: (a, b) => a.detected_at.localeCompare(b.detected_at), cell: (d) => formatDate(d.detected_at, "date") },
  ];
  const outCols: Column<AnomalyItem>[] = [
    { id: "obj", label: t("Object"), cell: (a) => <Code code={a.module_id} text={moduleText(a.module_id)} /> },
    { id: "field", label: t("Field"), cell: (a) => field(a.field_name, a.field_description) },
    { id: "rec", label: t("Record"), cell: (a) => (a.record_key ? <span className="nx-mono">{a.record_key}</span> : "-") },
    { id: "value", label: t("Value"), align: "end", cell: (a) => (a.field_value == null ? "-" : int(a.field_value)) },
    { id: "usual", label: t("Usual"), cell: usual },
    { id: "sev", label: t("Severity"), cell: (a) => <Chip tone={sevTone(a.severity)}>{sevWord(a.severity)}</Chip> },
    { id: "how", label: t("How found"), cell: (a) => METHOD[a.detection_method]?.() ?? labelText(a.detection_method) },
  ];
  const linkCols: Column<RelationshipItem>[] = [
    { id: "obj", label: t("Object"), cell: (r) => <Code code={r.module_id} text={moduleText(r.module_id)} /> },
    { id: "a", label: t("Field"), cell: (r) => field(r.field_a, r.field_a_description) },
    { id: "b", label: t("With field"), cell: (r) => field(r.field_b, r.field_b_description) },
    { id: "type", label: t("Relationship"), cell: (r) => LINK[r.relationship_type]?.() ?? labelText(r.relationship_type) },
    { id: "strength", label: t("Strength"), align: "end", compare: (a, b) => a.strength_score - b.strength_score, cell: (r) => pct1(r.strength_score) },
  ];
  const patternCols: Column<MiningPattern>[] = [
    {
      id: "pattern", label: t("Pattern"), cell: (p) => {
        const f = p.pattern_type === "anomaly" ? p.id.split(":")[2] : null;
        return (
          <span className="nx-cell-stack">
            {f ? <span>{t("Outliers in")} {field(f, p.field_description)}</span> : t("Duplicate records")}
            <span className="nx-sub">{moduleText(p.module)}</span>
          </span>
        );
      },
    },
    { id: "sev", label: t("Severity"), cell: (p) => <Chip tone={sevTone(p.severity)}>{sevWord(p.severity)}</Chip> },
    { id: "found", label: t("Found"), align: "end", compare: (a, b) => a.occurrences - b.occurrences, cell: (p) => t("{n, plural, one {once} other {# times}}", { n: p.occurrences }) },
    { id: "conf", label: t("Confidence"), align: "end", cell: (p) => pct1(p.confidence) },
  ];

  return (
    <div className="nx-body" data-testid="mining-page">
      <section aria-label={t("Data mining")} data-testid="mining">
        <p className="nx-sub">{t("{d} likely duplicate pairs and {o} outliers in the current data", { d: more(nd, LIMITS.duplicates), o: more(no, LIMITS.anomalies) })}</p>
        <p className="nx-sub">{t("Found by comparing records and values, not by the rules. Review them before they become rules or merges.")}</p>
        <div className="nx-statgrid">
          <StatCard label={t("Patterns, last {n} days", { n: int(o.window_days) })} value={o.total_patterns} />
          <StatCard label={t("Objects mined")} value={o.coverage_pct} format={(n) => `${f1(n)}%`} />
          <StatCard label={t("Runs mined")} value={o.runs_total} />
        </div>
        <div className="nx-row nx-wrap">
          <MineAction />
          <V2Link href="/rule-promotion" className="nx-btn nx-btn-secondary nx-btn-sm">{t("Review rule candidates")}</V2Link>
        </div>
        <p className="nx-sub">{t("Mining again reads the data and lists candidates. No record and no rule is changed until you promote a candidate.")}</p>
      </section>

      <div className="nx-chartcards">
        <ChartCard
          title={t("Findings by object")} testId="mining-objects"
          state={dupes.isPending || outliers.isPending ? "loading" : dupes.isError || outliers.isError ? "failed" : objects.length ? "ready" : "empty"}
          onRetry={() => { void dupes.refetch(); void outliers.refetch(); }}
          chart={<PartBar segments={objects.map((r) => ({ label: `${moduleText(r.module)} (${r.module})`, value: r.dupes + r.outliers }))} label={t("Findings by object")} format={compact} />}
          figure={int(objects.reduce((s, r) => s + r.dupes + r.outliers, 0))}
          line={t("Duplicate pairs and outliers per object.")}
          emptyLine={t("Mining found no duplicate or outlier.")}
        />
      </div>

      <Section title={t("Patterns")} meta={t("Outliers grouped by field, duplicates by object.")} testId="mining-patterns">
        <List q={patterns} rows={patterns.data?.patterns} empty={t("No pattern was found.")} what={t("The patterns could not be read.")}>
          {(rows) => <TableSave title={t("Patterns")}><DataTable rows={rows} columns={patternCols} rowKey={(p) => p.id} rowLabel={(p) => p.name} caption={t("Patterns")} /></TableSave>}
        </List>
      </Section>

      <Section title={t("Likely duplicates")} meta={nd != null ? t("{n} pairs, highest match first", { n: more(nd, LIMITS.duplicates) }) : undefined} testId="mining-duplicates">
        <List q={dupes} rows={dupes.data} empty={t("No likely duplicate was found.")} what={t("The duplicates could not be read.")}>
          {(rows) => <TableSave title={t("Likely duplicates")}><DataTable rows={rows} columns={dupeCols} rowKey={(d) => d.id} rowLabel={(d) => `${d.record_a} ${d.record_b}`} caption={t("Likely duplicates")} /></TableSave>}
        </List>
      </Section>

      <Section title={t("Outliers")} meta={no != null ? t("{n} values far from the rest of their field", { n: more(no, LIMITS.anomalies) }) : undefined} testId="mining-outliers">
        <List q={outliers} rows={outliers.data} empty={t("No outlier was found.")} what={t("The outliers could not be read.")}>
          {(rows) => <TableSave title={t("Outliers")}><DataTable rows={rows} columns={outCols} rowKey={(a) => a.id} rowLabel={(a) => `${a.field_name} ${a.record_key ?? ""}`} caption={t("Outliers")} /></TableSave>}
        </List>
      </Section>

      <Section title={t("Fields that depend on each other")} meta={t("Candidates for a cross-field rule, strongest first.")} testId="mining-relationships">
        <List q={links} rows={links.data ? [...links.data].sort((a, b) => b.strength_score - a.strength_score) : undefined} empty={t("No relationship between fields was found.")} what={t("The relationships could not be read.")}>
          {(rows) => <TableSave title={t("Fields that depend on each other")}><DataTable rows={rows} columns={linkCols} rowKey={(r) => r.id} rowLabel={(r) => `${r.field_a} ${r.field_b}`} caption={t("Fields that depend on each other")} /></TableSave>}
        </List>
      </Section>
    </div>
  );
}

function MineAction() {
  const session = useV2Session();
  const land = useLandscape(null);
  const toast = useToast();
  const qc = useQueryClient();
  const runs = runsToMine(land.data?.cells ?? []);
  const mine = useMutation({
    mutationFn: () => Promise.all([...runs].map(([run, modules]) => runMining(run, modules))),
    onSuccess: (r) => {
      toast({ text: t("Mining started on {n} runs. The lists refresh when it finishes.", { n: int(r.length) }), tone: "good" });
      void qc.invalidateQueries({ queryKey: ["mining"] });
    },
    onError: (e) => toast({ text: errorSentence(e, t("Mining could not be started.")), tone: "bad" }),
  });
  if (!session.can("mdm.write") || session.shared || session.viewAs) return null;
  return (
    <Button variant="primary" size={32} disabled={runs.size === 0} loading={mine.isPending} onClick={() => mine.mutate()} data-testid="mining-run">
      {t("Mine the latest runs")}
    </Button>
  );
}
