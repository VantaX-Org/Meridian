"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { retryJob } from "../../lib/api/jobs";
import { getSystems } from "../../lib/api/connectivity";
import { queryKeys } from "../../lib/query-keys";
import { formatModuleName, shortList } from "../../lib/format";
import { apiErrorMessage } from "../../lib/error";
import { useRole } from "../../hooks/use-role";
import { JOBS_QUERY_KEY } from "../../hooks/use-jobs";
import type { Job } from "../../types/jobs";
import { Button } from "../primitives/Button";
import { ConfirmDialog } from "../primitives/ConfirmDialog";
import { Tooltip } from "../primitives/Tooltip";
import { toast } from "./Toaster";

/** The permission each retryable kind's start endpoint requires (api/routes/jobs.py RETRY). */
const RETRY_ACTION: Partial<Record<Job["kind"], string>> = {
  extraction: "trigger_sync", analysis: "analyse", config_load: "trigger_sync", process_discovery: "run_process_discovery",
};

/** The permission a retry of this job needs, or null when it cannot be retried (api/routes/jobs.py _retryable). */
export function retryAction(job: Job): string | null {
  if (job.status !== "failed") return null;
  if (job.kind === "extraction" && !(job.retry && job.system_id)) return null;
  if (job.kind === "analysis" && !job.version_id) return null;
  if ((job.kind === "config_load" || job.kind === "process_discovery") && !job.system_id) return null;
  return RETRY_ACTION[job.kind] ?? null;
}

/** Why a start the user cannot make is disabled, named by the permission it needs. */
const NEEDS: Record<string, string> = {
  trigger_sync: "Needs extract permission",
  analyse: "Needs analyse permission",
  run_process_discovery: "Needs process discovery permission",
};
export const needsPermission = (action: string): string => NEEDS[action] ?? "Needs a permission you do not have";

/** A start the user may not make: still shown, disabled, with the permission it needs as its tooltip (the GatedPrimary pattern). */
export function DisabledJobAction({ action, label, children }: { action: string; label: string; children: string }) {
  const reason = needsPermission(action);
  return (
    <Tooltip label={reason} render={<Button variant="secondary" size="sm" disabled aria-disabled="true" aria-label={`${label}. ${reason}`} />}>
      {children}
    </Tooltip>
  );
}

/** "Material master" -> "material master"; "FI general ledger" keeps its acronym. */
const inSentence = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** What will run again: "Extract material master from ECC PRD again". */
export function retrySentence(job: Job, systemName: string | undefined): string {
  const system = systemName ?? "its system";
  switch (job.kind) {
    case "extraction": {
      const names = (job.modules ?? []).map((m) => inSentence(formatModuleName(m)));
      const list = names.length <= 3 ? names.join(", ").replace(/, ([^,]*)$/, " and $1") : shortList(names, 3);
      return `Extract ${list} from ${system} again`;
    }
    case "analysis":
      return systemName ? `Analyse the ${systemName} data again` : "Analyse this version again";
    case "config_load":
      return `Load the configuration of ${system} again`;
    default:
      return `Run process discovery on ${system} again`;
  }
}

/** "Retry" on a failed job: for a user who holds its start permission it confirms what runs again, then queues it;
 * for anyone else it stays visible, disabled, naming the permission it needs. */
export function RetryJobButton({ job }: { job: Job }) {
  const { can, loading } = useRole();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: systems } = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, enabled: open });
  const action = retryAction(job);
  const sentence = retrySentence(job, systems?.find((s) => s.id === job.system_id)?.name);
  const retry = useMutation({
    mutationFn: () => retryJob(job.id),
    onSuccess: () => {
      setOpen(false);
      toast.success("Job queued", { description: sentence });
      void qc.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
    },
    onError: (e) => toast.error("Could not start the job again", { description: apiErrorMessage(e) }),
  });
  if (!action) return null;
  if (!can(action)) {
    // Fail closed while grants load: nothing, not a flash of "Needs ...".
    if (loading) return null;
    return <DisabledJobAction action={action} label={`Retry ${job.label}`}>Retry</DisabledJobAction>;
  }
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label={`Retry ${job.label}`}>Retry</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Run this job again?"
        body={sentence}
        confirmLabel="Run again"
        pending={retry.isPending}
        onConfirm={() => retry.mutate()}
      />
    </>
  );
}
