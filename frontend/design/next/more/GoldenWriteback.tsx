"use client";

import { useMemo, useState } from "react";
import { formatDate, labelOf } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { useGoldenRecords } from "@/lib/v2/mdm-queries";
import type { MasterRecordSummary } from "@/types/api";
import { FieldHistory, SendToSap } from "@/design/v2/inspector/golden-writeback";
import { LegacyScope } from "../shell/LegacyMount";
import { Button, Chip, DataTable, SegmentedControl, SidePanel, type Column } from "../kit";
import { QueryView } from "./states";
import { useSheets } from "../shell/SheetHost";

type Row = MasterRecordSummary & { name?: string };

/** The licensed objects that carry golden records. */
const MODULES = ["material_master", "customer_master", "vendor_master"] as const;
type Module = (typeof MODULES)[number];
const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = { golden: "good", pending_review: "warn", candidate: "neutral", superseded: "neutral" };

/**
 * Golden records on their way back to SAP (api/routes/golden_writeback.py over api/routes/master_records.py). The list
 * picks a record; the side panel reuses the inspector's SendToSap and FieldHistory, so the preview diff, the SAP check
 * (dry run), the four-eyes approval and the request history behave, and are guarded, exactly as they are elsewhere.
 */
export function GoldenWriteback() {
  const sheets = useSheets();
  const [module, setModule] = useState<Module>("material_master");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Row | null>(null);
  const q = useGoldenRecords(module, page);
  const rows = useMemo(() => (q.data?.records ?? []) as Row[], [q.data]);
  const total = q.data?.total ?? 0;
  const per = q.data?.per_page ?? 25;
  const last = Math.max(1, Math.ceil(total / per));

  const columns: Column<Row>[] = [
    {
      id: "key", label: t("Golden record"),
      cell: (r) => (
        <span className="nx-cell-stack">
          <span className="nx-mono">{r.sap_object_key}</span>
          <span className="nx-sub">{r.name || t("Open the record for its name")}</span>
        </span>
      ),
    },
    { id: "status", label: t("Status"), cell: (r) => <Chip tone={STATUS_TONE[r.status] ?? "neutral"}>{labelOf(r.status)}</Chip> },
    { id: "sources", label: t("Sources"), align: "end", cell: (r) => int(r.source_count) },
    { id: "confidence", label: t("Confidence"), align: "end", cell: (r) => `${Math.round((r.overall_confidence ?? 0) * 100)}%` },
    { id: "issues", label: t("Open conflicts"), align: "end", cell: (r) => int(r.pending_issues) },
    { id: "updated", label: t("Last merged"), cell: (r) => formatDate(r.updated_at, "date") },
  ];

  return (
    <div className="nx-body" data-testid="golden-writeback-page">
      <p className="nx-sub">{t("Open a golden record to preview what changes in SAP, check it with SAP without saving, and send it for a second person to approve.")}</p>
      <Button variant="secondary" onClick={() => sheets.open({ kind: "dedup", id: "" })}>{t("Duplicate records to merge")}</Button>
      <SegmentedControl<Module>
        label={t("Object")}
        items={MODULES.map((m) => ({ value: m, label: labelOf(m) }))}
        value={module}
        onChange={(m) => { setModule(m); setPage(1); }}
      />
      <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={rows.length === 0} emptyHeading={t("No golden records for this object yet")} emptyText={t("Golden records appear once matching has merged duplicates for this object.")} label={t("Loading golden records")}>
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowLabel={(r) => r.sap_object_key} caption={t("Golden records")} total={total} onOpenRow={setOpen} />
        <div className="nx-row nx-wrap">
          <Button variant="secondary" size={32} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("Previous")}</Button>
          <span className="nx-sub">{t("Page {page} of {last}", { page: int(page), last: int(last) })}</span>
          <Button variant="secondary" size={32} disabled={page >= last} onClick={() => setPage((p) => p + 1)}>{t("Next")}</Button>
        </div>
      </QueryView>
      <SidePanel open={open !== null} onClose={() => setOpen(null)} title={open ? open.sap_object_key : t("Golden record")}>
        {open ? (
          <LegacyScope>
            <SendToSap id={open.id} status={open.status} />
            <FieldHistory id={open.id} />
          </LegacyScope>
        ) : null}
      </SidePanel>
    </div>
  );
}
