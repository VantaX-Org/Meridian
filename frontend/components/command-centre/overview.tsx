"use client";

/**
 * Command Centre → Overview: the Aurora surface on real data. Every number is
 * server-side (findings/aggregate), the trend is the composite DQS of each
 * analysis run, the inbox is the open critical and high findings, and a
 * finished analysis announces itself from the job stream.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, buildVerdict, CommandCentre, type CommandCentreInboxItem, type CommandCentreKpi } from "@/components/aurora";
import { GettingStarted } from "@/components/getting-started";
import { useJobs } from "@/hooks/use-jobs";
import { useNowSec } from "@/hooks/use-now";
import { compositeDqs, getFindings, getFindingsAggregate } from "@/lib/api/findings";
import { getVersions } from "@/lib/api/versions";
import { getConfigImpact } from "@/lib/api/connectivity";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { Finding } from "@/types/api";

const DISMISSED_KEY = "mn_arrival_dismissed";

function headline(f: Finding): string {
  const text = f.business_name ?? f.details?.message ?? f.check_id;
  return `${formatModuleName(f.module)} · ${text}`;
}

export function CommandCentreOverview() {
  const router = useRouter();
  const agg = useQuery({ queryKey: ["findings.aggregate"], queryFn: () => getFindingsAggregate() });
  const critical = useQuery({ queryKey: ["findings.list", { severity: "critical", limit: 10 }],
    queryFn: () => getFindings({ severity: "critical", limit: 10 }) });
  const high = useQuery({ queryKey: ["findings.list", { severity: "high", limit: 10 }],
    queryFn: () => getFindings({ severity: "high", limit: 10 }) });
  const versions = useQuery({ queryKey: ["versions.list", { limit: 40 }], queryFn: () => getVersions({ limit: 40 }) });
  const latestVersion = versions.data?.versions.find((v) => v.dqs_summary && Object.keys(v.dqs_summary).length);
  const impact = useQuery({ queryKey: ["config-impact", latestVersion?.id], enabled: !!latestVersion,
    queryFn: () => getConfigImpact(latestVersion!.id), retry: false, meta: { ignoreError: true } });
  const { jobs } = useJobs();
  const nowSec = useNowSec(true, 30_000);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return sessionStorage.getItem(DISMISSED_KEY); } catch { return null; }
  });

  const a = agg.data;
  const dqs = a?.dqs.composite ?? null;
  const topModule = a?.by_module[0]?.module ?? null;
  const verdict = buildVerdict({
    dqs: dqs ?? 0, previousDqs: a?.previous_dqs ?? null,
    critical: a?.severity.critical ?? 0, high: a?.severity.high ?? 0,
    topModule: topModule ? formatModuleName(topModule) : null,
  });
  if (dqs === null && a) verdict.sentence = "No analysis has run yet. Connect a system and download its objects, or import a file.";

  const kpis = useMemo<CommandCentreKpi[]>(() => {
    const delta = dqs !== null && a?.previous_dqs != null ? Math.round((dqs - a.previous_dqs) * 10) / 10 : null;
    const blocked = impact.data?.summary.features_blocked ?? null;
    return [
      { id: "dqs", label: "DQS", value: dqs === null ? "—" : dqs.toFixed(1), unit: dqs === null ? undefined : "/ 100",
        delta: delta === null ? undefined : { value: delta, unit: " pts", direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
          semantic: delta > 0 ? "success" : delta < 0 ? "danger" : "neutral" } },
      { id: "critical", label: "Critical", value: (a?.severity.critical ?? 0).toLocaleString(), tone: a?.severity.critical ? "danger" : "neutral" },
      { id: "high", label: "High", value: (a?.severity.high ?? 0).toLocaleString(), tone: (a?.severity.high ?? 0) > 10 ? "warning" : "neutral" },
      { id: "records", label: "Records affected", value: (a?.affected_records ?? 0).toLocaleString() },
      { id: "blocked", label: "SAP features blocked", value: blocked === null ? "—" : blocked.toLocaleString(),
        tone: blocked ? "danger" : "neutral" },
    ];
  }, [a, dqs, impact.data]);

  const inbox = useMemo<CommandCentreInboxItem[]>(() => {
    const rows = [...(critical.data?.findings ?? []), ...(high.data?.findings ?? [])].filter((f) => f.affected_count > 0);
    return rows.slice(0, 12).map((f) => ({
      id: f.check_id, headline: headline(f), module: formatModuleName(f.module),
      severity: f.severity as CommandCentreInboxItem["severity"], age: relativeTime(f.created_at), affected: f.affected_count,
    }));
  }, [critical.data, high.data]);

  const trend = useMemo(() => (versions.data?.versions ?? [])
    .map((v) => ({ date: v.run_at.slice(0, 10), dqs: compositeDqs(v.dqs_summary) }))
    .filter((p): p is { date: string; dqs: number } => p.dqs !== null)
    .reverse(), [versions.data]);

  const issues = useMemo(() => (["critical", "high", "medium", "low"] as const)
    .map((s) => ({ severity: s, count: a?.severity[s] ?? 0 })), [a]);

  const arrivedJob = jobs.find((j) => j.kind !== "config_sync" && j.status === "completed"
    && nowSec - (j.finished_at ?? 0) < 900 && j.id !== dismissed);
  const dismiss = () => {
    if (!arrivedJob) return;
    try { sessionStorage.setItem(DISMISSED_KEY, arrivedJob.id); } catch { /* ignore */ }
    setDismissed(arrivedJob.id);
  };

  const empty = a && a.version_ids.length === 0 && !versions.isLoading && (versions.data?.versions.length ?? 0) === 0;

  return (
    <div className="aurora-cc">
      {empty ? (
        <div className="mn-legacy-host" style={{ margin: "0 0 var(--aurora-space-6)" }}>
          <GettingStarted hasAnalysis={false} />
        </div>
      ) : null}
      <CommandCentre
        arrival={arrivedJob ? {
          eyebrow: "Just finished", title: `${arrivedJob.label} is complete.`,
          body: arrivedJob.message,
          actions: <Button variant="secondary" onClick={() => { dismiss(); router.push("/?tab=findings"); }}>Open findings</Button>,
          onDismiss: dismiss,
        } : undefined}
        verdict={verdict}
        kpis={kpis}
        verdictActions={
          <>
            <Button variant="secondary" onClick={() => router.push("/?tab=report")}>Executive report</Button>
            <Button variant="ghost" onClick={() => router.push("/workbench")}>Open workbench</Button>
          </>
        }
        inbox={inbox}
        onInboxActivate={(item) => router.push(`/workbench?tab=triage&check_id=${encodeURIComponent(item.id)}`)}
        trend={trend}
        issues={issues}
      />
    </div>
  );
}
