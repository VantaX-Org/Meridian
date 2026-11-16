"use client";

/**
 * System comparison, native. The pairs of a source and a target system per object, a form to pair two more, and one
 * pair's detail at ?pair=: the three scores and why they differ, the trend, the record reconciliation, the
 * differences with their record pairs, the configuration and the key fields (api/routers/compare.py).
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import {
  createPair, deletePair, exportComparison, getComparison, getDifferences, getLatest, getPairs, getRecordPair, getTrend, patchPair, runPair,
  type CompareKind, type Comparison, type ComparePair, type DiffQuery, type DiffRow, type KeyMap, type TableCompare,
} from "@/lib/api/v2/compare";
import type { ReconReason, ReconScores } from "@/lib/api/v2/migration";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { keyParts, shortfall, SIDES, trendSeries, type ScoreSide } from "@/lib/v2/compare";
import { useUrlParam } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { pairQuality } from "@/lib/v2/paired-quality";
import { f1, int } from "@/lib/v2/score";
import { Button, Code, Confirm, DataTable, EmptyState, ErrorState, PointSpark, Skeleton, useToast, type Column } from "../kit";
import { Banner, Panel } from "./parts";

const httpStatus = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = httpStatus(e); return s !== 403 && s !== 404 && n < 2; };

export const STATUS_TEXT: Record<string, () => string> = {
  queued: () => t("Queued"),
  running: () => t("Running"),
  done: () => t("Done"),
  failed: () => t("Failed"),
};
const REASON: Record<string, () => string> = {
  table_not_extracted: () => t("One of the systems has no extraction of this table."),
  source_extract_incomplete: () => t("The source extraction did not finish."),
  target_extract_incomplete: () => t("The target extraction did not finish."),
  source_extract_partial: () => t("The source extraction holds only part of the table."),
  target_extract_partial: () => t("The target extraction holds only part of the table."),
  key_not_extracted: () => t("A key field was not extracted, so records cannot be matched."),
  no_key_in_dictionary: () => t("The dictionary has no key for this table. Set the key fields below."),
  key_map_mismatch: () => t("The source and target key lists have different lengths."),
  no_migration_run: () => t("No migration analysis has finished for the source, so there is no projection."),
  no_projection_in_run: () => t("The newest migration analysis has no projection for this object."),
  no_target_analysis: () => t("The target system has no completed analysis."),
  no_target_findings_for_module: () => t("The target analysis has no findings for this object."),
  no_config_load_source: () => t("The source configuration has not been read yet."),
  no_config_load_target: () => t("The target configuration has not been read yet."),
};
const why = (code?: string | null) => (code ? REASON[code]?.() ?? code : "");
const KIND: Record<CompareKind, () => string> = {
  missing: () => t("Missing in target"),
  extra: () => t("Extra in target"),
  differing: () => t("Different value"),
};
const TRANSFORM: Record<string, () => string> = {
  leading_zeros: () => t("Leading zeros"),
  case: () => t("Case or spacing"),
  code_map: () => t("Value mapping"),
  date_format: () => t("Date format"),
  numeric_format: () => t("Number format"),
};
const VERDICT: Record<string, () => string> = {
  equal: () => t("Equal"),
  differing: () => t("Different"),
  missing: () => t("Missing in target"),
  extra: () => t("Extra in target"),
};
const SIDE: Record<ScoreSide, () => string> = {
  source: () => t("Source score"),
  projected: () => t("Projected"),
  actual: () => t("Actual in target"),
};
const signed = (n: number) => `${n > 0 ? "+" : ""}${f1(n)}`;
const busy = (c: Comparison | null | undefined) => c?.status === "queued" || c?.status === "running";
const statusText = (s: string) => STATUS_TEXT[s]?.() ?? s;
const mono = (s: string) => <code className="nx-code">{s}</code>;

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["system-compare"] });
}

/** The comparison tab: the pair list and the pair form, or one pair when ?pair= is set. */
export function Compare() {
  const [pair, setPair] = useUrlParam("pair", "");
  return pair ? <PairDetail id={pair} onBack={() => setPair("")} /> : <Overview />;
}

function Overview() {
  const fixture = useFixture();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [removing, setRemoving] = useState<ComparePair | null>(null);
  const q = useQuery({ queryKey: ["system-compare", "pairs", fixture], queryFn: getPairs, staleTime: 60_000, retry });
  const run = useMutation({
    mutationFn: (id: string) => runPair(id),
    onSuccess: () => { toast({ text: t("Comparison started"), tone: "good" }); invalidate(); },
    onError: (e) => toast({ text: errorSentence(e, t("The comparison could not start.")), tone: "bad" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deletePair(id),
    onSuccess: () => { toast({ text: t("Pair removed"), tone: "good" }); setRemoving(null); invalidate(); },
    onError: (e) => toast({ text: errorSentence(e, t("The pair could not be removed.")), tone: "bad" }),
  });
  const title = t("System comparison");

  if (q.isPending) return <Skeleton lines={6} label={title} />;
  if (q.isError) {
    return httpStatus(q.error) === 403
      ? <EmptyState heading={title}>{t("Your role cannot read the system comparisons.")}</EmptyState>
      : <ErrorState sentence={t("The system comparisons could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  }
  const d = q.data;
  const cols: Column<ComparePair>[] = [
    { id: "object", label: t("Object"), cell: (p) => <Link className="nx-link" href={`/load/compare?pair=${encodeURIComponent(p.id)}`}>{formatModuleName(p.module)}</Link> },
    { id: "source", label: t("Source"), cell: (p) => p.source.name },
    { id: "target", label: t("Target"), cell: (p) => p.target.name },
    { id: "s", label: SIDE.source(), align: "end", cell: (p) => f1(p.last?.scores?.source ?? null) },
    { id: "p", label: SIDE.projected(), align: "end", cell: (p) => f1(p.last?.scores?.projected ?? null) },
    { id: "a", label: SIDE.actual(), align: "end", cell: (p) => f1(p.last?.scores?.actual ?? null) },
    { id: "last", label: t("Last comparison"), cell: (p) => (p.last ? `${statusText(p.last.status)}, ${formatDate(p.last.at, "date")}` : t("Not compared yet")) },
    {
      id: "act", label: t("Actions"), cell: (p) => (
        <span className="nx-ld-actions">
          <Button variant="secondary" disabled={run.isPending} onClick={() => run.mutate(p.id)}>{t("Compare now")}</Button>
          <Button variant="secondary" onClick={() => setRemoving(p)}>{t("Remove")}</Button>
        </span>
      ),
    },
  ];
  return (
    <div className="nx-ld-step" data-testid="nx-load-compare">
      <header>
        <h2>{title}</h2>
        <p className="nx-ld-lede">{t("Pair a source and a target system per object. Each comparison reconciles the records, compares the configuration and explains why the target score differs from the source.")}</p>
      </header>
      <Panel title={t("Pairs")} meta={t("{n} pairs", { n: d.pairs.length })} testId="cmp-pairs">
        <DataTable rows={d.pairs} columns={cols} rowKey={(p) => p.id} rowLabel={(p) => formatModuleName(p.module)} caption={t("Pairs")}
          empty={{ heading: t("No systems are paired yet. Pair a source and a target below.") }} />
      </Panel>
      <PairForm data={d} />
      <Confirm
        open={removing != null}
        title={removing ? t("Remove the pair {s} to {g}", { s: removing.source.name, g: removing.target.name }) : ""}
        consequence={t("The pair and all its comparisons are removed. The systems and their extractions stay.")}
        confirmLabel={t("Remove the pair")}
        danger
        onConfirm={() => removing && remove.mutate(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function PairForm({ data }: { data: Awaited<ReturnType<typeof getPairs>> }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [module, setModule] = useState(data.modules[0] ?? "");
  const [src, setSrc] = useState("");
  const [tgt, setTgt] = useState("");
  const ok = Boolean(module && src && tgt && src !== tgt);
  const add = useMutation({
    mutationFn: () => createPair({ module, source_system_id: src, target_system_id: tgt }),
    onSuccess: () => { toast({ text: t("Pair added"), tone: "good" }); setSrc(""); setTgt(""); invalidate(); },
    onError: (e) => toast({ text: errorSentence(e, t("The pair could not be added.")), tone: "bad" }),
  });
  const systems = (
    <>
      <option value="">{t("Choose a system")}</option>
      {data.systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </>
  );
  return (
    <Panel title={t("Pair two systems")} testId="cmp-new">
      {data.suggestions.length ? (
        <p className="nx-ld-list-row">
          <span className="nx-ld-meta">{t("Suggested pairs:")}</span>
          {data.suggestions.map((s) => (
            <Button key={`${s.source.id}-${s.target.id}`} variant="secondary" onClick={() => { setSrc(s.source.id); setTgt(s.target.id); }}>
              {t("{s} to {g}", { s: s.source.name, g: s.target.name })}
            </Button>
          ))}
        </p>
      ) : null}
      <form className="nx-ld-filters" onSubmit={(e) => { e.preventDefault(); if (ok) add.mutate(); }}>
        <label>{t("Object")}
          <select className="nx-input" value={module} onChange={(e) => setModule(e.target.value)}>
            {data.modules.map((m) => <option key={m} value={m}>{formatModuleName(m)}</option>)}
          </select>
        </label>
        <label>{t("Source system")}
          <select className="nx-input" value={src} onChange={(e) => setSrc(e.target.value)}>{systems}</select>
        </label>
        <label>{t("Target system")}
          <select className="nx-input" value={tgt} onChange={(e) => setTgt(e.target.value)}>{systems}</select>
        </label>
        <Button type="submit" disabled={!ok || add.isPending}>{t("Add the pair")}</Button>
      </form>
      {src && src === tgt ? <p role="alert" className="nx-ld-meta">{t("The source and the target must be different systems.")}</p> : null}
    </Panel>
  );
}

/** One source and target pair: scores and why they differ, trend, record reconciliation, differences and config. */
function PairDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const fixture = useFixture();
  const toast = useToast();
  const invalidate = useInvalidate();
  const q = useQuery({
    queryKey: ["system-compare", "latest", id, fixture],
    queryFn: () => getLatest(id),
    staleTime: 60_000,
    retry,
    refetchInterval: (query) => (busy(query.state.data?.comparison) ? 3_000 : false),
  });
  const run = useMutation({
    mutationFn: () => runPair(id),
    onSuccess: () => { toast({ text: t("Comparison started"), tone: "good" }); invalidate(); },
    onError: (e) => toast({ text: errorSentence(e, t("The comparison could not start.")), tone: "bad" }),
  });
  const back = <p><Button variant="secondary" onClick={onBack}>{t("All pairs")}</Button></p>;
  const title = t("System comparison");

  if (q.isPending) return <Skeleton lines={8} label={title} />;
  if (q.isError) {
    const s = httpStatus(q.error);
    return (
      <div className="nx-ld-step" data-testid="nx-load-compare-pair">
        {back}
        {s === 404 ? <EmptyState heading={title}>{t("This pair no longer exists.")}</EmptyState> : s === 403 ? (
          <EmptyState heading={title}>{t("Your role cannot read the system comparisons.")}</EmptyState>
        ) : <ErrorState sentence={t("The comparison could not be read.")} error={q.error} onRetry={() => void q.refetch()} />}
      </div>
    );
  }
  const { pair, comparison: c } = q.data;
  const s = c?.scores;
  const gap = shortfall(s?.projected ?? null, s?.actual ?? null);
  return (
    <div className="nx-ld-step" data-testid="nx-load-compare-pair">
      {back}
      <Banner
        testId="cmp-banner"
        eyebrow={t("{s} to {g}", { s: pair.source.name, g: pair.target.name })}
        headline={formatModuleName(pair.module)}
        why={c ? `${statusText(c.status)}, ${formatDate(c.completed_at ?? c.created_at, "date")}` : t("Not compared yet")}
        figs={[
          { label: SIDE.source(), value: f1(s?.source ?? null) },
          { label: SIDE.projected(), value: f1(s?.projected ?? null), note: why(s?.projected_reason) || undefined },
          { label: SIDE.actual(), value: f1(s?.actual ?? null), note: s?.actual_reason ? why(s.actual_reason) : gap != null ? t("{n} points short of the projection", { n: f1(gap) }) : undefined },
        ]}
        action={<Button disabled={run.isPending || busy(c)} onClick={() => run.mutate()}>{t("Compare now")}</Button>}
      />
      {!c ? <p className="nx-ld-meta">{t("This pair has not been compared yet. Compare now to reconcile the records.")}</p> : (
        <>
          {busy(c) && c.progress ? (
            <p className="nx-ld-meta" role="status" data-testid="cmp-progress">
              {t("Comparing {done} of {total} tables", { done: c.progress.done, total: c.progress.total })}{c.progress.table ? <> {mono(c.progress.table)}</> : null}
            </p>
          ) : null}
          {c.status === "failed" ? <p role="alert" className="nx-ld-note">{c.error ?? t("The comparison failed.")}</p> : null}
          <Reasons scores={s ?? null} />
          <Trend id={id} />
          {c.status === "done" ? (
            <>
              <Tables c={c} />
              <Differences c={c} />
              <Config c={c} />
            </>
          ) : null}
          <KeyMapEditor pair={pair} tables={c.tables} />
        </>
      )}
    </div>
  );
}

function Reasons({ scores }: { scores: Comparison["scores"] }) {
  const row = scores ? pairQuality([scores as ReconScores], 10)[0] : undefined;
  const cols: Column<ReconReason>[] = [
    { id: "rule", label: t("Rule"), cell: (r) => <Link className="nx-link" href={`/r/${encodeURIComponent(r.check_id)}`}><Code code={r.check_id} text={r.description} /></Link> },
    { id: "sev", label: t("Severity"), cell: (r) => labelOf(r.severity) },
    { id: "src", label: t("Source pass rate"), align: "end", cell: (r) => f1(r.source_pass_rate ?? null) },
    { id: "tgt", label: t("Target pass rate"), align: "end", cell: (r) => f1(r.target_pass_rate ?? null) },
    { id: "chg", label: t("Change"), align: "end", cell: (r) => signed(r.change), compare: (a, b) => a.change - b.change },
  ];
  return (
    <Panel title={t("Why the scores differ")} meta={t("The rules whose pass rate moved most between source and target")} testId="cmp-reasons">
      <DataTable rows={row?.reasons ?? []} columns={cols} rowKey={(r) => r.check_id} rowLabel={(r) => r.check_id} caption={t("Why the scores differ")}
        empty={{ heading: t("No rule moved between the source and the target, or the target has not been analysed.") }} />
    </Panel>
  );
}

/** One earlier comparison of the pair, read from GET /compare/comparisons/{id}. */
function SavedComparison({ cid, onClose }: { cid: string; onClose: () => void }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["system-compare", "comparison", cid, fixture], queryFn: () => getComparison(cid), retry });
  return (
    <div data-testid="cmp-saved" className="nx-ld-step">
      {q.isError ? <ErrorState sentence={t("The saved comparison could not be read.")} error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <>
          <p className="nx-ld-meta">{t("Comparison of {date}, {status}", { date: formatDate(q.data.completed_at ?? q.data.created_at, "date"), status: statusText(q.data.status) })}</p>
          <Tables c={q.data} />
        </>
      ) : null}
      <p><Button variant="secondary" onClick={onClose}>{t("Close")}</Button></p>
    </div>
  );
}

type TrendRow = { side: ScoreSide; values: (number | null)[] };

function Trend({ id }: { id: string }) {
  const fixture = useFixture();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["system-compare", "trend", id, fixture], queryFn: () => getTrend(id), staleTime: 60_000, retry });
  const points = useMemo(() => [...(q.data?.points ?? [])].sort((a, b) => a.at.localeCompare(b.at)), [q.data]);
  const series = trendSeries(points);
  const last = (vs: (number | null)[]) => [...vs].reverse().find((v) => v != null) ?? null;
  const dates = points.map((p) => formatDate(p.at, "date"));
  const cols: Column<TrendRow>[] = [
    { id: "side", label: t("Score"), cell: (r) => SIDE[r.side]() },
    ...dates.map((d, i): Column<TrendRow> => ({ id: `p${i}`, label: d, align: "end", cell: (r) => f1(r.values[i] ?? null) })),
  ];
  let body;
  if (q.isPending) body = <Skeleton lines={3} label={t("Scores over time")} />;
  else if (q.isError) body = <ErrorState sentence={t("The comparison could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  else if (points.length < 2) body = <p className="nx-ld-meta">{t("Two comparisons are needed to draw a trend.")}</p>;
  else {
    body = (
      <div className="nx-ld-sparks">
        {SIDES.map((k) => {
          const label = t("{label}: {last} at the newest comparison", { label: SIDE[k](), last: f1(last(series[k])) });
          return (
            <figure key={k}>
              <figcaption className="nx-ld-meta">{label}</figcaption>
              <PointSpark label={label} points={series[k].flatMap((v, i) => (v == null ? [] : [{ label: dates[i], value: v }]))} />
            </figure>
          );
        })}
      </div>
    );
  }
  return (
    <Panel title={t("Scores over time")} meta={t("Source, projected and actual target score per comparison")} testId="cmp-trend">
      {body}
      {points.length > 0 ? (
        <>
          <DataTable rows={SIDES.map((k) => ({ side: k, values: series[k] }))} columns={cols} rowKey={(r) => r.side} rowLabel={(r) => SIDE[r.side]()}
            caption={`${t("Scores by comparison")} (${t("85 cap")})`} />
          <ul className="nx-ld-list">
            {points.map((p) => (
              <li key={p.comparison_id} className="nx-ld-list-row">
                <span>{formatDate(p.at, "date")}</span>
                <Button variant="quiet" aria-label={t("Open the comparison of {date}", { date: formatDate(p.at, "date") })} onClick={() => setOpen(p.comparison_id)}>{t("Open")}</Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {open ? <SavedComparison cid={open} onClose={() => setOpen(null)} /> : null}
    </Panel>
  );
}

function Tables({ c }: { c: Comparison }) {
  const sm = c.summary;
  const cols: Column<TableCompare>[] = [
    { id: "table", label: t("Table"), cell: (tb) => <Code code={tb.table} text={tb.description} /> },
    {
      id: "key", label: t("Key"), cell: (tb) => (
        <>
          {mono(tb.target_keys.join(", "))}
          {tb.source_keys.join() !== tb.target_keys.join() ? <span className="nx-ld-meta"> {t("from source {k}", { k: tb.source_keys.join(", ") })}</span> : null}
          {tb.key_mapped ? <span className="nx-ld-meta"> {t("{n} keys mapped old to new", { n: int(tb.key_mapped) })}</span> : null}
        </>
      ),
    },
    { id: "src", label: t("In source"), align: "end", cell: (tb) => int(tb.in_source) },
    { id: "tgt", label: t("In target"), align: "end", cell: (tb) => int(tb.in_target) },
    { id: "match", label: t("Matched"), align: "end", cell: (tb) => (tb.comparable ? int(tb.matched) : <span className="nx-ld-meta">{t("Not compared")}</span>) },
    { id: "miss", label: t("Missing in target"), align: "end", cell: (tb) => (tb.comparable ? int(tb.missing_in_target) : "") },
    { id: "extra", label: t("Extra in target"), align: "end", cell: (tb) => (tb.comparable ? int(tb.extra_in_target) : "") },
    {
      id: "fields", label: t("Fields"), cell: (tb) => (tb.comparable ? <FieldList tb={tb} /> : (
        <span>{why(tb.reason)}{tb.absent_keys?.length ? <> {mono(tb.absent_keys.join(", "))}</> : null}</span>
      )),
    },
  ];
  return (
    <Panel title={t("Record reconciliation")} meta={sm ? t("{m} of {s} source records matched in the target", { m: int(sm.matched), s: int(sm.in_source) }) : undefined} testId="cmp-tables">
      <DataTable rows={c.tables} columns={cols} rowKey={(tb) => tb.table} rowLabel={(tb) => tb.table} caption={t("Record reconciliation")} />
    </Panel>
  );
}

function FieldList({ tb }: { tb: TableCompare }) {
  const moved = tb.fields.filter((f) => f.differing || Object.values(f.transformed).some(Boolean));
  return (
    <>
      <span className="nx-ld-meta">{t("{n} fields compared", { n: tb.fields.length })}</span>
      {moved.length ? (
        <ul className="nx-ld-list">
          {moved.map((f) => (
            <li key={f.field}>
              <Code code={f.field} text={f.description} />{" "}
              {f.differing ? t("{n} different", { n: int(f.differing) }) : null}
              {Object.entries(f.transformed).filter(([, n]) => n).map(([k, n]) => ` ${t("{n} equal after {how}", { n: int(n), how: TRANSFORM[k]?.() ?? k })}`)}
              {f.withheld ? ` ${t("(personal, values withheld)")}` : null}
            </li>
          ))}
        </ul>
      ) : null}
      {tb.capped ? <p className="nx-ld-meta">{t("Only the first 100 records per kind are kept for review; the counts cover all records.")}</p> : null}
    </>
  );
}

const LIMIT = 50;

function Differences({ c }: { c: Comparison }) {
  const fixture = useFixture();
  const toast = useToast();
  const [f, setF] = useState<DiffQuery>({});
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<DiffRow | null>(null);
  const query = { ...f, offset, limit: LIMIT };
  const q = useQuery({ queryKey: ["system-compare", "diff", c.id, query, fixture], queryFn: () => getDifferences(c.id, query), staleTime: 60_000, retry });
  const set = (patch: DiffQuery) => { setF((x) => ({ ...x, ...patch })); setOffset(0); };
  const tables = c.tables.filter((x) => x.comparable);
  const fields = tables.find((x) => x.table === f.table)?.fields ?? [];
  const download = async (fmt: "xlsx" | "csv") => {
    try { await exportComparison(c.id, fmt, f); } catch (e) { toast({ text: errorSentence(e, t("The export could not be made.")), tone: "bad" }); }
  };
  const cols: Column<DiffRow & { i: number }>[] = [
    { id: "table", label: t("Table"), cell: (r) => <Code code={r.table} text={r.table_text} /> },
    {
      id: "rec", label: t("Record"), cell: (r) => (
        <Button variant="quiet" aria-label={t("Show the record pair {k}", { k: r.key })} onClick={() => setOpen(r)}>
          {mono(keyParts(r.key).map((p) => p.value).join(" / "))}
        </Button>
      ),
    },
    { id: "kind", label: t("Kind"), cell: (r) => KIND[r.kind]() },
    { id: "field", label: t("Field"), cell: (r) => (r.field ? <Code code={r.field} text={r.field_text} /> : null) },
    { id: "src", label: t("Source value"), cell: (r) => mono(r.source ?? "") },
    { id: "tgt", label: t("Target value"), cell: (r) => mono(r.target ?? "") },
  ];
  return (
    <Panel title={t("Differences")} meta={q.data ? t("{n} records", { n: int(q.data.total) }) : undefined} testId="cmp-diff">
      <form className="nx-ld-filters" aria-label={t("Filter the differences")} onSubmit={(e) => e.preventDefault()}>
        <label>{t("Table")}
          <select className="nx-input" value={f.table ?? ""} onChange={(e) => set({ table: e.target.value || undefined, field: undefined })}>
            <option value="">{t("Any table")}</option>
            {tables.map((x) => <option key={x.table} value={x.table}>{x.table} {x.description}</option>)}
          </select>
        </label>
        <label>{t("Kind")}
          <select className="nx-input" value={f.kind ?? ""} onChange={(e) => set({ kind: (e.target.value || undefined) as CompareKind | undefined })}>
            <option value="">{t("Any kind")}</option>
            {(Object.keys(KIND) as CompareKind[]).map((k) => <option key={k} value={k}>{KIND[k]()}</option>)}
          </select>
        </label>
        <label>{t("Field")}
          <select className="nx-input" value={f.field ?? ""} disabled={!f.table} onChange={(e) => set({ field: e.target.value || undefined })}>
            <option value="">{t("Any field")}</option>
            {fields.map((x) => <option key={x.field} value={x.field}>{x.field} {x.description}</option>)}
          </select>
        </label>
        <label>{t("Search")}
          <input className="nx-input" type="search" value={f.q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} />
        </label>
        <Button variant="secondary" onClick={() => void download("xlsx")}>{t("Export to Excel")}</Button>
        <Button variant="secondary" onClick={() => void download("csv")}>{t("Export to CSV")}</Button>
      </form>
      <DataTable
        rows={(q.data?.rows ?? []).map((r, i) => ({ ...r, i }))}
        columns={cols}
        rowKey={(r) => `${r.table}-${r.key}-${r.field ?? ""}-${r.i}`}
        rowLabel={(r) => r.key}
        caption={t("Differences")}
        loading={q.isPending}
        error={q.isError ? { sentence: t("The differences could not be read."), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: t("No differences match these filters.") }}
      />
      {q.data && q.data.total > 0 ? (
        <p className="nx-ld-pager">
          <span className="nx-ld-meta">{t("{from} to {to} of {n}", { from: int(offset + 1), to: int(Math.min(offset + LIMIT, q.data.total)), n: int(q.data.total) })}</span>
          <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>{t("Previous")}</Button>
          <Button variant="secondary" disabled={offset + LIMIT >= q.data.total} onClick={() => setOffset(offset + LIMIT)}>{t("Next")}</Button>
        </p>
      ) : null}
      {open ? <RecordPairView cid={c.id} row={open} onClose={() => setOpen(null)} /> : null}
    </Panel>
  );
}

type PairField = Awaited<ReturnType<typeof getRecordPair>>["fields"][number];

function RecordPairView({ cid, row, onClose }: { cid: string; row: DiffRow; onClose: () => void }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["system-compare", "pair", cid, row.table, row.key, fixture], queryFn: () => getRecordPair(cid, row.table, row.key), staleTime: 60_000, retry });
  const cols: Column<PairField>[] = [
    { id: "field", label: t("Field"), cell: (x) => <Code code={x.field} text={x.description} /> },
    { id: "src", label: t("Source value"), cell: (x) => mono(x.source ?? "") },
    { id: "tgt", label: t("Target value"), cell: (x) => mono(x.target ?? "") },
    { id: "verdict", label: t("Verdict"), cell: (x) => VERDICT[x.verdict]?.() ?? TRANSFORM[x.verdict]?.() ?? x.verdict },
  ];
  return (
    <section className="nx-ld-step" aria-label={t("Record pair")} data-testid="cmp-record">
      <p className="nx-ld-list-row">
        <Code code={row.table} text={row.table_text} />
        {keyParts(row.key).map((p) => <span key={p.field}>{mono(p.field)} {mono(p.value)}</span>)}
        <Button variant="secondary" onClick={onClose}>{t("Close")}</Button>
      </p>
      {q.isError && httpStatus(q.error) === 404 ? <p className="nx-ld-meta">{t("This record pair was not kept for review.")}</p> : (
        <DataTable rows={q.data?.fields ?? []} columns={cols} rowKey={(x) => x.field} rowLabel={(x) => x.field} caption={t("Record pair")}
          loading={q.isPending} error={q.isError ? { sentence: t("The record pair could not be read."), onRetry: () => void q.refetch() } : undefined} />
      )}
    </section>
  );
}

type CfgObject = NonNullable<NonNullable<Comparison["config"]>["objects"]>[number];

function Config({ c }: { c: Comparison }) {
  const cfg = c.config;
  const cols: Column<CfgObject>[] = [
    { id: "obj", label: t("Object"), cell: (o) => mono(o.object) },
    { id: "src", label: t("In source"), align: "end", cell: (o) => int(o.in_source) },
    { id: "tgt", label: t("In target"), align: "end", cell: (o) => int(o.in_target) },
    { id: "same", label: t("Same key"), align: "end", cell: (o) => int(o.exists) },
    { id: "norm", label: t("Key after normalising"), align: "end", cell: (o) => int(o.key_match) },
    { id: "desc", label: t("By description"), align: "end", cell: (o) => int(o.desc_match) },
    { id: "miss", label: t("Missing in target"), align: "end", cell: (o) => int(o.missing), compare: (a, b) => a.missing - b.missing },
    { id: "only", label: t("Only in target"), align: "end", cell: (o) => int(o.only_in_target) },
  ];
  return (
    <Panel title={t("Configuration")} meta={t("Organisational units, value lists and check tables of the source, found in the target")} testId="cmp-config">
      {!cfg || !cfg.available ? <p className="nx-ld-meta">{why(cfg?.reason) || t("The configuration was not compared.")}</p> : (
        <>
          <DataTable rows={cfg.objects ?? []} columns={cols} rowKey={(o) => o.object} rowLabel={(o) => o.object} caption={t("Configuration")} />
          {cfg.only_in_source?.length ? <p className="nx-ld-meta">{t("Read only in the source:")} {mono(cfg.only_in_source.join(", "))}</p> : null}
          {cfg.only_in_target?.length ? <p className="nx-ld-meta">{t("Read only in the target:")} {mono(cfg.only_in_target.join(", "))}</p> : null}
        </>
      )}
    </Panel>
  );
}

const split = (s: string) => s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);

function KeyMapEditor({ pair, tables }: { pair: ComparePair; tables: TableCompare[] }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState<Record<string, { source: string; target: string }>>(() =>
    Object.fromEntries(tables.map((x) => [x.table, { source: (pair.key_map[x.table]?.source ?? []).join(", "), target: (pair.key_map[x.table]?.target ?? []).join(", ") }])));
  const save = useMutation({
    mutationFn: () => {
      const km: KeyMap = {};
      for (const [table, d] of Object.entries(draft)) {
        const target = split(d.target);
        if (target.length) km[table] = { source: split(d.source).length ? split(d.source) : target, target };
      }
      return patchPair(pair.id, km);
    },
    onSuccess: () => { toast({ text: t("Key fields saved. Compare again to use them."), tone: "good" }); invalidate(); },
    onError: (e) => toast({ text: errorSentence(e, t("The key fields could not be saved.")), tone: "bad" }),
  });
  if (!tables.length) return null;
  const input = (x: TableCompare, side: "source" | "target") => (
    <input
      className="nx-input"
      aria-label={t("{side} key fields of {table}", { side: side === "source" ? t("Source") : t("Target"), table: x.table })}
      value={draft[x.table]?.[side] ?? ""}
      onChange={(e) => setDraft((d) => ({ ...d, [x.table]: { ...(d[x.table] ?? { source: "", target: "" }), [side]: e.target.value } }))}
    />
  );
  const cols: Column<TableCompare>[] = [
    { id: "table", label: t("Table"), cell: (x) => <Code code={x.table} text={x.description} /> },
    { id: "dict", label: t("Dictionary key"), cell: (x) => mono(x.target_keys.join(", ")) },
    { id: "src", label: t("Source key fields"), cell: (x) => input(x, "source") },
    { id: "tgt", label: t("Target key fields"), cell: (x) => input(x, "target") },
  ];
  return (
    <Panel title={t("Key fields")} meta={t("Leave empty to match on the dictionary key. Set the target field that holds the old number, for example BISMT, when the target numbers records anew.")} testId="cmp-keys">
      <form className="nx-ld-step" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <DataTable rows={tables} columns={cols} rowKey={(x) => x.table} rowLabel={(x) => x.table} caption={t("Key fields")} />
        <p><Button type="submit" disabled={save.isPending}>{t("Save the key fields")}</Button></p>
      </form>
    </Panel>
  );
}
