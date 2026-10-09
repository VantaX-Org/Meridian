"use client";

/**
 * Configuration load for one system: the card, its body and the start button,
 * built on @/design only. The load logic (useConfigLoad, configStatus,
 * hasNoConfig) lives here as well, so the panel owns everything it needs.
 */

import Link from "next/link";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, EmptyState, ErrorState, Mono, Pill, type PillTone } from "@/design";
import { getConfigLoad, startConfigLoad, type AreaObject, type AreaStatus, type ConfigLoad, type LoadArea } from "@/lib/api/config-load";
import { getJob } from "@/lib/api/jobs";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { SystemType } from "@/types/api";

const AREA_TONE: Record<AreaStatus, PillTone> = {
  waiting: "neutral",
  running: "neutral",
  loaded: "go",
  failed: "no-go",
  not_available: "neutral",
};
const AREA_LABEL: Record<AreaStatus, string> = {
  waiting: "Waiting",
  running: "Reading",
  loaded: "Loaded",
  failed: "Failed",
  not_available: "Not available",
};

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** The cause or outcome of one object's read, in plain words. The object name is shown separately in Mono, so it is not repeated here. */
function areaObjectText(o: AreaObject): string {
  if (o.cause === "auth") return `No authorisation to read this table.${o.detail ? ` ${o.detail}` : ""} The user needs read access to this table.`;
  if (o.cause === "timeout") return "Reading timed out. Try again outside peak hours or ask Basis to raise the RFC timeout.";
  if (o.state === "loaded") return `${o.rows.toLocaleString()} found.`;
  return o.detail || "Not read.";
}

/** One line per area: what was found (up to two objects), or that nothing was found. */
function areaFoundText(a: LoadArea): string {
  const found = a.objects.filter((o) => o.state === "loaded" && o.rows > 0).slice(0, 2);
  if (!found.length) return `No ${lower(a.label)} configuration found.`;
  return found.map((o) => `${o.rows.toLocaleString()} ${lower(o.label ?? o.object)}`).join(", ");
}

/** Area-by-area breakdown of a configuration load, grouped by business area. */
function AreaRows({ systemId, areas }: { systemId: string; areas: LoadArea[] }) {
  if (!areas.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>By area</p>
      {areas.map((a) => {
        const linkObject = a.status === "loaded" ? a.objects[0]?.object : undefined;
        return (
          <div key={a.area} className="flex flex-col gap-1 rounded border px-3 py-2" style={{ borderColor: "var(--m-line)" }}>
            <div className="flex items-center justify-between">
              {linkObject ? (
                <Link href={`/systems/${systemId}?tab=health&part=config&table=${encodeURIComponent(linkObject)}`} className="text-[13px] underline" style={{ color: "var(--m-ink)" }}>
                  {a.label}
                </Link>
              ) : (
                <span className="text-[13px]" style={{ color: "var(--m-ink)" }}>{a.label}</span>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>{a.tables_done} of {a.tables_total}</span>
                <Pill tone={AREA_TONE[a.status]}>{AREA_LABEL[a.status]}</Pill>
              </div>
            </div>
            {a.status === "running" || a.status === "waiting" ? (
              <div className="h-1 rounded overflow-hidden" style={{ background: "var(--m-line)" }}>
                <div
                  className="h-full"
                  style={{
                    background: "var(--m-accent)",
                    width: `${a.tables_total ? Math.round((a.tables_done / a.tables_total) * 100) : 0}%`,
                  }}
                />
              </div>
            ) : null}
            {a.status === "loaded" ? (
              <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>{areaFoundText(a)}</p>
            ) : null}
            {a.objects
              .filter((o) => o.state === "failed" || o.cause)
              .map((o) => (
                <p key={o.object} className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
                  <Mono>{o.object}</Mono>: {areaObjectText(o)}
                </p>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** SAP BTP has no business configuration to read. */
export const hasNoConfig = (t: SystemType) => t === "btp";

export type ConfigStatus = "loaded" | "gaps" | "loading" | "not_loaded" | "failed" | "not_available";

/** State of one system's configuration load (the job id lives in the query cache). */
export function useConfigLoad(systemId: string) {
  const qc = useQueryClient();
  const jobId = useQuery({
    queryKey: queryKeys.configLoadJobId(systemId), queryFn: () => null as string | null, initialData: null, staleTime: Infinity,
  }).data;
  const job = useQuery({
    queryKey: queryKeys.configLoadJob(jobId), enabled: !!jobId, queryFn: () => getJob(jobId!),
    refetchInterval: (q) => (q.state.data && ["completed", "failed"].includes(q.state.data.status) ? false : 2000),
  });
  const jobActive = !!jobId && (!job.data || !["completed", "failed"].includes(job.data.status));
  const load = useQuery({
    queryKey: queryKeys.configLoad(systemId), queryFn: () => getConfigLoad(systemId),
    refetchInterval: (q) => (jobActive || q.state.data?.status === "running" ? 2000 : false),
  });
  const jobDone = job.data?.status === "completed" || job.data?.status === "failed";
  useEffect(() => {
    if (jobDone) qc.invalidateQueries({ queryKey: queryKeys.configLoad(systemId) });
  }, [jobDone, qc, systemId]);

  const start = useMutation({
    mutationFn: () => startConfigLoad(systemId),
    onSuccess: (r) => { qc.setQueryData(queryKeys.configLoadJobId(systemId), r.job_id); toast.success("Loading configuration"); },
    onError: (e) => toast.error((e as Error).message || "Configuration not loaded"),
  });
  const running = jobActive || start.isPending || load.data?.status === "running";
  return {
    load: load.data ?? null,
    isLoading: load.isLoading,
    error: load.error as Error | null,
    job: job.data ?? null,
    running,
    start,
    refetch: load.refetch,
  };
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

export function ConfigLoadButton({ running, loaded, onClick }: { running: boolean; loaded: boolean; onClick: () => void }) {
  return (
    <Button variant="secondary" disabled={running} onClick={onClick}>
      {running ? "Loading…" : loaded ? "Load again" : "Load configuration"}
    </Button>
  );
}

const MAX_FAILED_ROWS = 8;

function Result({ systemId, load, retry, retrying, canLoad }: { systemId: string; load: ConfigLoad; retry: () => void; retrying: boolean; canLoad: boolean }) {
  const s = load.summary;
  const failed = load.objects.filter((o) => o.state === "failed");
  const na = s.not_available ?? 0;
  return (
    <div className="flex flex-col gap-2">
      {failed.length ? (
        <div className="flex items-center justify-between rounded border px-3 py-2" style={{ borderColor: "var(--m-medium)" }}>
          <p className="text-[13px]" style={{ color: "var(--m-ink)" }}>
            Configuration loaded with gaps. {load.areas_loaded} of {load.areas_total} areas loaded. Rules that depend on the others apply by default.
          </p>
          {canLoad ? <Button variant="secondary" disabled={retrying} onClick={retry}>Try again</Button> : null}
        </div>
      ) : null}
      <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
        Loaded {relativeTime(load.finished_at ?? load.created_at)}.
      </p>
      <dl className="grid grid-cols-2 gap-2 text-[13px]">
        <div><dt style={{ color: "var(--m-ink-2)" }}>Objects with rows</dt><dd>{(s.loaded ?? 0).toLocaleString()}</dd></div>
        <div><dt style={{ color: "var(--m-ink-2)" }}>Objects with no rows</dt><dd>{(s.empty ?? 0).toLocaleString()}</dd></div>
        <div>
          <dt style={{ color: "var(--m-ink-2)" }}>Processes derived</dt>
          <dd>{load.flows_derived ? <Link href="/process?tab=readiness" className="underline">View in Process</Link> : "None"}</dd>
        </div>
        {load.areas.length ? (
          <div><dt style={{ color: "var(--m-ink-2)" }}>Areas loaded</dt><dd>{load.areas_loaded} of {load.areas_total}</dd></div>
        ) : null}
      </dl>
      {load.areas.length ? (
        <AreaRows systemId={systemId} areas={load.areas} />
      ) : (
        <>
          {failed.slice(0, MAX_FAILED_ROWS).map((o) => (
            <p key={o.object} className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
              Could not read <Mono>{o.object}</Mono>.{o.detail ? ` ${o.detail}` : ""}
            </p>
          ))}
          {failed.length > MAX_FAILED_ROWS ? (
            <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>and {failed.length - MAX_FAILED_ROWS} more.</p>
          ) : null}
        </>
      )}
      {na ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
          Not available from this system: {na} {na === 1 ? "object" : "objects"}. Nothing to fix.
        </p>
      ) : null}
    </div>
  );
}

/** Configuration panel shown on the system page's Health tab. */
export function ConfigLoadPanel({ systemId, systemType, canLoad }: { systemId: string; systemType: SystemType; canLoad: boolean }) {
  const { load, running, job, start, isLoading, error, refetch } = useConfigLoad(systemId);
  const status = configStatus(load, running, systemType);
  const action = canLoad && !hasNoConfig(systemType) ? <ConfigLoadButton running={running} loaded={!!load} onClick={() => start.mutate()} /> : null;

  let body: React.ReactNode;
  if (status === "not_available") {
    body = (
      <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
        Not available from this system. {hasNoConfig(systemType) ? "SAP BTP has no business configuration to read; rules apply by default." : "It exposes no configuration to read; rules apply by default."}
      </p>
    );
  } else if (isLoading) {
    body = <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>Reading the configuration state.</p>;
  } else if (error) {
    body = <ErrorState message={`Configuration state could not be read. ${error.message}`} onRetry={() => void refetch()} />;
  } else if (status === "loading") {
    body = (
      <div className="flex flex-col gap-3">
        <div role="status" aria-live="polite" className="flex items-center gap-2">
          <Pill tone="neutral">{job?.stage ?? "Reading"}</Pill>
          <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
            {job?.message || "Reading configuration"}. You can leave this page; loading continues in the background.
          </p>
        </div>
        <AreaRows systemId={systemId} areas={load?.areas ?? []} />
      </div>
    );
  } else if (status === "failed") {
    const timedOut = (load?.error ?? job?.error ?? "") === "Timed out";
    body = (
      <ErrorState
        message={timedOut
          ? "Reading took too long. Nothing was saved. Try again outside peak hours."
          : `Something failed on our side. Nothing was saved. ${load?.error ?? ""}`.trim()}
        onRetry={canLoad ? () => start.mutate() : undefined}
      />
    );
  } else if (status === "not_loaded" || !load) {
    body = (
      <EmptyState
        title="Not loaded. Rules apply by default until you load it."
        action={canLoad ? <Button onClick={() => start.mutate()}>Load configuration</Button> : undefined}
      />
    );
  } else {
    body = <Result systemId={systemId} load={load} retry={() => start.mutate()} retrying={start.isPending} canLoad={canLoad} />;
  }

  return (
    <div className="rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Configuration</p>
        {action}
      </div>
      <div className="mt-2">{body}</div>
    </div>
  );
}
