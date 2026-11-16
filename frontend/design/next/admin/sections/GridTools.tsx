"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v2Get, v2Send } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { createShareLink, exportGrid } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { columnsFromHidden, downloadGridCsv, exportColumns, exportRows, hiddenColumns, hiddenFromColumns, visibleColumns, writeHidden, type ToolColumn } from "@/lib/v2/grid-export";
import { useV2Session } from "@/lib/v2/hooks";
import { Dialog, copyText } from "./kit";
import { Grid, type GridProps } from "./Grid";
import { Button, Popover } from "@/design/next/kit";
import { useToast } from "./Toast";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";

/**
 * The tools every v2 grid gets (step 6c), placed in the grid's toolbar slot: a Views menu (the person's own and shared
 * views of this grid, save the columns as a view, share the page as a read-only link) and Export to Excel with the
 * columns on screen. The column choice follows the person: it is saved to /views (the reserved `_columns` row of the
 * route) and restored on another browser. Grid.tsx reads its columns once, so the caller keys the grid with
 * `useGridKey` and the tools bump the key after they change the columns.
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

/** [key, bump]: give the key to the Grid, the bump to GridTools. */
export function useGridKey(gridId: string): [string, () => void] {
  const [n, setN] = useState(0);
  return [`${gridId}:${n}`, useCallback(() => setN((x) => x + 1), [])];
}

export interface GridToolsProps<T> {
  gridId: string;
  /** The /views route key; defaults to the grid id. */
  route?: string;
  title: string;
  columns: readonly ToolColumn<T>[];
  rows: readonly T[];
  filters?: Record<string, string>;
  /** Applies a saved view's filters on pages that have filters; views of pages without filters only carry columns. */
  onApplyFilters?: (filters: Record<string, string>) => void;
  onColumns: () => void;
  /** Every row of the filter, not only the rows loaded on screen: the Excel and CSV exports use it when given (F26). */
  allRows?: () => Promise<readonly T[]>;
}

export function GridTools<T>({ gridId, route, title, columns, rows, filters, onApplyFilters, onColumns, allRows }: GridToolsProps<T>) {
  const key = route ?? gridId;
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const pathname = usePathname();
  const params = useSearchParams();
  const viewsQ = useQuery({ queryKey: ["v2", "views", fx, key], queryFn: () => v2Get<{ views: SavedView[]; columns?: string[] | null }>("/views", { route: key }), staleTime: 60_000, retry: false });
  const synced = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState<{ url: string } | null>(null);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = session.shared || Boolean(session.viewAs);

  // Restore the person's columns from the server once, when this browser has none of its own.
  const remote = viewsQ.data?.columns ?? null;
  useEffect(() => {
    if (!remote || synced.current !== null) return;
    const local = columnsFromHidden(columns, hiddenColumns(gridId, columns));
    synced.current = JSON.stringify(remote);
    if (JSON.stringify(local) !== synced.current) {
      writeHidden(gridId, hiddenFromColumns(columns, remote));
      onColumns();
    }
  }, [remote, columns, gridId, onColumns]);

  const pushColumns = useCallback(() => {
    if (readOnly || !viewsQ.data) return;
    const now = JSON.stringify(columnsFromHidden(columns, hiddenColumns(gridId, columns)));
    const base = synced.current ?? JSON.stringify(columnsFromHidden(columns, new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id))));
    if (now === base) return;
    synced.current = now;
    void v2Send("PUT", "/views", { route: key, name: "_columns", filters: {}, columns: JSON.parse(now) as string[] }).catch(() => undefined);
  }, [readOnly, viewsQ.data, columns, gridId, key]);
  useEffect(() => () => pushColumns(), [pushColumns]);

  const apply = (v: SavedView) => {
    if (v.columns) {
      writeHidden(gridId, hiddenFromColumns(columns, v.columns));
      synced.current = JSON.stringify(v.columns);
      onColumns();
    }
    if (onApplyFilters) onApplyFilters(v.filters);
  };
  const views = (viewsQ.data?.views ?? []).filter((v) => !v.builtin || onApplyFilters);
  const doExport = async () => {
    try {
      const every = allRows ? await allRows() : rows;
      const shown = exportColumns(every, visibleColumns(gridId, columns));
      const name = await exportGrid({ title, route: key, columns: shown.map((c) => ({ key: c.id, header: c.header, kind: c.numeric ? "int" : "text" })), rows: exportRows(every, shown), filters, total: every.length });
      toast.show(t("Exported {rowsCount} rows to {name}", { rowsCount: int(every.length), name }));
    } catch (e) {
      toast.show(failureText(e), "error");
    }
  };
  const doCsv = async () => {
    try {
      const every = allRows ? await allRows() : rows;
      toast.show(t("Exported {rowsCount} rows to {name}", { rowsCount: int(every.length), name: downloadGridCsv(key, every, visibleColumns(gridId, columns)) }));
    } catch (e) {
      toast.show(failureText(e), "error");
    }
  };
  const save = async () => {
    setError(null);
    try {
      await v2Send("PUT", "/views", { route: key, name: name.trim(), filters: filters ?? {}, columns: columnsFromHidden(columns, hiddenColumns(gridId, columns)), shared });
      await qc.invalidateQueries({ queryKey: ["v2", "views", fx, key] });
      setSaving(false);
      setName("");
      toast.show(shared ? t("Saved and shared with everyone") : t("View saved"));
    } catch (e) {
      setError(failureText(e));
    }
  };
  const share = async () => {
    try {
      const state = Object.fromEntries([...params.entries()].filter(([k]) => k !== "fixture" && k !== "persona" && k !== "role"));
      const link = await createShareLink(pathname, state, 7, title);
      setSharing({ url: `${window.location.origin}${link.url}` });
    } catch (e) {
      toast.show(failureText(e), "error");
    }
  };
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const item = (id: string, label: string, onSelect: () => void, sub?: string, disabled?: boolean) => (
    <button key={id} type="button" role="menuitem" className="nx-pop-item" disabled={disabled} aria-disabled={disabled || undefined} onClick={() => {
      setOpen(false);
      onSelect();
    }}>
      {label}
      {sub ? <span className="nx-reason"> {sub}</span> : null}
    </button>
  );
  const everyRow = t("The columns on screen, every row of the filter");
  return (
    <span className="nx-adm-gtools" data-testid={`grid-tools-${gridId}`}>
      <Button
        ref={setAnchor}
        size={32}
        icon="download"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("Share and export {title}", { title })}
        onClick={() => {
          if (!open) pushColumns();
          setOpen(!open);
        }}
      >
        {t("Share and export")}
      </Button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="bottom" label={t("Saved views, sharing and export of {title}", { title })}>
        <p className="nx-reason">{t("Views")}</p>
        {views.length
          ? views.map((v) => (
              <button
                key={v.id}
                type="button"
                role="menuitem"
                className="nx-pop-item"
                onClick={() => {
                  setOpen(false);
                  apply(v);
                }}
              >
                {v.name}
                <span className="nx-reason"> {v.builtin ? t("Built in") : v.mine === false ? t("Shared") : v.shared ? t("Yours, shared") : t("Yours")}</span>
              </button>
            ))
          : item("none", t("No saved views yet"), () => undefined, undefined, true)}
        <hr className="nx-adm-sep" />
        {item("save", t("Save these columns as a view…"), () => setSaving(true), undefined, readOnly)}
        {session.can("export") ? (
          <>
            {item("share", t("Share this page as a link…"), () => void share(), undefined, readOnly)}
            {item("export", t("Export to Excel"), () => void doExport(), allRows ? everyRow : t("The columns on screen"))}
            {item("export-csv", t("Export to CSV"), () => void doCsv(), allRows ? everyRow : t("The columns and rows on screen"))}
          </>
        ) : null}
      </Popover>
      {saving ? (
        <Dialog title={t("Save these columns as a view")} description={t("The columns on screen and the filters in force, under a name.")} onClose={() => setSaving(false)}>
          <label className="nx-field">
            {t("Name")}
            <input className="nx-input" type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="nx-adm-sw">
            <input className="nx-check" type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>
              {t("Share with everyone")}
              <span className="nx-reason"> {t("Others see it in their Views menu and cannot change it.")}</span>
            </span>
          </label>
          {error ? (
            <p className="nx-reason" role="alert">
              {error}
            </p>
          ) : null}
          <div className="nx-adm-acts">
            <Button variant="secondary" onClick={() => setSaving(false)}>
              {t("Cancel")}
            </Button>
            <Button variant="primary" disabled={!name.trim() || name.trim().startsWith("_")} onClick={() => void save()}>
              {t("Save view")}
            </Button>
          </div>
        </Dialog>
      ) : null}
      {sharing ? (
        <Dialog title={t("Read-only link")} description={t("Anyone in this tenant who opens it sees this page as a viewer, for 7 days. An administrator can revoke it.")} onClose={() => setSharing(null)}>
          <input className="nx-input" type="text" readOnly value={sharing.url} aria-label={t("Share link")} onFocus={(e) => e.currentTarget.select()} />
          <div className="nx-adm-acts">
            <Button variant="secondary" onClick={() => setSharing(null)}>
              {t("Close")}
            </Button>
            <Button variant="primary" onClick={() => void copyText(sharing.url).then((ok) => toast.show(ok ? t("Link copied") : t("Copy it from the field")))}>
              {t("Copy link")}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </span>
  );
}

/**
 * Grid with the tools: a drop-in for `<Grid>` that adds the Views menu and Export to the toolbar and re-keys the grid
 * when a view changes its columns. `toolsTitle` names the sheet and the menu; `toolsRoute` the /views route key.
 */
export function ToolGrid<T>(props: GridProps<T> & { toolsTitle: string; toolsRoute?: string; toolsFilters?: Record<string, string> }) {
  const { toolsTitle, toolsRoute, toolsFilters, toolbar, ...grid } = props;
  const [key, bump] = useGridKey(grid.id);
  const tools = <GridTools gridId={grid.id} route={toolsRoute} title={toolsTitle} columns={grid.columns} rows={grid.rows} filters={toolsFilters} onColumns={bump} />;
  return (
    <Grid<T>
      key={key}
      {...grid}
      toolbar={
        toolbar ? (
          <>
            {toolbar}
            {tools}
          </>
        ) : (
          tools
        )
      }
    />
  );
}
