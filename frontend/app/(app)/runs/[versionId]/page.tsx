// frontend/app/(app)/runs/[versionId]/page.tsx
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, ErrorState, Pill, ReportPage, type PillTone } from "@/design";
import { useRole } from "@/hooks/use-role";
import { errorText } from "@/lib/api/remediation";
import { getRunSteps, type RunStep } from "@/lib/api/v1/runs";
import { getVersion, getVersions, pinBaseline } from "@/lib/api/versions";
import { formatDate, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { baselineRunId, previousRunId } from "@/lib/runs";

const STATUS_TONE: Record<string, PillTone> = {
  failed: "no-go",
  agents_failed: "no-go",
  complete: "go",
  agents_complete: "go",
  ai_enriched: "go",
};

const statusTone = (status: string): PillTone => STATUS_TONE[status] ?? "at-risk";

const stepColumns: ColumnDef<RunStep>[] = [
  { accessorKey: "step_number", header: "#" },
  { accessorKey: "step_name", header: "Step" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Pill tone={statusTone(row.original.status)}>{labelOf(row.original.status)}</Pill>,
  },
  {
    accessorKey: "duration_ms",
    header: "Duration",
    cell: ({ row }) => (row.original.duration_ms == null ? "—" : `${(row.original.duration_ms / 1000).toFixed(1)}s`),
  },
  {
    id: "error",
    header: "Error",
    cell: ({ row }) => (row.original.error_detail ? <p role="alert">{row.original.error_detail}</p> : "—"),
  },
];

export default function RunDetailPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const qc = useQueryClient();
  const { can } = useRole();

  const version = useQuery({ queryKey: queryKeys.run(versionId), queryFn: () => getVersion(versionId) });
  const steps = useQuery({ queryKey: [...queryKeys.run(versionId), "steps"], queryFn: () => getRunSteps(versionId) });
  const systemId = version.data?.metadata?.system_id;
  const scope = useQuery({
    queryKey: queryKeys.versionsList({ system_id: systemId }),
    queryFn: () => getVersions(systemId ? { system_id: systemId, limit: 100 } : undefined),
    enabled: version.isSuccess,
  });

  const isBaseline = version.data?.metadata?.baseline === true;
  const pin = useMutation({
    mutationFn: () => pinBaseline(versionId, !isBaseline),
    onSuccess: () => {
      toast.success(isBaseline ? "Baseline unpinned" : "Pinned as baseline");
      qc.invalidateQueries({ queryKey: queryKeys.run(versionId) });
      qc.invalidateQueries({ queryKey: queryKeys.run("list") });
      qc.invalidateQueries({ queryKey: ["versions-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (version.isError) {
    return <ErrorState message={`Couldn't load this run. ${errorText(version.error)}`} onRetry={() => version.refetch()} />;
  }

  const v = version.data;
  const runs = scope.data?.versions ?? [];
  const prevId = v ? previousRunId(v, runs) : null;
  const baseId = v ? baselineRunId(v, runs) : null;
  const stepRows = steps.data?.steps ?? [];
  const state = steps.isLoading ? "loading" : steps.isError ? "error" : stepRows.length === 0 ? "empty" : undefined;

  const narrative = v ? (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2">
        <span>{v.label ?? versionId}</span>
        <span>— started {formatDate(v.run_at, "datetime")}.</span>
        <Pill tone={statusTone(v.status)}>{labelOf(v.status)}</Pill>
        {isBaseline ? <Pill tone="go">Baseline</Pill> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        {prevId ? <Link href={`/runs/${versionId}/vs/${prevId}`}><Button variant="secondary">Compare with previous</Button></Link> : null}
        {baseId ? <Link href={`/runs/${versionId}/vs/baseline`}><Button variant="secondary">Compare with baseline</Button></Link> : null}
        {can("analyse") ? (
          <Button variant="ghost" disabled={pin.isPending} onClick={() => pin.mutate()}>
            {isBaseline ? "Unpin baseline" : "Pin as baseline"}
          </Button>
        ) : null}
      </div>
    </div>
  ) : (
    <p>Loading run…</p>
  );

  return (
    <ReportPage
      narrative={narrative}
      charts={null}
      tables={<DataTable columns={stepColumns} data={stepRows} getRowId={(s) => String(s.step_number)} />}
      state={state}
      emptyProps={{ title: "No step history for this run yet." }}
      errorProps={{ message: "Couldn't load the run steps.", onRetry: () => steps.refetch() }}
    />
  );
}
