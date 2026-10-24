"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, Drawer, DrillLink, EmptyState, ErrorState, Mono, Skeleton, Stat, Status } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorState } from "@/lib/error";
import { getS4Readiness, type S4Area, type S4Check } from "@/lib/api/migration";
import { createBatch, errorText } from "@/lib/api/remediation";
import { getRuleByCode } from "@/lib/api/rules";
import { queryKeys } from "@/lib/query-keys";

const n = (v: number) => v.toLocaleString();
const topFailing = (a: S4Area): S4Check | undefined => a.checks.find((c) => c.affected_count > 0);
const REMEDIATION_CHECKS = 5;

function AreaDrawer({ area, versionId, onClose, onFix, fixing, canFix }: {
  area: S4Area | null; versionId: string; onClose: () => void; onFix: (area: S4Area, check: S4Check) => void;
  fixing: string | null; canFix: boolean;
}) {
  const failing = useMemo(() => (area?.checks ?? []).filter((c) => c.affected_count > 0), [area]);
  const shown = failing.slice(0, REMEDIATION_CHECKS);
  const rules = useQueries({
    queries: shown.map((c) => ({
      queryKey: queryKeys.ruleDetail(`code:${c.check_id}`),
      queryFn: () => getRuleByCode(c.check_id, c.module ?? undefined),
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });
  const columns = useMemo<ColumnDef<S4Check>[]>(() => [
    { id: "check", header: "Check", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "impact", header: "Impact", cell: ({ row }) => <Status kind="verdict" value={row.original.impact} /> },
    {
      id: "records", header: "Failing records", meta: { numeric: true },
      cell: ({ row }) => row.original.module
        ? <DrillLink object={row.original.module} ruleId={row.original.check_id} run={versionId}>{n(row.original.affected_count)}</DrillLink>
        : n(row.original.affected_count),
    },
  ], [versionId]);
  return (
    <Drawer
      open={area !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={area?.label ?? "Area"}
      subtitle={area?.simplification_item ?? undefined}
    >
      {area ? (
        <div className="flex flex-col gap-5">
          <div className="m-stat-grid">
            <Stat label="Failing rules" value={n(area.failing)} />
            <Stat label="Blocking" value={n(area.blocking_failing)} />
            <Stat label="Warnings" value={n(area.warning_failing)} />
            <Stat label="Failing records" value={n(area.failing_records)} />
          </div>
          {failing.length === 0 ? (
            <EmptyState variant="inline" title="No failing checks in this area" />
          ) : (
            <>
              <DataTable columns={columns} data={failing} getRowId={(c) => c.check_id} hideToolbar dense height="auto" tableId="s4-area-checks" />
              <section className="flex flex-col gap-3" data-testid="s4-remediation">
                <h3 className="m-text-body font-semibold">How to fix it</h3>
                {shown.map((c, i) => {
                  const r = rules[i];
                  return (
                    <div key={c.check_id} className="flex flex-col gap-1 m-text-body">
                      <div className="flex items-center justify-between gap-2">
                        <span><Mono>{c.check_id}</Mono> <Status kind="verdict" value={c.impact} /></span>
                        {canFix ? (
                          <Button variant="secondary" size="sm" onClick={() => onFix(area, c)} pending={fixing === c.check_id}>Create fix batch</Button>
                        ) : null}
                      </div>
                      {r.isLoading ? <Skeleton height={32} /> : r.data ? (
                        <>
                          {r.data.message ? <p>{r.data.message}</p> : null}
                          {r.data.sap_impact ? <p className="m-ink-2">{r.data.sap_impact}</p> : null}
                          {r.data.record_fix_template ? <p className="m-ink-3">{r.data.record_fix_template}</p> : null}
                        </>
                      ) : <p className="m-ink-3">No fix text for this check</p>}
                    </div>
                  );
                })}
                {failing.length > shown.length ? (
                  <p className="m-text-meta m-ink-3">{n(failing.length - shown.length)} more failing checks. Open the findings for the rest</p>
                ) : null}
              </section>
            </>
          )}
        </div>
      ) : null}
    </Drawer>
  );
}

/** `runAction` is the cockpit's Run now, absent without the analyse permission. */
export function S4Tab({ versionId, runAction }: { versionId: string | null; runAction?: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useRole();
  const [open, setOpen] = useState<string | null>(null);
  const s4 = useQuery({
    queryKey: queryKeys.s4Readiness(versionId ?? ""),
    queryFn: () => getS4Readiness(versionId ?? ""),
    enabled: versionId !== null,
  });
  const fix = useMutation({
    mutationFn: (v: { area: S4Area; check: S4Check }) =>
      createBatch(`S/4 ${v.area.label}: ${v.check.check_id}`, { check_id: v.check.check_id, version_id: versionId }),
    onSuccess: (b) => {
      toast.success("Fix batch drafted");
      void qc.invalidateQueries({ queryKey: ["remediation"] });
      // A remediation batch opens in the Batches tab drawer; /fix/[batchId] reads cleaning_queue.batch_id, a different id.
      router.push(`/fix?tab=batches&batch=${b.id}`);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const canFix = can("apply");
  const fixingCheck = fix.isPending ? fix.variables?.check.check_id ?? null : null;

  const columns = useMemo<ColumnDef<S4Area>[]>(() => {
    // Filter by module only when every failing check in the area shares one, so the list matches the counts shown.
    const findingsHref = (a: S4Area) => {
      const modules = new Set(a.checks.filter((c) => c.affected_count > 0).map((c) => c.module));
      const only = modules.size === 1 ? [...modules][0] : undefined;
      return `/runs/${versionId}?tab=findings${only ? `&module=${only}` : ""}`;
    };
    return [
      { accessorKey: "label", header: "Area" },
      { id: "status", header: "Status", cell: ({ row }) => <Status kind="verdict" value={row.original.status} /> },
      { id: "rules", header: "Rules", meta: { numeric: true }, cell: ({ row }) => n(row.original.rules) },
      { id: "failing", header: "Failing rules", meta: { numeric: true }, cell: ({ row }) => <DrillLink href={findingsHref(row.original)}>{n(row.original.failing)}</DrillLink> },
      { id: "blocking", header: "Blocking", meta: { numeric: true }, cell: ({ row }) => <DrillLink href={findingsHref(row.original)}>{n(row.original.blocking_failing)}</DrillLink> },
      { id: "records", header: "Failing records", meta: { numeric: true }, cell: ({ row }) => <DrillLink href={findingsHref(row.original)}>{n(row.original.failing_records)}</DrillLink> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const a = row.original;
          const top = topFailing(a);
          return (
            <span className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              <Button variant="secondary" size="sm" disabled={!top} render={<Link href={findingsHref(a)}>Open findings</Link>} />
              {canFix ? (
                <Button variant="secondary" size="sm" disabled={!top} pending={top !== undefined && fixingCheck === top.check_id} onClick={() => top && fix.mutate({ area: a, check: top })}>Create fix batch</Button>
              ) : null}
            </span>
          );
        },
      },
    ];
  }, [versionId, canFix, fix, fixingCheck]);

  if (!versionId) return <EmptyState title="Not run yet" detail="Run this wave to see its S/4 simplification areas." action={runAction} />;
  if (s4.isError) return <ErrorState {...apiErrorState(s4.error)} onRetry={() => void s4.refetch()} />;
  if (s4.isLoading || !s4.data) return <Skeleton height={240} />;
  const d = s4.data;
  const blockingAreas = d.areas.filter((a) => a.blocking_failing > 0).length;
  const findingsRoot = `/runs/${versionId}?tab=findings`;
  const openArea = d.areas.find((a) => a.area === open) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="m-stat-grid" data-testid="s4-summary">
        <Stat label="Ready" value={<Status kind="verdict" value={d.ready ? "go" : "no-go"} />} href={findingsRoot} />
        <Stat label="Blocking areas" value={n(blockingAreas)} href={findingsRoot} />
        <Stat label="Failing records" value={n(d.failing_records)} href={findingsRoot} />
      </div>
      <DataTable columns={columns} data={d.areas} getRowId={(a) => a.area} onRowClick={(a) => setOpen(a.area)} tableId="s4-areas" />
      <AreaDrawer
        area={openArea}
        versionId={versionId}
        onClose={() => setOpen(null)}
        onFix={(area, check) => fix.mutate({ area, check })}
        fixing={fixingCheck}
        canFix={canFix}
      />
    </div>
  );
}
