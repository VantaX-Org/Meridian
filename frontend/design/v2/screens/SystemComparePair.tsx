"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import {
  exportComparison, getDifferences, getLatest, getRecordPair, getTrend, patchPair, runPair,
  type CompareKind, type Comparison, type ComparePair, type DiffQuery, type DiffRow, type KeyMap, type TableCompare,
} from "@/lib/api/v2/compare";
import type { ReconScores } from "@/lib/api/v2/migration";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { keyParts, shortfall, SIDES, trendSeries, type ScoreSide } from "@/lib/v2/compare";
import { t } from "@/lib/v2/i18n";
import { pairQuality } from "@/lib/v2/paired-quality";
import { f1, int } from "@/lib/v2/score";
import { ChartFrame, ChartTable, MULTI_H, SmallMultiples, scoreDomain } from "../charts";
import { Coded, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { STATUS_TEXT } from "./SystemCompare";
import { retry, status, Table } from "./WorkAnalytics";

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

/** One source and target pair: scores and why they differ, trend, record reconciliation, differences and config. */
export function SystemComparePair({ id, onBack }: { id: string; onBack: () => void }) {
  const fixture = useFixture();
  const q = useQuery({
    queryKey: ["system-compare", "latest", id, fixture],
    queryFn: () => getLatest(id),
    staleTime: 60_000,
    retry,
    refetchInterval: (query) => (busy(query.state.data?.comparison) ? 3_000 : false),
  });
  const toast = useToast();
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => runPair(id),
    onSuccess: () => { toast.show(t("Comparison started")); void qc.invalidateQueries({ queryKey: ["system-compare"] }); },
    onError: (e) => toast.show(errorSentence(e, t("The comparison could not start.")), "error"),
  });
  const back = <button type="button" className="m2-btn m2-sm" onClick={onBack}>{t("All pairs")}</button>;
  const title = t("System comparison");

  if (q.isPending) return <CcPage title={title}><Skeleton width="100%" height={320} /></CcPage>;
  if (q.isError) {
    return (
      <CcPage title={title}>
        {back}
        {status(q.error) === 404 ? <EmptyFrame>{t("This pair no longer exists.")}</EmptyFrame> : status(q.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the system comparisons.")}</EmptyFrame>
        ) : <ErrorFrame onRetry={() => void q.refetch()}>{t("The comparison could not be read.")}</ErrorFrame>}
      </CcPage>
    );
  }
  const { pair, comparison: c } = q.data;
  const s = c?.scores;
  const gap = shortfall(s?.projected ?? null, s?.actual ?? null);
  const compareBtn = <button type="button" className="m2-btn m2-next" disabled={run.isPending || busy(c)} onClick={() => run.mutate()}>{t("Compare now")}</button>;
  return (
    <CcPage title={title}>
      {back}
      <CcBanner
        eyebrow={t("{s} to {g}", { s: pair.source.name, g: pair.target.name })}
        headline={formatModuleName(pair.module)}
        why={c ? `${STATUS_TEXT[c.status]?.() ?? c.status}, ${formatDate(c.completed_at ?? c.created_at, "date")}` : t("Not compared yet")}
        figs={[
          { label: SIDE.source(), value: f1(s?.source ?? null) },
          { label: SIDE.projected(), value: f1(s?.projected ?? null), note: why(s?.projected_reason) || undefined },
          { label: SIDE.actual(), value: f1(s?.actual ?? null), note: s?.actual_reason ? why(s.actual_reason) : gap != null ? t("{n} points short of the projection", { n: f1(gap) }) : undefined },
        ]}
        action={compareBtn}
        testId="cmp-banner"
        label={t("Scores of this pair")}
      />
      {!c ? <EmptyFrame>{t("This pair has not been compared yet. Compare now to reconcile the records.")}</EmptyFrame> : (
        <>
          {busy(c) && c.progress ? (
            <p className="m2-meta" role="status" data-testid="cmp-progress">
              {t("Comparing {done} of {total} tables", { done: c.progress.done, total: c.progress.total })}{c.progress.table ? <> <Mono>{c.progress.table}</Mono></> : null}
            </p>
          ) : null}
          {c.status === "failed" ? <ErrorFrame>{c.error ?? t("The comparison failed.")}</ErrorFrame> : null}
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
    </CcPage>
  );
}

function Reasons({ scores }: { scores: Comparison["scores"] }) {
  const row = scores ? pairQuality([scores as ReconScores], 10)[0] : undefined;
  return (
    <Panel title={t("Why the scores differ")} meta={t("The rules whose pass rate moved most between source and target")} testId="cmp-reasons">
      {!row || row.reasons.length === 0 ? <EmptyFrame>{t("No rule moved between the source and the target, or the target has not been analysed.")}</EmptyFrame> : (
        <Table title={t("Why the scores differ")} head={[t("Rule"), t("Severity"), t("Source pass rate"), t("Target pass rate"), t("Change")]}>
          {row.reasons.map((r) => (
            <tr key={r.check_id}>
              <th scope="row" className="m2-card-lead"><V2Link href={`/r/${r.check_id}`}><Coded code={r.check_id} text={r.description} /></V2Link></th>
              <td data-label={t("Severity")}>{labelOf(r.severity)}</td>
              <td data-label={t("Source pass rate")} className="m2-num">{f1(r.source_pass_rate ?? null)}</td>
              <td data-label={t("Target pass rate")} className="m2-num">{f1(r.target_pass_rate ?? null)}</td>
              <td data-label={t("Change")} className="m2-num">{signed(r.change)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

function Trend({ id }: { id: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["system-compare", "trend", id, fixture], queryFn: () => getTrend(id), staleTime: 60_000, retry });
  const points = useMemo(() => [...(q.data?.points ?? [])].sort((a, b) => a.at.localeCompare(b.at)), [q.data]);
  const series = trendSeries(points);
  const domain = scoreDomain(SIDES.flatMap((k) => series[k].filter((v): v is number => v != null)), [85], 20);
  const last = (vs: (number | null)[]) => [...vs].reverse().find((v) => v != null) ?? null;
  return (
    <section className="m2-sec" aria-label={t("Scores over time")}>
      <ChartFrame
        title={t("Scores over time")}
        sub={t("Source, projected and actual target score per comparison")}
        state={q.isPending ? "loading" : q.isError ? "error" : points.length < 2 ? "empty" : "ready"}
        empty={t("Two comparisons are needed to draw a trend.")}
        onRetry={() => void q.refetch()}
        height={MULTI_H * 2 + 48}
        testId="cmp-trend"
        table={
          <ChartTable
            caption={t("Scores by comparison")}
            head={[t("Score"), ...points.map((p) => formatDate(p.at, "date"))]}
            rows={SIDES.map((k) => [SIDE[k](), ...series[k].map((v) => f1(v))])}
          />
        }
      >
        <SmallMultiples
          items={SIDES.map((k) => ({ id: k, title: SIDE[k](), values: series[k], last: f1(last(series[k])), label: t("{label}: {last} at the newest comparison", { label: SIDE[k](), last: f1(last(series[k])) }) }))}
          domain={domain}
          reference={{ value: 85, label: t("85 cap") }}
        />
      </ChartFrame>
    </section>
  );
}

function Tables({ c }: { c: Comparison }) {
  const sm = c.summary;
  return (
    <Panel title={t("Record reconciliation")} meta={sm ? t("{m} of {s} source records matched in the target", { m: int(sm.matched), s: int(sm.in_source) }) : undefined} testId="cmp-tables">
      <Table title={t("Record reconciliation")} head={[t("Table"), t("Key"), t("In source"), t("In target"), t("Matched"), t("Missing in target"), t("Extra in target"), t("Fields")]}>
        {c.tables.map((tb) => (
          <tr key={tb.table}>
            <th scope="row" className="m2-card-lead"><Coded code={tb.table} text={tb.description} /></th>
            <td data-label={t("Key")}>
              <Mono>{tb.target_keys.join(", ")}</Mono>
              {tb.source_keys.join() !== tb.target_keys.join() ? <span className="m2-meta"> {t("from source {k}", { k: tb.source_keys.join(", ") })}</span> : null}
              {tb.key_mapped ? <span className="m2-meta"> {t("{n} keys mapped old to new", { n: int(tb.key_mapped) })}</span> : null}
            </td>
            <td data-label={t("In source")} className="m2-num">{int(tb.in_source)}</td>
            <td data-label={t("In target")} className="m2-num">{int(tb.in_target)}</td>
            {tb.comparable ? (
              <>
                <td data-label={t("Matched")} className="m2-num">{int(tb.matched)}</td>
                <td data-label={t("Missing in target")} className="m2-num">{int(tb.missing_in_target)}</td>
                <td data-label={t("Extra in target")} className="m2-num">{int(tb.extra_in_target)}</td>
                <td data-label={t("Fields")}><FieldList tb={tb} /></td>
              </>
            ) : (
              <td colSpan={4} data-label={t("Not compared")}>
                {why(tb.reason)}{tb.absent_keys?.length ? <> <Mono>{tb.absent_keys.join(", ")}</Mono></> : null}
              </td>
            )}
          </tr>
        ))}
      </Table>
    </Panel>
  );
}

function FieldList({ tb }: { tb: TableCompare }) {
  const moved = tb.fields.filter((f) => f.differing || Object.values(f.transformed).some(Boolean));
  return (
    <>
      <span className="m2-meta">{t("{n} fields compared", { n: tb.fields.length })}</span>
      {moved.length ? (
        <ul className="m2-pq-why">
          {moved.map((f) => (
            <li key={f.field}>
              <Coded code={f.field} text={f.description} />{" "}
              {f.differing ? t("{n} different", { n: int(f.differing) }) : null}
              {Object.entries(f.transformed).filter(([, n]) => n).map(([k, n]) => ` ${t("{n} equal after {how}", { n: int(n), how: TRANSFORM[k]?.() ?? k })}`)}
              {f.withheld ? ` ${t("(personal, values withheld)")}` : null}
            </li>
          ))}
        </ul>
      ) : null}
      {tb.capped ? <p className="m2-meta">{t("Only the first 100 records per kind are kept for review; the counts cover all records.")}</p> : null}
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
  const fields = (tables.find((x) => x.table === f.table)?.fields ?? []);
  const download = async (fmt: "xlsx" | "csv") => {
    try { await exportComparison(c.id, fmt, f); } catch (e) { toast.show(errorSentence(e, t("The export could not be made.")), "error"); }
  };
  return (
    <Panel title={t("Differences")} meta={q.data ? t("{n} records", { n: int(q.data.total) }) : undefined} testId="cmp-diff">
      <form className="m2-rfilters" aria-label={t("Filter the differences")} onSubmit={(e) => e.preventDefault()}>
        <label>{t("Table")}
          <select className="m2-sel" value={f.table ?? ""} onChange={(e) => set({ table: e.target.value || undefined, field: undefined })}>
            <option value="">{t("Any table")}</option>
            {tables.map((x) => <option key={x.table} value={x.table}>{x.table} {x.description}</option>)}
          </select>
        </label>
        <label>{t("Kind")}
          <select className="m2-sel" value={f.kind ?? ""} onChange={(e) => set({ kind: (e.target.value || undefined) as CompareKind | undefined })}>
            <option value="">{t("Any kind")}</option>
            {(Object.keys(KIND) as CompareKind[]).map((k) => <option key={k} value={k}>{KIND[k]()}</option>)}
          </select>
        </label>
        <label>{t("Field")}
          <select className="m2-sel" value={f.field ?? ""} disabled={!f.table} onChange={(e) => set({ field: e.target.value || undefined })}>
            <option value="">{t("Any field")}</option>
            {fields.map((x) => <option key={x.field} value={x.field}>{x.field} {x.description}</option>)}
          </select>
        </label>
        <label>{t("Search")}
          <input className="m2-sel" type="search" value={f.q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} />
        </label>
        <button type="button" className="m2-btn m2-sm" onClick={() => void download("xlsx")}>{t("Export to Excel")}</button>
        <button type="button" className="m2-btn m2-sm" onClick={() => void download("csv")}>{t("Export to CSV")}</button>
      </form>
      {q.isPending ? <Skeleton width="100%" height={160} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The differences could not be read.")}</ErrorFrame> : q.data.rows.length === 0 ? (
        <EmptyFrame>{t("No differences match these filters.")}</EmptyFrame>
      ) : (
        <>
          <Table title={t("Differences")} head={[t("Table"), t("Record"), t("Kind"), t("Field"), t("Source value"), t("Target value")]}>
            {q.data.rows.map((r, i) => (
              <tr key={`${r.table}-${r.key}-${r.field ?? ""}-${i}`}>
                <th scope="row" className="m2-card-lead"><Coded code={r.table} text={r.table_text} /></th>
                <td data-label={t("Record")}>
                  <button type="button" className="m2-btn m2-sm" aria-label={t("Show the record pair {k}", { k: r.key })} onClick={() => setOpen(r)}>
                    <Mono>{keyParts(r.key).map((p) => p.value).join(" / ")}</Mono>
                  </button>
                </td>
                <td data-label={t("Kind")}>{KIND[r.kind]()}</td>
                <td data-label={t("Field")}>{r.field ? <Coded code={r.field} text={r.field_text} /> : null}</td>
                <td data-label={t("Source value")}><Mono>{r.source ?? ""}</Mono></td>
                <td data-label={t("Target value")}><Mono>{r.target ?? ""}</Mono></td>
              </tr>
            ))}
          </Table>
          <p className="m2-meta">
            {t("{from} to {to} of {n}", { from: int(offset + 1), to: int(Math.min(offset + LIMIT, q.data.total)), n: int(q.data.total) })}{" "}
            <button type="button" className="m2-btn m2-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>{t("Previous")}</button>{" "}
            <button type="button" className="m2-btn m2-sm" disabled={offset + LIMIT >= q.data.total} onClick={() => setOffset(offset + LIMIT)}>{t("Next")}</button>
          </p>
        </>
      )}
      {open ? <RecordPairView cid={c.id} row={open} onClose={() => setOpen(null)} /> : null}
    </Panel>
  );
}

function RecordPairView({ cid, row, onClose }: { cid: string; row: DiffRow; onClose: () => void }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["system-compare", "pair", cid, row.table, row.key, fixture], queryFn: () => getRecordPair(cid, row.table, row.key), staleTime: 60_000, retry });
  return (
    <section className="m2-sec" aria-label={t("Record pair")} data-testid="cmp-record">
      <p className="m2-meta">
        <Coded code={row.table} text={row.table_text} />{" "}
        {keyParts(row.key).map((p) => <span key={p.field}><Mono>{p.field}</Mono> <Mono>{p.value}</Mono> </span>)}
        <button type="button" className="m2-btn m2-sm" onClick={onClose}>{t("Close")}</button>
      </p>
      {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? (
        status(q.error) === 404 ? <EmptyFrame>{t("This record pair was not kept for review.")}</EmptyFrame> : <ErrorFrame onRetry={() => void q.refetch()}>{t("The record pair could not be read.")}</ErrorFrame>
      ) : (
        <Table title={t("Record pair")} head={[t("Field"), t("Source value"), t("Target value"), t("Verdict")]}>
          {q.data.fields.map((x) => (
            <tr key={x.field}>
              <th scope="row" className="m2-card-lead"><Coded code={x.field} text={x.description} /></th>
              <td data-label={t("Source value")}><Mono>{x.source ?? ""}</Mono></td>
              <td data-label={t("Target value")}><Mono>{x.target ?? ""}</Mono></td>
              <td data-label={t("Verdict")}>{VERDICT[x.verdict]?.() ?? TRANSFORM[x.verdict]?.() ?? x.verdict}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}

function Config({ c }: { c: Comparison }) {
  const cfg = c.config;
  return (
    <Panel title={t("Configuration")} meta={t("Organisational units, value lists and check tables of the source, found in the target")} testId="cmp-config">
      {!cfg || !cfg.available ? <EmptyFrame>{why(cfg?.reason) || t("The configuration was not compared.")}</EmptyFrame> : (
        <>
          <Table title={t("Configuration")} head={[t("Object"), t("In source"), t("In target"), t("Same key"), t("Key after normalising"), t("By description"), t("Missing in target"), t("Only in target")]}>
            {(cfg.objects ?? []).map((o) => (
              <tr key={o.object}>
                <th scope="row" className="m2-card-lead"><Mono>{o.object}</Mono></th>
                <td data-label={t("In source")} className="m2-num">{int(o.in_source)}</td>
                <td data-label={t("In target")} className="m2-num">{int(o.in_target)}</td>
                <td data-label={t("Same key")} className="m2-num">{int(o.exists)}</td>
                <td data-label={t("Key after normalising")} className="m2-num">{int(o.key_match)}</td>
                <td data-label={t("By description")} className="m2-num">{int(o.desc_match)}</td>
                <td data-label={t("Missing in target")} className="m2-num">{int(o.missing)}</td>
                <td data-label={t("Only in target")} className="m2-num">{int(o.only_in_target)}</td>
              </tr>
            ))}
          </Table>
          {cfg.only_in_source?.length ? <p className="m2-meta">{t("Read only in the source:")} <Mono>{cfg.only_in_source.join(", ")}</Mono></p> : null}
          {cfg.only_in_target?.length ? <p className="m2-meta">{t("Read only in the target:")} <Mono>{cfg.only_in_target.join(", ")}</Mono></p> : null}
        </>
      )}
    </Panel>
  );
}

const split = (s: string) => s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);

function KeyMapEditor({ pair, tables }: { pair: ComparePair; tables: TableCompare[] }) {
  const toast = useToast();
  const qc = useQueryClient();
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
    onSuccess: () => { toast.show(t("Key fields saved. Compare again to use them.")); void qc.invalidateQueries({ queryKey: ["system-compare"] }); },
    onError: (e) => toast.show(errorSentence(e, t("The key fields could not be saved.")), "error"),
  });
  if (!tables.length) return null;
  return (
    <Panel title={t("Key fields")} meta={t("Leave empty to match on the dictionary key. Set the target field that holds the old number, for example BISMT, when the target numbers records anew.")} testId="cmp-keys">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Table title={t("Key fields")} head={[t("Table"), t("Dictionary key"), t("Source key fields"), t("Target key fields")]}>
          {tables.map((x) => (
            <tr key={x.table}>
              <th scope="row" className="m2-card-lead"><Coded code={x.table} text={x.description} /></th>
              <td data-label={t("Dictionary key")}><Mono>{x.target_keys.join(", ")}</Mono></td>
              {(["source", "target"] as const).map((side) => (
                <td key={side} data-label={side === "source" ? t("Source key fields") : t("Target key fields")}>
                  <input
                    className="m2-sel"
                    aria-label={t("{side} key fields of {table}", { side: side === "source" ? t("Source") : t("Target"), table: x.table })}
                    value={draft[x.table]?.[side] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [x.table]: { ...(d[x.table] ?? { source: "", target: "" }), [side]: e.target.value } }))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </Table>
        <button type="submit" className="m2-btn m2-next" disabled={save.isPending}>{t("Save the key fields")}</button>
      </form>
    </Panel>
  );
}
