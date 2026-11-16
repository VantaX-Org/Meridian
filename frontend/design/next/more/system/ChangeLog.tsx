"use client";

import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { describeTable } from "@/lib/v2/sap-fields";
import { DASH, int } from "@/lib/v2/score";
import { useVersionChanges } from "@/lib/v2/step9-queries";
import { Code, DataTable, EmptyState, ErrorState, Skeleton, type Column } from "../../kit";
import { Panel } from "../cfg-parts";
import { ExportTable } from "../ExportTable";

const modeWord = (mode: string): string => (mode === "change_date" ? t("Changes by date") : mode === "full" ? t("Read in full") : mode);

/** `20261009` as a date, or the text as it came. */
function sapDate(s: string | null | undefined): string {
  if (!s) return t("the last download");
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return m ? formatDate(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`, "date") : s;
}

const cell = (n: number | null | undefined) => (n == null ? <span title={t("Not compared with an earlier download")}>{DASH}</span> : int(n));

type Row = { table: string | null; mode: string; rows_read: number; rows_total: number | null; inserted: number | null; updated: number | null; deleted: number | null; unchanged: number | null };

/** The per-table change log of one download: how each table was read and what changed since the previous one. */
export function ChangeLog({ versionId, when }: { versionId: string; when: string | null }) {
  const q = useVersionChanges(versionId);
  const columns: Column<Row>[] = [
    { id: "table", label: t("Table"), cell: (r) => (r.table ? <Code code={r.table} text={describeTable(r.table) ?? undefined} /> : <strong>{t("All tables")}</strong>) },
    { id: "mode", label: t("How it was read"), cell: (r) => (r.table ? modeWord(r.mode) : null) },
    { id: "read", label: t("Rows read"), align: "end", cell: (r) => int(r.rows_read) },
    { id: "total", label: t("Rows in table"), align: "end", cell: (r) => (r.rows_total == null ? DASH : int(r.rows_total)) },
    { id: "ins", label: t("Inserted"), align: "end", cell: (r) => cell(r.inserted) },
    { id: "upd", label: t("Updated"), align: "end", cell: (r) => cell(r.updated) },
    { id: "del", label: t("Deleted"), align: "end", cell: (r) => cell(r.deleted) },
    { id: "same", label: t("Unchanged"), align: "end", cell: (r) => cell(r.unchanged) },
  ];
  return (
    <Panel title={t("Change log")} meta={when ? t("Download of {when}", { when: formatDate(when, "datetime") }) : t("This download")} testId="change-log">
      {q.isPending ? (
        <Skeleton lines={4} label={t("Change log")} />
      ) : q.isError ? (
        <ErrorState sentence={t("The change log of this download could not be read.")} onRetry={() => void q.refetch()} />
      ) : q.data.tables.length === 0 ? (
        <EmptyState heading={t("This download has no change log: it was taken before change logs were kept. The next download writes one per table.")} />
      ) : (
        <>
          <p className="nx-note" data-testid="change-log-line">
            {q.data.delta
              ? q.data.totals.changed == null
                ? t("Changes only since {since}: {read} rows read of {total}, not compared.", { since: sapDate(q.data.delta.since), read: int(q.data.totals.rows_read), total: int(q.data.totals.rows_total) })
                : t("Changes only since {since}: {read} rows read of {total}, {changed} changed.", { since: sapDate(q.data.delta.since), read: int(q.data.totals.rows_read), total: int(q.data.totals.rows_total), changed: int(q.data.totals.changed) })
              : q.data.totals.changed == null
                ? t("Full download: {read} rows read, not compared with an earlier download.", { read: int(q.data.totals.rows_read) })
                : t("Full download: {read} rows read, {changed} changed since the one before.", { read: int(q.data.totals.rows_read), changed: int(q.data.totals.changed) })}
          </p>
          <ExportTable>
            <DataTable
              rows={[...q.data.tables.map((tb) => ({ ...tb, table: tb.table }) as Row), { ...q.data.totals, table: null, mode: "" } as Row]}
              columns={columns}
              rowKey={(r) => r.table ?? "__all"}
              rowLabel={(r) => r.table ?? t("All tables")}
              caption={t("Change log by table")}
            />
          </ExportTable>
          <p className="nx-sub">{t("Counts only, never values. A table with SAP change dates is re-read from the last download's date and merged; any other table is read in full. Each is compared with the previous download row by row.")}</p>
        </>
      )}
    </Panel>
  );
}
