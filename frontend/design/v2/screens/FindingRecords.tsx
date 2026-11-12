"use client";

import { useState } from "react";
import { useFindingRecords } from "@/lib/v2/runs-queries";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { t as tr } from "@/lib/v2/i18n";
import { Coded, Dash, EmptyFrame, ErrorFrame, Mono, SapCode, Skeleton, V2Link, Value } from "../parts";
import { TableExport } from "@/design/v2/TableExport";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";

const PAGE = 25;

/** The records that fail one rule at one run, a page at a time, with the values of the fields the rule reads. */
export function FindingRecords({ checkId, runs }: { checkId: string; runs: { id: string; label: string }[] }) {
  const asked = useRunParam();
  const { hrefFor } = useOpenItem();
  const [runId, setRunId] = useState<string | null>(runs.find((r) => r.id === asked)?.id ?? runs[0]?.id ?? null);
  const [offset, setOffset] = useState(0);
  const q = useFindingRecords(runId, checkId, { limit: PAGE, offset });
  const rows = q.data?.records ?? [];
  const total = q.data?.total ?? 0;
  const fields = [...new Set(rows.flatMap((r) => Object.keys(r.field_values ?? {})))];
  if (!runs.length) return null;
  return (
    <section className="m2-sec" aria-label={tr("Failing records, in detail")} data-testid="finding-records">
      <div className="m2-sechead">
        <h2 className="m2-h2">{tr("Failing records, in detail")}</h2>
        <span className="m2-sub">{tr("The records that fail this rule, with the values it read. Sensitive values are masked.")}</span>
        {runs.length > 1 ? (
          <span className="m2-cta">
            <select
              className="m2-sel"
              aria-label={tr("Run")}
              value={runId ?? ""}
              onChange={(e) => {
                setRunId(e.target.value);
                setOffset(0);
              }}
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </span>
        ) : null}
      </div>
      {q.isLoading ? (
        <Skeleton width="100%" height={160} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{tr("The failing records could not be read.")}</ErrorFrame>
      ) : rows.length === 0 ? (
        <EmptyFrame>{tr("No record fails this rule at this run.")}</EmptyFrame>
      ) : (
        <>
          <div className="m2-frame">
            <TableExport>
              <table className="m2-tbl" data-testid="finding-records-table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Record")}</th>
                    <th scope="col">{tr("Table")}</th>
                    <th scope="col">{tr("Object")}</th>
                    {fields.map((f) => (
                      <th key={f} scope="col">
                        <SapCode field={f} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.grain}:${r.record_key}`}>
                      <th scope="row">
                        <V2Link href={hrefFor({ kind: "record", id: `${r.module}:${r.record_key}` })} data-testid="finding-record-link">
                          <Mono>{r.record_key}</Mono>
                        </V2Link>
                      </th>
                      <td>
                        <SapCode table={r.grain} />
                      </td>
                      <td>{moduleText(r.module)}</td>
                      {fields.map((f) => {
                        const v = r.field_values?.[f];
                        return <td key={f}>{v == null || v === "" ? <Dash /> : r.value_labels?.[f] ? <Coded code={String(v)} text={r.value_labels[f]} first /> : <Value value={String(v)} />}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableExport>
          </div>
          <p className="m2-prov" data-testid="finding-records-range">
            {tr("Records {from} to {to} of {total}", { from: int(offset + 1), to: int(offset + rows.length), total: int(total) })}
            {" "}
            <button type="button" className="m2-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              {tr("Previous page")}
            </button>{" "}
            <button type="button" className="m2-btn" disabled={offset + rows.length >= total} onClick={() => setOffset(offset + PAGE)}>
              {tr("Next page")}
            </button>
          </p>
        </>
      )}
    </section>
  );
}
