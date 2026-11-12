"use client";

import { useMemo } from "react";
import { formatDate } from "@/lib/format";
import { useBatches } from "@/lib/v2/approvals-queries";
import { BATCH_STATUS_LABEL, type BatchRow } from "@/lib/v2/batches";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { int, moduleFromSlug } from "@/lib/v2/score";
import { t as tr } from "@/lib/v2/i18n";
import { CleanedUpload } from "./CleanedUpload";
import { AletheiaCleaningPlan } from "./AletheiaCleaningPlan";
import { Grid, type GridColumn } from "../../Grid";
import { Dash, EmptyFrame, ErrorFrame, Mono, V2Link } from "../../parts";

/** The fix batches that hold records of this object, newest first; a row opens the batch. */
export function FixesTab({ system, module: moduleSegment }: { system: string; module: string }) {
  const run = useRunParam();
  const apiModule = moduleFromSlug(moduleSegment);
  const label = useLandscape(run).data?.objects.find((o) => o.module === apiModule)?.label ?? apiModule.replace(/_/g, " ");
  const q = useBatches();
  const { openItem, open } = useOpenItem();
  const rows = q.rows.filter((b) => b.modules.includes(apiModule));
  // The guided cycle's Upload step takes the same workbook, several files at once, and scores the result.
  const toCycle = (
    <p className="m2-sec">
      <V2Link href={`/next/o/${system}/${moduleSegment}/cycle?step=upload${run ? `&run=${encodeURIComponent(run)}` : ""}`} data-testid="fixes-to-cycle-upload">
        {tr("Upload a cleaned workbook")}
      </V2Link>
    </p>
  );
  const columns = useMemo<GridColumn<BatchRow>[]>(
    () => [
      { id: "batch", header: tr("Batch"), width: 90, pin: true, locked: true, cell: (b) => <Mono>{b.label}</Mono> },
      { id: "name", header: tr("Name"), width: 260, cell: (b) => b.name },
      { id: "status", header: tr("Status"), width: 220, cell: (b) => BATCH_STATUS_LABEL[b.status] ?? b.status },
      { id: "records", header: tr("Records"), width: 90, numeric: true, cell: (b) => int(b.records) },
      { id: "owner", header: tr("Built by"), width: 160, cell: (b) => b.owner ?? <Dash why={tr("The batch does not name who built it")} /> },
      { id: "created", header: tr("Created"), width: 150, cell: (b) => formatDate(b.createdAt, "datetime") },
      { id: "verified", header: tr("Fixed after load"), width: 130, numeric: true, cell: (b) => (b.verification ? int(b.verification.fixed) : <Dash why={tr("No run has read the records since the load")} />) },
    ],
    [],
  );

  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{tr("The fix batches could not be read.")}</ErrorFrame>;
  if (!q.isPending && rows.length === 0) {
    return (
      <>
        <CleanedUpload module={apiModule} label={label} />
        {toCycle}
        <AletheiaCleaningPlan module={apiModule} label={label} versionId={run} />
        <EmptyFrame action={<V2Link href="/work" className="m2-btn">{tr("Open Work")}</V2Link>}>
          {tr("No fix batches for {l} yet. A batch starts when a steward accepts suggested values or imports a filled fix sheet.", { l: label })}
        </EmptyFrame>
      </>
    );
  }
  return (
    <>
    <CleanedUpload module={apiModule} label={label} />
        {toCycle}
    <AletheiaCleaningPlan module={apiModule} label={label} versionId={run} />
    <section aria-label={tr("Fix batches")} className="m2-sec">
      <div className="m2-sechead">
        <h2 className="m2-h2">{tr("Fix batches")}</h2>
        <span className="m2-sub">{tr("{n} {n, plural, one {batch} other {batches}} with {label} records", { n: rows.length, label })}</span>
      </div>
      <Grid<BatchRow>
        id="object-fixes"
        ariaLabel={tr("Fix batches of {label}", { label })}
        columns={columns}
        rows={rows}
        rowId={(b) => b.id}
        hideBar
        fixedColumns
        loading={q.isPending}
        height={32 + Math.max(rows.length, 1) * 32 + 2}
        initialViewport={Math.max(rows.length, 8)}
        openRowId={open?.kind === "batch" ? open.id : null}
        onOpen={(b) => openItem({ kind: "batch", id: b.id })}
      />
    </section>
    </>
  );
}
