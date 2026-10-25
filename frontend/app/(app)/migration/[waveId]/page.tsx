"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Bar, Button, Card, DataTable, DrillLink, EmptyState, ErrorState, ExportMenu, PageHeader, Skeleton, Sparkline, Stat, Tabs, entityTabs, type ExportOption, Status, statusLabel, toVerdict } from "@/design";
import { GatedPrimary } from "@/components/gated-primary";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage, apiErrorState, isNotFound } from "@/lib/error";
import {
  downloadMigrationExport, downloadMigrationGaps, downloadWaveReport, getWaveCockpit, runWave, signoffWave,
} from "@/lib/api/migration";
import { downloadRealignment } from "@/lib/api/config-pairing";
import { browserTimezone, formatDate, formatModuleName, trendSentence } from "@/lib/format";
import { getTriageSettings } from "@/lib/api/triage";
import { queryKeys } from "@/lib/query-keys";
import type { WaveObject } from "@/types/api";
import { CreateWaveDialog, STAGE_LABEL } from "../create-wave-dialog";
import { useState } from "react";
import { BlockersTab } from "./blockers-tab";
import { MappingTab } from "./mapping-tab";
import { S4Tab } from "./s4-tab";

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

const objectColumns = (run: string | null, waveId: string): ColumnDef<WaveObject>[] => {
  const drill = (module: string, tab: string, n: string) =>
    run ? <DrillLink href={`/objects/${module}?run=${run}&tab=${tab}`}>{n}</DrillLink> : n;
  return [
  // The object's name from formatModuleName, never the API's label ("Sd Sales Orders").
  { id: "object", header: "Object", accessorFn: (o) => formatModuleName(o.module) },
  { id: "verdict", header: "Verdict", cell: ({ row }) => (
      <Status kind="verdict" value={row.original.verdict} />) },
  { id: "score", header: "Readiness", cell: ({ row }) => drill(row.original.module, "overview", pct(row.original.score)) },
  { id: "records", header: "Records", cell: ({ row }) => drill(row.original.module, "records", row.original.records.toLocaleString()) },
  { id: "blocked", header: "Records blocked", cell: ({ row }) => drill(row.original.module, "records", row.original.records_blocked.toLocaleString()) },
  // Migration gaps (every gap type but the informational ones), opened on this wave's gap view, not the object's rules.
  { id: "gaps", header: "Migration gaps", cell: ({ row }) => (row.original.blocker_count > 0
      ? <DrillLink href={`/migration/${waveId}?tab=blockers`}>{row.original.blocker_count.toLocaleString()}</DrillLink>
      : "0") },
  { id: "dqs", header: "Score", cell: ({ row }) => (row.original.dqs == null ? "—" : drill(row.original.module, "overview", row.original.dqs.toFixed(1))) },
  { id: "open", header: "", size: 80, cell: ({ row }) => (
      <Link href={run ? `/objects/${row.original.module}?run=${run}` : `/objects/${row.original.module}`} className="m-ink-accent-ink underline" onClick={(e) => e.stopPropagation()}>Open</Link>
    ) },
  ];
};

export default function WaveCockpitPage() {
  const { waveId } = useParams<{ waveId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { can } = useRole();
  const [editing, setEditing] = useState(false);
  const cockpit = useQuery({ queryKey: queryKeys.migrationCockpit(waveId), queryFn: () => getWaveCockpit(waveId) });
  // Sign-off time read in the tenant's zone (the triage calendar), the browser's until it loads.
  const tenantTz = useQuery({ queryKey: queryKeys.triageSettings(), queryFn: getTriageSettings, staleTime: 300_000, select: (st) => st.timezone }).data ?? browserTimezone();
  const signoff = useMutation({
    mutationFn: () => signoffWave(waveId),
    onSuccess: () => {
      toast.success("Wave signed off");
      void qc.invalidateQueries({ queryKey: queryKeys.migrationCockpit(waveId) });
      void qc.invalidateQueries({ queryKey: queryKeys.migrationWaves() });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  // The waves list's Run now, offered here by the tabs that need a run first.
  const runNow = useMutation({
    mutationFn: () => runWave(waveId),
    onSuccess: () => {
      toast.success("Run queued, readiness updates when it completes");
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
  if (cockpit.isError && isNotFound(cockpit.error)) {
    return (
      <EmptyState
        title="Wave not found"
        detail="This wave does not exist, or it was deleted."
        action={<Button render={<Link href="/migration">Back to migration</Link>} />}
      />
    );
  }
  if (cockpit.isError)
    return <ErrorState {...apiErrorState(cockpit.error)} onRetry={() => void cockpit.refetch()} />;
  const c = cockpit.data;
  const w = c.wave;
  const run = c.source_version_id ?? c.run_id;
  const funnel = (["go", "at_risk", "no_go"] as const).map((v) => ({
    x: statusLabel("verdict", v), y: c.objects.filter((o) => o.verdict === v).length,
  }));

  // Most records blocked first: what moves the wave's readiness.
  const ranked = [...c.objects].sort((a, b) => b.records_blocked - a.records_blocked || b.blocker_count - a.blocker_count);

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
  const runAction = can("analyse") ? <Button onClick={() => runNow.mutate()} pending={runNow.isPending}>Run now</Button> : undefined;
  // A wave's objects are edited here; without the analyse permission the waves list is the way back.
  const wavesAction = can("analyse")
    ? <Button onClick={() => setEditing(true)}>Add objects</Button>
    : <Button variant="secondary" render={<Link href="/migration">Open waves</Link>} />;
  const signable = c.verdict === "go" && !w.signed_off_at;

  return (
    <div className="flex flex-col [gap:var(--m-section-gap)]">
      <PageHeader
        title={w.name}
        status={<Status kind="verdict" value={c.verdict} />}
        meta={`${STAGE_LABEL[w.stage]}, target ${w.target_date ? formatDate(w.target_date, "date") : "not set"}, ${w.signed_off_at ? `signed off ${formatDate(w.signed_off_at, "datetime", tenantTz)}` : "not signed off"}. Clear the blockers until readiness reaches ${w.min_readiness}%, then sign the wave off`}
        actions={
          <>
            {can("analyse") ? <Button variant="ghost" onClick={() => setEditing(true)}>Edit wave</Button> : null}
            {signable ? (
              <GatedPrimary kind="signoff" allowed={can("approve")} disabled={signoff.isPending} onClick={() => signoff.mutate()}>Sign off</GatedPrimary>
            ) : null}
            {can("export") ? <ExportMenu options={exportOptions} /> : null}
          </>
        }
      />
      <div className="grid grid-cols-1 [gap:var(--m-section-gap)] @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]" data-testid="wave-figure">
        <Stat
          label="Readiness"
          href={`/migration/${waveId}?tab=overview`}
          value={pct(c.score)}
          bar={c.score ?? undefined}
          rule={{ target: w.min_readiness }}
          tone={toVerdict(c.verdict)}
          delta={`minimum ${w.min_readiness}%`}
        />
        <Stat label="Records blocked" href={`/migration/${waveId}?tab=blockers`} value={c.records_blocked.toLocaleString()}
              delta={`of ${c.records_total.toLocaleString()}`} />
        <Card title="Trend" padding="sm">
          {c.trend.length < 2 ? (
            <p className="m-text-body m-ink-2">The trend starts with the second run</p>
          ) : (
            <div className="flex flex-col gap-2">
              <Sparkline data={c.trend.map((p) => ({ x: formatDate(p.completed_at, "date"), y: p.score }))} width={160} height={32} />
              <p className="m-text-body m-ink-2">{trendSentence(c.trend[0].score, c.trend[c.trend.length - 1].score, c.trend.length, "Readiness").replace(/\.$/, "")}</p>
            </div>
          )}
        </Card>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => router.replace(`/migration/${waveId}?tab=${v}`)}
        items={[
          { value: "overview", label: "Overview", content: c.objects.length ? (
              <div className="flex flex-col [gap:var(--m-section-gap)]">
                <DataTable columns={objectColumns(run, waveId)} data={ranked} getRowId={(o) => o.module} />
                <Bar label="Objects by readiness verdict" height={96} data={funnel} />
              </div>
            ) : <EmptyState title="No objects in this wave" detail="Add the SAP objects this wave moves, then run it to score their readiness." action={wavesAction} /> },
          { value: "blockers", label: "Blockers", content: <BlockersTab waveId={waveId} runId={c.run_id} blockers={c.blockers} runAction={runAction} /> },
          { value: "mapping", label: "Mapping", content: (
              <MappingTab modules={w.modules} destType={c.dest_system_type} runAction={runAction} wavesAction={wavesAction} />) },
          { value: "s4", label: "S/4 areas", content: <S4Tab versionId={c.source_version_id} runAction={runAction} /> },
          ...entityTabs({ entityType: "migration", entityId: waveId, auditPath: `/migration/waves/${waveId}` }),
        ]}
      />
      {can("analyse") ? <CreateWaveDialog key={w.updated_at} open={editing} onOpenChange={setEditing} wave={w} /> : null}
    </div>
  );
}
