"use client";

import "../../step10.css";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { eventWords } from "@/lib/v2/step10";
import { useRecordHistory } from "@/lib/v2/step10-queries";
import { STATUS_LABEL } from "@/lib/v2/work";
import { VerdictMark } from "../../marks";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../../parts";

/**
 * The History tab of the record inspector (GET /work/records/{module}/{key}/history): every run that measured the
 * record's object, oldest first, with the values of its failing fields in that run; then every decision on it in
 * order, with who and when, each linked to its run.
 */
export function RecordHistoryPanel({ module, recordKey }: { module: string; recordKey: string }) {
  const q = useRecordHistory(module, recordKey);
  if (q.isPending) return <Skeleton width="100%" height={160} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The history of this record could not be read.")}</ErrorFrame>;
  const h = q.data;
  if (h.runs.length === 0 && h.events.length === 0) return <EmptyFrame>{t("No run has measured this record yet, and nothing has been decided on it.")}</EmptyFrame>;
  const fields = [...new Set(h.runs.flatMap((r) => Object.keys(r.values)))].sort();
  const failing = h.runs.filter((r) => r.failing).length;
  const runs = [...h.runs].reverse();
  return (
    <div data-testid="record-history-tab">
      <h3>{t("Every run")}</h3>
      <p className="m2-prov">{t("{n} {n, plural, one {run} other {runs}} measured this record, {failing} with it failing. Values are as each run stored them; the work status is today's.", { n: h.runs.length, failing })}</p>
      <div className="m2-frame" tabIndex={0} role="region" aria-label={t("Runs of this record, scrollable")}>
        <table className="m2-tbl m2-hist-tbl" aria-label={t("Values of the failing fields by run")} data-testid="history-runs">
          <thead>
            <tr>
              <th scope="col">{t("Run")}</th>
              <th scope="col">{t("Failing")}</th>
              <th scope="col">{t("Rules")}</th>
              {fields.map((f) => (
                <th key={f} scope="col">
                  <Mono>{f}</Mono>
                </th>
              ))}
              <th scope="col">{t("Status today")}</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run_id}>
                <th scope="row">
                  <V2Link href={`/run/${r.run_id}`}>{formatDate(r.run_at, "datetime")}</V2Link>
                  {r.sandbox ? <span className="m2-meta">{` ${t("sandbox")}`}</span> : null}
                </th>
                <td>
                  <span className="m2-v">
                    <VerdictMark verdict={r.failing ? "no-go" : "go"} />
                    {r.failing ? t("Failing") : t("Passing")}
                  </span>
                </td>
                <td>{r.checks.length ? <Mono>{r.checks.join(", ")}</Mono> : <Dash why={t("No rule failed this record in this run")} />}</td>
                {fields.map((f) => (
                  <td key={f}>{f in r.values ? r.values[f] == null || r.values[f] === "" ? <span className="m2-meta">{t("blank")}</span> : <Mono>{r.values[f]}</Mono> : <Dash why={t("Not stored for this run")} />}</td>
                ))}
                <td>{r.work_status ? (STATUS_LABEL[r.work_status] ?? r.work_status) : <Dash why={t("No work row in this run")} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>{t("Decisions")}</h3>
      {h.events.length === 0 ? (
        <p className="m2-meta">{t("Nothing has been decided on this record yet.")}</p>
      ) : (
        <ol className="m2-hist-ev" data-testid="history-events">
          {h.events.map((e, n) => (
            <li key={`${e.at ?? ""}-${n}`}>
              <span>{eventWords(e)}</span>
              {e.note && e.action !== "comment" ? <span>{e.note}</span> : null}
              <span className="m2-meta">
                {[e.by ?? t("the system"), e.at ? formatDate(e.at, "datetime") : null].filter(Boolean).join(", ")}
                {e.run_id ? (
                  <>
                    {", "}
                    <V2Link href={`/run/${e.run_id}`}>{t("open the run")}</V2Link>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
