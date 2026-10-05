"use client";

/**
 * SAP features the latest version's findings block or degrade, with the
 * transactions they stop and the records behind them. A row opens a drawer
 * (?feature=) listing the blocking findings, each linking to Finding detail.
 */

import Link from "next/link";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  DataTable, DetailDrawer, EmptyState, Mono, SectionCard, StatusBadge, useDrawerParam,
  type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { useFindingHref } from "@/components/process/shared";
import { formatModuleName } from "@/lib/format";
import type { ConfigImpactResult } from "@/types/api";

export const STATE: Record<ConfigImpactResult["status"], { status: Status; label: string }> = {
  blocked: { status: "critical", label: "Blocked" },
  degraded: { status: "medium", label: "Degraded" },
  ok: { status: "ok", label: "Unaffected" },
};
export const ORDER = { blocked: 0, degraded: 1, ok: 2 } as const;
const meta = (m: AuroraColumnMeta) => m;
const key = (r: ConfigImpactResult) => `${r.system}:${r.feature}`;

const columns: ColumnDef<ConfigImpactResult, unknown>[] = [
  { id: "feature", header: "Feature", meta: meta({ sticky: "start", minWidth: 220 }), accessorFn: (r) => r.feature,
    cell: ({ row }) => {
      const t = row.original.blocked_transactions;
      return (
        <span className="ui-cell-stack">
          <span className="ui-cell-stack__main">{row.original.feature}</span>
          {t.length ? <span className="ui-cell-stack__sub"><Mono>{t.slice(0, 4).join(", ")}</Mono>{t.length > 4 ? ` and ${t.length - 4} more` : ""}</span> : null}
        </span>
      );
    } },
  { id: "system", header: "System", meta: meta({ width: 120 }), accessorFn: (r) => r.system },
  { id: "status", header: "State", meta: meta({ width: 120 }), accessorFn: (r) => ORDER[r.status],
    cell: ({ row }) => <StatusBadge status={STATE[row.original.status].status}>{STATE[row.original.status].label}</StatusBadge> },
  { id: "blocking", header: "Blocking findings", meta: meta({ width: 140, numeric: true }), accessorFn: (r) => r.blocking_findings.length },
  { id: "records", header: "Records", meta: meta({ width: 120, numeric: true }), accessorFn: (r) => r.total_affected_records,
    cell: ({ row }) => row.original.total_affected_records.toLocaleString() },
  { id: "cost", header: "Opportunity cost", meta: meta({ minWidth: 260 }), accessorFn: (r) => r.opportunity_cost_summary },
];

export function FeaturesTable({ results, versionId }: { results: ConfigImpactResult[]; versionId: string }) {
  const drawer = useDrawerParam("feature");
  const findingHref = useFindingHref(versionId);
  const sorted = useMemo(
    () => [...results].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.total_affected_records - a.total_affected_records),
    [results],
  );
  const picked = drawer.value ? sorted.find((r) => key(r) === drawer.value) ?? null : null;

  return (
    <>
      <SectionCard title="SAP features at risk" meta={`${sorted.length.toLocaleString()} assessed, blocked first`} flush>
        <div className="ui-table-stacked">
          <DataTable columns={columns} data={sorted} getRowId={key} ariaLabel="Config impact by feature" maxHeight="65vh"
            onRowActivate={(r) => drawer.open(key(r))}
            empty={<EmptyState>No features were assessed for this version.</EmptyState>} />
        </div>
      </SectionCard>

      <DetailDrawer open={!!picked} onClose={drawer.close} ariaLabel="Feature detail"
        header={picked ? <div className="ui-drawer-head"><StatusBadge status={STATE[picked.status].status}>{STATE[picked.status].label}</StatusBadge>
          <h2 className="ui-drawer-head__title">{picked.feature}</h2></div> : null}>
        {picked ? (
          <div className="ui-detail">
            <p className="ui-note">{picked.opportunity_cost_summary || `${picked.total_affected_records.toLocaleString()} records involved.`}</p>
            {picked.blocked_transactions.length ? <p className="ui-note">Stops <Mono>{picked.blocked_transactions.join(", ")}</Mono>.</p> : null}
            {picked.blocking_findings.length ? (
              <ul className="ui-ranked">
                {picked.blocking_findings.map((b) => {
                  const href = findingHref(b.module, b.check_id);
                  return (
                    <li key={`${b.module}:${b.check_id}`}>
                      <div className="ui-ranked__row">
                        <StatusBadge status={b.severity === "critical" ? "critical" : b.severity === "high" ? "high" : "medium"}>{b.severity}</StatusBadge>
                        <span className="ui-ranked__title">{href ? <Link className="ui-link" href={href}>{b.check_id}</Link> : <Mono>{b.check_id}</Mono>}</span>
                        <span className="ui-ranked__num">{b.affected_count.toLocaleString()} records</span>
                        <span className="ui-ranked__meta">{formatModuleName(b.module)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState>No findings block this feature.</EmptyState>}
          </div>
        ) : null}
      </DetailDrawer>
    </>
  );
}
