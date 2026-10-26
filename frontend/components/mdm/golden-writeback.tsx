"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Drawer, ErrorState, Mono, Notice, Pill, Skeleton, toast, type PillTone } from "@/design";
import { GatedPrimary } from "@/components/gated-primary";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatDate } from "@/lib/format";
import {
  getWritebackPreview, getWritebackRequests, requestWriteback, submitWriteback,
  type WritebackField, type WritebackFieldResult, type WritebackRequest, type WritebackStatus, type WritebackTarget,
} from "@/lib/api/golden-writeback";

/**
 * "Write back to SAP" for a golden record: the target systems (the record's source systems), the field diff,
 * a simulation (the worker reads SAP and diffs, nothing is written), then a request for a second person to
 * approve in the inbox. After approval the worker writes; the per-field results show here.
 * API: api/routes/golden_writeback.py.
 */

export const STATUS_LABEL: Record<WritebackStatus, string> = {
  simulating: "Simulating",
  simulated: "Simulated",
  simulation_failed: "Simulation failed",
  pending_approval: "Waiting for approval",
  approved: "Approved, writing soon",
  applying: "Writing to SAP",
  applied: "Written to SAP",
  applied_with_errors: "Written with errors",
  failed: "Write failed",
  rejected: "Rejected",
  cancelled: "Replaced by a newer simulation",
};

const STATUS_TONE: Record<WritebackStatus, PillTone> = {
  simulating: "info", simulated: "info", simulation_failed: "no-go", pending_approval: "at-risk",
  approved: "info", applying: "info", applied: "go", applied_with_errors: "at-risk", failed: "no-go",
  rejected: "neutral", cancelled: "neutral",
};

export const RESULT_LABEL: Record<WritebackFieldResult, string> = {
  would_change: "Will change",
  unchanged: "Already matches",
  written: "Written",
  error: "Error",
  unsupported: "Not supported",
};

const RESULT_TONE: Record<WritebackFieldResult, PillTone> = {
  would_change: "info", unchanged: "neutral", written: "go", error: "no-go", unsupported: "neutral",
};

const RUNNING: WritebackStatus[] = ["simulating", "approved", "applying"];
const CLOSED: WritebackStatus[] = ["cancelled", "rejected"];

const METHOD_LABEL = { odata_patch: "OData PATCH", rfc_bapi: "RFC BAPI" } as const;

const show = (v: unknown) => (v == null || v === "" ? "blank" : String(v));

const fieldCols: ColumnDef<WritebackField>[] = [
  { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
  { id: "golden", header: "Golden value", cell: ({ row }) => <Mono>{show(row.original.golden_value)}</Mono> },
  {
    id: "current", header: "In SAP now",
    cell: ({ row }) => ("current_value" in row.original ? <Mono>{show(row.original.current_value)}</Mono> : <span className="m-ink-3">Not read yet</span>),
  },
  {
    id: "result", header: "Result",
    cell: ({ row }) => {
      const f = row.original;
      const result: WritebackFieldResult | undefined = f.result ?? (f.supported ? undefined : "unsupported");
      const note = f.message ?? (f.supported ? null : f.reason);
      return (
        <span className="flex flex-col gap-1">
          {result ? <Pill tone={RESULT_TONE[result]}>{RESULT_LABEL[result]}</Pill> : <span className="m-ink-3">Simulate to see</span>}
          {note ? <span className="m-text-meta m-ink-3">{note}</span> : null}
        </span>
      );
    },
  },
];

function TargetSection({ target }: { target: WritebackTarget }) {
  return (
    <section aria-label={`Target ${target.system_name}`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="m-text-body font-medium m-ink">{target.system_name}</span>
        <Mono>{target.system_type}</Mono>
        {target.supported && target.method
          ? <Pill tone="go">{METHOD_LABEL[target.method]}</Pill>
          : <Pill tone="neutral">Not supported</Pill>}
      </div>
      {!target.supported && target.reason ? <p className="m-text-meta m-ink-3">{target.reason}</p> : null}
      <DataTable
        columns={fieldCols}
        data={target.fields}
        getRowId={(f) => f.field}
        height="auto"
        hideToolbar
        label={`Fields for ${target.system_name}`}
      />
    </section>
  );
}

/** One line under the record's actions: the latest write-back and where it stands. */
export function WritebackStatusLine({ request }: { request: WritebackRequest }) {
  const c = request.counts;
  const parts = [
    c.written ? `${c.written} written` : null,
    c.would_change ? `${c.would_change} to change` : null,
    c.unchanged ? `${c.unchanged} already match` : null,
    c.error ? `${c.error} failed` : null,
  ].filter(Boolean);
  return (
    <p className="flex flex-wrap items-center gap-2 m-text-body m-ink-2" data-testid="writeback-status">
      <span>Write-back to SAP:</span>
      <Pill tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Pill>
      {parts.length ? <span className="m-ink-3">{parts.join(", ")}</span> : null}
      {request.applied_at ? <span className="m-ink-3">{formatDate(request.applied_at, "datetime")}</span> : null}
    </p>
  );
}

export function GoldenWriteback({ recordId, status }: { recordId: string; status: string }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const [open, setOpen] = useState(false);
  const isGolden = status === "golden";

  const requestsKey = ["master-records", recordId, "writeback", "requests"] as const;
  const requests = useQuery({
    queryKey: requestsKey,
    queryFn: () => getWritebackRequests(recordId),
    enabled: isGolden,
    refetchInterval: (q) => (q.state.data?.requests[0] && RUNNING.includes(q.state.data.requests[0].status) ? 2000 : false),
    meta: { ignoreError: true },
  });
  const preview = useQuery({
    queryKey: ["master-records", recordId, "writeback", "preview"],
    queryFn: () => getWritebackPreview(recordId),
    enabled: open && isGolden,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: requestsKey });
  const simulate = useMutation({
    mutationFn: () => requestWriteback(recordId),
    onSuccess: refresh,
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const submit = useMutation({
    mutationFn: (requestId: string) => submitWriteback(recordId, requestId),
    onSuccess: () => {
      refresh();
      toast.success("Sent for approval. A second person approves it in the inbox.");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (!isGolden) return null;

  const latest = requests.data?.requests[0];
  const current = latest && !CLOSED.includes(latest.status) ? latest : undefined;
  const targets = current?.targets ?? preview.data?.targets ?? [];
  const busy = current ? ["pending_approval", ...RUNNING].includes(current.status) : false;
  const canSubmit = current?.status === "simulated" && (current.counts.would_change ?? 0) > 0;

  const footer = (
    <div className="flex w-full justify-end gap-2">
      <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
      {canSubmit ? (
        <Button disabled={submit.isPending} onClick={() => submit.mutate(current.id)}>
          {submit.isPending ? "Requesting…" : "Request approval"}
        </Button>
      ) : (
        <Button
          disabled={!preview.data?.writeback_supported || busy || simulate.isPending}
          onClick={() => simulate.mutate()}
        >
          {current?.status === "simulating" || simulate.isPending ? "Simulating…" : current ? "Simulate again" : "Simulate"}
        </Button>
      )}
    </div>
  );

  return (
    <>
      <GatedPrimary kind="writeback" allowed={can("apply")} variant="secondary" onClick={() => setOpen(true)}>
        Write back to SAP
      </GatedPrimary>
      {latest ? <WritebackStatusLine request={latest} /> : null}
      <Drawer open={open} onOpenChange={setOpen} title="Write back to SAP" subtitle="Simulated first, then approved by a second person" footer={footer}>
        <div className="flex flex-col gap-4">
          {preview.isLoading ? <Skeleton height={120} /> : preview.isError ? (
            <ErrorState {...apiErrorState(preview.error)} onRetry={() => void preview.refetch()} />
          ) : preview.data ? (
            <>
              <Notice tone={preview.data.writeback_supported ? "info" : "warning"}>{preview.data.message}</Notice>
              {!preview.data.live_enabled ? (
                <Notice tone="warning" title="Live SAP write-back is off on this deployment">
                  You can simulate and request approval, but approval is refused until an administrator switches it on.
                </Notice>
              ) : null}
              {preview.data.unresolved_sources.length ? (
                <p className="m-text-meta m-ink-3">
                  No registered system for {preview.data.unresolved_sources.map((s, i) => <span key={s}>{i ? ", " : ""}<Mono>{s}</Mono></span>)}.
                </p>
              ) : null}
            </>
          ) : null}
          {current ? (
            <div className="flex flex-col gap-1">
              <WritebackStatusLine request={current} />
              {current.status === "pending_approval" ? (
                <p className="m-text-meta m-ink-3">
                  Waiting in the <Link className="m-ink-accent underline" href="/inbox">inbox</Link>. You cannot approve a write-back you requested.
                </p>
              ) : null}
              {current.status === "simulated" && !canSubmit ? (
                <p className="m-text-meta m-ink-3">The simulation found nothing to change in SAP.</p>
              ) : null}
              {current.error ? <p className="m-text-meta m-ink-3">{current.error}</p> : null}
            </div>
          ) : null}
          {targets.map((t) => <TargetSection key={t.system_id} target={t} />)}
        </div>
      </Drawer>
    </>
  );
}
