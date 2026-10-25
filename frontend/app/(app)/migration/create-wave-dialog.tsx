"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Dialog, Field, Input, Select } from "@/design";
import { apiErrorMessage } from "@/lib/error";
import { createWave, updateWave } from "@/lib/api/migration";
import { getSystems } from "@/lib/api/connectivity";
import { useSystemScope } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";
import type { MigrationWave, WaveStage } from "@/types/api";

export const STAGE_LABEL: Record<WaveStage, string> = {
  plan: "Plan", mock1: "Mock 1", mock2: "Mock 2", dress: "Dress rehearsal", cutover: "Cutover",
};

/** Select cannot hold an empty value, so "no system" is a named choice. */
const NONE = "none";

function isWaveStage(v: string): v is WaveStage {
  return Object.hasOwn(STAGE_LABEL, v);
}

/** Creates a wave, or with `wave` edits that one (the cockpit's Edit wave). Remount with a key to reset it to the wave. */
export function CreateWaveDialog({ open, onOpenChange, wave }: { open: boolean; onOpenChange: (o: boolean) => void; wave?: MigrationWave }) {
  const qc = useQueryClient();
  const systemScope = useSystemScope();
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, enabled: open, select: systemScope });
  const [name, setName] = useState(wave?.name ?? "");
  const [source, setSource] = useState(wave?.source_system_id ?? "");
  const [target, setTarget] = useState(wave?.target_system_id ?? "");
  const [modules, setModules] = useState((wave?.modules ?? []).join(", "));
  const [date, setDate] = useState(wave?.target_date?.slice(0, 10) ?? "");
  const [stage, setStage] = useState<WaveStage>(wave?.stage ?? "plan");
  const [minReadiness, setMinReadiness] = useState(String(wave?.min_readiness ?? 95));
  const [tried, setTried] = useState(false);
  const readiness = Number(minReadiness);
  const errors = {
    name: !name.trim() ? "Give the wave a name" : undefined,
    readiness: minReadiness === "" || !Number.isFinite(readiness) || readiness < 0 || readiness > 100 ? "Enter a number from 0 to 100" : undefined,
  };
  const valid = !errors.name && !errors.readiness;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        source_system_id: source || null,
        target_system_id: target || null,
        modules: modules.split(",").map((m) => m.trim()).filter(Boolean),
        target_date: date || null,
        stage,
        min_readiness: Number(minReadiness),
      };
      return wave ? updateWave(wave.id, body) : createWave(body);
    },
    onSuccess: (w) => {
      toast.success(wave ? `Wave ${w.name} saved` : `Wave ${w.name} created`);
      void qc.invalidateQueries({ queryKey: queryKeys.migrationWaves() });
      if (wave) void qc.invalidateQueries({ queryKey: queryKeys.migrationCockpit(wave.id) });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const systemOptions = (systems.data ?? []).map((sys) => ({ value: sys.id, label: sys.name }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={wave ? "Edit wave" : "Create wave"}>
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (valid) save.mutate();
        }}
      >
        <p className="m-text-body m-ink-2">A wave is a group of objects you move to S/4HANA together. Meridian scores how ready they are to load.</p>
        <Field label="Name" error={tried ? errors.name : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Source system">
          <Select value={source || NONE} onValueChange={(v) => setSource(v === NONE ? "" : v)}
            options={[{ value: NONE, label: "None yet" }, ...systemOptions]} />
        </Field>
        <Field label="Target system">
          <Select value={target || NONE} onValueChange={(v) => setTarget(v === NONE ? "" : v)}
            options={[{ value: NONE, label: "S/4HANA standard" }, ...systemOptions]} />
        </Field>
        <Field label="Objects">
          <Input value={modules} onChange={(e) => setModules(e.target.value)} placeholder="material_master, accounts_payable" />
        </Field>
        <p className="m-text-meta m-ink-3">Object ids separated by commas. A wave needs a source system and at least one object before it can run.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Target date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Stage">
            <Select value={stage} onValueChange={(v) => { if (isWaveStage(v)) setStage(v); }}
              options={Object.entries(STAGE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
          </Field>
          <Field label="Ready at (%)" error={tried ? errors.readiness : undefined}>
            <Input type="number" min={0} max={100} value={minReadiness} onChange={(e) => setMinReadiness(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="submit" pending={save.isPending}>Save wave</Button>
        </div>
      </form>
    </Dialog>
  );
}
