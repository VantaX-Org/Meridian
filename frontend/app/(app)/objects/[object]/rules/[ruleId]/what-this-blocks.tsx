"use client";

/** What a failing rule puts at risk: the cost buckets of GET /analytics/impact/{finding_id}, priced from the tenant's cost model. */

import { useQuery } from "@tanstack/react-query";
import { Card, Skeleton } from "@/design";
import { getFindingImpact } from "@/lib/api/analytics";
import { getFindings } from "@/lib/api/findings";
import { formatMoney, labelOf } from "@/lib/format";

export function WhatThisBlocks({ run, object, checkId }: { run: string; object: string; checkId: string }) {
  // The impact is keyed by the finding's id; the run's finding of this rule is found by its check id.
  const finding = useQuery({
    queryKey: ["findings", "of-rule", run, object, checkId],
    queryFn: async () => (await getFindings({ version_id: run, module: object, check_id: checkId, limit: 1 })).findings[0]?.id ?? null,
    enabled: !!run,
    retry: false,
    meta: { ignoreError: true },
  });
  const findingId = finding.data ?? null;
  const impact = useQuery({
    queryKey: ["analytics", "impact", findingId],
    queryFn: () => getFindingImpact(findingId as string),
    enabled: findingId !== null,
    retry: false,
    meta: { ignoreError: true },
  });
  if (finding.isLoading || (findingId !== null && impact.isLoading)) return <Skeleton height={96} />;
  if (finding.isError || impact.isError || findingId === null) return null; // the failing records stand without it
  const priced = (impact.data?.impacts ?? []).filter((b) => b.annual_risk > 0).sort((a, b) => b.annual_risk - a.annual_risk);
  return (
    <Card title="What this blocks" meta="Yearly cost this rule puts at risk while it fails, priced from your cost model" padding="sm">
      {priced.length === 0 ? (
        <p className="m-text-body m-ink-2">No cost is attached to this rule. It is not priced by your cost model.</p>
      ) : (
        <table className="m-table" aria-label="Cost at risk by category">
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col" className="text-right">At risk a year</th>
              <th scope="col" className="text-right">Avoided by fixing</th>
            </tr>
          </thead>
          <tbody>
            {priced.map((b) => (
              <tr key={b.category}>
                <th scope="row" className="font-normal" title={b.calculation_method}>{labelOf(b.category)}</th>
                <td className="text-right m-numeric">{formatMoney(b.annual_risk, b.currency)}</td>
                <td className="text-right m-numeric">{formatMoney(b.mitigated, b.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
