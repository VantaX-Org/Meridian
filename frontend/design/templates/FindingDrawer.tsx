// frontend/design/templates/FindingDrawer.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Drawer } from "../primitives/Drawer";
import { Button } from "../primitives/Button";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { Skeleton } from "../primitives/Skeleton";
import { Mono } from "../primitives/Mono";
import { SeverityDot } from "../primitives/SeverityDot";
import { isSeverity } from "../tokens";
import { buildDrillHref } from "../shell/DrillLink";
import { getFinding } from "@/lib/api/findings";
import { getFindingImpact } from "@/lib/api/analytics";
import { queryKeys } from "@/lib/query-keys";
import { apiErrorMessage } from "@/lib/error";
import { checkClassLabel, AUTHORITY_SENTENCE, formatModuleName } from "@/lib/format";

const heading = "text-[13px] font-semibold";
const dim = { color: "var(--m-ink-3)" } as const;

export interface FindingDrawerProps {
  /** null closes the drawer. */
  findingId: string | null;
  /** Narrows the finding lookup to one run; omit to search every run. */
  versionId?: string | null;
  onClose: () => void;
}

/** One finding, in full: what failed, how many, why, impact, samples, fix. */
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
    <Drawer open={findingId !== null} onOpenChange={(open) => { if (!open) onClose(); }} title="Finding">
      {findingId === null ? null : findingQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton height={24} />
          <Skeleton height={120} />
        </div>
      ) : findingQuery.isError ? (
        <ErrorState message={apiErrorMessage(findingQuery.error)} onRetry={() => findingQuery.refetch()} />
      ) : !findingQuery.data ? (
        <EmptyState title="Finding not found." detail="It may belong to a run that has since been deleted." />
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
                <div className="flex items-center gap-2 text-[13px]">
                  {isSeverity(finding.severity) && <SeverityDot severity={finding.severity} />}
                  <Mono>{finding.check_id}</Mono>
                  <span style={dim}>{formatModuleName(finding.module)}</span>
                </div>
                <p className="text-[13px]">
                  {finding.details.message ?? (isAnomaly ? "An unexpected change was detected in this data." : "No message recorded for this check.")}
                </p>
                {finding.check_class && (
                  <p className="text-[13px]" style={dim}>{checkClassLabel(finding.check_class)}</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className={heading} style={{ color: "var(--m-ink)" }}>How many</h3>
                <p className="text-[13px]">
                  {finding.affected_count.toLocaleString()} of {finding.total_count.toLocaleString()} record
                  {finding.total_count === 1 ? "" : "s"} affected
                  {finding.pass_rate != null ? ` (${(finding.pass_rate * (finding.pass_rate <= 1 ? 100 : 1)).toFixed(1)} % passing).` : "."}
                </p>
              </section>

              <section className="flex flex-col gap-2">
                <h3 className={heading} style={{ color: "var(--m-ink)" }}>Why</h3>
                {finding.rule_context ? (
                  <div className="flex flex-col gap-1 text-[13px]">
                    <p>{finding.rule_context.why_it_matters}</p>
                    <p style={dim}>{AUTHORITY_SENTENCE[finding.rule_context.rule_authority] ?? ""}</p>
                    <p>{finding.rule_context.sap_impact}</p>
                  </div>
                ) : (
                  <p className="text-[13px]" style={dim}>No rule context recorded for this check.</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className={heading} style={{ color: "var(--m-ink)" }}>Impact</h3>
                {impactQuery.isLoading ? (
                  <Skeleton height={48} />
                ) : impactQuery.data && impactQuery.data.impacts.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {impactQuery.data.impacts.map((bucket) => (
                      <li key={bucket.category}>
                        {bucket.category}: {bucket.finding_count.toLocaleString()} finding{bucket.finding_count === 1 ? "" : "s"},{" "}
                        {bucket.annual_risk_zar.toLocaleString()} at risk per year ({bucket.calculation_method}).
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px]" style={dim}>No impact model for this check.</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className={heading} style={{ color: "var(--m-ink)" }}>Samples</h3>
                {isAnomaly && anomalySamples.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {anomalySamples.slice(0, 10).map((s) => (
                      <li key={s.record_key}><Mono>{s.record_key}</Mono>{s.value != null ? ` — ${s.value}` : ""}</li>
                    ))}
                  </ul>
                ) : invalidValues.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {invalidValues.slice(0, 10).map(([value, count]) => (
                      <li key={value}><Mono>{value || "(blank)"}</Mono> — {count.toLocaleString()} record{count === 1 ? "" : "s"}</li>
                    ))}
                  </ul>
                ) : failingSamples.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {failingSamples.slice(0, 10).map((row, i) => (
                      <li key={i}><Mono>{JSON.stringify(row)}</Mono></li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px]" style={dim}>No sample records stored for this finding.</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className={heading} style={{ color: "var(--m-ink)" }}>Fix</h3>
                {finding.remediation_text && <p className="text-[13px]">{finding.remediation_text}</p>}
                {valueFixes.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {valueFixes.slice(0, 10).map((fix) => (
                      <li key={fix.invalid_value}>
                        <Mono>{fix.invalid_value}</Mono> — {fix.fix_instruction}
                        {fix.suggested_value ? ` (suggested: ${fix.suggested_value})` : ""}
                      </li>
                    ))}
                  </ul>
                ) : recordFixes.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {recordFixes.slice(0, 10).map((fix) => (
                      <li key={fix.record_id}>
                        <Mono>{fix.record_id}</Mono> — {fix.fix_instruction}
                      </li>
                    ))}
                  </ul>
                ) : !finding.remediation_text ? (
                  <p className="text-[13px]" style={dim}>No fix guidance for this check yet.</p>
                ) : null}
              </section>

              <div className="flex gap-2 pt-2 border-t" style={{ borderColor: "var(--m-line)" }}>
                <Button
                  variant="secondary"
                  render={<Link href={buildDrillHref({ object: finding.module, ruleId: finding.check_id, run: finding.version_id })}>Open records</Link>}
                />
                <Button
                  variant="secondary"
                  render={<Link href={`/rules/${encodeURIComponent(finding.check_id)}`}>Open rule</Link>}
                />
              </div>
            </div>
          );
        })()
      )}
    </Drawer>
  );
}
