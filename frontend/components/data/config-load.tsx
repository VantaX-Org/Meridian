"use client";

/**
 * Load configuration: one read-only job per system that reads its customizing,
 * derives process flows and reads customizing change history. The register
 * drawer offers it (it starts when the system is connected) and the system
 * page owns it (ConfigLoadCard). Shapes: lib/api/config-load.ts.
 */

import Link from "next/link";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, Stack, Text } from "@/components/aurora";
import { EmptyState, KeyValue, Mono, SectionCard, StatusBadge, type Status } from "@/components/ui-core";
import { ProgressBar, StageStepper } from "@/components/data/job-card";
import {
  getConfigLoad, startConfigLoad, type Applicability, type ConfigLoad, type ConfiguredIn, type LoadArea, type SystemConfigState,
} from "@/lib/api/config-load";
import { getJob } from "@/lib/api/jobs";
import { formatDate, relativeTime } from "@/lib/format";
import type { SystemType } from "@/types/api";
import type { JobStage, JobStageStatus } from "@/types/jobs";

const ABAP_TYPES: SystemType[] = ["ecc", "s4hana_onprem", "ewm"];
/** SAP BTP has no business configuration to read. */
export const hasNoConfig = (t: SystemType) => t === "btp";

export type ConfigStatus = "loaded" | "gaps" | "loading" | "not_loaded" | "failed" | "not_available";

const STATE_BADGE: Record<SystemConfigState, { status: Status; label: string }> = {
  loaded: { status: "ok", label: "Loaded" }, with_gaps: { status: "medium", label: "With gaps" }, loading: { status: "running", label: "Loading" },
  not_loaded: { status: "idle", label: "Not loaded" }, failed: { status: "failed", label: "Failed" }, not_available: { status: "idle", label: "Not available" },
};
export const ConfigStateBadge = ({ state }: { state: SystemConfigState }) => <StatusBadge status={STATE_BADGE[state].status}>{STATE_BADGE[state].label}</StatusBadge>;

const APPLIES_BADGE: Record<Applicability, { status: Status; label: string }> = {
  applies: { status: "ok", label: "Applies" }, does_not_apply: { status: "idle", label: "Does not apply" },
  applies_by_default: { status: "idle", label: "Applies by default" }, not_available: { status: "idle", label: "Not available" },
};
export const ApplicabilityBadge = ({ a }: { a: Applicability }) => <StatusBadge status={APPLIES_BADGE[a].status}>{APPLIES_BADGE[a].label}</StatusBadge>;

/** Where configuration is maintained: IMG path then transaction (ABAP), admin path (cloud). Nothing when unknown. */
export function ConfiguredInText({ items }: { items: ConfiguredIn[] }) {
  return (
    <>
      {items.map((c) => (
        <span key={`${c.path}-${c.tcode ?? ""}`} style={{ display: "block" }}>
          {c.kind === "img" ? "IMG: " : ""}{c.path}{c.tcode ? <> <Mono>{c.tcode}</Mono></> : null}
        </span>
      ))}
    </>
  );
}

const jobIdKey = (systemId: string) => ["config-load-job-id", systemId] as const;

export function ReadsLine({ type }: { type: SystemType }) {
  return <>{ABAP_TYPES.includes(type) ? "Reads customizing tables over RFC. Read-only." : "Reads configuration through the API. Read-only."}</>;
}

/** State of one system's configuration load, shared by every card that shows it (the job id lives in the query cache). */
export function useConfigLoad(systemId: string) {
  const qc = useQueryClient();
  const jobId = useQuery({ queryKey: jobIdKey(systemId), queryFn: () => null as string | null, initialData: null, staleTime: Infinity }).data;
  const job = useQuery({
    queryKey: ["config-load-job", jobId], enabled: !!jobId, queryFn: () => getJob(jobId!),
    refetchInterval: (q) => (q.state.data && ["completed", "failed"].includes(q.state.data.status) ? false : 2000),
  });
  const jobActive = !!jobId && (!job.data || !["completed", "failed"].includes(job.data.status));
  const load = useQuery({
    queryKey: ["config-load", systemId], queryFn: () => getConfigLoad(systemId),
    refetchInterval: (q) => (jobActive || q.state.data?.status === "running" ? 2000 : false),
  });
  const jobDone = job.data?.status === "completed" || job.data?.status === "failed";
  useEffect(() => {
    if (jobDone) qc.invalidateQueries({ queryKey: ["config-load", systemId] });
  }, [jobDone, qc, systemId]);

  const start = useMutation({
    mutationFn: () => startConfigLoad(systemId),
    onSuccess: (r) => { qc.setQueryData(jobIdKey(systemId), r.job_id); toast.success("Loading configuration"); },
    onError: (e) => toast.error((e as Error).message || "Configuration not loaded"),
  });
  const running = jobActive || start.isPending || load.data?.status === "running";
  return { load: load.data ?? null, isLoading: load.isLoading, error: load.error as Error | null, job: job.data ?? null, running, start };
}

export function configStatus(load: ConfigLoad | null, running: boolean, type: SystemType): ConfigStatus {
  if (hasNoConfig(type)) return "not_available";
  if (running) return "loading";
  if (!load) return "not_loaded";
  if (load.status === "failed") return "failed";
  if (load.status === "running") return "loading";
  const s = load.summary;
  if (!(s.loaded ?? 0) && !(s.empty ?? 0) && !(s.failed ?? 0)) return "not_available";
  return (s.failed ?? 0) > 0 ? "gaps" : "loaded";
}

function stages(load: ConfigLoad | null, stage: string | null | undefined, failed: boolean): JobStage[] {
  const order = stage === "derive" ? 2 : stage === "connect" ? 0 : 1;
  const at = (i: number): JobStageStatus => (failed && i === order ? "failed" : i < order ? "done" : i === order ? "running" : "queued");
  const done = load?.status === "completed";
  const s = (i: number): JobStageStatus => (done ? "done" : at(i));
  return [{ id: "connect", label: "Connected", status: s(0) }, { id: "read", label: "Loading configuration", status: s(1) },
    { id: "derive", label: "Processes derived", status: s(2) }];
}

function History({ load }: { load: ConfigLoad }) {
  const h = load.history;
  if (h.available === false) return <>Change history is not available from this system.</>;
  if (h.table_logging_off) {
    return <>Table logging is off, so change history is not available. Ask Basis to set <Mono>rec/client</Mono> to log customizing if you need it.</>;
  }
  const dates = load.objects.map((o) => o.history?.last_change).filter((d): d is string => !!d).sort();
  const changes = load.objects.reduce((a, o) => a + (o.history?.changes_in_window ?? 0), 0);
  if (!dates.length) return <>No customizing changes in the last year.</>;
  return <>Customizing last changed {formatDate(dates[dates.length - 1])}, {changes.toLocaleString()} changes in the last year.</>;
}

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** One short clause per found count, at most two, in plain English; the cause and fix when an object did not load. */
function areaText(a: LoadArea) {
  const failed = a.objects.find((o) => o.state === "failed");
  if (failed) {
    const what = <Mono>{failed.object}</Mono>;
    if (failed.cause === "auth") return <>Could not read {what}. The user needs read access to this table.</>;
    if (failed.cause === "timeout") return <>Reading {what} took too long. Try again outside peak hours or ask Basis to raise the RFC timeout.</>;
    return <>Could not read {what}.{failed.detail ? ` ${failed.detail}` : ""}</>;
  }
  const found = a.objects.filter((o) => o.state === "loaded" && o.rows > 0).slice(0, 2);
  if (!found.length) return <>No {lower(a.label)} configuration found.</>;
  return <>{found.map((o) => `${o.rows.toLocaleString()} ${lower(o.label ?? o.object)}`).join(", ")}</>;
}

/** Area rows of a load: progress while reading, found counts when done, the fix when an area failed. */
export function AreaRows({ areas, systemId }: { areas: LoadArea[]; systemId?: string }) {
  if (!areas.length) return null;
  return (
    <div role="status" aria-live="polite" aria-atomic="false" className="ui-stack">
      {areas.map((a) => {
        const na = a.status === "not_available";
        const link = systemId && a.status === "loaded" && a.objects[0]
          ? `/systems/${systemId}?tab=health&part=config&table=${encodeURIComponent(a.objects[0].object)}` : null;
        const body = a.status === "waiting" ? <Text variant="text-small" tone="muted">waiting</Text>
          : a.status === "running" ? (
            <Text variant="text-small" tone="secondary"><span className="aurora-number">{a.tables_done} of {a.tables_total} tables</span></Text>)
          : na ? <Text variant="text-small" tone="secondary">Not available from this system.</Text>
          : <Text variant="text-small" tone="secondary">{areaText(a)}</Text>;
        const row = (
          <span style={{ display: "grid", gridTemplateColumns: "9rem 1fr", gap: "var(--aurora-space-3)", alignItems: "baseline" }}>
            <Text as="span" variant="text-small" tone="primary">{a.label}</Text>
            <span>
              {a.status === "running" || a.status === "waiting" ? (
                <ProgressBar percent={a.tables_total ? (a.tables_done / a.tables_total) * 100 : 0} live={a.status === "running"} label={`${a.label} tables read`} />
              ) : null}
              {body}
            </span>
          </span>
        );
        return link ? <Link key={a.area} className="ui-link" href={link}>{row}</Link> : <div key={a.area}>{row}</div>;
      })}
    </div>
  );
}

function Result({ load, type, systemId, retry, retrying, canLoad }: { load: ConfigLoad; type: SystemType; systemId: string; retry: () => void; retrying: boolean; canLoad: boolean }) {
  const s = load.summary;
  const failed = load.objects.filter((o) => o.state === "failed");
  const na = s.not_available ?? 0;
  const read = (s.loaded ?? 0) + (s.empty ?? 0);
  const total = load.objects.length;
  const cloud = !ABAP_TYPES.includes(type);
  return (
    <Stack gap={3}>
      {failed.length ? (
        <Banner tone="warning" title="Configuration loaded with gaps"
          action={canLoad ? <Button size="sm" variant="secondary" onClick={retry} disabled={retrying}>Try again</Button> : undefined}>
          {load.areas_loaded} of {load.areas_total} areas loaded ({read} of {total} {cloud ? "objects" : "tables"} read). Rules that depend on the others apply by default.
        </Banner>
      ) : null}
      <Text variant="text-small" tone="secondary">
        Loaded {relativeTime(load.finished_at ?? load.created_at)}. <History load={load} />
      </Text>
      <KeyValue rows={[
        { k: "Areas loaded", v: `${load.areas_loaded} of ${load.areas_total}` },
        { k: cloud ? "Objects with rows" : "Tables with rows", v: (s.loaded ?? 0).toLocaleString() },
        { k: cloud ? "Objects with no rows" : "Tables with no rows", v: (s.empty ?? 0).toLocaleString() },
        { k: "Processes derived", v: load.flows_derived ? (
          <Link className="ui-link" href="/process?tab=readiness">View in Process</Link>) : "None" },
      ]} />
      <AreaRows areas={load.areas} systemId={systemId} />
      {na ? <Text variant="text-small" tone="secondary">Not available from this system: {na} {na === 1 ? "object" : "objects"}. Nothing to fix.</Text> : null}
    </Stack>
  );
}

function Failure({ load, jobError, jobId, retry, retrying, canLoad }: {
  load: ConfigLoad | null; jobError: string | null; jobId: string | null; retry: () => void; retrying: boolean; canLoad: boolean;
}) {
  const timedOut = (load?.error ?? jobError ?? "") === "Timed out";
  return (
    <Stack gap={3}>
      <Banner tone="danger" title="Configuration could not be loaded">
        {timedOut ? "Reading took too long. Nothing was saved. Try again outside peak hours."
          : <>Something failed on our side. Nothing was saved. Try again; if it fails twice, send the job id <Mono>{jobId ?? load?.load_id ?? ""}</Mono> to support.</>}
      </Banner>
      {load?.error && !timedOut ? <Text variant="text-small" tone="secondary">{load.error}</Text> : null}
      {canLoad ? <div><Button size="sm" onClick={retry} disabled={retrying}>Try again</Button></div> : null}
    </Stack>
  );
}

/** Body of the Configuration card on the system page: every state of the load. */
export function ConfigLoadBody({ systemId, systemType, canLoad }: { systemId: string; systemType: SystemType; canLoad: boolean }) {
  const { load, running, job, start, isLoading, error } = useConfigLoad(systemId);
  const status = configStatus(load, running, systemType);
  if (status === "not_available") {
    return <Text tone="secondary">Not available from this system. {hasNoConfig(systemType) ? "SAP BTP has no business configuration to read; rules apply by default." : "It exposes no configuration to read; rules apply by default."}</Text>;
  }
  if (isLoading) return <Text tone="secondary">Reading the configuration state.</Text>;
  if (error) return <Banner tone="danger" title="Configuration state could not be read">{error.message}</Banner>;
  if (status === "loading") {
    return (
      <div role="status" aria-live="polite" aria-atomic="false">
        <Stack gap={3}>
          <StageStepper stages={stages(load, job?.stage, false)} />
          <AreaRows areas={load?.areas ?? []} />
          <Text variant="text-small" tone="secondary">{job?.message || "Reading configuration"}. You can leave this page; loading continues in the background.</Text>
        </Stack>
      </div>
    );
  }
  if (status === "failed") {
    return <Failure load={load} jobError={job?.error ?? null} jobId={job?.id ?? null} retry={() => start.mutate()} retrying={start.isPending} canLoad={canLoad} />;
  }
  if (status === "not_loaded" || !load) {
    return (
      <EmptyState action={canLoad ? <Button size="sm" onClick={() => start.mutate()}>Load configuration</Button> : undefined}>
        Not loaded. Rules apply by default until you load it.
      </EmptyState>
    );
  }
  return <Result load={load} type={systemType} systemId={systemId} retry={() => start.mutate()} retrying={start.isPending} canLoad={canLoad} />;
}

export function ConfigLoadCard({ systemId, systemType, canLoad }: { systemId: string; systemType: SystemType; canLoad: boolean }) {
  const { load, running, start } = useConfigLoad(systemId);
  const action = canLoad && !hasNoConfig(systemType) ? (
    <ConfigLoadButton running={running} loaded={!!load} onClick={() => start.mutate()} />
  ) : undefined;
  return (
    <SectionCard title="Configuration" action={action}>
      <ConfigLoadBody systemId={systemId} systemType={systemType} canLoad={canLoad} />
    </SectionCard>
  );
}

export function ConfigLoadButton({ running, loaded, onClick }: { running: boolean; loaded: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="secondary" disabled={running} onClick={onClick}>
      {running ? "Loading…" : loaded ? "Load again" : "Load configuration"}
    </Button>
  );
}

/** Register drawer step, shown after a successful test. The load starts when the system is connected. */
export function ConfigLoadChoice({ systemType, skipped, onChange }: { systemType: SystemType; skipped: boolean; onChange: (skip: boolean) => void }) {
  return (
    <SectionCard title="Configuration">
      {hasNoConfig(systemType) ? (
        <Text tone="secondary">Not available from this system. SAP BTP has no business configuration to read; rules apply by default.</Text>
      ) : skipped ? (
        <EmptyState action={<Button size="sm" variant="ghost" onClick={() => onChange(false)}>Load now</Button>}>
          Not loaded. Rules apply by default until you load it from the system page.
        </EmptyState>
      ) : (
        <Stack gap={3}>
          <Text variant="text-small" tone="secondary">
            Load this system&apos;s configuration so rules apply only where it is set up. <ReadsLine type={systemType} /> Loading starts when you connect and continues in the background.
          </Text>
          <div><Button type="button" size="sm" variant="ghost" onClick={() => onChange(true)}>Skip for now</Button></div>
        </Stack>
      )}
    </SectionCard>
  );
}
