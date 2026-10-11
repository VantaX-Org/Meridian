"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Bar, Button, DataTable, DrillLink, EmptyState, ErrorState, Line, Pill, Skeleton, Stat, Tabs, entityTabs, type ExportOption } from "@/design";
import { GatedPrimary } from "@/components/gated-primary";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/error";
import {
  downloadMigrationExport, downloadMigrationGaps, downloadWaveReport, getWaveCockpit, signoffWave,
} from "@/lib/api/migration";
import { downloadRealignment } from "@/lib/api/config-pairing";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { WaveObject } from "@/types/api";
import { STAGE_LABEL } from "../create-wave-dialog";
import { VERDICT_LABEL, VERDICT_TONE } from "@/lib/migration-verdict";
import { BlockersTab } from "./blockers-tab";
import { MappingTab } from "./mapping-tab";
import { S4Tab } from "./s4-tab";

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

const objectColumns = (run: string | null): ColumnDef<WaveObject>[] => {
  const drill = (module: string, tab: string, n: string) =>
    run ? <DrillLink href={`/objects/${module}?run=${run}&tab=${tab}`}>{n}</DrillLink> : n;
  return [
  { accessorKey: "label", header: "Object" },
  { id: "verdict", header: "Verdict", cell: ({ row }) => (
      <Pill tone={VERDICT_TONE[row.original.verdict]}>{VERDICT_LABEL[row.original.verdict]}</Pill>) },
  { id: "score", header: "Readiness", cell: ({ row }) => drill(row.original.module, "overview", pct(row.original.score)) },
  { id: "records", header: "Records", cell: ({ row }) => drill(row.original.module, "records", row.original.records.toLocaleString()) },
  { id: "blocked", header: "Records blocked", cell: ({ row }) => drill(row.original.module, "records", row.original.records_blocked.toLocaleString()) },
  { id: "gaps", header: "Blocking gaps", cell: ({ row }) => drill(row.original.module, "rules", row.original.blocker_count.toLocaleString()) },
  { id: "dqs", header: "DQS", cell: ({ row }) => (row.original.dqs == null ? "—" : drill(row.original.module, "overview", row.original.dqs.toFixed(1))) },
  ];
};

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

  if (cockpit.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton height={56} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={88} />)}</div>
        <Skeleton height={240} />
      </div>
    );
  }
  if (cockpit.isError)
    return <ErrorState message={apiErrorMessage(cockpit.error)} onRetry={() => void cockpit.refetch()} />;
  const c = cockpit.data;
  const w = c.wave;
  const run = c.source_version_id ?? c.run_id;
  const funnel = (["go", "at_risk", "no_go"] as const).map((v) => ({
    x: VERDICT_LABEL[v], y: c.objects.filter((o) => o.verdict === v).length,
  }));

  const exportOptions: ExportOption[] = [
    { format: "pdf", label: "Readiness report (PDF)", run: () => downloadWaveReport(waveId, "pdf") },
    { format: "xlsx", label: "Readiness report (Excel)", run: () => downloadWaveReport(waveId, "xlsx") },
    ...(c.run_id
      ? ([
          { format: "xlsx", label: "Gap list (Excel)", run: () => downloadMigrationGaps(c.run_id ?? "", "xlsx") },
          { format: "xlsx", label: "Realignment (Excel)", run: () => downloadRealignment(c.run_id ?? "", "xlsx") },
          { format: "pdf", label: "Realignment (PDF)", run: () => downloadRealignment(c.run_id ?? "", "pdf") },
          { format: "xlsx", label: "Load files (Excel)", run: () => downloadMigrationExport(c.run_id ?? "", "xlsx") },
          { format: "csv", label: "Load files (CSV)", run: () => downloadMigrationExport(c.run_id ?? "", "csv") },
        ] as ExportOption[])
      : []),
  ];

  // "objects" is the pre-18a name of the first tab; keep old deep links working.
  const rawTab = searchParams.get("tab") ?? "overview";
  const tab = rawTab === "objects" ? "overview" : rawTab;

  const downloads = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => void downloadWaveReport(waveId, "pdf")}>Readiness report (PDF)</Button>
      <Button variant="secondary" onClick={() => void downloadWaveReport(waveId, "xlsx")}>Readiness report (Excel)</Button>
      {c.run_id ? (
        <>
          <Button variant="secondary" onClick={() => void downloadMigrationGaps(c.run_id ?? "", "xlsx")}>Gap list (Excel)</Button>
          <Button variant="secondary" onClick={() => void downloadRealignment(c.run_id ?? "", "xlsx")}>Realignment (Excel)</Button>
          <Button variant="secondary" onClick={() => void downloadRealignment(c.run_id ?? "", "pdf")}>Realignment (PDF)</Button>
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
        {c.verdict === "go" && !w.signed_off_at ? (
          <GatedPrimary kind="signoff" allowed={can("approve")} disabled={signoff.isPending} onClick={() => signoff.mutate()}>Sign off</GatedPrimary>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Verdict" value={<Pill tone={VERDICT_TONE[c.verdict]}>{VERDICT_LABEL[c.verdict]}</Pill>} href={`/migration/${waveId}?tab=overview`} />
        <Stat label="Readiness" href={`/migration/${waveId}?tab=overview`} value={pct(c.score)} delta={`minimum ${w.min_readiness}%`} />
        <Stat label="Records blocked" href={`/migration/${waveId}?tab=blockers`} value={c.records_blocked.toLocaleString()}
              delta={`of ${c.records_total.toLocaleString()}`} />
        <Stat label="Trend" href={run ? `/runs/${run}` : undefined} value={<Line data={c.trend.map((p) => ({ x: formatDate(p.completed_at, "date"), y: p.score }))} />} />
      </div>
      {c.objects.length ? <Bar label="Objects by readiness verdict" height={120} data={funnel} /> : null}
      <Tabs
        value={tab}
        onValueChange={(v) => router.replace(`/migration/${waveId}?tab=${v}`)}
        items={[
          { value: "overview", label: "Overview", content: c.objects.length ? (
              <DataTable columns={objectColumns(run)} data={c.objects} getRowId={(o) => o.module} />
            ) : <EmptyState title="Add modules to this wave to see its objects." /> },
          { value: "blockers", label: "Blockers", content: <BlockersTab waveId={waveId} runId={c.run_id} blockers={c.blockers} /> },
          { value: "mapping", label: "Mapping", content: (
              <MappingTab modules={w.modules} destType={c.dest_system_type} />) },
          { value: "s4", label: "S/4 areas", content: <S4Tab versionId={c.source_version_id} /> },
          { value: "downloads", label: "Downloads", content: downloads },
          ...entityTabs({ entityType: "migration", entityId: waveId, auditPath: `/migration/waves/${waveId}`, exportOptions, canExport: can("export") }),
        ]}
      />
    </div>
  );
}
