"use client";

import Link from "next/link";
import { useBatches } from "@/lib/v2/approvals-queries";
import { BATCH_STATUS_LABEL, type BatchRow } from "@/lib/v2/batches";
import { formatDate } from "@/lib/format";
import { useOpenItem, useV2Href } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { DataTable, type Column } from "@/design/next/kit";
import { ExportTable } from "@/design/next/more/ExportTable";
import type { ObjectRun } from "../useObjectRun";
import { CleaningPlan } from "./CleaningPlan";
import { Dash } from "./tabs-g-parts";
import "./tabs-f.css";

/** Fixes for one object: the way to upload a cleaned workbook, the cleaning plan, then every fix batch that holds its records. */
export function FixesTab({ o }: { o: ObjectRun }) {
  return (
    <div className="nx-tf" data-testid="fixes-tab">
      <p className="nx-tf-tools">
        <Link className="nx-btn nx-btn-secondary" data-testid="fixes-to-cycle-upload" href={o.hrefWith(`/next/o/${o.systemSeg}/${o.moduleSeg}/cycle`, { step: "upload" })}>
          {t("Upload a cleaned workbook")}
        </Link>
      </p>
      <CleaningPlan module={o.module} label={o.label} versionId={o.runId} />
      <Batches o={o} />
    </div>
  );
}

function Batches({ o }: { o: ObjectRun }) {
  const q = useBatches();
  const { openItem } = useOpenItem();
  const href = useV2Href();
  const rows = q.rows.filter((b) => b.modules.includes(o.module));
  const cols: Column<BatchRow>[] = [
    { id: "label", label: t("Batch"), cell: (b) => <span className="nx-mono">{b.label}</span> },
    { id: "name", label: t("Name"), cell: (b) => b.name },
    { id: "status", label: t("Status"), cell: (b) => BATCH_STATUS_LABEL[b.status] ?? b.status },
    { id: "records", label: t("Records"), cell: (b) => int(b.records), align: "end", compare: (a, b) => a.records - b.records },
    { id: "owner", label: t("Built by"), cell: (b) => b.owner ?? <Dash why={t("Not recorded")} /> },
    { id: "created", label: t("Created"), cell: (b) => formatDate(b.createdAt, "datetime"), compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
    { id: "fixed", label: t("Fixed after load"), cell: (b) => (b.verification ? int(b.verification.fixed) : <Dash why={t("No run since the load")} />), align: "end" },
  ];
  return (
    <section className="nx-card nx-tf-sec" aria-label={t("Fix batches")}>
      <div className="nx-tf-head">
        <h2 className="nx-sec-h">{t("Fix batches")}</h2>
        <span className="nx-tf-sub">{t("Batches that hold {label} records", { label: o.label })}</span>
      </div>
      <ExportTable>
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={(b) => b.id}
          rowLabel={(b) => b.label}
          caption={t("Fix batches for {label}", { label: o.label })}
          loading={q.isLoading}
          error={q.isError ? { sentence: t("The fix batches could not be read."), onRetry: () => void q.refetch() } : undefined}
          empty={{
            heading: t("No fix batches yet"),
            text: t("No fix batches for {label} yet. A batch starts when a steward accepts suggested values or imports a filled fix sheet.", { label: o.label }),
            action: (
              <Link className="nx-link" href={href("/work")}>
                {t("Open Work")}
              </Link>
            ),
          }}
          onOpenRow={(b) => openItem({ kind: "batch", id: b.id })}
        />
      </ExportTable>
    </section>
  );
}
