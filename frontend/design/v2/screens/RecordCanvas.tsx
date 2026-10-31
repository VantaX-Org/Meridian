"use client";

import { useMemo } from "react";
import type { WorkIssue } from "@/lib/api/work";
import { formatDate } from "@/lib/format";
import { describeField, sapField } from "@/lib/v2/sap-fields";
import { moduleFromSlug } from "@/lib/v2/score";
import { STATUS_LABEL, splitKey } from "@/lib/v2/work";
import { useOpenItem } from "@/lib/v2/hooks";
import { useRecordLinks, useWorkRecord } from "@/lib/v2/work-queries";
import { t as tr } from "@/lib/v2/i18n";
import { SeverityMark, type SeverityKey } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, Value, V2Link } from "../parts";
import { historyLine } from "./RecordInspector";

const sev = (s: string | null | undefined): SeverityKey => (s === "critical" || s === "high" || s === "medium" || s === "low" ? s : "low");
const tableOf = (field: string): string => (field.includes(".") ? field.split(".")[0] : "");

/**
 * One record on the canvas, /o/{system}/{module}/records/{key}: its fields grouped by SAP table with the rules that
 * reject them, the findings with their state, the change log and the duplicates. The data is the inspector's
 * (GET /work/records and its links); the inspector keeps the actions.
 */
export function RecordCanvas({ module: slug, recordKey }: { module: string; recordKey: string }) {
  const mod = moduleFromSlug(slug);
  const key = (() => {
    try {
      return decodeURIComponent(recordKey);
    } catch {
      return recordKey;
    }
  })();
  const q = useWorkRecord(mod, key);
  const detail = q.data;
  const links = useRecordLinks(mod, key, detail?.version_id ?? null).data;
  const { hrefFor } = useOpenItem();
  const title = splitKey(key)[0]?.value ?? key;
  const groups = useMemo(() => {
    const by = new Map<string, [string, string | null][]>();
    for (const e of Object.entries(detail?.values ?? {})) by.set(tableOf(e[0]), [...(by.get(tableOf(e[0])) ?? []), e]);
    return [...by];
  }, [detail]);
  const failing = useMemo(() => {
    const m = new Map<string, WorkIssue[]>();
    for (const i of detail?.issues ?? []) if (i.field) for (const k of new Set([i.field, sapField(i.field)])) m.set(k, [...(m.get(k) ?? []), i]);
    return m;
  }, [detail]);

  if (q.isPending) return <div aria-busy="true"><PageTitle><Mono>{title}</Mono></PageTitle><Skeleton width="100%" height={160} /></div>;
  if (q.isError || !detail) {
    return (
      <>
        <PageTitle><Mono>{title}</Mono></PageTitle>
        <ErrorFrame onRetry={() => void q.refetch()}>{tr("The record could not be read.")}</ErrorFrame>
      </>
    );
  }
  const dup = detail.duplicates;
  return (
    <div data-testid="record-canvas">
      <PageTitle sub={detail.name}><Mono>{title}</Mono></PageTitle>
      <p className="m2-statusline">
        <span>{STATUS_LABEL[detail.status] ?? detail.status}</span>
      </p>

      <section className="m2-sec" aria-label={tr("Findings")}>
        <div className="m2-sechead"><h2 className="m2-h2">{tr("Findings")}</h2></div>
        {detail.issues.length === 0 ? <EmptyFrame>{tr("No changes have been made to this record yet.")}</EmptyFrame> : (
          <ul className="m2-hist" data-testid="record-findings">
            {detail.issues.map((i) => (
              <li key={`${i.check_id}|${i.field}`}>
                <span className="m2-v"><SeverityMark severity={sev(i.severity)} /><V2Link href={hrefFor({ kind: "rule", id: i.check_id })} className="m2-mono">{i.check_id}</V2Link></span>
                <span>{i.message} <span className="m2-meta">{STATUS_LABEL[i.status] ?? i.status}{i.suggestion?.value ? `, ${i.suggestion.value}` : ""}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="m2-sec" aria-label={tr("Facts")}>
        <div className="m2-sechead"><h2 className="m2-h2">{tr("Facts")}</h2></div>
        {groups.map(([table, fields]) => (
          <div key={table} data-testid="record-table">
            <h3 className="m2-h3">{table ? <Mono>{table}</Mono> : tr("Record")}</h3>
            <dl className="m2-facts">
              {fields.map(([field, value]) => {
                const hits = [...new Map((failing.get(field) ?? []).map((h) => [h.check_id, h])).values()];
                const desc = describeField(field);
                return (
                  <div className="m2-fact" key={field}>
                    <dt>{desc ? `${desc} ` : ""}<Mono className="m2-fid">{sapField(field)}</Mono></dt>
                    <dd>
                      {value === null || value === "" ? <span className="m2-meta">{tr("blank")}</span> : <Value value={String(value)} />}
                      {hits.map((h) => (
                        <span key={h.check_id} className="m2-v"><SeverityMark severity={sev(h.severity)} /><V2Link href={hrefFor({ kind: "rule", id: h.check_id })} className="m2-mono">{h.check_id}</V2Link></span>
                      ))}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </section>

      <section className="m2-sec" aria-label={tr("Change log")}>
        <div className="m2-sechead"><h2 className="m2-h2">{tr("Change log")}</h2></div>
        {links ? (links.history.length ? (
          <ul className="m2-hist" data-testid="record-changelog">
            {links.history.map((h, n) => <li key={`${h.at}-${n}`}><span className="m2-d">{h.at ? formatDate(h.at, "date") : <Dash />}</span><span>{historyLine(h)}</span></li>)}
          </ul>
        ) : <p className="m2-meta">{tr("No changes have been made to this record yet.")}</p>) : <Skeleton width="60%" height={12} />}
      </section>

      <section className="m2-sec" aria-label={tr("Possible duplicate")}>
        <div className="m2-sechead"><h2 className="m2-h2">{tr("Possible duplicate")}</h2></div>
        {dup && dup.open > 0 ? <p><V2Link href={dup.href}>{tr("Possible duplicate")} ({dup.open})</V2Link></p> : null}
        {detail.golden_record ? <p><V2Link href={detail.golden_record.href}>{tr("Golden record")}</V2Link></p> : null}
        {!(dup && dup.open > 0) && !detail.golden_record ? <p className="m2-meta">{tr("No golden record is named.")}</p> : null}
      </section>
    </div>
  );
}
