"use client";

import "../../step9.css";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { useVersionChanges } from "@/lib/v2/step9-queries";
import { int } from "@/lib/v2/score";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../../parts";

const modeWord = (mode: string): string => (mode === "change_date" ? t("Changes by date") : mode === "full" ? t("Read in full") : mode);

/** `20261009` as a date, or the text as it came. */
function sapDate(s: string | null | undefined): string {
  if (!s) return t("the last download");
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return m ? formatDate(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`, "date") : s;
}

const cell = (n: number | null) => (n == null ? <Dash why={t("Not compared with an earlier download")} /> : int(n));

/** The per-table change log of one download: how each table was read and what changed since the previous one. */
export function ChangeLog({ versionId, when }: { versionId: string; when: string | null }) {
  const q = useVersionChanges(versionId);
  return (
    <section className="m2-sec" aria-label={t("Change log")} data-testid="change-log">
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Change log")}</h2>
        <span className="m2-sub">{when ? t("Download of {when}", { when: formatDate(when, "datetime") }) : t("This download")}</span>
      </div>
      {q.isPending ? (
        <Skeleton width="100%" height={100} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The change log of this download could not be read.")}</ErrorFrame>
      ) : q.data.tables.length === 0 ? (
        <EmptyFrame>{t("This download has no change log: it was taken before change logs were kept. The next download writes one per table.")}</EmptyFrame>
      ) : (
        <>
          <p className="m2-finding" data-testid="change-log-line">
            {q.data.delta
              ? q.data.totals.changed == null
                ? t("Changes only since {since}: {read} rows read of {total}, not compared.", { since: sapDate(q.data.delta.since), read: int(q.data.totals.rows_read), total: int(q.data.totals.rows_total) })
                : t("Changes only since {since}: {read} rows read of {total}, {changed} changed.", { since: sapDate(q.data.delta.since), read: int(q.data.totals.rows_read), total: int(q.data.totals.rows_total), changed: int(q.data.totals.changed) })
              : q.data.totals.changed == null
                ? t("Full download: {read} rows read, not compared with an earlier download.", { read: int(q.data.totals.rows_read) })
                : t("Full download: {read} rows read, {changed} changed since the one before.", { read: int(q.data.totals.rows_read), changed: int(q.data.totals.changed) })}
          </p>
          <div className="m2-frame" tabIndex={0} role="region" aria-label={t("Change log, scrollable")}>
            <table className="m2-tbl" aria-label={t("Change log by table")}>
              <thead>
                <tr>
                  <th scope="col">{t("Table")}</th>
                  <th scope="col">{t("How it was read")}</th>
                  <th scope="col" className="m2-r">{t("Rows read")}</th>
                  <th scope="col" className="m2-r">{t("Rows in table")}</th>
                  <th scope="col" className="m2-r">{t("Inserted")}</th>
                  <th scope="col" className="m2-r">{t("Updated")}</th>
                  <th scope="col" className="m2-r">{t("Deleted")}</th>
                  <th scope="col" className="m2-r">{t("Unchanged")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.tables.map((tb) => (
                  <tr key={tb.table}>
                    <th scope="row">
                      <Mono>{tb.table}</Mono>
                    </th>
                    <td>{modeWord(tb.mode)}</td>
                    <td className="m2-r">{int(tb.rows_read)}</td>
                    <td className="m2-r">{tb.rows_total == null ? <Dash /> : int(tb.rows_total)}</td>
                    <td className="m2-r">{cell(tb.inserted)}</td>
                    <td className="m2-r">{cell(tb.updated)}</td>
                    <td className="m2-r">{cell(tb.deleted)}</td>
                    <td className="m2-r">{cell(tb.unchanged)}</td>
                  </tr>
                ))}
                <tr className="m2-sum">
                  <th scope="row">{t("All tables")}</th>
                  <td />
                  <td className="m2-r">{int(q.data.totals.rows_read)}</td>
                  <td className="m2-r">{int(q.data.totals.rows_total)}</td>
                  <td className="m2-r">{cell(q.data.totals.inserted)}</td>
                  <td className="m2-r">{cell(q.data.totals.updated)}</td>
                  <td className="m2-r">{cell(q.data.totals.deleted)}</td>
                  <td className="m2-r">{cell(q.data.totals.unchanged)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="m2-prov">{t("Counts only, never values. A table with SAP change dates is re-read from the last download's date and merged; any other table is read in full. Each is compared with the previous download row by row.")}</p>
        </>
      )}
    </section>
  );
}
