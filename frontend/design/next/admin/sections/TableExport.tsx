"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, Popover } from "@/design/next/kit";
import { exportGrid } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { domTable, downloadCsv, tableCsv, tableTitle } from "@/lib/v2/grid-export";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { useToast } from "./Toast";

/**
 * Export to Excel and CSV for a plain table (one not built on Grid): wraps the table and exports what it shows, read
 * from the page, so the filter, the sort and the columns on screen are what lands in the file. Codes come with their
 * description column. The file is named after the table: its aria-label or caption, else the heading above it, else
 * the page title, unless `title` is given. Only people holding the export permission see it; the server checks again.
 */
export function TableExport({ title: given, children }: { title?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const session = useV2Session();
  const toast = useToast();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  if (!session.can("export")) return <>{children}</>;
  const run = async (format: "xlsx" | "csv") => {
    try {
      const table = box.current?.querySelector("table");
      if (!table) throw new Error(t("There is no table to export yet."));
      const data = domTable(table);
      const title = (given ?? tableTitle(table)).slice(0, 80);
      const route = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 64) || "table";
      const name = format === "csv" ? downloadCsv(route, tableCsv(data.columns, data.rows)) : await exportGrid({ title, route, columns: data.columns, rows: data.rows, total: data.rows.length });
      toast.show(t("Exported {rowsCount} rows to {name}", { rowsCount: int(data.rows.length), name }));
    } catch (e) {
      toast.show(failureText(e), "error");
    }
  };
  return (
    <div className="nx-adm-tx" ref={box}>
      <div className="nx-adm-tx-bar">
        <Button ref={setAnchor} size={32} icon="download" aria-haspopup="menu" aria-expanded={open} aria-label={given ? t("Export {title}", { title: given }) : t("Export this table")} onClick={() => setOpen(!open)}>
          {t("Export")}
        </Button>
        <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="bottom" label={t("Export this table")}>
          <button type="button" role="menuitem" className="nx-pop-item" onClick={() => (setOpen(false), void run("xlsx"))}>
            {t("Export to Excel")}
          </button>
          <button type="button" role="menuitem" className="nx-pop-item" onClick={() => (setOpen(false), void run("csv"))}>
            {t("Export to CSV")}
          </button>
        </Popover>
      </div>
      {children}
    </div>
  );
}
