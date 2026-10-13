"use client";

/** Systems/[id] › Configuration: one module's inventory and alignment findings, opened from the module tables. */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Drawer, EmptyState, ErrorState, Mono, Pill, Skeleton, Stat, type PillTone } from "@/design";
import {
  getConfigAlignmentByModule, getConfigInventoryByModule, type AlignmentFinding, type ConfigElement,
} from "@/lib/api/config-intelligence";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName, labelOf } from "@/lib/format";

const STATUS_TONE: Record<string, PillTone> = { active: "go", dormant: "at-risk", ghost: "no-go" };
const SEVERITY_TONE: Record<string, PillTone> = { critical: "no-go", high: "no-go", medium: "at-risk", low: "neutral" };
const n = (v: number) => v.toLocaleString();

export function InventoryModuleDrawer({ module, onClose }: { module: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["config-intelligence", "inventory", module],
    queryFn: () => getConfigInventoryByModule(module as string),
    enabled: module !== null,
    retry: false,
  });
  const elements = useMemo(() => q.data?.elements ?? [], [q.data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of elements) c[e.status] = (c[e.status] ?? 0) + 1;
    return c;
  }, [elements]);
  const columns = useMemo<ColumnDef<ConfigElement>[]>(() => [
    { id: "type", header: "Element", cell: ({ row }) => labelOf(row.original.element_type) },
    { id: "value", header: "Value", cell: ({ row }) => <Mono>{row.original.element_value}</Mono> },
    { id: "tx", header: "Transactions", cell: ({ row }) => n(row.original.transaction_count), meta: { numeric: true } },
    { id: "status", header: "Status", cell: ({ row }) => <Pill tone={STATUS_TONE[row.original.status] ?? "neutral"}>{labelOf(row.original.status)}</Pill> },
  ], []);
  return (
    <Drawer open={module !== null} onOpenChange={(o) => { if (!o) onClose(); }} title={module ? `${formatModuleName(module)} inventory` : "Inventory"} subtitle="Configuration elements seen in transactions">
      {q.isLoading ? <Skeleton height={200} /> : q.isError ? (
        <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : elements.length === 0 ? (
        <EmptyState title="No elements in this module" detail="Run discovery to fill the inventory" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="m-stat-grid" data-testid="inventory-counts">
            <Stat label="Elements" value={n(elements.length)} />
            {(["active", "dormant", "ghost"] as const).map((s) => <Stat key={s} label={labelOf(s)} value={n(counts[s] ?? 0)} />)}
          </div>
          <DataTable columns={columns} data={elements} getRowId={(e) => `${e.element_type}/${e.element_value}`} hideToolbar dense height="auto" tableId="config-inventory-module" />
        </div>
      )}
    </Drawer>
  );
}

export function AlignmentModuleDrawer({ module, onClose }: { module: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["config-intelligence", "alignment", module],
    queryFn: () => getConfigAlignmentByModule(module as string),
    enabled: module !== null,
    retry: false,
  });
  const findings = q.data?.findings ?? [];
  const columns = useMemo<ColumnDef<AlignmentFinding>[]>(() => [
    { id: "check", header: "Check", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "severity", header: "Severity", cell: ({ row }) => <Pill tone={SEVERITY_TONE[row.original.severity] ?? "neutral"}>{labelOf(row.original.severity)}</Pill> },
    { id: "title", header: "Finding", cell: ({ row }) => row.original.title },
  ], []);
  return (
    <Drawer open={module !== null} onOpenChange={(o) => { if (!o) onClose(); }} title={module ? `${formatModuleName(module)} alignment` : "Alignment"} subtitle="Configuration compared with how it is used">
      {q.isLoading ? <Skeleton height={200} /> : q.isError ? (
        <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : findings.length === 0 ? (
        <EmptyState title="Nothing found in this module" detail="The latest run raised no alignment findings here" />
      ) : (
        <DataTable
          columns={columns}
          data={findings}
          getRowId={(f) => `${f.check_id}/${f.title}`}
          hideToolbar
          dense
          height="auto"
          tableId="config-alignment-module"
          renderExpanded={(f) => (
            <div className="flex flex-col gap-2 m-text-body">
              <p>{f.description}</p>
              {f.remediation ? <p style={{ color: "var(--m-ink-2)" }}>Remediation: {f.remediation}</p> : null}
              {f.affected_elements.length ? <p style={{ color: "var(--m-ink-2)" }}>Affected: {f.affected_elements.join(", ")}</p> : null}
            </div>
          )}
        />
      )}
    </Drawer>
  );
}
