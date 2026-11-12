"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/v2/admin";
import type { RunSchedule, SchedulePreset } from "@/lib/api/v2/admin";
import { formatDate } from "@/lib/format";
import { refreshAdmin, useRunSchedules } from "@/lib/v2/admin-queries";
import { useSystemObjectList, useSystemsExtended } from "@/lib/v2/runs-queries";
import { describeCron } from "@/lib/v2/cron";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { type GridColumn } from "../Grid";
import { ToolGrid } from "../GridTools";
import { EmptyFrame, ErrorFrame } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Confirm, Dialog, StatusWord, useCan, useDone } from "./kit";

const PRESETS: SchedulePreset[] = ["hourly", "daily", "weekdays", "weekly", "monthly"];
const presetText = (p: SchedulePreset): string =>
  ({ hourly: t("Every hour"), daily: t("Every day"), weekdays: t("Every weekday"), weekly: t("Every week"), monthly: t("Every month") })[p];

const words = (s: string): string[] => s.split(/[\s,;]+/).filter(Boolean);
const nameOf = (s: RunSchedule): string => s.name || `${s.system_name} ${s.modules.map(labelText).join(", ")}`;

/** "manual" starts only when someone starts it; a preset or a cron line starts it on a rhythm. */
type Cadence = "manual" | "custom" | SchedulePreset;

function ScheduleDialog({ schedule, onClose }: { schedule: RunSchedule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const done = useDone();
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
  const { outcome, pending, run } = useOutcome("admin-runschedule");
  const offered = Array.from(new Set([...(objects.data?.objects ?? []).map((o) => o.object), ...(schedule?.modules ?? [])]));
  const line = cron.trim();
  const valid = !!system && modules.length > 0 && (cadence !== "custom" || line.split(/\s+/).length === 5) && (!from || !to || from <= to);
  const flip = (m: string) => setModules((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
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
  const save = () =>
    void run("save", async () => {
      if (schedule) {
        await api.patchRunSchedule(schedule.id, { name: name.trim() || null, modules, ...rhythm, scope, extraction_mode: mode });
      } else {
        await api.createRunSchedule({ system_id: system, name: name.trim() || null, modules, ...rhythm, scope, extraction_mode: mode });
      }
      await refreshAdmin(qc, "runschedules");
      done(schedule ? t("Schedule saved") : t("Schedule created"));
      onClose();
      return { tone: "ok", title: schedule ? t("Schedule saved") : t("Schedule created") };
    });
  return (
    <Dialog title={schedule ? t("Edit {name}", { name: nameOf(schedule) }) : t("Schedule a run")} description={t("The system extracts these objects on this rhythm. Changing a schedule never starts a run at once.")} onClose={onClose} wide>
      <label className="m2-afld">
        <span className="m2-lbl">{t("System")}</span>
        <select value={system} disabled={!!schedule} onChange={(e) => { setSystem(e.target.value); setModules([]); }}>
          <option value="">{t("Choose a system")}</option>
          {(systems.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="m2-afld">
        <span className="m2-lbl">{t("Name (optional)")}</span>
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>
      <fieldset className="m2-afld">
        <legend className="m2-lbl">{t("Objects")}</legend>
        {offered.length === 0 ? <p className="m2-prov">{system ? t("This system offers no objects yet.") : t("Choose a system first.")}</p> : null}
        {offered.map((m) => (
          <label key={m} style={{ display: "flex", gap: "var(--m2-s2)", alignItems: "center" }}>
            <input type="checkbox" checked={modules.includes(m)} onChange={() => flip(m)} />
            {labelText(m)}
          </label>
        ))}
      </fieldset>
      <label className="m2-afld">
        <span className="m2-lbl">{t("Rhythm")}</span>
        <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
          <option value="manual">{t("Only when someone starts it")}</option>
          {PRESETS.map((p) => (
            <option key={p} value={p}>{presetText(p)}</option>
          ))}
          <option value="custom">{t("A cron line")}</option>
        </select>
      </label>
      {cadence === "custom" ? (
        <label className="m2-afld">
          <span className="m2-lbl">{t("Cron line (minute hour day month weekday)")}</span>
          <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 4 * * 1" />
        </label>
      ) : null}
      <label className="m2-afld">
        <span className="m2-lbl">{t("What it reads")}</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as "full" | "delta")}>
          <option value="full">{t("Everything each time")}</option>
          <option value="delta">{t("Only what changed since the last run")}</option>
        </select>
      </label>
      <label className="m2-afld">
        <span className="m2-lbl">{t("Company codes (empty reads all)")}</span>
        <input value={companies} onChange={(e) => setCompanies(e.target.value)} />
      </label>
      <label className="m2-afld">
        <span className="m2-lbl">{t("Plants (empty reads all)")}</span>
        <input value={plants} onChange={(e) => setPlants(e.target.value)} />
      </label>
      <label className="m2-afld">
        <span className="m2-lbl">{t("Sales organisations (empty reads all)")}</span>
        <input value={salesOrgs} onChange={(e) => setSalesOrgs(e.target.value)} />
      </label>
      <label className="m2-afld">
        <span className="m2-lbl">{t("Purchasing organisations (empty reads all)")}</span>
        <input value={purchOrgs} onChange={(e) => setPurchOrgs(e.target.value)} />
      </label>
      <label className="m2-afld">
        <span className="m2-lbl">{t("Records from")}</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="m2-afld">
        <span className="m2-lbl">{t("Records to")}</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label style={{ display: "flex", gap: "var(--m2-s2)", alignItems: "center" }}>
        <input type="checkbox" checked={skipDeleted} onChange={(e) => setSkipDeleted(e.target.checked)} />
        {t("Leave out records marked for deletion")}
      </label>
      {cadence !== "manual" ? <p className="m2-prov" role="status">{t("Runs {rhythm}.", { rhythm: cadence === "custom" ? describeCron(line) : presetText(cadence).toLowerCase() })}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-dlg-a">
        <button type="button" className="m2-btn" onClick={onClose}>{t("Cancel")}</button>
        <button type="button" className="m2-btn m2-strong" disabled={!valid || pending !== null} onClick={save}>
          {pending === "save" ? t("Saving…") : schedule ? t("Save the schedule") : t("Create the schedule")}
        </button>
      </div>
    </Dialog>
  );
}

/** Admin › Run schedules: every analysis run schedule of the tenant, across systems. */
export function RunSchedulesSection() {
  const qc = useQueryClient();
  const can = useCan()("manage_systems");
  const done = useDone();
  const q = useRunSchedules();
  const [editing, setEditing] = useState<RunSchedule | "new" | null>(null);
  const [removing, setRemoving] = useState<RunSchedule | null>(null);
  const { outcome, pending, run } = useOutcome("admin-runschedules");
  const toggle = (s: RunSchedule) =>
    void run(`pause-${s.id}`, async () => {
      await (s.active ? api.pauseRunSchedule(s.id) : api.resumeRunSchedule(s.id));
      await refreshAdmin(qc, "runschedules");
      done(s.active ? t("{name} paused", { name: nameOf(s) }) : t("{name} resumed", { name: nameOf(s) }), async () => {
        await (s.active ? api.resumeRunSchedule(s.id) : api.pauseRunSchedule(s.id));
        await refreshAdmin(qc, "runschedules");
      });
      return { tone: "ok", title: s.active ? t("Schedule paused") : t("Schedule resumed") };
    });
  const columns: GridColumn<RunSchedule>[] = [
    { id: "name", header: t("Schedule"), width: 240, pin: true, locked: true, cell: (s) => nameOf(s) },
    { id: "system", header: t("System"), width: 180, cell: (s) => s.system_name },
    { id: "objects", header: t("Objects"), width: 220, cell: (s) => s.modules.map(labelText).join(", ") },
    { id: "when", header: t("Rhythm"), width: 220, cell: (s) => (s.schedule_cron ? describeCron(s.schedule_cron) : s.cadence.preset ? presetText(s.cadence.preset) : t("Only when someone starts it")) },
    { id: "mode", header: t("Reads"), width: 110, cell: (s) => (s.extraction_mode === "delta" ? t("Changes") : t("Everything")) },
    { id: "next", header: t("Next run"), width: 160, cell: (s) => (s.active && s.next_run_at ? formatDate(s.next_run_at, "datetime") : <StatusWord tone="neutral">{s.active ? t("Manual") : t("Paused")}</StatusWord>) },
    { id: "last", header: t("Last run"), width: 160, cell: (s) => (s.last_run_at ? formatDate(s.last_run_at, "datetime") : t("Never")) },
    {
      id: "act",
      header: t("Actions"),
      width: 220,
      locked: true,
      cell: (s) => (
        <span style={{ display: "inline-flex", gap: "var(--m2-s2)" }}>
          <button type="button" className="m2-btn m2-sm" disabled={!can || pending !== null} aria-label={`${s.active ? t("Pause") : t("Resume")} ${nameOf(s)}`} onClick={() => toggle(s)}>
            {s.active ? t("Pause") : t("Resume")}
          </button>
          <button type="button" className="m2-btn m2-sm" disabled={!can} aria-label={t("Edit {name}", { name: nameOf(s) })} onClick={() => setEditing(s)}>
            {t("Edit")}
          </button>
          <button type="button" className="m2-btn m2-sm m2-crit" disabled={!can} aria-label={t("Delete {name}", { name: nameOf(s) })} onClick={() => setRemoving(s)}>
            {t("Delete")}
          </button>
        </span>
      ),
    },
  ];
  return (
    <AdminPage title={t("Run schedules")} lead={t("Every analysis run that starts on a rhythm, across all systems. A paused schedule keeps its settings.")}>
      <Block title={t("Scheduled runs")}>
        {outcome ? <ResultFrame outcome={outcome} /> : null}
        <ToolGrid<RunSchedule>
          toolsTitle={t("Run schedules")}
          id="admin-runschedules"
          ariaLabel={t("Run schedules")}
          columns={columns}
          rows={q.data?.schedules ?? []}
          rowId={(s) => s.id}
          loading={q.isPending}
          error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The run schedules could not be read.")}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>{t("No run is scheduled. Schedule one and the extraction arrives on its own.")}</EmptyFrame>}
          fixedColumns
          compact
        />
        <div className="m2-adm-acts">
          <button type="button" className="m2-btn" disabled={!can} onClick={() => setEditing("new")}>{t("Schedule a run")}</button>
        </div>
        {!can ? <p className="m2-prov">{t("Scheduling needs the manage systems permission.")}</p> : null}
      </Block>
      {editing ? <ScheduleDialog schedule={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {removing ? (
        <Confirm
          title={t("Delete {name}", { name: nameOf(removing) })}
          body={t("The objects are no longer extracted on a rhythm. Runs it already made stay.")}
          confirm={t("Delete the schedule")}
          danger
          pending={pending === "delete"}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void run("delete", async () => {
              await api.deleteRunSchedule(removing.id);
              await refreshAdmin(qc, "runschedules");
              setRemoving(null);
              return { tone: "ok", title: t("Schedule deleted") };
            })
          }
        />
      ) : null}
    </AdminPage>
  );
}
