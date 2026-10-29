"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReportFile, ReportSchedule, ReportScheduleInput, ScheduleCadence } from "@/lib/api/reports";
import * as rep from "@/lib/api/v2/reports";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { refreshAdmin, useCatalogue, useReportHistory, useSchedules, useScheduleOptions } from "@/lib/v2/admin-queries";
import { useLandscape, useRunList } from "@/lib/v2/queries";
import { fixed } from "@/lib/v2/format";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { Confirm, useCan, useDone } from "../admin/kit";
import { ResultFrame, useOutcome } from "./shared";

export const sizeText = (n: number): string => (n >= 1e6 ? `${fixed(n / 1e6, 1)} MB` : n >= 1e3 ? `${fixed(n / 1e3, 0)} kB` : `${n} B`);
export const SCHEDULE_TONE = { sent: "go", partial: "at-risk", failed: "no-go", skipped: "neutral", running: "at-risk" } as const;
export const SCHEDULE_WORD = { sent: "Delivered", partial: "Partly delivered", failed: "Failed", skipped: "Skipped", running: "Running" } as const;
const SOURCE: Record<ReportFile["source"], string> = { download: "Downloaded", schedule: "Scheduled", run_now: "Run on request" };

/* ── Create or open a report ── */

function NewReport({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const runs = useRunList();
  const landscape = useLandscape(null);
  const [version, setVersion] = useState("");
  const [module, setModule] = useState("");
  const [compare, setCompare] = useState("");
  const [kind, setKind] = useState("board");
  const latest = version || runs.data?.versions[0]?.id || "";
  const catalogue = useCatalogue({ version_id: latest || undefined, module: module || undefined, compare: compare || undefined });
  const entry = catalogue.data?.find((c) => c.id === kind);
  const { outcome, pending, run } = useOutcome();
  const needsRun = entry?.requires.includes("run");
  const needsModule = entry?.requires.includes("module");
  return (
    <InspectorFrame title="Create a report" status="Built from the run you choose" onClose={onClose}>
      <div className="m2-aform">
        <label>
          Report
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {(catalogue.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Run
          <select value={latest} onChange={(e) => setVersion(e.target.value)}>
            {(runs.data?.versions ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label ?? `Run of ${formatDate(r.run_at)}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Object{needsModule ? "" : " (optional)"}
          <select value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">{needsModule ? "Choose an object" : "All objects"}</option>
            {(landscape.data?.objects ?? []).map((o) => (
              <option key={o.module} value={o.module}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Compare with (optional)
          <select value={compare} onChange={(e) => setCompare(e.target.value)}>
            <option value="">No comparison</option>
            {(runs.data?.versions ?? []).filter((r) => r.id !== latest).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label ?? `Run of ${formatDate(r.run_at)}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {entry ? (
        <>
          <Facts>
            <Fact label="Format">{entry.format}</Fact>
            <Fact label="About">{entry.about}</Fact>
            <Fact label="Contains">{entry.sections.join(", ")}</Fact>
            {entry.page_estimate ? <Fact label="Length">{`About ${entry.page_estimate} pages`}</Fact> : null}
          </Facts>
        </>
      ) : catalogue.isLoading ? (
        <Skeleton width="100%" height={80} />
      ) : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button
          type="button"
          className="m2-btn m2-next"
          disabled={!entry || !entry.url || pending !== null || (!!needsRun && !latest) || (!!needsModule && !module)}
          onClick={() =>
            entry &&
            void run("build", async () => {
              const name = await rep.buildReport(entry);
              await refreshAdmin(qc, "reports");
              return { tone: "ok", title: `${entry.name} built`, detail: `Saved as ${name}. It is in the list of reports.` };
            })
          }
        >
          {pending === "build" ? "Building…" : `Create the ${entry?.format ?? ""} report`.replace("  ", " ")}
        </button>
      </Actions>
      <p className="m2-prov">The report is built from the stored run, not from the live system. To get it on a rhythm, schedule it.</p>
    </InspectorFrame>
  );
}

function ReportBody({ f }: { f: ReportFile }) {
  const qc = useQueryClient();
  const { close, openItem } = useOpenItem();
  const [ask, setAsk] = useState(false);
  const { outcome, pending, run } = useOutcome();
  return (
    <>
      <Facts>
        <Fact label="File">{f.file_name}</Fact>
        <Fact label="Format">{f.format.toUpperCase()}</Fact>
        <Fact label="Size">{sizeText(f.size_bytes)}</Fact>
        <Fact label="Run">{f.run_label ?? (f.run_at ? formatDate(f.run_at) : "Not tied to a run")}</Fact>
        <Fact label="Made">{`${formatDate(f.created_at, "datetime")}, ${SOURCE[f.source]}${f.created_by_label ? ` by ${f.created_by_label}` : ""}`}</Fact>
      </Facts>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button
          type="button"
          className="m2-btn m2-strong"
          disabled={pending !== null}
          onClick={() =>
            void run("download", async () => {
              const name = await rep.downloadReportFile(f.id, f.file_name);
              return { tone: "ok", title: "Downloaded", detail: name };
            })
          }
        >
          {pending === "download" ? "Downloading…" : "Download"}
        </button>
        {f.schedule_id ? (
          <button type="button" className="m2-btn" onClick={() => openItem({ kind: "schedule", id: f.schedule_id as string })}>
            Open its schedule
          </button>
        ) : null}
        <button type="button" className="m2-btn m2-crit" disabled={!f.can_delete || pending !== null} onClick={() => setAsk(true)}>
          Delete the file
        </button>
      </Actions>
      {ask ? (
        <Confirm
          title="Delete this report file"
          body={`${f.file_name} is removed from the list. A report can be built again from its run.`}
          confirm="Delete the file"
          danger
          pending={pending === "delete"}
          onCancel={() => setAsk(false)}
          onConfirm={() =>
            void run("delete", async () => {
              await rep.deleteReportFile(f.id);
              await refreshAdmin(qc, "reports");
              setAsk(false);
              close();
              return { tone: "ok", title: "File deleted" };
            })
          }
        />
      ) : null}
    </>
  );
}

export function ReportInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useReportHistory();
  if (id === "new") return <NewReport onClose={onClose} />;
  const f = q.data?.items.find((x) => x.id === id);
  return (
    <InspectorFrame title={f?.name ?? "Report"} status={f ? `${f.format.toUpperCase()}, ${sizeText(f.size_bytes)}` : undefined} onClose={onClose}>
      {f ? <ReportBody f={f} /> : q.isLoading ? <Skeleton width="100%" height={100} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>The report could not be read.</ErrorFrame> : <EmptyFrame>This report file is gone. It may have been deleted.</EmptyFrame>}
    </InspectorFrame>
  );
}

/* ── Schedules ── */

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function ScheduleForm({ initial, onClose }: { initial: ReportSchedule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { openItem, close } = useOpenItem();
  const done = useDone();
  const can = useCan();
  const opts = useScheduleOptions();
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "board");
  const [scope, setScope] = useState(initial?.params.scope ?? "latest");
  const [module, setModule] = useState(initial?.params.module ?? "");
  const [cadence, setCadence] = useState<ScheduleCadence>(initial?.cadence ?? "weekly");
  const [time, setTime] = useState(initial?.time_of_day ?? "07:00");
  const [weekday, setWeekday] = useState(initial?.weekday ?? 0);
  const [day, setDay] = useState(initial?.day_of_month ?? 1);
  const [users, setUsers] = useState<string[]>(initial?.recipient_user_ids ?? []);
  const [channels, setChannels] = useState<string[]>(initial?.recipient_channel_ids ?? []);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [ask, setAsk] = useState(false);
  const { outcome, pending, run } = useOutcome(`schedule:${initial?.id ?? "new"}`);
  const o = opts.data;
  const type = o?.types.find((t) => t.id === kind);
  const edit = initial ? initial.can_edit : true;
  const body = (): ReportScheduleInput => ({
    name: name.trim(),
    kind,
    format: type?.format ?? initial?.format ?? "pdf",
    params: { scope, module: module || null },
    cadence,
    time_of_day: time,
    weekday: cadence === "weekly" ? weekday : null,
    day_of_month: cadence === "monthly" ? day : null,
    timezone: initial?.timezone ?? o?.timezone ?? null,
    recipient_user_ids: users,
    recipient_channel_ids: channels,
    enabled,
  });
  const valid = !!name.trim() && /^\d{2}:\d{2}$/.test(time) && (users.length > 0 || channels.length > 0) && (!type?.needs_module || !!module);
  const toggle = (list: string[], id: string, set: (v: string[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const toInput = (s: ReportSchedule): ReportScheduleInput => ({ name: s.name, kind: s.kind, format: s.format, params: s.params, cadence: s.cadence, time_of_day: s.time_of_day, weekday: s.weekday, day_of_month: s.day_of_month, timezone: s.timezone, recipient_user_ids: s.recipient_user_ids, recipient_channel_ids: s.recipient_channel_ids, enabled: s.enabled });
  const save = () =>
    void run("save", async () => {
      if (initial) {
        const prev = toInput(initial);
        const r = await rep.updateSchedule(initial.id, body());
        await refreshAdmin(qc, "reports");
        done(`Schedule ${r.name} saved`, async () => {
          await rep.updateSchedule(initial.id, prev);
          await refreshAdmin(qc, "reports");
        });
        return { tone: "ok", title: "Schedule saved", detail: r.next_run_at ? `Next run ${formatDate(r.next_run_at, "datetime")}.` : "It is paused." };
      }
      const r = await rep.createSchedule(body());
      await refreshAdmin(qc, "reports");
      openItem({ kind: "schedule", id: r.id });
      return { tone: "ok", title: "Schedule created", detail: r.summary };
    });
  const pause = (on: boolean) =>
    initial &&
    void run("pause", async () => {
      await rep.updateSchedule(initial.id, { ...toInput(initial), enabled: on });
      await refreshAdmin(qc, "reports");
      setEnabled(on);
      done(on ? `Schedule ${initial.name} resumed` : `Schedule ${initial.name} paused`, async () => {
        await rep.updateSchedule(initial.id, toInput(initial));
        await refreshAdmin(qc, "reports");
      });
      return { tone: "ok", title: on ? "Schedule resumed" : "Schedule paused" };
    });
  return (
    <InspectorFrame title={initial ? initial.name : "Schedule a report"} status={initial ? initial.summary : "New schedule"} onClose={onClose}>
      {!can("export") ? <p className="m2-prov">Scheduling reports needs the export permission.</p> : null}
      {initial ? (
        <Facts>
          <Fact label="Next run">{initial.next_run_at ? formatDate(initial.next_run_at, "datetime") : "Paused"}</Fact>
          <Fact label="Last run">{initial.last_run_at ? `${formatDate(initial.last_run_at, "datetime")}, ${initial.last_status ? SCHEDULE_WORD[initial.last_status] : ""}` : "Not run yet"}</Fact>
        </Facts>
      ) : null}
      <div className="m2-aform">
        <label>
          Name
          <input value={name} disabled={!edit} onChange={(e) => setName(e.target.value)} placeholder="Board pack for the steering committee" />
        </label>
        <label>
          Report
          <select value={kind} disabled={!edit} onChange={(e) => setKind(e.target.value)}>
            {(o?.types ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {`${t.name} (${t.format.toUpperCase()})`}
              </option>
            ))}
            {!o && initial ? <option value={initial.kind}>{labelOf(initial.kind)}</option> : null}
          </select>
        </label>
        <label>
          Which run
          <select value={scope} disabled={!edit} onChange={(e) => setScope(e.target.value)}>
            <option value="latest">The latest finished run</option>
            <option value="upload">The latest file upload</option>
            {(o?.systems ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {`Latest run of ${s.label}`}
              </option>
            ))}
          </select>
        </label>
        {type?.needs_module || (o?.modules.length ?? 0) > 0 ? (
          <label>
            Object{type?.needs_module ? "" : " (optional)"}
            <select value={module} disabled={!edit} onChange={(e) => setModule(e.target.value)}>
              <option value="">{type?.needs_module ? "Choose an object" : "All objects"}</option>
              {(o?.modules ?? []).map((m) => (
                <option key={m} value={m}>
                  {formatModuleName(m)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Cadence
          <select value={cadence} disabled={!edit} onChange={(e) => setCadence(e.target.value as ScheduleCadence)}>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
          </select>
        </label>
        {cadence === "weekly" ? (
          <label>
            On
            <select value={weekday} disabled={!edit} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {cadence === "monthly" ? (
          <label>
            On day of the month
            <input type="number" min={1} max={31} value={day} disabled={!edit} onChange={(e) => setDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} />
          </label>
        ) : null}
        <label>
          {`At (${initial?.timezone ?? o?.timezone ?? "tenant time zone"})`}
          <input type="time" value={time} disabled={!edit} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <h3>Recipients</h3>
      {o ? (
        <>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="m2-sr">People</legend>
            <ul className="m2-pick" aria-label="People who receive it">
              {o.users.length === 0 ? <li className="m2-meta" style={{ padding: 8 }}>No one can receive reports yet.</li> : null}
              {o.users.map((u) => (
                <li key={u.id}>
                  <label>
                    <input type="checkbox" checked={users.includes(u.id)} disabled={!edit} onChange={() => toggle(users, u.id, setUsers)} />
                    <span>{u.label}</span>
                    <span className="m2-meta">{u.detail}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {o.channels.length ? (
            <ul className="m2-pick" aria-label="Alert channels that receive it">
              {o.channels.map((c) => (
                <li key={c.id}>
                  <label>
                    <input type="checkbox" checked={channels.includes(c.id)} disabled={!edit} onChange={() => toggle(channels, c.id, setChannels)} />
                    <span>{c.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <Skeleton width="100%" height={80} />
      )}
      <label className="m2-sw" style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input type="checkbox" checked={enabled} disabled={!edit} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Schedule is on</span>
      </label>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button type="button" className="m2-btn m2-strong" disabled={!edit || !valid || pending !== null} onClick={save}>
          {pending === "save" ? "Saving…" : initial ? "Save the schedule" : "Create the schedule"}
        </button>
        {initial ? (
          <>
            <button type="button" className="m2-btn" disabled={!edit || pending !== null} onClick={() => pause(!initial.enabled)}>
              {initial.enabled ? "Pause" : "Resume"}
            </button>
            <button
              type="button"
              className="m2-btn"
              disabled={!edit || pending !== null}
              onClick={() =>
                void run("now", async () => {
                  const r = await rep.runScheduleNow(initial.id);
                  await refreshAdmin(qc, "reports");
                  return { tone: "ok", title: r.queued ? "Queued to run now" : "Could not queue it", detail: "It is built on the worker and delivered to the recipients; the next scheduled run is unchanged." };
                })
              }
            >
              Run it now
            </button>
            <button type="button" className="m2-btn m2-crit" disabled={!edit || pending !== null} onClick={() => setAsk(true)}>
              Delete
            </button>
          </>
        ) : null}
      </Actions>
      {!initial && !valid ? <p className="m2-prov">Name it, choose when, and pick at least one recipient.</p> : null}
      {ask && initial ? (
        <Confirm
          title={`Delete ${initial.name}`}
          body="No more reports are built or sent from this schedule. Files it already made stay in the list."
          confirm="Delete the schedule"
          danger
          pending={pending === "delete"}
          onCancel={() => setAsk(false)}
          onConfirm={() =>
            void run("delete", async () => {
              await rep.deleteSchedule(initial.id);
              await refreshAdmin(qc, "reports");
              setAsk(false);
              close();
              return { tone: "ok", title: "Schedule deleted" };
            })
          }
        />
      ) : null}
    </InspectorFrame>
  );
}

export function ScheduleInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useSchedules();
  if (id === "new") return <ScheduleForm initial={null} onClose={onClose} />;
  const s = q.data?.find((x) => x.id === id);
  if (s) return <ScheduleForm key={s.id} initial={s} onClose={onClose} />;
  return (
    <InspectorFrame title="Schedule" onClose={onClose}>
      {q.isLoading ? <Skeleton width="100%" height={100} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>The schedule could not be read.</ErrorFrame> : <EmptyFrame>This schedule does not exist. It may have been deleted.</EmptyFrame>}
    </InspectorFrame>
  );
}

