"use client";

/**
 * "Raise an exception" from a failing record: opens a tracked exception (POST /exceptions) for a record the team
 * will not fix in this run. It needs `analyse` or `run_process_discovery`, as the API does; a denial opens the
 * request-access dialog through the API client.
 */

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Dialog, Field, Select, Textarea } from "@/design";
import { createException } from "@/lib/api/exceptions";
import type { WorkRecordDetail, WorkSeverity } from "@/lib/api/work";
import { usePermissions } from "@/lib/permissions";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";

type ExceptionSeverity = "critical" | "high" | "medium" | "low";
const SEVERITIES: { value: ExceptionSeverity; label: string }[] = [
  { value: "critical", label: "Critical" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" },
];
const RANK: Record<WorkSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** The worst severity among the record's failing checks; the exception starts there. */
export function worstSeverity(issues: Pick<WorkRecordDetail["issues"][number], "severity">[]): ExceptionSeverity {
  const worst = issues.reduce<WorkSeverity>((w, i) => (RANK[i.severity] > RANK[w] ? i.severity : w), "info");
  return worst === "info" ? "low" : worst;
}

/** The request body for one record: the reason is the description, the failing checks ride in `affected_records`. */
export function exceptionBody(rec: Pick<WorkRecordDetail, "module" | "record_key" | "issues">, reason: string, severity: ExceptionSeverity) {
  const checks = rec.issues.map((i) => i.check_id);
  return {
    type: "dq_rule",
    category: "data_quality",
    severity,
    title: `${formatModuleName(rec.module)} record ${rec.record_key}: ${checks.length} failing ${checks.length === 1 ? "check" : "checks"}`,
    description: reason.trim(),
    affected_records: { module: rec.module, record_key: rec.record_key, check_ids: checks },
    object_type: rec.module,
  };
}

export function RaiseException({ rec }: { rec: WorkRecordDetail }) {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [severity, setSeverity] = useState<ExceptionSeverity>(() => worstSeverity(rec.issues));
  const raise = useMutation({
    mutationFn: () => createException(exceptionBody(rec, reason, severity)),
    onSuccess: () => {
      setOpen(false);
      setReason("");
      toast.success("Exception raised", { action: <Link href="/inbox?kind=exception" data-button="">Open exceptions</Link> });
      void qc.invalidateQueries({ queryKey: ["exceptions"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  if (!can("analyse") && !can("run_process_discovery")) return null;
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>Raise an exception</Button>
      <Dialog
        open={open}
        onOpenChange={(o) => { if (!raise.isPending) setOpen(o); }}
        title="Raise an exception"
        footer={
          <>
            <Button variant="secondary" disabled={raise.isPending} onClick={() => setOpen(false)}>Keep working</Button>
            <Button pending={raise.isPending} disabled={!reason.trim()} onClick={() => raise.mutate()}>Raise exception</Button>
          </>
        }
      >
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) raise.mutate(); }}>
          <p className="m-text-body m-ink-2">
            Track this record under Exceptions in the Inbox when it will not be fixed in this run. The exception keeps its own owner and due date.
          </p>
          <Field label="Reason">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} autoFocus />
          </Field>
          <Select label="Severity" value={severity} onValueChange={(v) => setSeverity(v as ExceptionSeverity)} options={SEVERITIES} />
        </form>
      </Dialog>
    </>
  );
}
