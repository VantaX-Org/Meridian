"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Checkbox, Dialog, Field, Input, Mono, Notice } from "@/design";
import { startRuns, type CatalogueRow, type RunMode } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";

/** §7.3 "New run": L1 multi-select (all by default), mode (incremental once a run completed), period start (full only). */
export function NewRunDialog({ open, onOpenChange, systemId, systemName, rows }: {
  open: boolean; onOpenChange: (open: boolean) => void; systemId: string; systemName: string; rows: CatalogueRow[];
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const hasCompleted = rows.some((r) => r.last_run && r.coverage !== "reference");
  const [l1s, setL1s] = useState<string[]>(() => rows.map((r) => r.l1));
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
        <fieldset className="grid gap-1">
          <legend className="m-field-label mb-1">Processes</legend>
          <div className="grid grid-cols-2 gap-1">
            {rows.map((r) => (
              <label key={r.l1} className="flex items-center gap-2">
                <Checkbox aria-label={`Include ${r.l1}`} checked={l1s.includes(r.l1)} onChange={() => toggle(r.l1)} />
                <Mono>{r.l1}</Mono> {r.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-1">
          <legend className="m-field-label mb-1">Mode</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === "incremental"} onChange={() => setMode("incremental")} />
            Incremental: from the last run, with a 14-day overlap
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === "full"} onChange={() => setMode("full")} />
            Full
          </label>
        </fieldset>
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
