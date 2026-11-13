"use client";

/** The migration templates of one object as a table of sheets: how much is filled, what the source lacks, and what to decide next. */
import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { downloadBlankTemplate, downloadTemplateFile, uploadTemplate } from "@/lib/api/v2/migration";
import { loadKeys, useTemplates } from "@/lib/api/next/load";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button, Chip, DataTable, EmptyState, ErrorState, Skeleton, useToast, type Column } from "../kit";
import { filledBefore, nextSheet, rowsOf, type SheetStatus, type TemplateRow } from "./templates";
import { Denied, Trunc, compactInt, useGuard } from "./states";

const STATUS: Record<SheetStatus, { tone: "good" | "warn" | "neutral"; label: () => string }> = {
  ready: { tone: "good", label: () => t("Ready") },
  decision: { tone: "warn", label: () => t("Needs a decision") },
  "not-started": { tone: "neutral", label: () => t("Not started") },
};

export function TemplatesPanel({ module, onFill }: { module: string; onFill: (sheet: string) => void }) {
  const session = useV2Session();
  const q = useTemplates(module);
  const qc = useQueryClient();
  const toast = useToast();
  const guard = useGuard();
  const file = useRef<HTMLInputElement>(null);

  if (!session.can("analyse")) return <Denied right={t("analyse")} />;
  if (q.isLoading) return <Skeleton lines={5} label={t("Loading the templates")} />;
  if (q.isError) return <ErrorState sentence={t("The templates could not be loaded.")} error={q.error} onRetry={() => void q.refetch()} />;

  const tpl = q.data?.templates[0] ?? null;
  const rows = tpl ? rowsOf(tpl.coverage, filledBefore(tpl)) : [];
  const next = nextSheet(rows);
  const download = () => guard.run(() => (tpl ? downloadTemplateFile(module, tpl) : downloadBlankTemplate(module)));
  const upload = (f: File | undefined) => {
    if (!f) return;
    void guard.run(async () => {
      try {
        await uploadTemplate(module, f, f.name.replace(/\.[^.]+$/, ""));
        await qc.invalidateQueries({ queryKey: loadKeys.all });
        toast({ text: t("Workbook uploaded"), tone: "good" });
      } catch {
        toast({ text: t("The workbook could not be read. Download the blank workbook and fill that one."), tone: "bad" });
      }
    });
  };

  const columns: Column<TemplateRow>[] = [
    { id: "name", label: t("Sheet"), cell: (r) => <Trunc text={r.name} />, compare: (a, b) => a.name.localeCompare(b.name) },
    { id: "filled", label: t("Filled"), align: "end", cell: (r) => <span className="nx-num">{`${compactInt(r.filled)} / ${compactInt(r.columns)}`}</span> },
    {
      id: "missing",
      label: t("Missing in source"),
      align: "end",
      cell: (r) => <span className="nx-num" data-testid="tpl-missing">{r.missing.length === 0 ? t("None") : compactInt(r.missing.length)}</span>,
    },
    { id: "status", label: t("Status"), cell: (r) => <Chip tone={STATUS[r.status].tone}>{STATUS[r.status].label()}</Chip> },
  ];

  return (
    <section className="nx-ld-step" data-testid="templates" aria-label={t("Migration templates")}>
      <div className="nx-ld-actions">
        <Button variant="primary" disabled={!next} reason={next ? undefined : t("Every sheet is ready.")} onClick={() => next && onFill(next.name)}>{t("Fill the next sheet")}</Button>
        <Button variant="secondary" icon="download" loading={guard.busy} onClick={() => void download()}>{t("Download workbook")}</Button>
        <Button variant="secondary" icon="upload" onClick={() => file.current?.click()}>{t("Upload workbook")}</Button>
        <input ref={file} type="file" accept=".xlsx,.xlsm" hidden data-testid="tpl-file" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {!tpl ? (
        <div data-testid="templates-empty">
          <EmptyState heading={t("No template for this object yet")}>{t("Download the blank workbook, or upload the workbook of the new system. Its columns decide what is filled.")}</EmptyState>
        </div>
      ) : rows.length === 0 ? (
        <div data-testid="templates-nosheets">
          <EmptyState heading={t("This workbook has no sheets Meridian can read")}>{t("Upload the workbook again, with the header row on the first line of each sheet.")}</EmptyState>
        </div>
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.name} rowLabel={(r) => r.name} caption={t("Sheets of {name}", { name: tpl.name })} onOpenRow={(r) => r.status !== "ready" && onFill(r.name)} />
      )}
    </section>
  );
}
