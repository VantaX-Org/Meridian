"use client";

import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import type { PortfolioRow } from "@/lib/api/next/portfolio";
import { Button } from "../kit";

/** What the portfolio can do to one object or many; the screen owns the confirm, the panel and the toasts. */
export interface PortfolioActions {
  pull: (rows: PortfolioRow[]) => void;
  download: (rows: PortfolioRow[]) => void;
  upload: (rows: PortfolioRow[]) => void;
  score: (rows: PortfolioRow[]) => void;
  compare: (rows: PortfolioRow[]) => void;
  /** The system's name for its id; the id itself when the system is gone. */
  sysName: (id: string | null) => string;
  can: (action: string) => boolean;
  /** Version ids being scored now. */
  scoring: Set<string>;
}

/** The object page of a row (Batch D owns /o). */
export function objectHref(row: PortfolioRow, sysName: (id: string | null) => string, tail = ""): string {
  return `/o/${systemSlug(sysName(row.system_id))}/${moduleSlug(row.module)}${tail}`;
}

export const rowKey = (r: PortfolioRow) => r.version_id;

/** The buttons for a selection, also used inside the table's own bulk bar. */
export function BulkActions({ rows, act }: { rows: PortfolioRow[]; act: PortfolioActions }) {
  const no = (a: string) => (act.can(a) ? undefined : t("Your role cannot do this."));
  return (
    <>
      <Button variant="primary" size={32} icon="play" onClick={() => act.pull(rows)} disabled={!!no("trigger_sync")} reason={no("trigger_sync")}>{t("Pull now")}</Button>
      <Button size={32} icon="download" onClick={() => act.download(rows)}>{t("Download workbooks")}</Button>
      <Button size={32} icon="upload" onClick={() => act.upload(rows)} disabled={!!no("upload")} reason={no("upload")}>{t("Upload cleaned workbooks")}</Button>
      <Button size={32} icon="refresh" onClick={() => act.score(rows)} disabled={!!no("analyse")} reason={no("analyse")}>{t("Score again")}</Button>
      <Button size={32} icon="columns" onClick={() => act.compare(rows)} disabled={rows.length < 2} reason={rows.length < 2 ? t("Pick two or more objects to compare them side by side.") : undefined}>{t("Compare")}</Button>
    </>
  );
}

export function BulkBar({ rows, act, onClear }: { rows: PortfolioRow[]; act: PortfolioActions; onClear: () => void }) {
  if (!rows.length) return null;
  return (
    <div className="nx-bulk nx-pf-bulk" role="region" aria-label={t("Selection")} data-testid="pf-bulk">
      <strong>{t("{n} objects selected", { n: formatInt(rows.length) })}</strong>
      <BulkActions rows={rows} act={act} />
      <Button variant="quiet" size={32} onClick={onClear}>{t("Clear selection")}</Button>
    </div>
  );
}
