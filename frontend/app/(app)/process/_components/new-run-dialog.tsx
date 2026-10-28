"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button, Checkbox, Dialog, Field, Input, Mono, Notice, RadioGroup } from "@/design";
import { startRuns, type CatalogueRow, type RunMode } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";

/**
 * What a discovery run reads from SAP and roughly how long it takes: the one sentence the dialog and every
 * "Run discovery" empty state show. The worker's time limit is two hours (workers/tasks/run_process_discovery.py,
 * spec §8.2); the tables per process are spec §1.2.
 */
export const discoveryReads = (systemName: string): string =>
  `Discovery reads the document and change tables of each process from ${systemName} and mines how it really runs; a full run takes from a few minutes to two hours, depending on volume.`;

/**
 * §7.3 "New run": L1 multi-select (all by default, or only the `?l1=` the link named, or `only`), mode (incremental
 * once a run completed), period start (full only).
 */
export function NewRunDialog({ open, onOpenChange, systemId, systemName, rows, only: onlyProp }: {
  open: boolean; onOpenChange: (open: boolean) => void; systemId: string; systemName: string; rows: CatalogueRow[];
  /** Preselect this L1 alone (the L1 page); otherwise `?l1=`, else every L1. */
  only?: string;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const urlOnly = useSearchParams().get("l1");
  const only = onlyProp ?? urlOnly;
  const hasCompleted = rows.some((r) => r.last_run && r.coverage !== "reference");
  // Licence-blocked L1s are never on by default: selecting one made every default "Start run" 402 on a
  // tenant whose licence lacks its event-log modules (QM/PS on a pilot tenant), and the dialog read that as
  // "Could not reach the server." They stay listed, disabled, so the offer and the refusal match.
  const [l1s, setL1s] = useState<string[]>(() => (only && rows.some((r) => r.l1 === only) ? [only] : rows.filter((r) => !r.licence_blocked).map((r) => r.l1)));
  const [mode, setMode] = useState<RunMode>(hasCompleted ? "incremental" : "full");
  const [periodFrom, setPeriodFrom] = useState("");
  const start = useMutation({
    mutationFn: () => startRuns(systemId, { l1s, mode, period_from: mode === "full" && periodFrom ? periodFrom : null }),
    onSuccess: (res) => {
      toast(`Discovery started for ${l1s.length} ${l1s.length === 1 ? "process" : "processes"}`);
      qc.invalidateQueries({ queryKey: ["process"] });
      onOpenChange(false);
      if (res.run_ids.length === 1) router.push(`/process/runs/${res.run_ids[0]}`);
    },
  });
  const toggle = (l1: string) => setL1s((cur) => (cur.includes(l1) ? cur.filter((x) => x !== l1) : [...cur, l1]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New discovery run"
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Close without starting</Button>
        <Button onClick={() => start.mutate()} pending={start.isPending} disabled={!l1s.length}>Start run</Button>
      </>}>
      <div className="grid gap-4">
        <p>System: <strong>{systemName}</strong></p>
        <p className="m-ink-2">{discoveryReads(systemName)}</p>
        <fieldset className="grid gap-1">
          <legend className="m-field-label mb-1">Processes</legend>
          <div className="grid grid-cols-2 gap-1">
            {rows.map((r) => (
              <label key={r.l1} className="flex items-center gap-2">
                <Checkbox aria-label={`Include ${r.l1}`} disabled={!!r.licence_blocked} checked={l1s.includes(r.l1)} onChange={() => toggle(r.l1)} />
                <Mono>{r.l1}</Mono> {r.name}
                {r.licence_blocked && <span className="m-text-meta m-ink-3">— not in this licence</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <RadioGroup legend="Mode" name="mode" value={mode} onValueChange={(v) => setMode(v as RunMode)}
          options={[
            { value: "incremental", label: "Incremental: from the last run, with a 14-day overlap" },
            { value: "full", label: "Full" },
          ]} />
        {mode === "full" && (
          <Field label="Period start (blank: the whole history)">
            <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </Field>
        )}
        {start.isError && <Notice tone="danger" title="Could not start the run">{apiErrorMessage(start.error)}</Notice>}
      </div>
    </Dialog>
  );
}
