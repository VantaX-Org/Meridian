"use client";

import { useQuery } from "@tanstack/react-query";
import { Code, DataTable, EmptyState, ErrorState, NxLink, Skeleton, type Column } from "@/design/next/kit";
import type { WorkRecordDetail } from "@/lib/api/work";
import { getDuplicateCluster } from "@/lib/api/v2/insights";
import { getRecordFindings, getRecordSheet, type RecordFindings } from "@/lib/api/v2/object-records";
import { labelOf } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { describeField, sapField } from "@/lib/v2/sap-fields";
import { f1 } from "@/lib/v2/score";
import { Dash } from "./tabs/tabs-g-parts";

const status = (e: unknown) => {
  const x = e as { status?: number; response?: { status?: number } } | null;
  return x?.response?.status ?? x?.status;
};

type Edge = { source: string; target: string; label: string };

/** Open duplicate candidates, the golden record and its match cluster for one record. */
export function RecordDuplicates({ module, detail }: { module: string; detail: WorkRecordDetail }) {
  const dup = detail.duplicates;
  const golden = detail.golden_record;
  return (
    <div data-testid="record-duplicates">
      {dup && dup.open > 0 ? <p><NxLink className="nx-link" href={dup.href}>{t("Possible duplicate")} ({dup.open})</NxLink></p> : null}
      {golden ? <p><NxLink className="nx-link" href={golden.href}>{t("Golden record")}</NxLink></p> : null}
      {!(dup && dup.open > 0) && !golden ? <p className="nx-muted">{t("No golden record is named.")}</p> : null}
      {golden?.id ? <Cluster module={module} recordId={golden.id} /> : null}
    </div>
  );
}

function Cluster({ module, recordId }: { module: string; recordId: string }) {
  const q = useQuery({ queryKey: ["duplicates", module, recordId], queryFn: () => getDuplicateCluster(module, recordId), retry: false });
  if (q.isError && status(q.error) === 404) return null;
  const title = t("Duplicate cluster");
  const columns: Column<Edge>[] = [
    { id: "source", label: t("Record"), cell: (e) => <span className="nx-mono">{e.source}</span> },
    { id: "target", label: t("Matches"), cell: (e) => <span className="nx-mono">{e.target}</span> },
    { id: "score", label: t("Match score"), align: "end", cell: (e) => e.label || <Dash /> },
  ];
  return (
    <section aria-label={title} data-testid="record-cluster">
      <p className="nx-muted">{t("Records that match this one and how closely")}</p>
      {q.isPending ? <Skeleton lines={3} label={title} /> : q.isError ? (
        <ErrorState fallback={t("The record could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.edges.length === 0 ? (
        <p className="nx-muted">{t("No matching pair is recorded for this record.")}</p>
      ) : (
        <>
          <p className="nx-muted">{t("Merged automatically from {auto}, reviewed from {floor}", { auto: f1(q.data.thresholds.auto_merge), floor: f1(q.data.thresholds.review_floor) })}</p>
          <DataTable rows={q.data.edges} columns={columns} rowKey={(e) => `${e.source}|${e.target}`} rowLabel={(e) => e.source} caption={title} />
        </>
      )}
    </section>
  );
}

type Failing = RecordFindings["failing"][number];

/** A record the work queue has no row for (it passes every rule): read it straight from the run's data. */
export function RecordSheetFallback({ module, recordKey, notFound }: { module: string; recordKey: string; notFound: string }) {
  const sheet = useQuery({ queryKey: ["record-sheet", module, recordKey], queryFn: () => getRecordSheet(module, recordKey), retry: false });
  const found = useQuery({ queryKey: ["record-findings", module, recordKey], queryFn: () => getRecordFindings(module, recordKey), retry: false });
  if (sheet.isPending) return <Skeleton lines={6} label={t("Reading the record")} />;
  if (sheet.isError || !sheet.data) {
    return <div data-testid="record-not-found"><EmptyState heading={t("Record not found")}>{notFound}</EmptyState></div>;
  }
  const rows = Object.entries(sheet.data.mara).filter(([, v]) => v !== null && v !== "");
  const failing = found.data?.failing ?? [];
  const columns: Column<Failing>[] = [
    { id: "rule", label: t("Rule"), cell: (f) => <><span className="nx-mono">{f.check_id}</span> {f.message ?? ""}</> },
    { id: "severity", label: t("Severity"), cell: (f) => labelOf(f.severity) },
    { id: "field", label: t("Field"), cell: (f) => (f.field ? <span className="nx-mono">{f.field}</span> : <Dash />) },
  ];
  return (
    <div data-testid="record-sheet">
      <h3 className="nx-rn-h3">{t("Record fields")}</h3>
      {sheet.data.description ? <p className="nx-muted">{sheet.data.description}</p> : null}
      {rows.length === 0 ? <p className="nx-muted">{t("The run holds no values for this record.")}</p> : (
        <dl className="nx-paired-row">
          {rows.map(([field, value]) => (
            <div key={field}><dt><Code code={sapField(field)} text={describeField(field) ?? undefined} /></dt><dd>{value}</dd></div>
          ))}
        </dl>
      )}
      <h3 className="nx-rn-h3">{t("Rules this record fails")}</h3>
      {found.isError ? (
        <ErrorState fallback={t("The record could not be read.")} error={found.error} onRetry={() => void found.refetch()} />
      ) : (
        <DataTable rows={failing} columns={columns} rowKey={(f) => f.check_id} rowLabel={(f) => f.check_id} caption={t("Rules this record fails")} loading={found.isPending} empty={{ heading: t("No rule fails this record in this run.") }} />
      )}
    </div>
  );
}
