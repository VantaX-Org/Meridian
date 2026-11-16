"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/v2/admin";
import type { RunSchedule, SchedulePreset } from "@/lib/api/v2/admin";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { refreshAdmin, useRunSchedules } from "@/lib/v2/admin-queries";
import { useSystemObjectList, useSystemsExtended } from "@/lib/v2/runs-queries";
import { describeCron } from "@/lib/v2/cron";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Button, Chip, Confirm, DataTable, Sheet, useToast, type Column } from "../kit";
import { OpsBlock, OpsPage } from "./ops-kit";

const PRESETS: SchedulePreset[] = ["hourly", "daily", "weekdays", "weekly", "monthly"];
const presetText = (p: SchedulePreset): string =>
  ({ hourly: t("Every hour"), daily: t("Every day"), weekdays: t("Every weekday"), weekly: t("Every week"), monthly: t("Every month") })[p];

const words = (s: string): string[] => s.split(/[\s,;]+/).filter(Boolean);
const nameOf = (s: RunSchedule): string => s.name || `${s.system_name} ${s.modules.map(labelText).join(", ")}`;

/** "manual" starts only when someone starts it; a preset or a cron line starts it on a rhythm. */
type Cadence = "manual" | "custom" | SchedulePreset;

function ScheduleSheet({ schedule, onClose }: { schedule: RunSchedule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const systems = useSystemsExtended();
  const [system, setSystem] = useState(schedule?.system_id ?? "");
  const objects = useSystemObjectList(system, !!system);
  const [name, setName] = useState(schedule?.name ?? "");
  const [modules, setModules] = useState<string[]>(schedule?.modules ?? []);
  const [cadence, setCadence] = useState<Cadence>(schedule ? (schedule.cadence.preset ?? (schedule.cadence.cron ? "custom" : "manual")) : "weekly");
  const [cron, setCron] = useState(schedule?.cadence.cron ?? "");
  const [mode, setMode] = useState<"full" | "delta">(schedule?.extraction_mode ?? "full");
  const sc = schedule?.scope ?? {};
  const [companies, setCompanies] = useState((sc.company_codes ?? []).join(", "));
  const [plants, setPlants] = useState((sc.plants ?? []).join(", "));
  const [salesOrgs, setSalesOrgs] = useState((sc.sales_orgs ?? []).join(", "));
  const [purchOrgs, setPurchOrgs] = useState((sc.purchasing_orgs ?? []).join(", "));
  const [from, setFrom] = useState(sc.date_from ?? "");
  const [to, setTo] = useState(sc.date_to ?? "");
  const [skipDeleted, setSkipDeleted] = useState(!!sc.exclude_deleted);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const offered = Array.from(new Set([...(objects.data?.objects ?? []).map((o) => o.object), ...(schedule?.modules ?? [])]));
  const line = cron.trim();
  const valid = !!system && modules.length > 0 && (cadence !== "custom" || line.split(/\s+/).length === 5) && (!from || !to || from <= to);
  const edit = <T,>(set: (v: T) => void) => (v: T) => { setTouched(true); set(v); };
  const flip = (m: string) => { setTouched(true); setModules((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m])); };
  const rhythm = cadence === "custom" ? { cron: line, preset: null } : cadence === "manual" ? { cron: null, preset: null } : { cron: null, preset: cadence };
  const scope = {
    company_codes: words(companies),
    plants: words(plants),
    sales_orgs: words(salesOrgs),
    purchasing_orgs: words(purchOrgs),
    date_from: from || null,
    date_to: to || null,
    exclude_deleted: skipDeleted,
  };
  const save = async () => {
    setSaving(true);
    setFailed(null);
    try {
      if (schedule) {
        await api.patchRunSchedule(schedule.id, { name: name.trim() || null, modules, ...rhythm, scope, extraction_mode: mode });
      } else {
        await api.createRunSchedule({ system_id: system, name: name.trim() || null, modules, ...rhythm, scope, extraction_mode: mode });
      }
      await refreshAdmin(qc, "runschedules");
      toast({ tone: "good", text: schedule ? t("Schedule saved") : t("Schedule created") });
      onClose();
    } catch (e) {
      setFailed(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      size="large"
      dirty={touched}
      title={schedule ? t("Edit {name}", { name: nameOf(schedule) }) : t("Schedule a run")}
      secondary={<Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button>}
      primary={
        <Button variant="primary" disabled={!valid} loading={saving} loadingLabel={t("Saving…")} onClick={() => void save()}>
          {schedule ? t("Save the schedule") : t("Create the schedule")}
        </Button>
      }
    >
      <p className="nx-sub">{t("The system extracts these objects on this rhythm. Changing a schedule never starts a run at once.")}</p>
      <div className="nx-ops-form">
        <label className="nx-field">
          <span>{t("System")}</span>
          <select className="nx-input" value={system} disabled={!!schedule} onChange={(e) => { setTouched(true); setSystem(e.target.value); setModules([]); }}>
            <option value="">{t("Choose a system")}</option>
            {(systems.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="nx-field">
          <span>{t("Name (optional)")}</span>
          <input className="nx-input" value={name} maxLength={120} onChange={(e) => edit(setName)(e.target.value)} />
        </label>
        <fieldset className="nx-field">
          <legend>{t("Objects")}</legend>
          {offered.length === 0 ? <p className="nx-note">{system ? t("This system offers no objects yet.") : t("Choose a system first.")}</p> : null}
          <div className="nx-ops-picks">
            {offered.map((m) => (
              <label key={m} className="nx-row">
                <input type="checkbox" checked={modules.includes(m)} onChange={() => flip(m)} />
                {labelText(m)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="nx-field">
          <span>{t("Rhythm")}</span>
          <select className="nx-input" value={cadence} onChange={(e) => edit(setCadence)(e.target.value as Cadence)}>
            <option value="manual">{t("Only when someone starts it")}</option>
            {PRESETS.map((p) => (
              <option key={p} value={p}>{presetText(p)}</option>
            ))}
            <option value="custom">{t("A cron line")}</option>
          </select>
        </label>
        {cadence === "custom" ? (
          <label className="nx-field">
            <span>{t("Cron line (minute hour day month weekday)")}</span>
            <input className="nx-input nx-mono" value={cron} onChange={(e) => edit(setCron)(e.target.value)} placeholder="0 4 * * 1" />
          </label>
        ) : null}
        <label className="nx-field">
          <span>{t("What it reads")}</span>
          <select className="nx-input" value={mode} onChange={(e) => edit(setMode)(e.target.value as "full" | "delta")}>
            <option value="full">{t("Everything each time")}</option>
            <option value="delta">{t("Only what changed since the last run")}</option>
          </select>
        </label>
        <label className="nx-field">
          <span>{t("Company codes (empty reads all)")}</span>
          <input className="nx-input" value={companies} onChange={(e) => edit(setCompanies)(e.target.value)} />
        </label>
        <label className="nx-field">
          <span>{t("Plants (empty reads all)")}</span>
          <input className="nx-input" value={plants} onChange={(e) => edit(setPlants)(e.target.value)} />
        </label>
        <label className="nx-field">
          <span>{t("Sales organisations (empty reads all)")}</span>
          <input className="nx-input" value={salesOrgs} onChange={(e) => edit(setSalesOrgs)(e.target.value)} />
        </label>
        <label className="nx-field">
          <span>{t("Purchasing organisations (empty reads all)")}</span>
          <input className="nx-input" value={purchOrgs} onChange={(e) => edit(setPurchOrgs)(e.target.value)} />
        </label>
        <label className="nx-field">
          <span>{t("Records from")}</span>
          <input className="nx-input" type="date" value={from} onChange={(e) => edit(setFrom)(e.target.value)} />
        </label>
        <label className="nx-field">
          <span>{t("Records to")}</span>
          <input className="nx-input" type="date" value={to} onChange={(e) => edit(setTo)(e.target.value)} />
        </label>
        <label className="nx-row">
          <input type="checkbox" checked={skipDeleted} onChange={(e) => edit(setSkipDeleted)(e.target.checked)} />
          {t("Leave out records marked for deletion")}
        </label>
      </div>
      {cadence !== "manual" ? <p className="nx-note" role="status">{t("Runs {rhythm}.", { rhythm: cadence === "custom" ? describeCron(line) : presetText(cadence).toLowerCase() })}</p> : null}
      {failed ? <p className="nx-note nx-ops-bad" role="alert">{failed}</p> : null}
    </Sheet>
  );
}

/** Admin > Run schedules: every analysis run schedule of the tenant, across systems. */
export function OpsSchedules() {
  const qc = useQueryClient();
  const can = useV2Session().can("manage_systems");
  const toast = useToast();
  const q = useRunSchedules();
  const [editing, setEditing] = useState<RunSchedule | "new" | null>(null);
  const [removing, setRemoving] = useState<RunSchedule | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const fail = (e: unknown) => toast({ tone: "bad", text: apiErrorMessage(e) });
  const toggle = async (s: RunSchedule) => {
    setPending(`pause-${s.id}`);
    try {
      await (s.active ? api.pauseRunSchedule(s.id) : api.resumeRunSchedule(s.id));
      await refreshAdmin(qc, "runschedules");
      toast({
        tone: "good",
        text: s.active ? t("{name} paused", { name: nameOf(s) }) : t("{name} resumed", { name: nameOf(s) }),
        onUndo: async () => {
          await (s.active ? api.resumeRunSchedule(s.id) : api.pauseRunSchedule(s.id));
          await refreshAdmin(qc, "runschedules");
        },
      });
    } catch (e) {
      fail(e);
    } finally {
      setPending(null);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setPending("delete");
    try {
      await api.deleteRunSchedule(removing.id);
      await refreshAdmin(qc, "runschedules");
      toast({ tone: "good", text: t("Schedule deleted") });
      setRemoving(null);
    } catch (e) {
      fail(e);
    } finally {
      setPending(null);
    }
  };
  const columns: Column<RunSchedule>[] = [
    { id: "name", label: t("Schedule"), cell: (s) => nameOf(s), compare: (a, b) => nameOf(a).localeCompare(nameOf(b)) },
    { id: "system", label: t("System"), cell: (s) => s.system_name },
    { id: "objects", label: t("Objects"), cell: (s) => s.modules.map(labelText).join(", ") },
    { id: "when", label: t("Rhythm"), cell: (s) => (s.schedule_cron ? describeCron(s.schedule_cron) : s.cadence.preset ? presetText(s.cadence.preset) : t("Only when someone starts it")) },
    { id: "mode", label: t("Reads"), cell: (s) => (s.extraction_mode === "delta" ? t("Changes") : t("Everything")) },
    { id: "next", label: t("Next run"), cell: (s) => (s.active && s.next_run_at ? formatDate(s.next_run_at, "datetime") : <Chip tone="neutral">{s.active ? t("Manual") : t("Paused")}</Chip>) },
    { id: "last", label: t("Last run"), cell: (s) => (s.last_run_at ? formatDate(s.last_run_at, "datetime") : t("Never")) },
    {
      id: "act",
      label: t("Actions"),
      cell: (s) => (
        <span className="nx-ops-actions">
          <Button size={32} disabled={!can || pending !== null} loading={pending === `pause-${s.id}`} aria-label={`${s.active ? t("Pause") : t("Resume")} ${nameOf(s)}`} onClick={() => void toggle(s)}>
            {s.active ? t("Pause") : t("Resume")}
          </Button>
          <Button size={32} disabled={!can} aria-label={t("Edit {name}", { name: nameOf(s) })} onClick={() => setEditing(s)}>
            {t("Edit")}
          </Button>
          <Button size={32} variant="danger" disabled={!can} aria-label={t("Delete {name}", { name: nameOf(s) })} onClick={() => setRemoving(s)}>
            {t("Delete")}
          </Button>
        </span>
      ),
    },
  ];
  return (
    <OpsPage lead={t("Every analysis run that starts on a rhythm, across all systems. A paused schedule keeps its settings.")}>
      <OpsBlock
        title={t("Scheduled runs")}
        actions={<Button variant="primary" disabled={!can} onClick={() => setEditing("new")}>{t("Schedule a run")}</Button>}
      >
        <DataTable<RunSchedule>
          caption={t("Run schedules")}
          rows={q.data?.schedules ?? []}
          rowKey={(s) => s.id}
          rowLabel={(s) => nameOf(s)}
          columns={columns}
          loading={q.isPending}
          error={q.isError ? { sentence: t("The run schedules could not be read."), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("No run is scheduled. Schedule one and the extraction arrives on its own.") }}
        />
        {!can ? <p className="nx-note">{t("Scheduling needs the manage systems permission.")}</p> : null}
      </OpsBlock>
      {editing ? <ScheduleSheet schedule={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      <Confirm
        open={!!removing}
        title={removing ? t("Delete {name}", { name: nameOf(removing) }) : ""}
        consequence={t("The objects are no longer extracted on a rhythm. Runs it already made stay.")}
        confirmLabel={t("Delete the schedule")}
        danger
        blocked={pending === "delete" ? t("Working…") : undefined}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </OpsPage>
  );
}
