// frontend/design/templates/FindingDrawer.tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { Drawer } from "../primitives/Drawer";
import { Button } from "../primitives/Button";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { Skeleton } from "../primitives/Skeleton";
import { Mono } from "../primitives/Mono";
import { SeverityDot } from "../primitives/SeverityDot";
import { Pill, type PillTone } from "../primitives/Pill";
import { ExportMenu } from "../primitives/ExportMenu";
import { isSeverity, type Severity } from "../tokens";
import { buildDrillHref } from "../shell/DrillLink";
import { exportFindingRecords, getFinding } from "@/lib/api/findings";
import { createBatch } from "@/lib/api/remediation";
import { useRole } from "@/hooks/use-role";
import { getFindingImpact } from "@/lib/api/analytics";
import { getConfigRootCause, type RootCauseType } from "@/lib/api/config-intelligence";
import { queryKeys } from "@/lib/query-keys";
import { apiErrorMessage } from "@/lib/error";
import { labelOf, checkClassLabel, AUTHORITY_SENTENCE, formatModuleName } from "@/lib/format";

const heading = "m-text-body font-semibold";
// Pill has no high tone: high shares the at-risk fill with medium.
const SEVERITY_PILL: Record<Severity, PillTone> = { critical: "no-go", high: "at-risk", medium: "at-risk", low: "neutral", pass: "go" };
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
  if (batchId) return <Button render={<Link href={`/fix/${batchId}`}>Open fix batch</Link>} />;
  return <Button onClick={() => create.mutate()} pending={create.isPending}>Auto clean this rule</Button>;
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
        <ErrorState message={apiErrorMessage(findingQuery.error)} onRetry={() => findingQuery.refetch()} />
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
                  {isSeverity(finding.severity) && <Pill tone={SEVERITY_PILL[finding.severity]} variant="solid">{labelOf(finding.severity)}</Pill>}
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
                        {bucket.category}: {bucket.finding_count.toLocaleString()} finding{bucket.finding_count === 1 ? "" : "s"},{" "}
                        {bucket.annual_risk_zar.toLocaleString()} at risk per year ({bucket.calculation_method}).
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
                  <ul className="flex flex-col gap-1 m-text-body">
                    {failingSamples.slice(0, 10).map((row, i) => (
                      <li key={i}><Mono>{JSON.stringify(row)}</Mono></li>
                    ))}
                  </ul>
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
