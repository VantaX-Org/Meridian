"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { CompareRecordsCheck, RecordChange } from "@/lib/api/v2/run-ops";
import { useOpenItem } from "@/lib/v2/hooks";
import { useCompareRecordKeys, useCompareRecords, useVersionChanges } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { Coded, Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { failureText } from "@/lib/v2/errors";
import { t as tr } from "@/lib/v2/i18n";
import { TableExport } from "@/design/v2/TableExport";

const PAGE = 100;
const CHANGES: RecordChange[] = ["new", "resolved", "persisting"];
const CHANGE_WORD = { get new() { return tr("Newly failing"); }, get resolved() { return tr("Fixed"); }, get persisting() { return tr("Still failing"); } } as Record<RecordChange, string>;

/** The record keys of one change for one check, searchable and paged. */
function RecordList({ a, b, row, onClose }: { a: string; b: string; row: CompareRecordsCheck; onClose: () => void }) {
  const [change, setChange] = useState<RecordChange>(row.new > 0 ? "new" : row.resolved > 0 ? "resolved" : "persisting");
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search.trim());
  const q = useCompareRecordKeys(row.check_id, { v1: a, v2: b, change, search: deferred, limit: PAGE, offset });
  const keys = q.data?.record_keys ?? [];
  const total = row[change];
  return (
    <div className="m2-frame" data-testid="compare-record-list">
      <div className="m2-sechead">
        <h3 className="m2-strong">{tr("Records of {check_id}", { check_id: row.check_id })}</h3>
        <button type="button" className="m2-btn" onClick={onClose}>{tr("Close")}</button>
      </div>
      <div className="m2-cta" role="group" aria-label={tr("Kind of change")}>
        {CHANGES.map((c) => (
          <button key={c} type="button" className="m2-btn" aria-pressed={change === c} onClick={() => { setChange(c); setOffset(0); }}>
            {CHANGE_WORD[c]} {int(row[c])}
          </button>
        ))}
        <input type="search" value={search} aria-label={tr("Search record keys")} placeholder={tr("Search record keys")} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
      </div>
      {q.isLoading ? (
        <Skeleton width="100%" height={96} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{failureText(q.error)}</ErrorFrame>
      ) : keys.length === 0 ? (
        <EmptyFrame>{deferred ? tr("No record key matches the search.") : tr("No records in this group.")}</EmptyFrame>
      ) : (
        <>
          <ul data-testid="compare-record-keys">
            {keys.map((k) => (
              <li key={k}><Mono>{k}</Mono></li>
            ))}
          </ul>
          <div className="m2-cta">
            <button type="button" className="m2-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{tr("Previous")}</button>
            <span className="m2-sub">{deferred ? tr("{from} to {to}", { from: int(offset + 1), to: int(offset + keys.length) }) : tr("{from} to {to} of {total}", { from: int(offset + 1), to: int(offset + keys.length), total: int(total) })}</span>
            <button type="button" className="m2-btn" disabled={keys.length < PAGE} onClick={() => setOffset(offset + PAGE)}>{tr("Next")}</button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Per rule, how many records started failing, were fixed, or still fail between two runs, from the record keys of each
 * run. A rule that was skipped or cut short in either run is shown as not comparable, never as a conclusion.
 */
export function CompareRecords({ a, b, labelOf }: { a: string; b: string; labelOf: (m: string) => string }) {
  const q = useCompareRecords(b, a);
  const changes = useVersionChanges(a, b);
  const { hrefFor } = useOpenItem();
  const [open, setOpen] = useState<string | null>(null);
  const messages = useMemo(() => {
    const m = new Map<string, string>();
    for (const list of Object.values(changes.data?.checks ?? {})) for (const c of list) if (c.message) m.set(c.check_id, c.message);
    return m;
  }, [changes.data]);
  const row = q.data?.checks.find((c) => c.check_id === open) ?? null;
  const t = q.data?.totals;
  return (
    <section className="m2-sec" aria-label={tr("Records that changed")} data-testid="compare-records">
      <div className="m2-sechead">
        <h2 className="m2-h2">{tr("Records that changed")}</h2>
        <span className="m2-sub">{tr("Per rule: records newly failing, fixed and still failing")}</span>
      </div>
      {q.isLoading ? (
        <Skeleton width="100%" height={160} />
      ) : q.isError || !q.data ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{failureText(q.error)}</ErrorFrame>
      ) : q.data.checks.length === 0 ? (
        <EmptyFrame>{tr("No rule has a failing record in either run.")}</EmptyFrame>
      ) : (
        <>
          <p className="m2-prov" data-testid="compare-records-totals">
            {tr("Across the rules that can be compared: {new} newly failing, {resolved} fixed, {persisting} still failing.", { new: int(t?.new), resolved: int(t?.resolved), persisting: int(t?.persisting) })}
          </p>
          <div className="m2-frame">
            <TableExport><table className="m2-tbl">
              <thead>
                <tr>
                  <th scope="col">{tr("Rule")}</th>
                  <th scope="col">{tr("Object")}</th>
                  <th scope="col" className="m2-r">{tr("Newly failing")}</th>
                  <th scope="col" className="m2-r">{tr("Fixed")}</th>
                  <th scope="col" className="m2-r">{tr("Still failing")}</th>
                  <th scope="col"><span className="m2-sr">{tr("Records")}</span></th>
                </tr>
              </thead>
              <tbody>
                {q.data.checks.map((c) => (
                  <tr key={c.check_id} data-testid="compare-records-row" data-comparable={c.comparable}>
                    <th scope="row">
                      <V2Link href={hrefFor({ kind: "rule", id: c.check_id })}>
                        <Coded code={c.check_id} text={messages.get(c.check_id)} />
                      </V2Link>
                    </th>
                    <td>{labelOf(c.module)}</td>
                    {c.comparable ? (
                      <>
                        <td className="m2-r">{int(c.new)}</td>
                        <td className="m2-r">{int(c.resolved)}</td>
                        <td className="m2-r">{int(c.persisting)}</td>
                        <td>
                          <button type="button" className="m2-linkbtn" onClick={() => setOpen(c.check_id)}>{tr("See records")}</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="m2-r"><Dash why={tr("This rule was skipped or cut short in one of the runs, so its records cannot be compared")} /></td>
                        <td className="m2-r"><Dash why={tr("This rule was skipped or cut short in one of the runs, so its records cannot be compared")} /></td>
                        <td className="m2-r"><Dash why={tr("This rule was skipped or cut short in one of the runs, so its records cannot be compared")} /></td>
                        <td className="m2-sub">{tr("Not comparable")}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table></TableExport>
          </div>
          {row ? <RecordList key={row.check_id} a={a} b={b} row={row} onClose={() => setOpen(null)} /> : null}
        </>
      )}
    </section>
  );
}
