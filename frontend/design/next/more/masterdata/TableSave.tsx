"use client";

import { useRef, type ReactNode } from "react";
import { exportGrid } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { domTable, downloadCsv, tableCsv } from "@/lib/v2/grid-export";
import { formatInt as int } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button, useToast } from "../../kit";

/**
 * Excel and CSV export for a native table, as the old TableExport did: it reads the table on screen, so the filter,
 * sort and columns shown are what lands in the file. Only people with the export permission see it.
 */
export function TableSave({ title, children }: { title: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const session = useV2Session();
  const toast = useToast();
  if (!session.can("export")) return <>{children}</>;
  const run = async (format: "xlsx" | "csv") => {
    try {
      const table = box.current?.querySelector("table");
      if (!table) throw new Error(t("There is no table to export yet."));
      const data = domTable(table);
      const route = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 64) || "table";
      const name = format === "csv" ? downloadCsv(route, tableCsv(data.columns, data.rows)) : await exportGrid({ title: title.slice(0, 80), route, columns: data.columns, rows: data.rows, total: data.rows.length });
      toast({ text: t("Exported {rowsCount} rows to {name}", { rowsCount: int(data.rows.length), name }), tone: "good" });
    } catch (e) {
      toast({ text: failureText(e), tone: "bad" });
    }
  };
  return (
    <div ref={box}>
      <div className="nx-row nx-wrap">
        <Button size={32} variant="quiet" icon="download" onClick={() => void run("xlsx")}>{t("Export to Excel")}</Button>
        <Button size={32} variant="quiet" icon="download" onClick={() => void run("csv")}>{t("Export to CSV")}</Button>
      </div>
      {children}
    </div>
  );
}
