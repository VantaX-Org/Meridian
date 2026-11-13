"use client";

import { useState } from "react";
import { formatDate, formatInt, MODULE_LABELS } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import type { LoadEvent } from "@/lib/api/v2/migration";
import { useLoadHistory } from "@/lib/api/next/load";
import { Button, DataTable, type Column } from "../kit";

const PAGE = 25;

/** One handed-over file as a sentence: "mig-0002.zip, 6,071 rows, 9 Nov 2026". */
export const eventSentence = (e: LoadEvent) =>
  t("{file}, {n} rows, {when}", { file: e.filename, n: formatInt(e.record_count), when: formatDate(e.exported_at, "date") });

/** The files already handed over to a load, newest first, paged on the server. */
export function History() {
  const [offset, setOffset] = useState(0);
  const q = useLoadHistory(PAGE, offset);
  const d = q.data;

  const columns: Column<LoadEvent>[] = [
    { id: "file", label: t("File"), cell: (e) => e.filename },
    { id: "format", label: t("Format"), cell: (e) => e.export_format },
    { id: "rows", label: t("Rows"), align: "end", cell: (e) => formatInt(e.record_count) },
    { id: "objects", label: t("Objects"), cell: (e) => e.modules.map((m) => MODULE_LABELS[m] ?? m).join(", ") },
    { id: "by", label: t("By"), cell: (e) => e.exported_by_label ?? "" },
    { id: "when", label: t("When"), cell: (e) => formatDate(e.exported_at, "datetime") },
    { id: "wave", label: t("Wave"), cell: (e) => e.wave_name ?? "" },
  ];

  return (
    <section className="nx-ld-step" data-testid="load-history" aria-labelledby="nx-ld-h-history">
      <h2 id="nx-ld-h-history">{t("Files handed over")}</h2>
      <p className="nx-ld-lede">{t("Every set of load files built from Meridian, newest first.")}</p>
      <DataTable
        rows={d?.items ?? []}
        columns={columns}
        rowKey={(e) => e.id}
        rowLabel={(e) => e.filename}
        caption={t("Files handed over")}
        loading={q.isLoading}
        error={q.isError ? { sentence: t("The history could not be read."), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: t("Nothing handed over yet"), text: t("Build load files on the Prepare tab and they are listed here.") }}
      />
      {d && d.total > PAGE ? (
        <div className="nx-ld-pager">
          <span className="nx-ld-meta">{t("{from} to {to} of {total}", { from: formatInt(d.offset + 1), to: formatInt(Math.min(d.offset + d.items.length, d.total)), total: formatInt(d.total) })}</span>
          <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("Previous")}</Button>
          <Button variant="secondary" disabled={d.next_offset === null} onClick={() => d.next_offset !== null && setOffset(d.next_offset)}>{t("Next")}</Button>
        </div>
      ) : null}
    </section>
  );
}
