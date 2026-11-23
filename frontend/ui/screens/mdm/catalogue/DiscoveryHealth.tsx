"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  addSchedule, deleteSchedule, getCatalogue, getDiscoveryHealth, getRunModel, getSchedules, patchSchedule,
  type Freshness, type L1Health, type Schedule,
} from "@/lib/api/v2/discovery";
import { whole } from "@/lib/v2/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import type { DiscoveryStats, L4 } from "@/types/process-model";
import { BarList, Button, Card, Code, DataTable, Field, Input, Select, Sheet, Stepper, useToast } from "@/ui/kit";
import { errMsg } from "@/ui/screens/systems/shared";
import { Async, Empty, num, useRead, when } from "./shared";

const FRESH: Record<Freshness, () => string> = {
  fresh: () => t("Fresh"), due: () => t("Due"), stale: () => t("Stale"), failed: () => t("Failed"), paused: () => t("Paused"), manual: () => t("Manual"),
};
const pct = (n: number | null | undefined) => (n === null || n === undefined ? t("n/a") : `${Math.round(n * 100)}%`);
const drift = (n: number | null) => (n === null ? t("n/a") : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)} ${t("points")}`);
const days = (s: number | null | undefined) => (s === null || s === undefined ? t("n/a") : s >= 86400 ? `${(s / 86400).toFixed(1)} ${t("days")}` : s >= 3600 ? `${(s / 3600).toFixed(1)} ${t("hours")}` : `${Math.round(s / 60)} ${t("minutes")}`);

/** Add or change one schedule in three steps: choose, review, saved. */
function ScheduleSheet({ systemId, free, edit, names, onClose }: { systemId: string; free: string[]; edit: Schedule | null; names: Record<string, string>; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [l1, setL1] = useState(edit?.l1 ?? free[0] ?? "");
  const [cron, setCron] = useState(edit?.schedule_cron ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (edit) await patchSchedule(systemId, edit.id, { schedule_cron: cron.trim() });
      else await addSchedule(systemId, l1, cron.trim());
      await qc.invalidateQueries({ queryKey: ["b7b"] });
      setStep(2);
    } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(false); }
  };
  const ok = !!l1 && cron.trim().length > 0;
  return (
    <Sheet open onClose={onClose} label={edit ? t("Change schedule") : t("Add a schedule")} closeLabel={t("Close")}>
      <div className="mx-col">
        <Stepper label={t("Schedule steps")} current={step} steps={[{ id: "set", label: t("Choose") }, { id: "review", label: t("Review") }, { id: "done", label: t("Saved") }]} />
        {step === 0 ? (
          <>
            <Field label={t("Process")}>
              <Select aria-label={t("Process")} value={l1} disabled={!!edit} onChange={(e) => setL1(e.target.value)} options={(edit ? [edit.l1] : free).map((id) => ({ value: id, label: `${id} ${names[id] ?? ""}`.trim() }))} />
            </Field>
            <Field label={t("Cron expression")} hint={t("Five fields, for example 0 2 * * 1 for Mondays at 02:00.")}>
              <Input value={cron} onChange={(e) => setCron(e.target.value)} />
            </Field>
            <Button disabled={!ok} onClick={() => setStep(1)}>{t("Review")}</Button>
          </>
        ) : step === 1 ? (
          <>
            <p><Code code={l1} description={names[l1]} /> {cron.trim()}</p>
            <span className="mx-links">
              <Button disabled={busy} onClick={() => void save()}>{t("Save schedule")}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => setStep(0)}>{t("Back")}</Button>
            </span>
          </>
        ) : (
          <>
            <p className="mx-muted">{t("The schedule is saved.")}</p>
            <Button variant="secondary" onClick={onClose}>{t("Close")}</Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Per process: how fresh the last run is, whether fitness drifted, and the schedule that keeps it current. */
export function HealthCard({ systemId }: { systemId: string }) {
  const me = useV2Session();
  const qc = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState<Schedule | "new" | null>(null);
  const health = useRead(["pd", "health", systemId], () => getDiscoveryHealth(systemId), !!systemId);
  const sched = useRead(["pd", "sched", systemId], () => getSchedules(systemId), !!systemId);
  const cat = useRead(["pd", "cat", systemId], () => getCatalogue(systemId), !!systemId);
  const can = me.can("run_process_discovery");
  const names = Object.fromEntries((cat.data ?? []).map((c) => [c.l1, c.name]));
  const byId = new Map((sched.data ?? []).map((s) => [s.l1, s]));
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await qc.invalidateQueries({ queryKey: ["b7b"] }); } catch (e) { toast(errMsg(e), "bad"); }
  };
  const free = (health.data ?? []).map((h) => h.l1).filter((id) => !byId.has(id));
  return (
    <Card title={t("Discovery health and schedules")} sub={t("Freshness of the latest run per process and the schedule behind it.")}
      action={can && free.length ? <Button variant="secondary" onClick={() => setSheet("new")}>{t("Add a schedule")}</Button> : undefined}>
      <Async q={health}>
        {(rows) => rows.length ? (
          <div className="mx-col">
            <BarList label={t("Fitness of the latest run")} max={100}
              items={rows.filter((h) => h.last_run?.fitness != null).map((h) => ({ id: h.l1, label: `${h.l1} ${names[h.l1] ?? ""}`.trim(), value: Math.round(h.last_run!.fitness! * 100), display: pct(h.last_run!.fitness), sev: h.freshness === "failed" || h.freshness === "stale" ? "high" : undefined }))} />
            <DataTable<L1Health> label={t("Discovery health")} rows={rows} rowKey={(h) => h.l1} height={320}
              columns={[
                { key: "p", label: t("Process"), sort: (h) => h.l1, render: (h) => <Code code={h.l1} description={names[h.l1]} /> },
                { key: "f", label: t("Freshness"), render: (h) => FRESH[h.freshness]() },
                { key: "r", label: t("Last run"), sort: (h) => h.last_run?.finished_at ?? "", render: (h) => when(h.last_run?.finished_at) },
                { key: "d", label: t("Fitness drift"), align: "end", sort: (h) => h.fitness_drift ?? 0, render: (h) => drift(h.fitness_drift) },
                { key: "s", label: t("Schedule"), render: (h) => h.schedule?.cron ?? t("None") },
                { key: "n", label: t("Next run"), render: (h) => (h.schedule?.active ? when(h.schedule.next_run_at) : t("n/a")) },
                ...(can ? [{
                  key: "a", label: t("Actions"), render: (h: L1Health) => {
                    const s = byId.get(h.l1);
                    return s ? (
                      <span className="mx-links">
                        <Button variant="ghost" onClick={() => void act(() => patchSchedule(systemId, s.id, { active: !s.active }))}>{s.active ? t("Pause") : t("Resume")}</Button>
                        <Button variant="ghost" onClick={() => setSheet(s)}>{t("Change")}</Button>
                        <Button variant="ghost" onClick={() => void act(() => deleteSchedule(systemId, s.id))}>{t("Remove")}</Button>
                      </span>
                    ) : null;
                  },
                }] : []),
              ]} />
          </div>
        ) : <Empty heading={t("No processes to watch")} />}
      </Async>
      {sheet ? <ScheduleSheet key={typeof sheet === "string" ? sheet : sheet.id} systemId={systemId} free={free} edit={typeof sheet === "string" ? null : sheet} names={names} onClose={() => setSheet(null)} /> : null}
    </Card>
  );
}

type Row = { id: string; name: string; level: string; stats: DiscoveryStats };

/** The as-is model mined from one run: every observed step with its volume, time and fitness. */
export function ModelView({ runId }: { runId: string }) {
  const q = useRead(["pd", "model", runId], () => getRunModel(runId));
  return (
    <Async q={q}>
      {(doc) => {
        const rows: Row[] = [];
        const walk = (l4: L4) => {
          if (l4.discovery) rows.push({ id: l4.id, name: l4.name, level: "L4", stats: l4.discovery });
          for (const a of l4.activities) if (a.discovery) rows.push({ id: a.id, name: a.name, level: "L5", stats: a.discovery });
        };
        doc.l1.forEach((l1) => l1.l2.forEach((l2) => l2.l3.forEach((l3) => l3.l4.forEach(walk))));
        if (!rows.length) return <Empty heading={t("This run has no mined model")} />;
        const top = rows.filter((r) => r.level === "L4").sort((a, b) => b.stats.case_count - a.stats.case_count).slice(0, 8);
        return (
          <div className="mx-col">
            <BarList label={t("Cases by step")} items={top.map((r) => ({ id: r.id, label: r.name, value: r.stats.case_count, display: whole(r.stats.case_count) }))} />
            <DataTable<Row> label={t("Mined model")} rows={rows} rowKey={(r) => r.id} height={320}
              columns={[
                { key: "s", label: t("Step"), sort: (r) => r.id, render: (r) => <Code code={r.id} description={r.name} /> },
                { key: "l", label: t("Level"), render: (r) => r.level },
                { key: "c", label: t("Cases"), align: "end", sort: (r) => r.stats.case_count, render: (r) => num(r.stats.case_count) },
                { key: "m", label: t("Median time"), align: "end", sort: (r) => r.stats.median_seconds ?? -1, render: (r) => days(r.stats.median_seconds) },
                { key: "f", label: t("Fitness"), align: "end", sort: (r) => r.stats.fitness ?? -1, render: (r) => pct(r.stats.fitness) },
                { key: "o", label: t("Observed"), render: (r) => (r.stats.observed ? t("Yes") : t("No")) },
              ]} />
          </div>
        );
      }}
    </Async>
  );
}
