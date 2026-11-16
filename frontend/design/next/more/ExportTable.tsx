"use client";

import { useRef, useState, type ReactNode } from "react";
import { exportGrid } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { domTable, downloadCsv, tableCsv, tableTitle } from "@/lib/v2/grid-export";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";

/**
 * Export to Excel and CSV for a plain table: reads the table from the page, so what is on screen lands in the file.
 * Only people holding the export permission see it; the server checks again.
 */
export function ExportTable({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const session = useV2Session();
  const [status, setStatus] = useState<{ text: string; bad: boolean } | null>(null);
  if (!session.can("export")) return <>{children}</>;
  const run = async (format: "xlsx" | "csv") => {
    try {
      const table = box.current?.querySelector("table");
      if (!table) throw new Error(t("There is no table to export yet."));
      const data = domTable(table);
      const title = tableTitle(table).slice(0, 80);
      const route = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 64) || "table";
      const name = format === "csv" ? downloadCsv(route, tableCsv(data.columns, data.rows)) : await exportGrid({ title, route, columns: data.columns, rows: data.rows, total: data.rows.length });
      setStatus({ text: t("Exported {rowsCount} rows to {name}", { rowsCount: int(data.rows.length), name }), bad: false });
    } catch (e) {
      setStatus({ text: failureText(e), bad: true });
    }
  };
  return (
    <div ref={box} data-testid="table-export">
      <div className="nx-row nx-wrap" role="group" aria-label={t("Export this table")}>
        <button type="button" className="nx-btn nx-btn-secondary nx-btn-sm" title={t("The columns and rows on screen")} onClick={() => void run("xlsx")} data-testid="export-xlsx">{t("Export to Excel")}</button>
        <button type="button" className="nx-btn nx-btn-secondary nx-btn-sm" title={t("The columns and rows on screen")} onClick={() => void run("csv")} data-testid="export-csv">{t("Export to CSV")}</button>
        <span className="nx-sub" role="status" aria-live="polite" data-tone={status?.bad ? "bad" : undefined}>{status?.text ?? ""}</span>
      </div>
      {children}
    </div>
  );
}
