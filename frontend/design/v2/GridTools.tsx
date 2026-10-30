"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v2Get, v2Send } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { createShareLink, exportGrid } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { columnsFromHidden, exportRows, hiddenColumns, hiddenFromColumns, visibleColumns, writeHidden, type ToolColumn } from "@/lib/v2/grid-export";
import { useV2Session } from "@/lib/v2/hooks";
import { Dialog, copyText } from "./admin/kit";
import { Grid, type GridProps } from "./Grid";
import { MenuButton, type MenuEntry } from "./Menu";
import { useToast } from "./Toast";
import "./roles.css";
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
}

export function GridTools<T>({ gridId, route, title, columns, rows, filters, onApplyFilters, onColumns }: GridToolsProps<T>) {
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
      const shown = visibleColumns(gridId, columns);
      const name = await exportGrid({ title, route: key, columns: shown.map((c) => ({ key: c.id, header: c.header, kind: c.numeric ? "int" : "text" })), rows: exportRows(rows, shown), filters });
      toast.show(t("Exported {rowsCount} rows to {name}", { rowsCount: int(rows.length), name }));
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
  const entries: MenuEntry[] = [
    { kind: "heading", label: t("Views") },
    ...(views.length
      ? views.map<MenuEntry>((v) => ({ kind: "item", id: v.id, label: v.name, sub: v.builtin ? t("Built in") : v.mine === false ? t("Shared") : v.shared ? t("Yours, shared") : t("Yours"), onSelect: () => apply(v) }))
      : [{ kind: "item", id: "none", label: t("No saved views yet"), disabled: true } as MenuEntry]),
    { kind: "separator" },
    { kind: "item", id: "save", label: t("Save these columns as a view…"), disabled: readOnly, onSelect: () => setSaving(true) },
    { kind: "item", id: "share", label: t("Share this page as a link…"), disabled: readOnly || !session.can("export"), onSelect: () => void share() },
    { kind: "item", id: "export", label: t("Export to Excel"), sub: t("The columns on screen"), disabled: !session.can("export"), onSelect: () => void doExport() },
  ];
  return (
    <span className="m2-gtools" data-testid={`grid-tools-${gridId}`}>
      <MenuButton label={t("Saved views, sharing and export of {title}", { title })} buttonLabel={t("Share and export {title}", { title })} entries={entries} className="m2-btn m2-sm" onOpen={pushColumns}>
        {t("Share and export")}
      </MenuButton>
      {saving ? (
        <Dialog title={t("Save these columns as a view")} description={t("The columns on screen and the filters in force, under a name.")} onClose={() => setSaving(false)}>
          <label>
            {t("Name")}
            <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="m2-sw">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>
              {t("Share with everyone")}
              <small>{t("Others see it in their Views menu and cannot change it.")}</small>
            </span>
          </label>
          {error ? (
            <p className="m2-err" role="alert">
              {error}
            </p>
          ) : null}
          <div className="m2-dlg-a">
            <button type="button" className="m2-btn" onClick={() => setSaving(false)}>
              {t("Cancel")}
            </button>
            <button type="button" className="m2-btn m2-strong" disabled={!name.trim() || name.trim().startsWith("_")} onClick={() => void save()}>
              {t("Save view")}
            </button>
          </div>
        </Dialog>
      ) : null}
      {sharing ? (
        <Dialog title={t("Read-only link")} description={t("Anyone in this tenant who opens it sees this page as a viewer, for 7 days. An administrator can revoke it.")} onClose={() => setSharing(null)}>
          <input type="text" readOnly value={sharing.url} aria-label={t("Share link")} onFocus={(e) => e.currentTarget.select()} />
          <div className="m2-dlg-a">
            <button type="button" className="m2-btn" onClick={() => setSharing(null)}>
              {t("Close")}
            </button>
            <button type="button" className="m2-btn m2-strong" onClick={() => void copyText(sharing.url).then((ok) => toast.show(ok ? t("Link copied") : t("Copy it from the field")))}>
              {t("Copy link")}
            </button>
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
