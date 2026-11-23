"use client";

/**
 * The top of the Load route: one pair's three scores on one ruler, why they differ, what failed to load, the
 * reconciliation, the field by field differences and the order to load in. Every figure is read from an existing
 * endpoint; what no endpoint supplies is left out (see the change report).
 */
import { useState } from "react";
import { exportComparison, type TableCompare } from "@/lib/api/v2/compare";
import type { LoadObject } from "@/lib/api/v2/load-plan";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { describeTable } from "@/lib/v2/sap-fields";
import { Button, Card, Chip, DataTable, EmptyState, ErrorState, FieldChip, ScoreRuler, Skeleton, StatTile, Stepper, useAletheiaScope, useToast } from "@/ui/kit";
import { compactCount, score, signed } from "../object/format";
import { Verdict, humanize, useHref, when } from "./common";
import { useLoadPlan, usePairLatest, usePairs, useRecords } from "./hooks";
import "./loadboard.css";

const labels = () => ({ atRisk: t("At risk"), go: t("Go"), cap70: t("Cap at 70"), cap85: t("Cap at 85"), measured: (n: number) => t("Measured {n}", { n }) });

function Failures({ runId, tables }: { runId: string; tables: TableCompare[] }) {
  const href = useHref();
  const q = useRecords(runId, "load_fail");
  const rows = q.data?.rows ?? [];
  const text = (tb: string | null) => tables.find((x) => x.table === tb)?.description || (tb ? describeTable(tb) ?? undefined : undefined);
  return (
    <Card title={t("Load failures to clear")} sub={t("{n, plural, one {# record} other {# records}}", { n: q.data?.total ?? 0 })}
      action={<Button variant="secondary" href={href("/load/maps")}>{t("Open value mapping")}</Button>}>
      {q.isLoading ? <Skeleton lines={3} label={t("Loading the load failures")} /> : q.isError ? <ErrorState heading={t("The load failures could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} /> : rows.length === 0 ? <EmptyState heading={t("No load failures")} body={t("A failure appears here when a load is rejected by SAP.")} /> : (
        <DataTable
          label={t("Load failures to clear")}
          rows={rows}
          rowKey={(r) => `${r.source_table}|${r.record_key}`}
          columns={[
            { key: "t", label: t("Table"), render: (r) => (r.source_table ? <FieldChip code={r.source_table} description={text(r.source_table)} /> : "") },
            { key: "k", label: t("Record"), render: (r) => <code className="mx-code">{r.record_key}</code> },
            { key: "r", label: t("Why it failed"), render: (r) => r.reasons.join("; ") },
          ]}
        />
      )}
    </Card>
  );
}

/** Why a table could not be reconciled, from the post-load and system-compare services. */
const REASONS: Record<string, () => string> = {
  no_key_in_dictionary: () => t("No key in the dictionary"),
  key_map_mismatch: () => t("Source and target keys differ"),
  key_not_in_load: () => t("Key not in the load"),
  target_extract_incomplete: () => t("Target extract was incomplete"),
  target_extract_partial: () => t("Target extract was partial"),
  table_not_extracted: () => t("Table not extracted"),
  key_not_in_target_extract: () => t("Key not in the target extract"),
};
export const reasonText = (r: string | null) => (r && REASONS[r] ? REASONS[r]() : t("Not comparable"));

export function LoadBoard() {
  useInterfaceLang();
  const href = useHref();
  const toast = useToast();
  const pairs = usePairs();
  const plan = useLoadPlan();
  const [chosen, setChosen] = useState<string | null>(null);
  const list = pairs.data?.pairs ?? [];
  const pairId = chosen ?? list[0]?.id ?? "";
  const latest = usePairLatest(pairId);
  const pair = latest.data?.pair ?? list.find((p) => p.id === pairId) ?? null;
  const cmp = latest.data?.comparison ?? null;
  const sc = cmp?.scores ?? pair?.last?.scores ?? null;
  const tables = cmp?.tables ?? [];
  const lost = sc && sc.projected !== null && sc.actual !== null ? sc.projected - sc.actual : null;
  const reasons = sc?.reasons ?? [];
  const fixed = reasons.filter((r) => r.change > 0).length;
  const broke = reasons.filter((r) => r.change < 0).length;
  const objects = [...(plan.data?.objects ?? [])].sort((a, b) => a.step - b.step);
  const firstOpen = objects.findIndex((o) => o.status !== "go");
  const blocked: LoadObject | undefined = objects.find((o) => o.status === "no_go" && o.prerequisites.length);
  const fieldRows = tables.flatMap((tb) => tb.fields.filter((f) => f.differing > 0 || Object.values(f.transformed).some((n) => n > 0))
    .map((f) => ({ id: `${tb.table}.${f.field}`, table: tb.table, f })));

  useAletheiaScope({
    key: "load-board", label: t("Asking about this load"),
    suggestions: lost !== null ? [t("Why did the target lose {n} points?", { n: score(lost) }), t("What blocks the load?")] : [t("What blocks the load?")],
    context: pair ? { module: pair.module } : {},
    answer: (prompt) => {
      if (prompt === t("What blocks the load?")) return blocked ? { text: t("{n} objects are no-go. Load them after the objects they wait for.", { n: objects.filter((o) => o.status === "no_go").length }), evidence: blocked.prerequisites.slice(0, 5).map((p) => `${p.table} ${p.text}`) } : { text: t("No object blocks the load."), evidence: [] };
      if (lost === null || !sc) return null;
      const worst = [...reasons].sort((a, b) => a.change - b.change)[0];
      return { text: t("Source {s}, projected target {p}, actual target {a}.", { s: score(sc.source ?? 0), p: score(sc.projected ?? 0), a: score(sc.actual ?? 0) }) + (worst && worst.change < 0 ? ` ${worst.check_id} ${worst.description ?? ""}` : ""), evidence: reasons.slice(0, 3).map((r) => `${r.check_id} ${signed(r.change)}`) };
    },
  });

  if (pairs.isLoading) return <Skeleton lines={5} label={t("Loading the load board")} />;
  if (pairs.isError) return <ErrorState heading={t("The load board could not be loaded")} retryLabel={t("Try again")} onRetry={() => void pairs.refetch()} />;
  const exportRecon = () => { if (cmp) exportComparison(cmp.id, "xlsx", {}).catch(() => toast(t("The export failed"), "bad")); };
  const marks: { id: string; label: string; shown: number }[] = [];
  if (sc) for (const [id, label, v] of [["source", t("Source"), sc.source], ["projected", t("Projected target"), sc.projected], ["actual", t("Actual target"), sc.actual]] as const) if (v !== null) marks.push({ id, label, shown: v });

  return (
    <section className="lb-board" aria-label={t("Load to target")} data-testid="load-board">
      {list.length > 1 && (
        <div className="mx-chips" role="group" aria-label={t("Pair")}>
          {list.map((p) => <Chip key={p.id} selected={p.id === pairId} onClick={() => setChosen(p.id)}>{`${labelText(p.module)}, ${p.source.name} ${t("to")} ${p.target.name}`}</Chip>)}
        </div>
      )}
      {latest.isError && <ErrorState heading={t("The comparison for this pair could not be loaded")} retryLabel={t("Try again")} onRetry={() => void latest.refetch()} />}
      {!pair ? <EmptyState heading={t("No pair to load yet")} body={t("Pair a source system with its target to compare them.")} action={<Button variant="secondary" href={href("/load/compare")}>{t("Paired systems")}</Button>} /> : (
        <>
          <Card title={t("Three scores on one ruler")} sub={`${labelText(pair.module)}, ${pair.source.name} ${t("to")} ${pair.target.name}${cmp ? `, ${t("compared {when}", { when: when(cmp.completed_at ?? cmp.created_at) })}` : ""}`}>
            {marks.length ? <ScoreRuler marks={marks} labels={labels()} ariaLabel={t("Source, projected target and actual target against the gates")} zones={{ noGo: t("No-go"), atRisk: t("At risk"), go: t("Go") }} /> : <EmptyState heading={t("Not compared yet")} body={t("Run a comparison to see the differences.")} />}
            {sc && (
              <dl className="mx-tiles">
                <StatTile label={t("Source")} value={sc.source !== null ? score(sc.source) : t("n/a")} />
                <StatTile label={t("Projected target")} value={sc.projected !== null ? score(sc.projected) : t("n/a")} />
                <StatTile label={t("Actual target")} value={sc.actual !== null ? score(sc.actual) : t("n/a")} />
                {lost !== null && <StatTile label={t("Lost in the load")} value={score(lost)} />}
              </dl>
            )}
          </Card>
          {reasons.length > 0 && (
            <Card title={t("Why they differ")} sub={t("Pass rate per rule, source against target")}>
              <DataTable
                label={t("Why they differ")}
                rows={reasons}
                rowKey={(r) => r.check_id}
                columns={[
                  { key: "c", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={r.description ?? undefined} /> },
                  { key: "s", label: t("Source pass rate"), align: "end", sort: (r) => r.source_pass_rate ?? -1, render: (r) => (r.source_pass_rate !== null ? score(r.source_pass_rate) : "") },
                  { key: "g", label: t("Target pass rate"), align: "end", sort: (r) => r.target_pass_rate ?? -1, render: (r) => (r.target_pass_rate !== null ? score(r.target_pass_rate) : "") },
                  { key: "d", label: t("Change"), align: "end", sort: (r) => r.change, render: (r) => <span data-tone={r.change >= 0 ? "good" : "bad"}>{signed(r.change)}</span> },
                ]}
              />
              <p className="lb-note">{t("The load fixed {fixed} rules and broke {broke}.", { fixed, broke })}</p>
            </Card>
          )}
          {sc?.migration_run_id ? <Failures runId={sc.migration_run_id} tables={tables} /> : null}
          <Card title={t("Reconciliation")} sub={cmp?.summary ? t("{n, plural, one {# record} other {# records}} in the target", { n: cmp.summary.in_target }) : undefined}
            action={<span className="lb-actions"><Button variant="secondary" href={href(`/load/compare/${pair.id}`)}>{t("Open missing records")}</Button><Button variant="secondary" onClick={exportRecon} disabled={!cmp}>{t("Export reconciliation")}</Button></span>}>
            {tables.length ? (
              <DataTable
                label={t("Records missing in the target")}
                rows={tables}
                rowKey={(r) => r.table}
                columns={[
                  { key: "t", label: t("Table"), render: (r) => <FieldChip code={r.table} description={r.description} /> },
                  { key: "f", label: t("Found in the target"), render: (r) => (r.comparable ? t("{a} of {b} found, {c} unexpected", { a: compactCount(r.matched), b: compactCount(r.in_source), c: compactCount(r.extra_in_target) }) : reasonText(r.reason)) },
                  { key: "m", label: t("Missing"), align: "end", sort: (r) => r.missing_in_target, render: (r) => (r.comparable ? compactCount(r.missing_in_target) : t("Not comparable")) },
                ]}
              />
            ) : <EmptyState heading={t("No tables compared yet")} body={t("Run a comparison to see each table.")} />}
          </Card>
          {fieldRows.length > 0 && (
            <Card title={t("Field by field")}>
              <DataTable
                label={t("Field by field")}
                rows={fieldRows}
                rowKey={(r) => r.id}
                columns={[
                  { key: "f", label: t("Field"), render: (r) => <FieldChip code={r.id} description={r.f.description} /> },
                  { key: "c", label: t("Compared"), align: "end", sort: (r) => r.f.compared, render: (r) => compactCount(r.f.compared) },
                  { key: "d", label: t("Differ"), align: "end", sort: (r) => r.f.differing, render: (r) => compactCount(r.f.differing) },
                  { key: "n", label: t("Transformed"), render: (r) => Object.entries(r.f.transformed).filter(([, n]) => n > 0).map(([k, n]) => `${labelText(k)}: ${compactCount(n)}`).join(", ") },
                ]}
              />
            </Card>
          )}
        </>
      )}
      <Card title={t("Load plan")} sub={t("Order set by dependencies")}>
        {plan.isLoading ? <Skeleton lines={3} label={t("Loading the load order")} /> : plan.isError ? <ErrorState heading={t("The load order could not be loaded")} retryLabel={t("Try again")} onRetry={() => void plan.refetch()} /> : objects.length === 0 ? <EmptyState heading={t("No load order yet")} body={t("Analyse an object first.")} /> : (
          <>
            <Stepper label={t("Load order")} current={firstOpen < 0 ? objects.length : firstOpen} steps={objects.map((o) => ({ id: o.module, label: o.label || humanize(o.module) }))} />
            <DataTable
              label={t("Load plan")}
              rows={objects}
              rowKey={(o) => o.module}
              columns={[
                { key: "n", label: t("Step"), align: "end", render: (o) => o.step },
                { key: "o", label: t("Object"), render: (o) => <FieldChip code={o.anchor} description={o.label || humanize(o.module)} /> },
                { key: "s", label: t("Status"), render: (o) => <Verdict v={o.status} /> },
                { key: "b", label: t("Blocking findings"), align: "end", render: (o) => o.blocking },
              ]}
            />
            {blocked && (
              <div className="lb-block">
                <h3 className="mx-card-t">{t("{object} waits for {n} configuration tables", { object: blocked.label || humanize(blocked.module), n: blocked.prerequisites.length })}</h3>
                <ul className="lb-list">{blocked.prerequisites.map((p) => <li key={p.table}><FieldChip code={p.table} description={p.text} /></li>)}</ul>
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
