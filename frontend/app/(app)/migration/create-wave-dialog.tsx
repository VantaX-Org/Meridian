"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Dialog } from "@/design";
import { apiErrorMessage } from "@/lib/error";
import { createWave } from "@/lib/api/migration";
import { getSystems } from "@/lib/api/connectivity";
import { queryKeys } from "@/lib/query-keys";
import type { WaveStage } from "@/types/api";

export const STAGE_LABEL: Record<WaveStage, string> = {
  plan: "Plan", mock1: "Mock 1", mock2: "Mock 2", dress: "Dress rehearsal", cutover: "Cutover",
};

const field = "w-full rounded-md border px-2 py-1 text-[13px]";
const fieldStyle = { borderColor: "var(--m-line)", color: "var(--m-ink)" };

function isWaveStage(v: string): v is WaveStage {
  return v in STAGE_LABEL;
}

export function CreateWaveDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, enabled: open });
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [modules, setModules] = useState("");
  const [date, setDate] = useState("");
  const [stage, setStage] = useState<WaveStage>("plan");
  const [minReadiness, setMinReadiness] = useState("95");

  const save = useMutation({
    mutationFn: () =>
      createWave({
        name: name.trim(),
        source_system_id: source || null,
        target_system_id: target || null,
        modules: modules.split(",").map((m) => m.trim()).filter(Boolean),
        target_date: date || null,
        stage,
        min_readiness: Number(minReadiness),
      }),
    onSuccess: (w) => {
      toast.success(`Wave ${w.name} created.`);
      void qc.invalidateQueries({ queryKey: queryKeys.migrationWaves() });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const systemOptions = systems.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Create wave">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
          Name
          <input className={field} style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
          Source system
          <select className={field} style={fieldStyle} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">None yet</option>
            {systemOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
          Target system
          <select className={field} style={fieldStyle} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">S/4HANA standard</option>
            {systemOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
          Modules
          <input className={field} style={fieldStyle} value={modules} onChange={(e) => setModules(e.target.value)}
                 placeholder="material_master, accounts_payable" />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
            Target date
            <input type="date" className={field} style={fieldStyle} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
            Stage
            <select className={field} style={fieldStyle} value={stage}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (isWaveStage(v)) setStage(v);
                    }}>
              {Object.entries(STAGE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
            Minimum readiness %
            <input type="number" min={0} max={100} className={field} style={fieldStyle} value={minReadiness}
                   onChange={(e) => setMinReadiness(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="submit" disabled={!name.trim() || save.isPending}>Save wave</Button>
        </div>
      </form>
    </Dialog>
  );
}
