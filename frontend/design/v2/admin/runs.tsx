"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SyncProfile } from "@/types/api";
import * as api from "@/lib/api/v2/admin";
import { analyseRun, loadSystemConfig, retryJobById } from "@/lib/api/v2/runs";
import { formatDate, labelOf } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { refreshAdmin } from "@/lib/v2/admin-queries";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobDoing } from "@/lib/v2/jobs";
import { useSystemConfigLoad, useSystemExtractions, useSystemObjectList, useSystemsExtended, useV2Jobs } from "@/lib/v2/runs-queries";
import { useFixture } from "@/lib/api/v2/fixture";
import { useQuery } from "@tanstack/react-query";
import type { Job } from "@/types/jobs";
import { Grid, type GridColumn } from "../Grid";
import { EmptyFrame, ErrorFrame } from "../parts";
import { canRetry } from "../inspector/job";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { describeCron } from "../screens/System";
import { AdminPage, Block, Confirm, Dialog, Fld, NeedsPermission, StatusWord, useCan, useDone } from "./kit";

const list = (s: string): string[] | undefined => {
  const v = s.split(/[\s,;]+/).filter(Boolean);
  return v.length ? v : undefined;
};

/** A cron line from a cadence, a time and a day. */
export function cronFor(cadence: "daily" | "weekly" | "monthly", time: string, weekday: number, day: number): string {
  const [h, m] = time.split(":").map((x) => Number(x) || 0);
  return cadence === "daily" ? `${m} ${h} * * *` : cadence === "weekly" ? `${m} ${h} * * ${weekday}` : `${m} ${h} ${day} * *`;
}

function SystemPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const systems = useSystemsExtended();
  return (
    <Fld label="System">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {(systems.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Fld>
  );
}

function Extraction({ system }: { system: string }) {
  const qc = useQueryClient();
  const can = useCan()("trigger_sync");
  const objects = useSystemObjectList(system, !!system);
  const [picked, setPicked] = useState<string[]>([]);
  const [analyse, setAnalyse] = useState(true);
  const [codes, setCodes] = useState("");
  const [plants, setPlants] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { outcome, pending, run } = useOutcome("admin-extract");
  const canAnalyse = useCan()("analyse");
  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  return (
    <Block title="Start an extraction" hint="Reads the chosen objects from the system into a new stored run. Leave the scope empty to read everything.">
      <ul className="m2-pick" aria-label="Objects to extract" style={{ maxWidth: 520 }}>
        {(objects.data?.objects ?? []).map((o) => (
          <li key={o.object}>
            <label>
              <input type="checkbox" checked={picked.includes(o.object)} disabled={!can} onChange={() => toggle(o.object)} />
              <span>{labelOf(o.object)}</span>
              <span className="m2-meta">{o.last_download ? `last ${formatDate(o.last_download.at)}` : "never"}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="m2-fgrid" style={{ marginTop: 12 }}>
        <Fld label="Company codes" hint="Separated by commas.">
          <input value={codes} disabled={!can} onChange={(e) => setCodes(e.target.value)} />
        </Fld>
        <Fld label="Plants">
          <input value={plants} disabled={!can} onChange={(e) => setPlants(e.target.value)} />
        </Fld>
        <Fld label="Documents from">
          <input type="date" value={from} disabled={!can} onChange={(e) => setFrom(e.target.value)} />
        </Fld>
        <Fld label="Documents to">
          <input type="date" value={to} disabled={!can} onChange={(e) => setTo(e.target.value)} />
        </Fld>
      </div>
      <label className="m2-sw" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={analyse && canAnalyse} disabled={!canAnalyse || !can} onChange={(e) => setAnalyse(e.target.checked)} />
        <span>Analyse straight after extracting</span>
      </label>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button
          type="button"
          className="m2-btn m2-next"
          disabled={!can || picked.length === 0 || pending !== null}
          onClick={() =>
            void run("extract", async () => {
              const r = await api.startExtraction(system, picked, analyse && canAnalyse, { company_codes: list(codes), plants: list(plants), date_from: from || undefined, date_to: to || undefined });
              void qc.invalidateQueries({ queryKey: ["v2"] });
              void qc.invalidateQueries({ queryKey: ["jobs"] });
              return { tone: "ok", title: "Extraction started", detail: `${picked.length} ${picked.length === 1 ? "object" : "objects"}${analyse && canAnalyse ? ", analysed straight after" : ""}.`, job: r.job_id };
            })
          }
        >
          {pending === "extract" ? "Starting…" : picked.length ? `Extract ${picked.length} ${picked.length === 1 ? "object" : "objects"}` : "Choose objects to extract"}
        </button>
      </div>
      {!can ? <p className="m2-prov">Starting an extraction needs the trigger sync permission on this system.</p> : null}
    </Block>
  );
}

function Analysis({ system }: { system: string }) {
  const qc = useQueryClient();
  const can = useCan()("analyse");
  const versions = useSystemExtractions(system, !!system);
  const seen = new Set<string>();
  const rows = (versions.data?.versions ?? []).filter((v) => v.analysable && !seen.has(v.id) && !!seen.add(v.id));
  const [picked, setPicked] = useState("");
  const chosen = picked || rows[0]?.id || "";
  const { outcome, pending, run } = useOutcome("admin-analyse");
  return (
    <Block title="Start an analysis" hint="Scores a stored extraction against the rules as they stand now. Earlier scores are kept as they were.">
      <div className="m2-fbar">
        <Fld label="Extraction">
          <select value={chosen} disabled={!can} onChange={(e) => setPicked(e.target.value)}>
            {rows.length === 0 ? <option value="">No extraction can be analysed</option> : null}
            {rows.map((v) => (
              <option key={v.id} value={v.id}>
                {`${v.label ?? formatDate(v.run_at, "datetime")}${v.analysed_at ? `, analysed with ${v.rule_set ?? "the rules"}` : ", not analysed yet"}`}
              </option>
            ))}
          </select>
        </Fld>
        <button
          type="button"
          className="m2-btn m2-next"
          disabled={!can || !chosen || pending !== null}
          onClick={() =>
            void run("analyse", async () => {
              const r = await analyseRun(chosen);
              void qc.invalidateQueries({ queryKey: ["v2"] });
              void qc.invalidateQueries({ queryKey: ["jobs"] });
              return { tone: "ok", title: "Analysis started", detail: "The extraction is being scored.", job: r.job_id };
            })
          }
        >
          {pending === "analyse" ? "Starting…" : "Run the analysis"}
        </button>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {!can ? <p className="m2-prov">Starting an analysis needs the analyse permission.</p> : null}
    </Block>
  );
}

function ConfigLoad({ system }: { system: string }) {
  const qc = useQueryClient();
  const can = useCan()("trigger_sync");
  const load = useSystemConfigLoad(system, !!system);
  const { outcome, pending, run } = useOutcome("admin-config");
  return (
    <Block title="Load configuration" hint="Reads the system's configuration tables, then derives the process flows. The last load is shown.">
      <p className="m2-prov" style={{ marginTop: 0 }}>{load.data ? `Last load: ${load.data.areas_loaded} of ${load.data.areas_total} areas, ${load.data.finished_at ? formatDate(load.data.finished_at, "datetime") : "running"}.` : "No configuration has been loaded yet."}</p>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button
          type="button"
          className="m2-btn"
          disabled={!can || !system || pending !== null}
          onClick={() =>
            void run("config", async () => {
              const r = await loadSystemConfig(system);
              void qc.invalidateQueries({ queryKey: ["v2"] });
              return { tone: "ok", title: "Configuration load started", job: r.job_id };
            })
          }
        >
          {pending === "config" ? "Starting…" : "Load the configuration"}
        </button>
      </div>
    </Block>
  );
}

function ProfileDialog({ system, profile, onClose }: { system: string; profile: SyncProfile | null; onClose: () => void }) {
  const qc = useQueryClient();
  const done = useDone();
  const objects = useSystemObjectList(system, !profile);
  const [object, setObject] = useState(profile?.domain ?? "");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [time, setTime] = useState("04:00");
  const [weekday, setWeekday] = useState(1);
  const [day, setDay] = useState(1);
  const [cron, setCron] = useState(profile?.schedule_cron ?? "");
  const [custom, setCustom] = useState(!!profile);
  const [mode, setMode] = useState<"full" | "delta">(profile?.extraction_mode ?? "full");
  const { outcome, pending, run } = useOutcome();
  const line = custom ? cron.trim() : cronFor(cadence, time, weekday, day);
  const valid = (profile || !!object) && line.split(/\s+/).length === 5;
  const save = () =>
    void run("save", async () => {
      if (profile) {
        const prev = { schedule_cron: profile.schedule_cron ?? "", active: profile.active, extraction_mode: profile.extraction_mode };
        await api.updateProfile(system, profile.id, { schedule_cron: line, extraction_mode: mode });
        await refreshAdmin(qc, "profiles");
        done("Schedule saved", async () => {
          await api.updateProfile(system, profile.id, prev);
          await refreshAdmin(qc, "profiles");
        });
        onClose();
        return { tone: "ok", title: "Schedule saved" };
      }
      const o = objects.data?.objects.find((x) => x.object === object);
      await api.createProfile(system, { system_id: system, domain: object, tables: o?.tables ?? [], schedule_cron: line, active: true, extraction_mode: mode });
      await refreshAdmin(qc, "profiles");
      onClose();
      return { tone: "ok", title: "Schedule created" };
    });
  return (
    <Dialog title={profile ? `Edit the schedule of ${labelOf(profile.domain)}` : "Schedule a run"} description="The system extracts the object on this rhythm. Changing it never fires a run at once." onClose={onClose} wide>
      {!profile ? (
        <label className="m2-fld">
          <span className="m2-lbl">Object</span>
          <select value={object} onChange={(e) => setObject(e.target.value)}>
            <option value="">Choose an object</option>
            {(objects.data?.objects ?? []).map((o) => (
              <option key={o.object} value={o.object}>
                {labelOf(o.object)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {custom ? (
        <label className="m2-fld">
          <span className="m2-lbl">Cron line (minute hour day month weekday)</span>
          <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 4 * * 1" />
        </label>
      ) : (
        <>
          <label className="m2-fld">
            <span className="m2-lbl">Cadence</span>
            <select value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </label>
          {cadence === "weekly" ? (
            <label className="m2-fld">
              <span className="m2-lbl">On</span>
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {cadence === "monthly" ? (
            <label className="m2-fld">
              <span className="m2-lbl">On day of the month</span>
              <input type="number" min={1} max={28} value={day} onChange={(e) => setDay(Math.max(1, Math.min(28, Number(e.target.value) || 1)))} />
            </label>
          ) : null}
          <label className="m2-fld">
            <span className="m2-lbl">At (UTC)</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </>
      )}
      <button type="button" className="m2-linkbtn" onClick={() => setCustom(!custom)}>
        {custom ? "Choose a cadence instead" : "Write a cron line instead"}
      </button>
      <label className="m2-fld">
        <span className="m2-lbl">What it reads</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as "full" | "delta")}>
          <option value="full">Everything each time</option>
          <option value="delta">Only what changed since the last run</option>
        </select>
      </label>
      <p className="m2-prov" role="status">{`Runs ${describeCron(line)}.`}</p>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-dlg-a">
        <button type="button" className="m2-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="m2-btn m2-strong" disabled={!valid || pending !== null} onClick={save}>
          {pending === "save" ? "Saving…" : profile ? "Save the schedule" : "Create the schedule"}
        </button>
      </div>
    </Dialog>
  );
}

function Schedules({ system }: { system: string }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const can = useCan()("manage_systems");
  const done = useDone();
  const q = useQuery({ queryKey: ["v2", "admin", fixture, "profiles", system], queryFn: () => api.listProfiles(system), enabled: !!system, staleTime: 15_000, retry: false });
  const [editing, setEditing] = useState<SyncProfile | "new" | null>(null);
  const [removing, setRemoving] = useState<SyncProfile | null>(null);
  const { outcome, pending, run } = useOutcome("admin-profiles");
  const rows = q.data ?? [];
  const toggle = (p: SyncProfile) =>
    void run(`pause-${p.id}`, async () => {
      await api.updateProfile(system, p.id, { active: !p.active });
      await refreshAdmin(qc, "profiles");
      done(p.active ? `${labelOf(p.domain)} schedule paused` : `${labelOf(p.domain)} schedule resumed`, async () => {
        await api.updateProfile(system, p.id, { active: p.active });
        await refreshAdmin(qc, "profiles");
      });
      return { tone: "ok", title: p.active ? "Schedule paused" : "Schedule resumed" };
    });
  const columns: GridColumn<SyncProfile>[] = [
    { id: "object", header: "Object", width: 200, pin: true, locked: true, cell: (p) => labelOf(p.domain) },
    { id: "when", header: "Rhythm", width: 230, cell: (p) => describeCron(p.schedule_cron) },
    { id: "mode", header: "Reads", width: 110, cell: (p) => (p.extraction_mode === "delta" ? "Changes" : "Everything") },
    { id: "next", header: "Next run", width: 160, cell: (p) => (p.active && p.next_run_at ? formatDate(p.next_run_at, "datetime") : <StatusWord tone="neutral">Paused</StatusWord>) },
    { id: "last", header: "Last run", width: 160, cell: (p) => (p.last_run_at ? formatDate(p.last_run_at, "datetime") : "Never") },
    {
      id: "act",
      header: "Actions",
      width: 220,
      locked: true,
      cell: (p) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button type="button" className="m2-btn m2-sm" disabled={!can || pending !== null} aria-label={`${p.active ? "Pause" : "Resume"} ${labelOf(p.domain)}`} onClick={() => toggle(p)}>
            {p.active ? "Pause" : "Resume"}
          </button>
          <button type="button" className="m2-btn m2-sm" disabled={!can} aria-label={`Edit ${labelOf(p.domain)}`} onClick={() => setEditing(p)}>
            Edit
          </button>
          <button type="button" className="m2-btn m2-sm m2-crit" disabled={!can} aria-label={`Delete ${labelOf(p.domain)}`} onClick={() => setRemoving(p)}>
            Delete
          </button>
        </span>
      ),
    },
  ];
  return (
    <Block title="Scheduled runs" hint="Objects this system extracts on a rhythm. A paused schedule keeps its settings.">
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Grid<SyncProfile>
        id="admin-profiles"
        ariaLabel="Scheduled runs"
        columns={columns}
        rows={rows}
        rowId={(p) => p.id}
        loading={q.isPending && !!system}
        error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>The schedules could not be read.</ErrorFrame> : undefined}
        emptyFrame={<EmptyFrame>No run is scheduled for this system. Schedule one and the extraction arrives on its own.</EmptyFrame>}
        fixedColumns
        compact
      />
      <div className="m2-adm-acts">
        <button type="button" className="m2-btn" disabled={!can || !system} onClick={() => setEditing("new")}>
          Schedule a run
        </button>
      </div>
      {!can ? <p className="m2-prov">Scheduling needs the manage systems permission.</p> : null}
      {editing ? <ProfileDialog system={system} profile={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {removing ? (
        <Confirm
          title={`Delete the schedule of ${labelOf(removing.domain)}`}
          body="The object is no longer extracted on a rhythm. Runs it already made stay."
          confirm="Delete the schedule"
          danger
          pending={pending === "delete"}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void run("delete", async () => {
              await api.deleteProfile(system, removing.id);
              await refreshAdmin(qc, "profiles");
              setRemoving(null);
              return { tone: "ok", title: "Schedule deleted" };
            })
          }
        />
      ) : null}
    </Block>
  );
}

function RecentJobs() {
  const qc = useQueryClient();
  const { openItem, open } = useOpenItem();
  const jobs = useV2Jobs();
  const can = useCan();
  const { outcome, pending, run } = useOutcome("admin-job-retry");
  const columns: GridColumn<Job>[] = [
    { id: "job", header: "Job", width: 280, pin: true, locked: true, cell: (j) => jobDoing(j) },
    { id: "kind", header: "Kind", width: 140, cell: (j) => JOB_KIND_LABEL[j.kind] ?? labelOf(j.kind) },
    { id: "status", header: "Status", width: 110, cell: (j) => <StatusWord tone={j.status === "completed" ? "go" : j.status === "failed" ? "no-go" : j.status === "running" ? "at-risk" : "neutral"}>{JOB_STATUS_LABEL[j.status]}</StatusWord> },
    { id: "started", header: "Started", width: 160, cell: (j) => formatDate(j.started_at * 1000, "datetime") },
    {
      id: "act",
      header: "Actions",
      width: 170,
      locked: true,
      cell: (j) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button type="button" className="m2-btn m2-sm" onClick={() => openItem({ kind: "job", id: j.id })} aria-label={`Open ${jobDoing(j)}`}>
            Open
          </button>
          {j.status === "failed" ? (
            <button
              type="button"
              className="m2-btn m2-sm"
              disabled={!canRetry(j) || !can("trigger_sync") || pending !== null}
              aria-label={`Retry ${jobDoing(j)}`}
              onClick={() =>
                void run(`retry-${j.id}`, async () => {
                  const r = await retryJobById(j.id);
                  void qc.invalidateQueries({ queryKey: ["v2"] });
                  void qc.invalidateQueries({ queryKey: ["jobs"] });
                  return { tone: "ok", title: "Started again", job: r.job_id ?? null };
                })
              }
            >
              Retry
            </button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <Block title="Recent jobs" hint="Open a job for its stages and tables. A failed job that recorded how it started can be retried; a running job cannot be cancelled, because the API has no cancel.">
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Grid<Job>
        id="admin-runs-jobs"
        ariaLabel="Recent jobs"
        columns={columns}
        rows={jobs.jobs.filter((j, i, all) => all.findIndex((x) => x.id === j.id) === i).slice(0, 12)}
        rowId={(j) => j.id}
        loading={jobs.isPending}
        emptyFrame={<EmptyFrame>No job has run yet.</EmptyFrame>}
        onOpen={(j) => openItem({ kind: "job", id: j.id })}
        openRowId={open?.kind === "job" ? open.id : null}
        fixedColumns
        compact
      />
    </Block>
  );
}

/** Admin › Runs and jobs: start an extraction, an analysis or a configuration load, schedule runs, and retry what failed. */
export function RunsSection() {
  const can = useCan();
  const systems = useSystemsExtended();
  const [picked, setPicked] = useState("");
  const system = picked || systems.data?.[0]?.id || "";
  const allowed = can("trigger_sync") || can("analyse") || can("manage_systems");
  if (!allowed) return <AdminPage title="Runs and jobs"><NeedsPermission what="Starting runs" permission="trigger_sync" /></AdminPage>;
  return (
    <AdminPage title="Runs and jobs" lead="Start work here and follow it in the job line. Everything below acts on one system at a time.">
      <div className="m2-fbar">
        <SystemPick value={system} onChange={setPicked} />
      </div>
      {systems.isSuccess && (systems.data ?? []).length === 0 ? (
        <EmptyFrame>No system is connected yet. Connect one from the landscape, then start an extraction here.</EmptyFrame>
      ) : !system ? null : (
        <>
          <Extraction key={`x-${system}`} system={system} />
          <Analysis key={`a-${system}`} system={system} />
          <ConfigLoad key={`c-${system}`} system={system} />
          <Schedules key={`s-${system}`} system={system} />
        </>
      )}
      <RecentJobs />
    </AdminPage>
  );
}
