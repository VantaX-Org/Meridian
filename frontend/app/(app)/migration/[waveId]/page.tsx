"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button, DataTable, EmptyState, ErrorState, Line, Pill, Skeleton, Stat, Tabs } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/error";
import {
  downloadMigrationExport, downloadMigrationGaps, downloadWaveReport, getWaveCockpit, signoffWave,
} from "@/lib/api/migration";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { WaveObject } from "@/types/api";
import { STAGE_LABEL } from "../create-wave-dialog";
import { VERDICT_LABEL, VERDICT_TONE } from "../page";
import { BlockersTab } from "./blockers-tab";
import { MappingTab } from "./mapping-tab";
import { S4Tab } from "./s4-tab";

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

const OBJECT_COLUMNS: ColumnDef<WaveObject>[] = [
  { accessorKey: "label", header: "Object" },
  { id: "verdict", header: "Verdict", cell: ({ row }) => (
      <Pill tone={VERDICT_TONE[row.original.verdict]}>{VERDICT_LABEL[row.original.verdict]}</Pill>) },
  { id: "score", header: "Readiness", cell: ({ row }) => pct(row.original.score) },
  { id: "records", header: "Records", cell: ({ row }) => row.original.records.toLocaleString() },
  { id: "blocked", header: "Records blocked", cell: ({ row }) => row.original.records_blocked.toLocaleString() },
  { id: "gaps", header: "Blocking gaps", cell: ({ row }) => row.original.blocker_count.toLocaleString() },
  { id: "dqs", header: "DQS", cell: ({ row }) => (row.original.dqs == null ? "—" : row.original.dqs.toFixed(1)) },
];

export default function WaveCockpitPage() {
  const { waveId } = useParams<{ waveId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { can } = useRole();
  const cockpit = useQuery({ queryKey: queryKeys.migrationCockpit(waveId), queryFn: () => getWaveCockpit(waveId) });
  const signoff = useMutation({
    mutationFn: () => signoffWave(waveId),
    onSuccess: () => {
      toast.success("Wave signed off.");
      void qc.invalidateQueries({ queryKey: queryKeys.migrationCockpit(waveId) });
      void qc.invalidateQueries({ queryKey: queryKeys.migrationWaves() });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (cockpit.isPending) return <Skeleton height={240} />;
  if (cockpit.isError)
    return <ErrorState message={apiErrorMessage(cockpit.error)} onRetry={() => void cockpit.refetch()} />;
  const c = cockpit.data;
  const w = c.wave;

  const downloads = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => void downloadWaveReport(waveId, "pdf")}>Readiness report (PDF)</Button>
      <Button variant="secondary" onClick={() => void downloadWaveReport(waveId, "xlsx")}>Readiness report (Excel)</Button>
      {c.run_id ? (
        <>
          <Button variant="secondary" onClick={() => void downloadMigrationGaps(c.run_id ?? "", "xlsx")}>Gap list (Excel)</Button>
          <Button variant="secondary" onClick={() => void downloadMigrationExport(c.run_id ?? "", "xlsx")}>Load files (Excel)</Button>
          <Button variant="secondary" onClick={() => void downloadMigrationExport(c.run_id ?? "", "csv")}>Load files (CSV)</Button>
        </>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[20px] font-semibold" style={{ color: "var(--m-ink)" }}>{w.name}</p>
          <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
            {STAGE_LABEL[w.stage]}, target {w.target_date ? formatDate(w.target_date, "date") : "not set"},{" "}
            {w.signed_off_at ? `signed off ${formatDate(w.signed_off_at, "datetime", "SAST")}` : "not signed off"}
          </p>
        </div>
        {can("approve") && c.verdict === "go" && !w.signed_off_at ? (
          <Button disabled={signoff.isPending} onClick={() => signoff.mutate()}>Sign off</Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Verdict" value={<Pill tone={VERDICT_TONE[c.verdict]}>{VERDICT_LABEL[c.verdict]}</Pill>} />
        <Stat label="Readiness" value={pct(c.score)} delta={`minimum ${w.min_readiness}%`} />
        <Stat label="Records blocked" value={c.records_blocked.toLocaleString()}
              delta={`of ${c.records_total.toLocaleString()}`} />
        <Stat label="Trend" value={<Line data={c.trend.map((p) => ({ x: formatDate(p.completed_at, "date"), y: p.score }))} />} />
      </div>
      <Tabs
        defaultValue={searchParams.get("tab") ?? "objects"}
        onValueChange={(v) => router.replace(`/migration/${waveId}?tab=${v}`)}
        items={[
          { value: "objects", label: "Objects", content: c.objects.length ? (
              <DataTable columns={OBJECT_COLUMNS} data={c.objects} getRowId={(o) => o.module} />
            ) : <EmptyState title="Add modules to this wave to see its objects." /> },
          { value: "blockers", label: "Blockers", content: <BlockersTab waveId={waveId} runId={c.run_id} blockers={c.blockers} /> },
          { value: "mapping", label: "Mapping", content: (
              <MappingTab modules={w.modules} destType={c.dest_system_type} />) },
          { value: "s4", label: "S/4 areas", content: <S4Tab versionId={c.source_version_id} /> },
          { value: "downloads", label: "Downloads", content: downloads },
        ]}
      />
    </div>
  );
}
