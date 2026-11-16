"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v2Get, v2Send } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { createShareLink, exportGrid } from "@/lib/api/v2/roles";
import { writeClipboard } from "@/lib/browser";
import { failureText } from "@/lib/v2/errors";
import { downloadGridCsv, exportColumns, exportRows, hiddenColumns, hiddenFromColumns, writeHidden, type ToolColumn } from "@/lib/v2/grid-export";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { Button, Sheet, useToast } from "../kit";
import "./queue.css";

/**
 * Saved views, a read-only share link and Export to Excel or CSV for a work table, natively. Views come from /views
 * (the person's own, shared and built-in ones). A view's filters are the /work/records query parameters, so applying
 * a view with filters opens the filtered work queue; its columns are written to this browser and the table re-keys.
 */

interface SavedView {
  id: string;
  name: string;
  filters: Record<string, string>;
  columns: string[] | null;
  builtin: boolean;
  shared?: boolean;
  mine?: boolean;
}

export interface WorkToolsProps<T> {
  gridId: string;
  route: string;
  title: string;
  columns: readonly ToolColumn<T>[];
  rows: readonly T[];
  filters?: Record<string, string>;
  /** Every row of the filter, for the exports. */
  allRows?: () => Promise<readonly T[]>;
  onColumns: () => void;
}

export function WorkTools<T>({ gridId, route, title, columns, rows, filters, allRows, onColumns }: WorkToolsProps<T>) {
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const session = useV2Session();
  const pathname = usePathname();
  const params = useSearchParams();
  const viewsQ = useQuery({ queryKey: ["v2", "views", fx, route], queryFn: () => v2Get<{ views: SavedView[]; columns?: string[] | null }>("/views", { route }), staleTime: 60_000, retry: false });
  const readOnly = session.shared || Boolean(session.viewAs);
  const [saving, setSaving] = useState(false);
  const [shown, setShown] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const views = viewsQ.data?.views ?? [];
  const visible = () => {
    const hidden = hiddenColumns(gridId, columns);
    return columns.filter((c) => !hidden.has(c.id));
  };

  const apply = (id: string) => {
    const v = views.find((x) => x.id === id);
    if (!v) return;
    if (v.columns) {
      writeHidden(gridId, hiddenFromColumns(columns, v.columns));
      onColumns();
    }
    const f = Object.entries(v.filters ?? {});
    if (f.length) {
      const q = new URLSearchParams(f);
      if (params.get("fixture")) q.set("fixture", params.get("fixture") ?? "1");
      router.push(`/work?${q.toString()}`);
    }
  };
  const doExport = async (format: "xlsx" | "csv") => {
    setBusy(true);
    try {
      const every = allRows ? await allRows() : rows;
      const file =
        format === "csv"
          ? downloadGridCsv(route, every, visible())
          : await (async () => {
              const cols = exportColumns(every, visible());
              return exportGrid({ title, route, columns: cols.map((c) => ({ key: c.id, header: c.header, kind: c.numeric ? "int" : "text" })), rows: exportRows(every, cols), filters, total: every.length });
            })();
      toast({ text: t("Exported {rowsCount} rows to {name}", { rowsCount: int(every.length), name: file }), tone: "good" });
    } catch (e) {
      toast({ text: failureText(e), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setError(null);
    try {
      await v2Send("PUT", "/views", { route, name: name.trim(), filters: filters ?? {}, columns: shown, shared });
      writeHidden(gridId, hiddenFromColumns(columns, shown));
      onColumns();
      await qc.invalidateQueries({ queryKey: ["v2", "views", fx, route] });
      setSaving(false);
      setName("");
      toast({ text: shared ? t("Saved and shared with everyone") : t("View saved"), tone: "good" });
    } catch (e) {
      setError(failureText(e));
    }
  };
  const share = async () => {
    try {
      const state = Object.fromEntries([...params.entries()].filter(([k]) => k !== "fixture" && k !== "persona" && k !== "role"));
      const made = await createShareLink(pathname, state, 7, title);
      setLink(`${window.location.origin}${made.url}`);
    } catch (e) {
      toast({ text: failureText(e), tone: "bad" });
    }
  };
  const sub = (v: SavedView) => (v.builtin ? t("Built in") : v.mine === false ? t("Shared") : v.shared ? t("Yours, shared") : t("Yours"));
  const bad = !name.trim() || name.trim().startsWith("_") || shown.length === 0;

  return (
    <div className="nx-wq-bar" role="group" aria-label={t("Saved views, sharing and export of {title}", { title })} data-testid={`grid-tools-${gridId}`}>
      <label>{t("Views")}
        <select value="" onChange={(e) => apply(e.target.value)} disabled={!views.length}>
          <option value="">{views.length ? t("Views") : t("No saved views yet")}</option>
          {views.map((v) => <option key={v.id} value={v.id}>{`${v.name} (${sub(v)})`}</option>)}
        </select>
      </label>
      <Button variant="secondary" size={32} disabled={readOnly} onClick={() => { setShown(visible().map((c) => c.id)); setError(null); setSaving(true); }}>{t("Save these columns as a view…")}</Button>
      {session.can("export") ? (
        <>
          <Button variant="secondary" size={32} disabled={readOnly} onClick={() => void share()}>{t("Share this page as a link…")}</Button>
          <Button variant="secondary" size={32} loading={busy} title={allRows ? t("The columns on screen, every row of the filter") : t("The columns on screen")} onClick={() => void doExport("xlsx")}>{t("Export to Excel")}</Button>
          <Button variant="quiet" size={32} disabled={busy} onClick={() => void doExport("csv")}>{t("Export to CSV")}</Button>
        </>
      ) : null}
      <Sheet
        open={saving}
        onClose={() => setSaving(false)}
        title={t("Save these columns as a view")}
        size="small"
        dirty={!!name.trim()}
        primary={<Button variant="primary" disabled={bad} onClick={() => void save()}>{t("Save view")}</Button>}
        secondary={<Button variant="quiet" onClick={() => setSaving(false)}>{t("Cancel")}</Button>}
      >
        <div className="nx-wq-form">
          <p className="nx-wq-meta">{t("The columns on screen and the filters in force, under a name.")}</p>
          <label>{t("Name")}
            <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <fieldset>
            <legend>{t("Columns")}</legend>
            {columns.map((c) => (
              <label key={c.id} className="nx-wq-row">
                <input type="checkbox" checked={shown.includes(c.id)} onChange={(e) => setShown((s) => (e.target.checked ? columns.map((x) => x.id).filter((x) => x === c.id || s.includes(x)) : s.filter((x) => x !== c.id)))} />
                {c.header}
              </label>
            ))}
          </fieldset>
          <label className="nx-wq-row">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>{t("Share with everyone")} <small>{t("Others see it in their Views menu and cannot change it.")}</small></span>
          </label>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </Sheet>
      <Sheet
        open={link !== null}
        onClose={() => setLink(null)}
        title={t("Read-only link")}
        size="small"
        primary={<Button variant="primary" onClick={() => void writeClipboard(link ?? "").then((ok) => toast({ text: ok ? t("Link copied") : t("Copy it from the field") }))}>{t("Copy link")}</Button>}
        secondary={<Button variant="quiet" onClick={() => setLink(null)}>{t("Close")}</Button>}
      >
        <div className="nx-wq-form">
          <p className="nx-wq-meta">{t("Anyone in this tenant who opens it sees this page as a viewer, for 7 days. An administrator can revoke it.")}</p>
          <input type="text" readOnly value={link ?? ""} aria-label={t("Share link")} onFocus={(e) => e.currentTarget.select()} />
        </div>
      </Sheet>
    </div>
  );
}
