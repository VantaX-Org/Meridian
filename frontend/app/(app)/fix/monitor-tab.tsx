"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, Card, DataTable, Delta, EmptyState, ErrorState, Mono, Pill, Skeleton, Stat, Status } from "@/design";
import { useNowSec } from "@/hooks/use-now";
import { useRole } from "@/hooks/use-role";
import { errorText, getMonitor, type MonitorItem, type RegressedCheck } from "@/lib/api/remediation";
import { getSyncProfiles, triggerSync } from "@/lib/api/systems";
import { pinBaseline } from "@/lib/api/versions";
import { formatDate, formatModuleName, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { presetLabel } from "../systems/[systemId]/schedules-panel";

const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

const scopeLabel = (m: MonitorItem) => m.system_name ?? (m.scope === "upload" ? "Imported files" : m.scope);

const regressedColumns: ColumnDef<RegressedCheck>[] = [
  { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Link href={`/rules/${row.original.check_id}`} className="underline"><Mono>{row.original.check_id}</Mono></Link> },
  { accessorKey: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
  { accessorKey: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} /> },
  { accessorKey: "new", header: "New failing records", meta: { numeric: true }, cell: ({ row }) => row.original.new.toLocaleString() },
];

/**
 * Monitoring after cleanup: every scope with a pinned baseline, its latest run
 * against that baseline, the rules that regressed, the fix batch drafted for
 * them, and the schedule that keeps the comparison fresh.
 */
export function MonitorTab() {
  const q = useQuery({ queryKey: queryKeys.remediationMonitor(), queryFn: getMonitor, staleTime: 60_000 });
  const items = q.data?.items ?? [];
  if (q.isLoading) return <Skeleton height={240} />;
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />;
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing is being monitored"
        detail="After a cleanup, pin the run that shows the cleaned data as the baseline. Every later run is compared with it, regressions are drafted into a fix batch, and you are notified."
        action={<Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />}
      />
    );
  }
  return <div className="flex flex-col gap-4">{items.map((m) => <MonitorCard key={m.lineage ?? m.scope} item={m} />)}</div>;
}

function MonitorCard({ item: m }: { item: MonitorItem }) {
  const { can } = useRole();
  const qc = useQueryClient();
  const nowMs = useNowSec(false) * 1000;
  const isSystem = m.scope !== "upload";
  const stale = m.latest.run_at ? nowMs - new Date(m.latest.run_at).getTime() > STALE_AFTER_MS : true;
  const mon = m.monitor;
  const regressed = mon?.regressed_check_count ?? 0;
  const delta = m.latest.id !== m.baseline.id && m.baseline.dqs != null && m.latest.dqs != null ? Math.round((m.latest.dqs - m.baseline.dqs) * 10) / 10 : null;
  const compare = m.latest.id !== m.baseline.id ? `/runs/${m.latest.id}/vs/${m.baseline.id}` : `/runs/${m.latest.id}`;

  const profiles = useQuery({ queryKey: queryKeys.syncProfiles(m.scope), queryFn: () => getSyncProfiles(m.scope), enabled: isSystem, staleTime: 60_000 });
  const active = (profiles.data ?? []).filter((p) => p.active && p.schedule_cron);
  const next = active.map((p) => p.next_run_at).filter((d): d is string => !!d).sort()[0];

  const recheck = useMutation({
    mutationFn: () => triggerSync(m.scope),
    onSuccess: (r) => toast.success(r.profile_count ? `Re-check started for ${scopeLabel(m)}. The comparison updates when the run finishes.` : `Nothing to extract for ${scopeLabel(m)}. Add a schedule first.`),
    onError: (e) => toast.error(errorText(e)),
  });
  const pin = useMutation({
    mutationFn: () => pinBaseline(m.latest.id),
    onSuccess: () => { toast.success("Latest run pinned as the baseline. Later runs compare against it."); void qc.invalidateQueries({ queryKey: queryKeys.remediationMonitor() }); },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Card
      title={scopeLabel(m)}
      meta={stale ? <Pill tone="at-risk">Stale check</Pill> : regressed > 0 ? <Pill tone="no-go">{regressed} rule{regressed === 1 ? "" : "s"} regressed</Pill> : <Pill tone="go">Holding</Pill>}
      actions={
        <>
          {isSystem && can("trigger_sync") ? <Button variant="secondary" onClick={() => recheck.mutate()} pending={recheck.isPending}>Re-check now</Button> : null}
          {can("analyse") && m.latest.id !== m.baseline.id ? <Button variant="ghost" onClick={() => pin.mutate()} pending={pin.isPending}>Pin latest as baseline</Button> : null}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-6">
          <Stat label="Baseline score" value={m.baseline.dqs != null ? m.baseline.dqs.toFixed(1) : "—"} href={`/runs/${m.baseline.id}`}
            hint={m.baseline.run_at ? `Pinned run of ${formatDate(m.baseline.run_at, "datetime")}` : "Pinned run"} />
          <Stat label="Latest score" value={m.latest.dqs != null ? m.latest.dqs.toFixed(1) : "—"} href={`/runs/${m.latest.id}`}
            delta={delta != null ? <Delta value={delta} run="baseline" /> : undefined}
            hint={m.latest.run_at ? `Checked ${relativeTime(m.latest.run_at)}` : "Not checked yet"} />
          <Stat label="New failing records" value={mon?.new_records ?? 0} href={compare} tone={mon?.new_records ? "no-go" : "go"} />
          <Stat label="Resolved since baseline" value={mon?.resolved_records ?? 0} href={compare} tone="go" />
          <Stat label="Regressed rules" value={regressed} href={compare} tone={regressed ? "no-go" : "go"} />
        </div>

        {mon && mon.regressed_checks.length > 0 ? (
          <DataTable columns={regressedColumns} data={mon.regressed_checks} getRowId={(r) => r.check_id} hideSearch maxHeight={280} />
        ) : null}

        <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
          {!mon || !mon.new_records ? (
            "No records have regressed since the baseline."
          ) : mon.batch_id ? (
            <>
              <Link href={`/fix?tab=batches&batch=${mon.batch_id}`} className="underline">
                {mon.batch_items.toLocaleString()} regressed record{mon.batch_items === 1 ? "" : "s"} drafted into a fix batch
              </Link>
              {mon.batch_auto_approvable ? `, ${mon.batch_auto_approvable.toLocaleString()} ready to approve.` : "."}
            </>
          ) : (
            `${mon.new_records.toLocaleString()} record${mon.new_records === 1 ? "" : "s"} regressed. Already in an open fix batch.`
          )}
        </p>

        {isSystem ? (
          <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
            {profiles.isLoading ? "Loading schedule" : active.length === 0 ? (
              <>
                No re-check schedule. The comparison only updates when someone extracts by hand.{" "}
                <Link href={`/systems/${m.scope}?tab=health`} className="underline">Set a schedule</Link>
              </>
            ) : (
              <>
                Re-checks {active.map((p) => presetLabel(p.schedule_cron).toLowerCase()).filter((v, i, a) => a.indexOf(v) === i).join(" and ")}
                {next ? `, next ${relativeTime(next)}.` : "."}{" "}
                <Link href={`/systems/${m.scope}?tab=health`} className="underline">Change</Link>
              </>
            )}
          </p>
        ) : (
          <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
            Imported files are re-checked when a new file is uploaded.{" "}
            <Link href="/import" className="underline">Upload</Link>
          </p>
        )}

        {stale ? (
          <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
            Not checked in over 36 hours. The comparison may not reflect recent SAP changes.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
