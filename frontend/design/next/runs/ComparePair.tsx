"use client";

/**
 * The detail of a two-run comparison, as the v2 compare page had it: by object (GET /runs/{a}/vs/{b}/summary) with the
 * rules that changed (GET /versions/compare), and per rule the records newly failing, fixed and still failing
 * (GET /versions/compare/records and its record keys). The earlier run is always a, so "worse" keeps its meaning.
 */
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { Button, Code, EmptyState, ErrorState, SegmentedControl, Skeleton } from "../kit";
import type { CompareRecordsCheck, RecordChange } from "@/lib/api/v2/run-ops";
import type { ChangeKind, CompareObject, VersionHead } from "@/lib/api/v2/runs";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useCompareRecordKeys, useCompareRecords, useCompareSummary, useVersionChanges } from "@/lib/v2/runs-queries";
import { f1, int } from "@/lib/v2/score";
import "./runs.css";

const PAGE = 100;
const CHANGES: RecordChange[] = ["new", "resolved", "persisting"];
const changeWord = (c: RecordChange) => (c === "new" ? t("Newly failing") : c === "resolved" ? t("Fixed") : t("Still failing"));
const GROUPS: ChangeKind[] = ["newly_failing", "fixed", "worse", "better"];
const groupTitle = (k: ChangeKind) => (k === "newly_failing" ? t("Newly failing rules") : k === "fixed" ? t("Fixed rules") : k === "worse" ? t("Worse") : t("Better"));
const measured = (o: CompareObject) => (o.before?.raw_score == null || o.after?.raw_score == null ? null : o.after.raw_score - o.before.raw_score);
const pct = (x: number | null | undefined) => (x == null ? "" : `${f1(100 * x)}%`);

export function ComparePair({ runs }: { runs: readonly VersionHead[] }) {
  const [x, y] = runs;
  const [a, b] = x.run_at <= y.run_at ? [x.id, y.id] : [y.id, x.id];
  const [view, setView] = useState<"changes" | "records">("changes");
  return (
    <section aria-label={t("Views of this comparison")} data-testid="compare-pair">
      <SegmentedControl label={t("Views of this comparison")} value={view} onChange={setView}
        items={[{ value: "changes", label: t("Scores and rules") }, { value: "records", label: t("Records") }]} />
      {view === "changes" ? <Changes a={a} b={b} /> : <Records a={a} b={b} />}
    </section>
  );
}

function Changes({ a, b }: { a: string; b: string }) {
  const sum = useCompareSummary(a, b);
  const changes = useVersionChanges(a, b);
  if (sum.isLoading) return <Skeleton lines={6} label={t("Loading the runs to compare")} />;
  if (sum.isError || !sum.data) return <ErrorState error={sum.error} fallback={t("These two runs could not be compared. Both must exist and belong to the same system.")} onRetry={() => void sum.refetch()} />;
  const S = sum.data;
  return (
    <>
      <h3 className="nx-rn-h3">{t("By object")}</h3>
      <p className="nx-rn-sub">{S.method} {t("Coverage is the share of records a rule could evaluate.")}</p>
      {S.objects.length === 0 ? (
        <EmptyState icon="info" heading={t("Neither run scored an object, so there is nothing to compare.")} />
      ) : (
        <table className="nx-rn-table" data-testid="compare-table">
          <caption className="nx-rn-sr">{t("By object")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Object")}</th><th scope="col">{t("Before")}</th><th scope="col">{t("After")}</th>
              <th scope="col">{t("Change")}</th><th scope="col">{t("Shown")}</th><th scope="col">{t("Records checked")}</th>
              <th scope="col">{t("Coverage")}</th><th scope="col">{t("New")}</th><th scope="col">{t("Closed")}</th>
              <th scope="col">{t("Worse")}</th><th scope="col">{t("Better")}</th>
            </tr>
          </thead>
          <tbody>
            {S.objects.map((o) => {
              const d = measured(o);
              return (
                <tr key={o.module} data-testid="compare-row">
                  <th scope="row"><Code code={o.module} text={o.label || moduleText(o.module)} /></th>
                  <td>{o.before?.raw_score == null ? t("Not scored") : f1(o.before.raw_score)}</td>
                  <td>{o.after?.raw_score == null ? t("Not scored") : f1(o.after.raw_score)}</td>
                  <td>{d == null ? "" : `${d > 0 ? "+" : ""}${f1(d)}`}</td>
                  <td>{o.before?.score == null ? "" : f1(o.before.score)} {t("to")} {o.after?.score == null ? "" : f1(o.after.score)}</td>
                  <td>{o.before?.records_checked == null && o.after?.records_checked == null ? t("Not counted") : `${int(o.before?.records_checked)} ${t("to")} ${int(o.after?.records_checked)}`}</td>
                  <td>{pct(o.after?.coverage)}</td>
                  <td>{int(o.newly_failing)}</td><td>{int(o.fixed)}</td><td>{int(o.worse)}</td><td>{int(o.better)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <h3 className="nx-rn-h3">{t("What changed")}</h3>
      {changes.isLoading ? (
        <Skeleton lines={4} label={t("What changed")} />
      ) : changes.isError || !changes.data ? (
        <ErrorState fallback={t("The rules that changed could not be read.")} error={changes.error} onRetry={() => void changes.refetch()} />
      ) : (
        <div data-testid="what-changed">
          {GROUPS.map((k) => {
            const list = changes.data.checks[k] ?? [];
            return (
              <div key={k} data-kind={k}>
                <h4 className="nx-rn-h3">{groupTitle(k)} {int(S.totals[k])}</h4>
                {list.length === 0 ? <p className="nx-rn-sub">{t("None.")}</p> : (
                  <ul>
                    {list.map((c) => (
                      <li key={c.check_id}>
                        <Link className="nx-rn-link" href={`/more/rules?rule=${encodeURIComponent(c.check_id)}`}><Code code={c.check_id} text={c.message ?? undefined} /></Link>{" "}
                        <span className="nx-rn-sub">{t("{module}, {v1_affected} to {v2_affected} records failing", { module: moduleText(c.module), v1_affected: int(c.v1_affected), v2_affected: int(c.v2_affected) })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function Records({ a, b }: { a: string; b: string }) {
  const q = useCompareRecords(b, a);
  const changes = useVersionChanges(a, b);
  const [open, setOpen] = useState<string | null>(null);
  const messages = useMemo(() => {
    const m = new Map<string, string>();
    for (const list of Object.values(changes.data?.checks ?? {})) for (const c of list) if (c.message) m.set(c.check_id, c.message);
    return m;
  }, [changes.data]);
  if (q.isLoading) return <Skeleton lines={6} label={t("Records that changed")} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.checks.length === 0) return <EmptyState icon="info" heading={t("No rule has a failing record in either run.")} />;
  const tot = q.data.totals;
  const row = q.data.checks.find((c) => c.check_id === open) ?? null;
  const why = t("This rule was skipped or cut short in one of the runs, so its records cannot be compared");
  return (
    <div data-testid="compare-records">
      <h3 className="nx-rn-h3">{t("Records that changed")}</h3>
      <p className="nx-rn-sub" data-testid="compare-records-totals">
        {t("Across the rules that can be compared: {new} newly failing, {resolved} fixed, {persisting} still failing.", { new: int(tot.new), resolved: int(tot.resolved), persisting: int(tot.persisting) })}
      </p>
      <table className="nx-rn-table">
        <caption className="nx-rn-sr">{t("Per rule: records newly failing, fixed and still failing")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Rule")}</th><th scope="col">{t("Object")}</th><th scope="col">{t("Newly failing")}</th>
            <th scope="col">{t("Fixed")}</th><th scope="col">{t("Still failing")}</th><th scope="col"><span className="nx-rn-sr">{t("Records")}</span></th>
          </tr>
        </thead>
        <tbody>
          {q.data.checks.map((c) => (
            <tr key={c.check_id} data-testid="compare-records-row" data-comparable={c.comparable}>
              <th scope="row"><Code code={c.check_id} text={messages.get(c.check_id)} /></th>
              <td><Code code={c.module} text={moduleText(c.module)} /></td>
              {c.comparable ? (
                <>
                  <td>{int(c.new)}</td><td>{int(c.resolved)}</td><td>{int(c.persisting)}</td>
                  <td><Button variant="quiet" size={32} onClick={() => setOpen(c.check_id)}>{t("See records")}</Button></td>
                </>
              ) : (
                <><td title={why} /><td title={why} /><td title={why} /><td className="nx-rn-sub" title={why}>{t("Not comparable")}</td></>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {row ? <RecordList key={row.check_id} a={a} b={b} row={row} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function RecordList({ a, b, row, onClose }: { a: string; b: string; row: CompareRecordsCheck; onClose: () => void }) {
  const [change, setChange] = useState<RecordChange>(row.new > 0 ? "new" : row.resolved > 0 ? "resolved" : "persisting");
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search.trim());
  const q = useCompareRecordKeys(row.check_id, { v1: a, v2: b, change, search: deferred, limit: PAGE, offset });
  const keys = q.data?.record_keys ?? [];
  return (
    <div className="nx-card" data-testid="compare-record-list">
      <h3 className="nx-rn-h3">{t("Records of {check_id}", { check_id: row.check_id })}</h3>
      <div className="nx-rn-filters">
        <SegmentedControl label={t("Kind of change")} value={change} onChange={(c) => { setChange(c); setOffset(0); }}
          items={CHANGES.map((c) => ({ value: c, label: `${changeWord(c)} ${int(row[c])}` }))} />
        <input type="search" className="nx-input" value={search} aria-label={t("Search record keys")} placeholder={t("Search record keys")} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
        <Button variant="quiet" size={32} onClick={onClose}>{t("Close")}</Button>
      </div>
      {q.isLoading ? <Skeleton lines={4} label={t("Records of {check_id}", { check_id: row.check_id })} />
        : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : keys.length === 0 ? <EmptyState icon="info" heading={deferred ? t("No record key matches the search.") : t("No records in this group.")} />
        : (
          <>
            <ul data-testid="compare-record-keys">{keys.map((k) => <li key={k}><Code code={k} /></li>)}</ul>
            <p className="nx-rn-pager">
              <Button size={32} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("Previous")}</Button>
              <span className="nx-rn-sub">{deferred ? t("{from} to {to}", { from: int(offset + 1), to: int(offset + keys.length) }) : t("{from} to {to} of {total}", { from: int(offset + 1), to: int(offset + keys.length), total: int(row[change]) })}</span>
              <Button size={32} disabled={keys.length < PAGE} onClick={() => setOffset(offset + PAGE)}>{t("Next")}</Button>
            </p>
          </>
        )}
    </div>
  );
}
