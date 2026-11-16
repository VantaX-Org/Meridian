"use client";

import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  getAnomalies, getDuplicates, getMiningOverview, getPatterns, getRelationships, LIMITS, runMining,
  type AnomalyItem, type DuplicatePair, type MiningPattern, type RelationshipItem,
} from "@/lib/api/v2/mining";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { f1, int, pct1 } from "@/lib/v2/score";
import { byObject, runsToMine } from "@/design/v2/screens/Mining";
import { Button, Code, DataTable, EmptyState, ErrorState, Skeleton, useToast, type Column } from "../kit";
import { SevChip } from "../object/tabs/tabs-g-parts";
import { About, Banner, Fold, HBars, Panel } from "./cfg-parts";
import { ExportTable } from "./ExportTable";

/**
 * Data mining: the likely duplicate records, the values far outside their field's usual range and the fields whose
 * values move together, as the mining tasks found them on the latest run of every object (api/routes/mining.py).
 * Each list is read on its own, so one that fails or is forbidden leaves the others on the page.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };
const dash = f1(null);

function useMining<T>(name: string, fn: () => Promise<T>) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["mining", fixture, name], queryFn: fn, staleTime: 60_000, retry });
}

const METHOD: Record<string, () => string> = {
  iqr: () => t("Outside the usual range"),
  zscore: () => t("Far from the average"),
};

const LINK: Record<string, () => string> = {
  correlation: () => t("Move together"),
  functional_dependency: () => t("One decides the other"),
};

/** One list's loading, refusal, failure and empty states, then its rows. */
function List<T>({ q, label, empty, what, rows, children }: {
  q: UseQueryResult<T, unknown>; label: string; empty: string; what: string; rows: (d: T) => readonly unknown[]; children: (d: T) => ReactNode;
}) {
  if (q.isPending) return <Skeleton lines={4} label={label} />;
  if (q.isError) {
    return status(q.error) === 403
      ? <EmptyState heading={t("Your role cannot read the mining results.")} />
      : <ErrorState sentence={what} onRetry={() => void q.refetch()} />;
  }
  return rows(q.data).length === 0 ? <EmptyState heading={empty} /> : <>{children(q.data)}</>;
}

/** A field code with its dictionary text beside it. */
const Field = ({ code, text }: { code: string; text?: string | null }) => <Code code={code} text={text ?? undefined} />;

/** The range the value fell outside, or how many standard deviations it sits from the average. */
function usual(a: AnomalyItem): string {
  if (a.lower_bound != null && a.upper_bound != null) return t("{lo} to {hi}", { lo: int(a.lower_bound), hi: int(a.upper_bound) });
  if (a.z_score != null) return t("{z} standard deviations away", { z: f1(Math.abs(a.z_score)) });
  return dash;
}

export function RecordMining() {
  const overview = useMining("summary", getMiningOverview);
  const dupes = useMining("duplicates", getDuplicates);
  const outliers = useMining("anomalies", getAnomalies);
  const links = useMining("relationships", getRelationships);
  const patterns = useMining("patterns", getPatterns);
  const title = t("Data mining");

  if (overview.isPending) return <Skeleton lines={8} label={title} />;
  if (overview.isError) {
    return status(overview.error) === 403
      ? <EmptyState heading={t("Your role cannot read the mining results.")} />
      : <ErrorState sentence={t("The mining figures could not be read.")} onRetry={() => void overview.refetch()} />;
  }
  const o = overview.data;
  const nd = dupes.data?.length;
  const no = outliers.data?.length;
  const more = (n: number | undefined, limit: number) => (n == null ? dash : n >= limit ? t("{n} or more", { n: int(n) }) : int(n));

  const dupCols: Column<DuplicatePair>[] = [
    { id: "obj", label: t("Object"), cell: (d) => moduleText(d.module_id) },
    { id: "a", label: t("Record"), cell: (d) => <Code code={d.record_a} /> },
    { id: "b", label: t("Looks like"), cell: (d) => <Code code={d.record_b} /> },
    { id: "match", label: t("Match"), align: "end", cell: (d) => pct1(d.match_score), compare: (a, b) => a.match_score - b.match_score },
    { id: "same", label: t("Same values in"), cell: (d) => (d.matched_fields?.length ? <ul className="nx-wrap">{d.matched_fields.map((c) => <li key={c}><Field code={c} text={d.field_texts?.[c]} /></li>)}</ul> : dash) },
    { id: "found", label: t("Found"), cell: (d) => formatDate(d.detected_at, "date") },
  ];
  const outCols: Column<AnomalyItem>[] = [
    { id: "obj", label: t("Object"), cell: (a) => moduleText(a.module_id) },
    { id: "field", label: t("Field"), cell: (a) => <Field code={a.field_name} text={a.field_description} /> },
    { id: "rec", label: t("Record"), cell: (a) => (a.record_key ? <Code code={a.record_key} /> : dash) },
    { id: "value", label: t("Value"), align: "end", cell: (a) => (a.field_value == null ? dash : int(a.field_value)) },
    { id: "usual", label: t("Usual"), cell: usual },
    { id: "sev", label: t("Severity"), cell: (a) => <SevChip severity={a.severity} /> },
    { id: "how", label: t("How found"), cell: (a) => METHOD[a.detection_method]?.() ?? labelText(a.detection_method) },
  ];
  const linkCols: Column<RelationshipItem>[] = [
    { id: "obj", label: t("Object"), cell: (r) => moduleText(r.module_id) },
    { id: "a", label: t("Field"), cell: (r) => <Field code={r.field_a} text={r.field_a_description} /> },
    { id: "b", label: t("With field"), cell: (r) => <Field code={r.field_b} text={r.field_b_description} /> },
    { id: "type", label: t("Relationship"), cell: (r) => LINK[r.relationship_type]?.() ?? labelText(r.relationship_type) },
    { id: "strength", label: t("Strength"), align: "end", cell: (r) => pct1(r.strength_score), compare: (a, b) => a.strength_score - b.strength_score },
  ];

  return (
    <div className="nx-body" data-testid="mining-page">
      <Banner
        title={t("{d} likely duplicate pairs and {o} outliers in the current data", { d: more(nd, LIMITS.duplicates), o: more(no, LIMITS.anomalies) })}
        why={t("Found by comparing records and values, not by the rules. Review them before they become rules or merges.")}
        meta={title}
        label={title}
        testId="mining"
        figs={[
          { label: t("Patterns, last {n} days", { n: int(o.window_days) }), value: int(o.total_patterns), note: t("outliers grouped by field, duplicates by object") },
          { label: t("Objects mined"), value: `${f1(o.coverage_pct)}%`, note: t("of the analysed objects") },
          { label: t("Runs mined"), value: int(o.runs_total), note: t("analysis runs with mining results") },
        ]}
      >
        <MineAction />
      </Banner>
      <Fold title={t("Findings by object")} hint={t("Duplicate pairs and outliers counted per object.")}>
        <Panel title={t("Findings by object")} meta={t("Duplicate pairs and outliers per object.")} testId="mining-objects">
          {dupes.isPending || outliers.isPending ? <Skeleton lines={3} label={t("Findings by object")} /> : dupes.isError || outliers.isError ? (
            <ErrorState sentence={t("The findings could not be read.")} onRetry={() => { void dupes.refetch(); void outliers.refetch(); }} />
          ) : (() => {
            const rows = byObject(dupes.data, outliers.data);
            const max = Math.max(...rows.map((r) => r.dupes + r.outliers), 1);
            return rows.length === 0 ? <EmptyState heading={t("Mining found no duplicate or outlier.")} /> : (
              <HBars
                label={t("Findings by object")}
                rows={rows.map((r) => ({
                  key: r.module,
                  label: <Code code={r.module} text={moduleText(r.module)} />,
                  value: ((r.dupes + r.outliers) / max) * 100,
                  text: t("{d, plural, one {# duplicate pair} other {# duplicate pairs}}, {o, plural, one {# outlier} other {# outliers}}", { d: r.dupes, o: r.outliers }),
                  tone: "warn",
                }))}
              />
            );
          })()}
        </Panel>
      </Fold>
      <Fold title={t("Patterns")} hint={t("Outliers grouped by field, duplicates by object.")}>
        <Patterns q={patterns} />
      </Fold>
      <Panel title={t("Likely duplicates")} meta={nd != null ? t("{n} pairs, highest match first", { n: more(nd, LIMITS.duplicates) }) : undefined} testId="mining-duplicates">
        <List q={dupes} label={t("Likely duplicates")} rows={(d) => d} empty={t("No likely duplicate was found.")} what={t("The duplicates could not be read.")}>
          {(rows) => <ExportTable><DataTable caption={t("Likely duplicates")} rows={rows} rowKey={(d) => d.id} rowLabel={(d) => d.record_a} columns={dupCols} /></ExportTable>}
        </List>
      </Panel>
      <Panel title={t("Outliers")} meta={no != null ? t("{n} values far from the rest of their field", { n: more(no, LIMITS.anomalies) }) : undefined} testId="mining-outliers">
        <List q={outliers} label={t("Outliers")} rows={(d) => d} empty={t("No outlier was found.")} what={t("The outliers could not be read.")}>
          {(rows) => <ExportTable><DataTable caption={t("Outliers")} rows={rows} rowKey={(a) => a.id} rowLabel={(a) => a.field_name} columns={outCols} /></ExportTable>}
        </List>
      </Panel>
      <Fold title={t("Fields that depend on each other")} hint={t("Candidates for a cross-field rule.")}>
        <Panel title={t("Fields that depend on each other")} meta={t("Candidates for a cross-field rule, strongest first.")} testId="mining-relationships">
          <List q={links} label={t("Fields that depend on each other")} rows={(d) => d} empty={t("No relationship between fields was found.")} what={t("The relationships could not be read.")}>
            {(rows) => (
              <ExportTable>
                <DataTable caption={t("Fields that depend on each other")} rows={[...rows].sort((a, b) => b.strength_score - a.strength_score)} rowKey={(r) => r.id} rowLabel={(r) => `${r.field_a} ${r.field_b}`} columns={linkCols} />
              </ExportTable>
            )}
          </List>
        </Panel>
      </Fold>
      <About
        shows={t("Finds outliers, duplicates and fields that depend on each other by comparing records and values, not by rules.")}
        why={t("Mining again reads the data and lists candidates. No record and no rule is changed until you promote a candidate.")}
        means={[
          [t("Patterns"), t("Groups of outliers by field and of duplicates by object.")],
          [t("Objects mined"), t("The share of analysed objects that have mining results.")],
          [t("Runs mined"), t("Analysis runs that have mining results.")],
        ]}
        next={{ href: "/rule-promotion", label: t("Review rule candidates") }}
      />
    </div>
  );
}

function Patterns({ q }: { q: UseQueryResult<{ patterns: MiningPattern[] }, unknown> }) {
  const fieldOf = (p: MiningPattern) => (p.pattern_type === "anomaly" ? p.id.split(":")[2] ?? null : null);
  const cols: Column<MiningPattern>[] = [
    {
      id: "pattern", label: t("Pattern"), cell: (p) => {
        const field = fieldOf(p);
        return (
          <>
            {field ? <>{t("Outliers in")} <Code code={field} text={p.field_description ?? undefined} /></> : t("Duplicate records")}
            <div className="nx-sub">{moduleText(p.module)}</div>
          </>
        );
      },
    },
    { id: "sev", label: t("Severity"), cell: (p) => <SevChip severity={p.severity} /> },
    { id: "found", label: t("Found"), align: "end", cell: (p) => t("{n, plural, one {once} other {# times}}", { n: p.occurrences }), compare: (a, b) => a.occurrences - b.occurrences },
    { id: "conf", label: t("Confidence"), align: "end", cell: (p) => pct1(p.confidence) },
  ];
  return (
    <Panel title={t("Patterns")} meta={t("Outliers grouped by field, duplicates by object.")} testId="mining-patterns">
      <List q={q} label={t("Patterns")} rows={(d) => d.patterns} empty={t("No pattern was found.")} what={t("The patterns could not be read.")}>
        {(d) => <ExportTable><DataTable caption={t("Patterns")} rows={d.patterns} rowKey={(p) => p.id} rowLabel={(p) => p.name} columns={cols} /></ExportTable>}
      </List>
    </Panel>
  );
}

function MineAction() {
  const { can } = useV2Session();
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
  if (!can("mdm.write")) return null;
  return (
    <Button disabled={runs.size === 0 || mine.isPending} onClick={() => mine.mutate()} data-testid="mining-run">
      {t("Mine the latest runs")}
    </Button>
  );
}
