// frontend/design/templates/FindingDrawer.tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "../shell/Toaster";
import Link from "next/link";
import { Drawer } from "../primitives/Drawer";
import { Button } from "../primitives/Button";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { Skeleton } from "../primitives/Skeleton";
import { Mono } from "../primitives/Mono";
import { SeverityDot } from "../primitives/SeverityDot";
import { Pill } from "../primitives/Pill";
import { Status } from "../primitives/Status";
import { ExportMenu } from "../primitives/ExportMenu";
import { DataTable } from "../table/DataTable";
import { isSeverity } from "../tokens";
import { buildDrillHref } from "../shell/DrillLink";
import { exportFindingRecords, getFinding } from "@/lib/api/findings";
import { createBatch } from "@/lib/api/remediation";
import { createException } from "@/lib/api/exceptions";
import { useRole } from "@/hooks/use-role";
import { getFindingImpact } from "@/lib/api/analytics";
import { getCostModel } from "@/lib/api/settings";
import { getConfigRootCause, type RootCauseType } from "@/lib/api/config-intelligence";
import { queryKeys } from "@/lib/query-keys";
import { apiErrorState } from "@/lib/error";
import { checkClassLabel, AUTHORITY_SENTENCE, formatModuleName, formatMoney, labelOf } from "@/lib/format";

const heading = "m-text-body font-semibold";
// Pill has no high tone: high shares the at-risk fill with medium.
const dim = { color: "var(--m-ink-3)" } as const;

/** getFinding (lib/api/findings.ts) throws a plain Error rather than a 404 when the id doesn't match any finding in scope. */
function isFindingNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === "Finding not found";
}

const ROOT_CAUSE_LABEL: Record<RootCauseType, string> = {
  bad_data: "Bad data",
  bad_config: "Bad configuration",
  bad_data_and_config: "Bad data and bad configuration",
  process_gap: "Process gap",
};

/** Where the problem sits, from the config-intelligence run of this finding's version. Renders nothing when the finding has no root-cause analysis. */
function RootCauseSection({ checkId, versionId }: { checkId: string; versionId: string }) {
  const q = useQuery({
    queryKey: queryKeys.findingRootCause(checkId, versionId),
    queryFn: () => getConfigRootCause(checkId, versionId),
    retry: false,
  });
  if (q.isLoading) return <section className="flex flex-col gap-2"><Skeleton height={48} /></section>;
  if (!q.data) return null;
  const issues: [string, string | null][] = [["Data", q.data.data_issue], ["Configuration", q.data.config_issue], ["Process", q.data.process_issue]];
  return (
    <section className="flex flex-col gap-2" data-testid="root-cause">
      <h3 className={heading} style={{ color: "var(--m-ink)" }}>Root cause</h3>
      <div className="flex items-center gap-2 m-text-body">
        <Pill tone={q.data.root_cause_type === "bad_data" ? "neutral" : "at-risk"}>{ROOT_CAUSE_LABEL[q.data.root_cause_type]}</Pill>
      </div>
      <ul className="flex flex-col gap-1 m-text-body">
        {issues.filter(([, text]) => text).map(([label, text]) => <li key={label}><span style={dim}>{label}: </span>{text}</li>)}
      </ul>
      {q.data.recommendation ? <p className="m-text-body">{q.data.recommendation}</p> : null}
    </section>
  );
}

type SampleRow = { id: string; sample: number; field: string; value: string };

/** One row per field of each sample record: the record number, the SAP field and its value. */
function sampleRows(samples: Record<string, unknown>[]): SampleRow[] {
  return samples.slice(0, 10).flatMap((row, i) =>
    Object.entries(row).map(([field, value]) => ({ id: `${i}:${field}`, sample: i + 1, field, value: value == null ? "" : String(value) })),
  );
}

const SAMPLE_COLUMNS: ColumnDef<SampleRow>[] = [
  { id: "sample", header: "Record", accessorFn: (r) => r.sample, meta: { numeric: true } },
  { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
  { id: "value", header: "Value", cell: ({ row }) => (row.original.value ? <Mono>{row.original.value}</Mono> : <span style={dim}>blank</span>) },
];

export interface FindingDrawerProps {
  /** null closes the drawer. */
  findingId: string | null;
  /** Narrows the finding lookup to one run; omit to search every run. */
  versionId?: string | null;
  onClose: () => void;
}

/** One finding, in full: what failed, how many, why, impact, samples, fix. */
/** One click from a finding to its fix batch: every failing record of this rule, in this run, queued for cleaning. */
function AutoCleanButton({ checkId, module, versionId }: { checkId: string; module: string; versionId: string }) {
  const { can } = useRole();
  const [batchId, setBatchId] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createBatch(`${checkId} ${module}`, { check_id: checkId, module, version_id: versionId }),
    onSuccess: (b) => { setBatchId(b.id); toast.success(`Fix batch created with ${b.item_count.toLocaleString()} ${b.item_count === 1 ? "item" : "items"}`); },
    onError: () => toast.error("Could not create the fix batch"),
  });
  if (!can("apply")) return null;
  if (batchId) return <Button render={<Link href={`/fix?tab=batches&batch=${batchId}`}>Open fix batch</Link>} />;
  return <Button onClick={() => create.mutate()} pending={create.isPending}>Create fix batch</Button>;
}

/** Track this finding as an exception: an owner, a status, an SLA and a comment thread in the inbox. */
function RaiseExceptionButton({ finding }: { finding: { id: string; check_id: string; module: string; severity: string; version_id: string; affected_count: number; details: { message?: string | null } } }) {
  const { can } = useRole();
  const [raised, setRaised] = useState<string | null>(null);
  const raise = useMutation({
    mutationFn: () => createException({
      type: "dq_rule",
      category: finding.module,
      severity: isSeverity(finding.severity) ? finding.severity : "medium",
      title: `${finding.check_id} fails on ${finding.affected_count.toLocaleString()} ${finding.affected_count === 1 ? "record" : "records"}`,
      description: finding.details.message ?? `Raised from rule ${finding.check_id}.`,
      linked_finding_id: finding.id,
      source_reference: `${finding.version_id}:${finding.check_id}`,
    }),
    onSuccess: (r) => { setRaised(r.id); toast.success("Exception raised. It now has an owner, an SLA and a thread in the inbox"); },
    onError: () => toast.error("Could not raise the exception"),
  });
  if (!can("analyse")) return null;
  if (raised) return <Button variant="secondary" render={<Link href={`/inbox?kind=exception&focus=${raised}`}>Open exception</Link>} />;
  return <Button variant="secondary" onClick={() => raise.mutate()} pending={raise.isPending}>Raise exception</Button>;
}

export function FindingDrawer({ findingId, versionId, onClose }: FindingDrawerProps) {
  const findingQuery = useQuery({
    queryKey: queryKeys.finding(findingId ?? "", versionId),
    queryFn: () => getFinding(findingId as string, versionId),
    enabled: findingId !== null,
    retry: false,
  });
  const impactQuery = useQuery({
    queryKey: queryKeys.findingImpact(findingId ?? ""),
    queryFn: () => getFindingImpact(findingId as string),
    enabled: findingId !== null,
    retry: false,
  });
  // Amounts print in the tenant's currency code (the cost model); without it the number stands alone.
  const costModel = useQuery({ queryKey: ["cost-model"], queryFn: getCostModel, enabled: findingId !== null, retry: false, meta: { ignoreError: true }, staleTime: 300_000 });
  const currency = costModel.data?.currency;

  return (
    <Drawer open={findingId !== null} onOpenChange={(open) => { if (!open) onClose(); }} title="Finding" subtitle={findingQuery.data ? <Mono>{findingQuery.data.check_id}</Mono> : undefined}>
      {findingId === null ? null : findingQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton height={24} />
          <Skeleton height={120} />
        </div>
      ) : isFindingNotFound(findingQuery.error) || !findingQuery.data ? (
        <EmptyState title="Finding not found." detail="It may belong to a run that has since been deleted." />
      ) : findingQuery.isError ? (
        <ErrorState {...apiErrorState(findingQuery.error)} onRetry={() => findingQuery.refetch()} />
      ) : (
        (() => {
          const finding = findingQuery.data;
          const isAnomaly = finding.finding_type === "anomaly";
          const failingSamples = finding.details.sample_failing_records ?? [];
          const invalidValues = Object.entries(finding.details.distinct_invalid_values ?? {});
          const anomalySamples = finding.details.samples?.bad ?? [];
          const valueFixes = Object.values(finding.value_fix_map ?? {});
          const recordFixes = finding.record_fixes ?? [];

          return (
            <div className="flex flex-col gap-6">
              <section className="flex flex-col gap-2">
                <h3 className={heading} style={{ color: "var(--m-ink)" }}>What failed</h3>
                <div className="flex items-center gap-2 m-text-body">
                  {isSeverity(finding.severity) && <SeverityDot severity={finding.severity} />}
                  {isSeverity(finding.severity) && <Status kind="severity" value={finding.severity} variant="solid" />}
                  <Mono>{finding.check_id}</Mono>
                  <span style={dim}>{formatModuleName(finding.module)}</span>
                </div>
                <p className="m-text-body">
                  {finding.details.message ?? (isAnomaly ? "An unexpected change was detected in this data." : "No message recorded for this check.")}
                </p>
                {finding.check_class && (
                  <p className="m-text-body" style={dim}>{checkClassLabel(finding.check_class)}</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className={heading} style={{ color: "var(--m-ink)" }}>How many</h3>
                <p className="m-text-body">
                  {finding.affected_count.toLocaleString()} of {finding.total_count.toLocaleString()} record
                  {finding.total_count === 1 ? "" : "s"} affected
                  {finding.pass_rate != null ? ` (${(finding.pass_rate * (finding.pass_rate <= 1 ? 100 : 1)).toFixed(1)} % passing).` : "."}
                </p>
              </section>

              <section className="flex flex-col gap-2">
                <h3 className={heading} style={{ color: "var(--m-ink)" }}>Why</h3>
                {finding.rule_context ? (
                  <div className="flex flex-col gap-1 m-text-body">
                    <p>{finding.rule_context.why_it_matters}</p>
                    <p style={dim}>{AUTHORITY_SENTENCE[finding.rule_context.rule_authority] ?? ""}</p>
                    <p>{finding.rule_context.sap_impact}</p>
                  </div>
                ) : (
                  <p className="m-text-body" style={dim}>No rule context recorded for this check.</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className={heading} style={{ color: "var(--m-ink)" }}>Impact</h3>
                {impactQuery.isLoading ? (
                  <Skeleton height={48} />
                ) : impactQuery.data && impactQuery.data.impacts.length > 0 ? (
                  <ul className="flex flex-col gap-1 m-text-body">
                    {impactQuery.data.impacts.map((bucket) => (
                      <li key={bucket.category}>
                        {labelOf(bucket.category)} puts {formatMoney(bucket.annual_risk_zar, currency)} a year at risk across {bucket.finding_count.toLocaleString()} finding{bucket.finding_count === 1 ? "" : "s"}.
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-text-body" style={dim}>No impact model for this check.</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className={heading} style={{ color: "var(--m-ink)" }}>Samples</h3>
                {isAnomaly && anomalySamples.length > 0 ? (
                  <ul className="flex flex-col gap-1 m-text-body">
                    {anomalySamples.slice(0, 10).map((s) => (
                      <li key={s.record_key}><Mono>{s.record_key}</Mono>{s.value != null ? ` — ${s.value}` : ""}</li>
                    ))}
                  </ul>
                ) : invalidValues.length > 0 ? (
                  <ul className="flex flex-col gap-1 m-text-body">
                    {invalidValues.slice(0, 10).map(([value, count]) => (
                      <li key={value}><Mono>{value || "(blank)"}</Mono> — {count.toLocaleString()} record{count === 1 ? "" : "s"}</li>
                    ))}
                  </ul>
                ) : failingSamples.length > 0 ? (
                  <DataTable
                    columns={SAMPLE_COLUMNS}
                    data={sampleRows(failingSamples)}
                    getRowId={(r) => r.id}
                    hideToolbar
                    hideSearch
                    height="auto"
                  />
                ) : (
                  <p className="m-text-body" style={dim}>No sample records stored for this finding.</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className={heading} style={{ color: "var(--m-ink)" }}>Fix</h3>
                {finding.remediation_text && <p className="m-text-body">{finding.remediation_text}</p>}
                {valueFixes.length > 0 ? (
                  <ul className="flex flex-col gap-1 m-text-body">
                    {valueFixes.slice(0, 10).map((fix) => (
                      <li key={fix.invalid_value}>
                        <Mono>{fix.invalid_value}</Mono> — {fix.fix_instruction}
                        {fix.suggested_value ? ` (suggested: ${fix.suggested_value})` : ""}
                      </li>
                    ))}
                  </ul>
                ) : recordFixes.length > 0 ? (
                  <ul className="flex flex-col gap-1 m-text-body">
                    {recordFixes.slice(0, 10).map((fix) => (
                      <li key={fix.record_id}>
                        <Mono>{fix.record_id}</Mono> — {fix.fix_instruction}
                      </li>
                    ))}
                  </ul>
                ) : !finding.remediation_text ? (
                  <p className="m-text-body" style={dim}>No fix guidance for this check yet.</p>
                ) : null}
              </section>

              <RootCauseSection checkId={finding.check_id} versionId={finding.version_id} />

              <div className="flex flex-wrap gap-2 pt-2 border-t" style={{ borderColor: "var(--m-line)" }}>
                <AutoCleanButton checkId={finding.check_id} module={finding.module} versionId={finding.version_id} />
                <RaiseExceptionButton finding={finding} />
                <Button
                  variant="secondary"
                  render={<Link href={buildDrillHref({ object: finding.module, ruleId: finding.check_id, run: finding.version_id })}>Open records</Link>}
                />
                <Button
                  variant="secondary"
                  render={<Link href={`/rules/${encodeURIComponent(finding.check_id)}`}>Open rule</Link>}
                />
                <ExportMenu options={[{ format: "xlsx", label: "Download list for manual clean (Excel)", run: () => exportFindingRecords(finding.version_id, finding.check_id, "xlsx") }]} />
              </div>
            </div>
          );
        })()
      )}
    </Drawer>
  );
}
