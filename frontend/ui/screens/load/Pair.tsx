"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { exportComparison, runPair, type CompareKind, type DiffRow } from "@/lib/api/v2/compare";
import { Button, Card, DataTable, DqsPair, EmptyState, FieldChip, PageHeader, Select, StatTile, Tabs, TrendArea, useAletheiaScope, useToast, ExportMenu } from "@/ui/kit";
import { AskButton, Gate, humanize, pct, useHref, when, useBack } from "./common";
import { invalidateLoad, useDiffs, usePairLatest, usePairTrend } from "./hooks";

const kindLabel = (k: CompareKind): string => (k === "missing" ? t("Missing in target") : k === "extra" ? t("Only in target") : t("Differs"));

/** One pair: source DQS, projected target DQS, actual target DQS and why they differ, then trend, differences and config. */
export function Pair({ id }: { id: string }) {
  useInterfaceLang();
  const back = useBack("/load/compare", t("Back to paired systems"));
  const q = usePairLatest(id);
  const tr = usePairTrend(id);
  const href = useHref();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("diffs");
  const [kind, setKind] = useState<"" | CompareKind>("");
  const cmp = q.data?.comparison ?? null;
  const pair = q.data?.pair ?? null;
  const filter = { kind: kind || undefined, limit: 200 };
  const diffs = useDiffs(cmp?.id ?? null, filter);
  const run = useMutation({ mutationFn: () => runPair(id), onSuccess: () => { toast(t("Comparison started"), "info"); invalidateLoad(qc); }, onError: () => toast(t("The comparison could not be started"), "bad") });
  const sc = cmp?.scores ?? pair?.last?.scores ?? null;
  const name = pair ? `${pair.source.name} ${t("to")} ${pair.target.name}` : "";

  useAletheiaScope({
    key: `load/compare/${id}`,
    label: t("Asking about {pair}", { pair: name }),
    suggestions: [t("Why do projected and actual target DQS differ?")],
    answer: () => {
      const r = sc?.reasons[0];
      return {
        text: sc ? t("Source {s}, projected target {p}, actual target {a}.", { s: pct(sc.source), p: pct(sc.projected), a: pct(sc.actual) }) + (r ? ` ${r.check_id} ${r.description}` : "") : t("This pair has not been compared yet."),
        evidence: (sc?.reasons ?? []).slice(0, 3).map((x) => `${x.check_id} ${pct(x.source_pass_rate)} ${t("to")} ${pct(x.target_pass_rate)}`),
      };
    },
  });

  const exp = async (f: string) => { if (cmp) await exportComparison(cmp.id, f as "xlsx" | "csv", filter); };
  const s = cmp?.summary;

  return (
    <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the pair")}>
      <PageHeader back={back}
        title={name}
        context={pair ? <>{<FieldChip code={pair.module} description={humanize(pair.module)} />}{cmp ? `, ${t("compared {when}", { when: when(cmp.completed_at ?? cmp.created_at) })}` : ""}</> : null}
        actions={<>
          <Button variant="primary" onClick={() => run.mutate()} disabled={run.isPending}>{t("Run comparison")}</Button>
          <ExportMenu label={t("Export differences")} disabled={!cmp} formats={[{ id: "xlsx", label: t("Excel workbook") }, { id: "csv", label: t("CSV") }]} onExport={exp} />
          <Button variant="secondary" href={href("/load/compare")}>{t("All pairs")}</Button>
          <AskButton />
        </>}
      />
      <div className="mx-split">
        <div className="mx-col">
          <Card title={t("Source and target quality")} sub={t("Why the three scores differ")}>
            {sc ? (
              <DqsPair
                naLabel={t("n/a")}
                rows={[
                  { key: "source", label: t("Source DQS"), value: sc.source },
                  { key: "projected", label: t("Projected target DQS"), value: sc.projected, note: sc.projected_reason ?? undefined },
                  { key: "actual", label: t("Actual target DQS"), value: sc.actual, note: sc.actual_reason ?? undefined },
                ]}
                reasons={sc.reasons.map((x) => ({ label: `${x.check_id} ${x.description}`.trim(), value: t("{a} to {b}", { a: pct(x.source_pass_rate), b: pct(x.target_pass_rate) }) }))}
              />
            ) : <EmptyState heading={t("Not compared yet")} body={t("Run a comparison to see the differences.")} />}
          </Card>
          <Card title={t("Scores over comparisons")}>
            <TrendArea
              label={t("Actual target DQS over comparisons")}
              emptyLabel={t("Not enough comparisons to draw a trend yet.")}
              points={(tr.data?.points ?? []).filter((p) => p.actual !== null).map((p) => ({ axis: when(p.at), title: when(p.at), value: p.actual as number }))}
            />
          </Card>
          {s ? (
            <Card title={t("Comparison")}>
              <dl className="mx-tiles">
                <StatTile label={t("Matched records")} value={String(s.matched)} />
                <StatTile label={t("Missing in target")} value={String(s.missing_in_target)} />
                <StatTile label={t("Only in target")} value={String(s.extra_in_target)} />
                <StatTile label={t("Differing fields")} value={String(s.differing_fields)} />
              </dl>
            </Card>
          ) : null}
        </div>
        <div className="mx-col">
          <Card title={t("Detail")}>
            <Tabs idBase="mx-pair" label={t("Pair detail")} value={tab} onChange={setTab} items={[{ id: "diffs", label: t("Differences"), badge: diffs.data ? String(diffs.data.total) : undefined }, { id: "tables", label: t("Tables") }, { id: "config", label: t("Config") }]} />
            {tab === "diffs" ? (
              <div id="mx-pair-panel-diffs" role="tabpanel">
                <Select aria-label={t("Kind of difference")} value={kind} onChange={(e) => setKind(e.target.value as "" | CompareKind)} options={[{ value: "", label: t("All differences") }, ...(["missing", "extra", "differing"] as CompareKind[]).map((k) => ({ value: k, label: kindLabel(k) }))]} />
                {diffs.data?.rows.length ? (
                  <DataTable<DiffRow>
                    label={t("Differences")}
                    rows={diffs.data.rows}
                    rowKey={(r) => `${r.table}|${r.key}|${r.field ?? ""}|${r.kind}`}
                    columns={[
                      { key: "table", label: t("Table"), render: (r) => <FieldChip code={r.table} description={r.table_text} /> },
                      { key: "key", label: t("Record"), render: (r) => <code className="mx-code">{r.key}</code> },
                      { key: "field", label: t("Field"), render: (r) => (r.field ? <FieldChip code={r.field} description={r.field_text} /> : "") },
                      { key: "kind", label: t("Difference"), render: (r) => kindLabel(r.kind) },
                      { key: "source", label: t("Source value"), render: (r) => r.source ?? "" },
                      { key: "target", label: t("Target value"), render: (r) => r.target ?? "" },
                    ]}
                  />
                ) : <EmptyState heading={cmp ? t("No differences found") : t("Run a comparison to see differences")} body={t("Run a comparison, or change the filter, to see differences.")} />}
              </div>
            ) : null}
            {tab === "tables" ? (
              <div id="mx-pair-panel-tables" role="tabpanel">
                {cmp?.tables.length ? (
                  <DataTable
                    label={t("Compared tables")}
                    rows={cmp.tables}
                    rowKey={(r) => r.table}
                    columns={[
                      { key: "table", label: t("Table"), render: (r) => <FieldChip code={r.table} description={r.description} /> },
                      { key: "records", label: t("Records"), align: "end", render: (r) => String(r.records_total) },
                      { key: "fields", label: t("Fields differing"), align: "end", render: (r) => String(r.fields.reduce((n, f) => n + f.differing, 0)) },
                      { key: "note", label: t("Note"), render: (r) => (r.comparable ? "" : r.reason ?? t("Not comparable")) },
                    ]}
                  />
                ) : <EmptyState heading={t("No tables compared yet")} body={t("Run a comparison to see each table.")} />}
              </div>
            ) : null}
            {tab === "config" ? (
              <div id="mx-pair-panel-config" role="tabpanel">
                {cmp?.config?.available && cmp.config.objects?.length ? (
                  <DataTable
                    label={t("Configuration objects")}
                    rows={cmp.config.objects}
                    rowKey={(r) => r.object}
                    columns={[
                      { key: "object", label: t("Object"), render: (r) => <code className="mx-code">{r.object}</code> },
                      { key: "in_source", label: t("In source"), align: "end", render: (r) => String(r.in_source) },
                      { key: "in_target", label: t("In target"), align: "end", render: (r) => String(r.in_target) },
                      { key: "missing", label: t("Missing in target"), align: "end", render: (r) => String(r.missing) },
                      { key: "only", label: t("Only in target"), align: "end", render: (r) => String(r.only_in_target) },
                    ]}
                  />
                ) : <EmptyState heading={t("No configuration comparison")} body={cmp?.config?.reason} />}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </Gate>
  );
}
