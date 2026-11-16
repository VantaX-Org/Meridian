"use client";

import { useState, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReportFile, ReportSchedule, ReportScheduleInput, ScheduleCadence } from "@/lib/api/reports";
import * as rep from "@/lib/api/v2/reports";
import { formatDate } from "@/lib/format";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { refreshAdmin, useCatalogue, useReportHistory, useSchedules, useScheduleOptions } from "@/lib/v2/admin-queries";
import { useLandscape, useRunList } from "@/lib/v2/queries";
import { fixed, v2Locale } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { Button, Confirm, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Field, Result, useDone, useOutcome } from "./reports-kit";
import { DeliveryInspector, WebhookInspector } from "./reports-webhook";
import { DigestInspector, PolicyPackInspector } from "./reports-digest";

export const sizeText = (n: number): string => (n >= 1e6 ? `${fixed(n / 1e6, 1)} MB` : n >= 1e3 ? `${fixed(n / 1e3, 0)} kB` : `${n} B`);
const scheduleWord = (s: NonNullable<ReportSchedule["last_status"]>): string =>
  ({ sent: t("Delivered"), partial: t("Partly delivered"), failed: t("Failed"), skipped: t("Skipped"), running: t("Running") })[s];
const sourceWord = (s: ReportFile["source"]): string => ({ download: t("Downloaded"), schedule: t("Scheduled"), run_now: t("Run on request") })[s];
const runName = (r: { label?: string | null; run_at: string }) => r.label ?? t("Run of {run_at}", { run_at: formatDate(r.run_at) });

/* Create a report */

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
    <InspectorFrame title={t("Create a report")} status={t("Built from the run you choose")} onClose={onClose}>
      <div className="nx-rp-form">
        <Field label={t("Report")}>
          <select className="nx-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {(catalogue.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Run")}>
          <select className="nx-input" value={latest} onChange={(e) => setVersion(e.target.value)}>
            {(runs.data?.versions ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {runName(r)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`${t("Object")}${needsModule ? "" : t(" (optional)")}`}>
          <select className="nx-input" value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">{needsModule ? t("Choose an object") : t("All objects")}</option>
            {(landscape.data?.objects ?? []).map((o) => (
              <option key={o.module} value={o.module}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Compare with (optional)")}>
          <select className="nx-input" value={compare} onChange={(e) => setCompare(e.target.value)}>
            <option value="">{t("No comparison")}</option>
            {(runs.data?.versions ?? [])
              .filter((r) => r.id !== latest)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {runName(r)}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {entry ? (
        <Facts>
          <Fact label={t("Format")}>{entry.format}</Fact>
          <Fact label={t("About")}>{entry.about}</Fact>
          <Fact label={t("Contains")}>{entry.sections.join(", ")}</Fact>
          {entry.page_estimate ? <Fact label={t("Length")}>{t("About {page_estimate} pages", { page_estimate: entry.page_estimate })}</Fact> : null}
        </Facts>
      ) : catalogue.isLoading ? (
        <Skeleton lines={3} />
      ) : catalogue.isError ? (
        <ErrorState error={catalogue.error} onRetry={() => void catalogue.refetch()} />
      ) : null}
      <Result outcome={outcome} />
      <Actions>
        <Button
          variant="primary"
          loading={pending === "build"}
          loadingLabel={t("Building…")}
          disabled={!entry || !entry.url || pending !== null || (!!needsRun && !latest) || (!!needsModule && !module)}
          onClick={() =>
            entry &&
            void run("build", async () => {
              const name = await rep.buildReport(entry);
              await refreshAdmin(qc, "reports");
              return { tone: "ok", title: t("{name} built", { name: entry.name }), detail: t("Downloaded {name}. A copy is also in Reports.", { name }) };
            })
          }
        >
          {entry?.format ? t("Create the {format} report", { format: entry.format }) : t("Create the report")}
        </Button>
      </Actions>
      <p className="nx-rp-sub">{t("The report is built from the stored run, not from the live system. To get it on a rhythm, schedule it.")}</p>
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
        <Fact label={t("File")}>{f.file_name}</Fact>
        <Fact label={t("Format")}>{f.format.toUpperCase()}</Fact>
        <Fact label={t("Size")}>{sizeText(f.size_bytes)}</Fact>
        <Fact label={t("Run")}>{f.run_label ?? (f.run_at ? formatDate(f.run_at) : t("Not tied to a run"))}</Fact>
        <Fact label={t("Made")}>{`${formatDate(f.created_at, "datetime")}, ${sourceWord(f.source)}${f.created_by_label ? t(" by {created_by_label}", { created_by_label: f.created_by_label }) : ""}`}</Fact>
      </Facts>
      <Result outcome={outcome} />
      <Actions>
        <Button
          variant="primary"
          loading={pending === "download"}
          loadingLabel={t("Downloading…")}
          disabled={pending !== null}
          onClick={() =>
            void run("download", async () => {
              const name = await rep.downloadReportFile(f.id, f.file_name);
              return { tone: "ok", title: t("Downloaded"), detail: name };
            })
          }
        >
          {t("Download")}
        </Button>
        {f.schedule_id ? <Button onClick={() => openItem({ kind: "schedule", id: f.schedule_id as string })}>{t("Open its schedule")}</Button> : null}
        <Button variant="danger" disabled={!f.can_delete || pending !== null} onClick={() => setAsk(true)}>
          {t("Delete the file")}
        </Button>
      </Actions>
      <Confirm
        open={ask}
        title={t("Delete this report file")}
        consequence={t("{file_name} is removed from the list. A report can be built again from its run.", { file_name: f.file_name })}
        confirmLabel={t("Delete the file")}
        danger
        onCancel={() => setAsk(false)}
        onConfirm={() =>
          void run("delete", async () => {
            await rep.deleteReportFile(f.id);
            await refreshAdmin(qc, "reports");
            setAsk(false);
            close();
            return { tone: "ok", title: t("File deleted") };
          })
        }
      />
    </>
  );
}

export function ReportInspector({ id, onClose }: BodyProps) {
  const q = useReportHistory();
  if (id === "new") return <NewReport onClose={onClose} />;
  const f = q.data?.items.find((x) => x.id === id);
  return (
    <InspectorFrame title={f?.name ?? t("Report")} status={f ? `${f.format.toUpperCase()}, ${sizeText(f.size_bytes)}` : undefined} onClose={onClose}>
      {f ? (
        <ReportBody f={f} />
      ) : q.isLoading ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The report could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState heading={t("This report file is gone. It may have been deleted.")} />
      )}
    </InspectorFrame>
  );
}

/* Schedules */

/** Monday to Sunday in the chosen language (19 October 2026 is a Monday). */
const weekdays = (): string[] => {
  const f = new Intl.DateTimeFormat(v2Locale(), { weekday: "long", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 9, 19 + i))));
};

const toInput = (s: ReportSchedule): ReportScheduleInput => ({
  name: s.name,
  kind: s.kind,
  format: s.format,
  params: s.params,
  cadence: s.cadence,
  time_of_day: s.time_of_day,
  weekday: s.weekday,
  day_of_month: s.day_of_month,
  timezone: s.timezone,
  recipient_user_ids: s.recipient_user_ids,
  recipient_channel_ids: s.recipient_channel_ids,
  enabled: s.enabled,
});

function ScheduleForm({ initial, onClose }: { initial: ReportSchedule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { openItem, close } = useOpenItem();
  const done = useDone();
  const { can } = useV2Session();
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
  const type = o?.types.find((x) => x.id === kind);
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
  const save = () =>
    void run("save", async () => {
      if (initial) {
        const prev = toInput(initial);
        const r = await rep.updateSchedule(initial.id, body());
        await refreshAdmin(qc, "reports");
        done(t("Schedule {name} saved", { name: r.name }), async () => {
          await rep.updateSchedule(initial.id, prev);
          await refreshAdmin(qc, "reports");
        });
        return { tone: "ok", title: t("Schedule saved"), detail: r.next_run_at ? t("Next run {next_run_at}.", { next_run_at: formatDate(r.next_run_at, "datetime") }) : t("It is paused.") };
      }
      const r = await rep.createSchedule(body());
      await refreshAdmin(qc, "reports");
      openItem({ kind: "schedule", id: r.id });
      return { tone: "ok", title: t("Schedule created"), detail: r.summary };
    });
  const pause = (on: boolean) =>
    initial &&
    void run("pause", async () => {
      await rep.updateSchedule(initial.id, { ...toInput(initial), enabled: on });
      await refreshAdmin(qc, "reports");
      setEnabled(on);
      done(on ? t("Schedule {name} resumed", { name: initial.name }) : t("Schedule {name} paused", { name: initial.name }), async () => {
        await rep.updateSchedule(initial.id, toInput(initial));
        await refreshAdmin(qc, "reports");
      });
      return { tone: "ok", title: on ? t("Schedule resumed") : t("Schedule paused") };
    });
  return (
    <InspectorFrame title={initial ? initial.name : t("Schedule a report")} status={initial ? initial.summary : t("New schedule")} onClose={onClose}>
      {!can("export") ? <p className="nx-rp-sub">{t("Scheduling reports needs the export permission.")}</p> : null}
      {initial ? (
        <Facts>
          <Fact label={t("Next run")}>{initial.next_run_at ? formatDate(initial.next_run_at, "datetime") : t("Paused")}</Fact>
          <Fact label={t("Last run")}>{initial.last_run_at ? `${formatDate(initial.last_run_at, "datetime")}, ${initial.last_status ? scheduleWord(initial.last_status) : ""}` : t("Not run yet")}</Fact>
        </Facts>
      ) : null}
      <div className="nx-rp-form">
        <Field label={t("Name")}>
          <input className="nx-input" value={name} disabled={!edit} onChange={(e) => setName(e.target.value)} placeholder={t("Board pack for the steering committee")} />
        </Field>
        <Field label={t("Report")}>
          <select className="nx-input" value={kind} disabled={!edit} onChange={(e) => setKind(e.target.value)}>
            {(o?.types ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {`${x.name} (${x.format.toUpperCase()})`}
              </option>
            ))}
            {!o && initial ? <option value={initial.kind}>{labelText(initial.kind)}</option> : null}
          </select>
        </Field>
        <Field label={t("Which run")}>
          <select className="nx-input" value={scope} disabled={!edit} onChange={(e) => setScope(e.target.value)}>
            <option value="latest">{t("The latest finished run")}</option>
            <option value="upload">{t("The latest file upload")}</option>
            {(o?.systems ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {t("Latest run of {label}", { label: s.label })}
              </option>
            ))}
          </select>
        </Field>
        {type?.needs_module || (o?.modules.length ?? 0) > 0 ? (
          <Field label={`${t("Object")}${type?.needs_module ? "" : t(" (optional)")}`}>
            <select className="nx-input" value={module} disabled={!edit} onChange={(e) => setModule(e.target.value)}>
              <option value="">{type?.needs_module ? t("Choose an object") : t("All objects")}</option>
              {(o?.modules ?? []).map((m) => (
                <option key={m} value={m}>
                  {moduleText(m)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label={t("Cadence")}>
          <select className="nx-input" value={cadence} disabled={!edit} onChange={(e) => setCadence(e.target.value as ScheduleCadence)}>
            <option value="daily">{t("Every day")}</option>
            <option value="weekly">{t("Every week")}</option>
            <option value="monthly">{t("Every month")}</option>
          </select>
        </Field>
        {cadence === "weekly" ? (
          <Field label={t("On")}>
            <select className="nx-input" value={weekday} disabled={!edit} onChange={(e) => setWeekday(Number(e.target.value))}>
              {weekdays().map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {cadence === "monthly" ? (
          <Field label={t("On day of the month")}>
            <input className="nx-input" type="number" min={1} max={31} value={day} disabled={!edit} onChange={(e) => setDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} />
          </Field>
        ) : null}
        <Field label={t("At ({timezone})", { timezone: initial?.timezone ?? o?.timezone ?? t("tenant time zone") })}>
          <input className="nx-input" type="time" value={time} disabled={!edit} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <h3 className="nx-rp-h">{t("Recipients")}</h3>
      {o ? (
        <>
          <fieldset className="nx-rp-set">
            <legend className="nx-rp-sr">{t("People")}</legend>
            <ul className="nx-rp-pick" aria-label={t("People who receive it")}>
              {o.users.length === 0 ? <li className="nx-rp-sub">{t("No one can receive reports yet.")}</li> : null}
              {o.users.map((u) => (
                <li key={u.id}>
                  <label>
                    <input type="checkbox" className="nx-check" checked={users.includes(u.id)} disabled={!edit} onChange={() => toggle(users, u.id, setUsers)} />
                    <span>{u.label}</span>
                    <span className="nx-rp-sub">{u.detail}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {o.channels.length ? (
            <ul className="nx-rp-pick" aria-label={t("Alert channels that receive it")}>
              {o.channels.map((c) => (
                <li key={c.id}>
                  <label>
                    <input type="checkbox" className="nx-check" checked={channels.includes(c.id)} disabled={!edit} onChange={() => toggle(channels, c.id, setChannels)} />
                    <span>{c.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : opts.isError ? (
        <ErrorState error={opts.error} onRetry={() => void opts.refetch()} />
      ) : (
        <Skeleton lines={3} />
      )}
      <label className="nx-rp-switch">
        <input type="checkbox" className="nx-check" checked={enabled} disabled={!edit} onChange={(e) => setEnabled(e.target.checked)} />
        <span>{t("Schedule is on")}</span>
      </label>
      <Result outcome={outcome} />
      <Actions>
        <Button variant="primary" loading={pending === "save"} loadingLabel={t("Saving…")} disabled={!edit || !valid || pending !== null} onClick={save}>
          {initial ? t("Save the schedule") : t("Create the schedule")}
        </Button>
        {initial ? (
          <>
            <Button disabled={!edit || pending !== null} onClick={() => pause(!initial.enabled)}>
              {initial.enabled ? t("Pause") : t("Resume")}
            </Button>
            <Button
              disabled={!edit || pending !== null}
              onClick={() =>
                void run("now", async () => {
                  const r = await rep.runScheduleNow(initial.id);
                  await refreshAdmin(qc, "reports");
                  return { tone: "ok", title: r.queued ? t("Queued to run now") : t("Could not queue it"), detail: t("It is built on the worker and delivered to the recipients; the next scheduled run is unchanged.") };
                })
              }
            >
              {t("Run it now")}
            </Button>
            <Button variant="danger" disabled={!edit || pending !== null} onClick={() => setAsk(true)}>
              {t("Delete")}
            </Button>
          </>
        ) : null}
      </Actions>
      {!initial && !valid ? <p className="nx-rp-sub">{t("Name it, choose when, and pick at least one recipient.")}</p> : null}
      {initial ? (
        <Confirm
          open={ask}
          title={t("Delete {name}", { name: initial.name })}
          consequence={t("No more reports are built or sent from this schedule. Files it already made stay in the list.")}
          confirmLabel={t("Delete the schedule")}
          danger
          onCancel={() => setAsk(false)}
          onConfirm={() =>
            void run("delete", async () => {
              await rep.deleteSchedule(initial.id);
              await refreshAdmin(qc, "reports");
              setAsk(false);
              close();
              return { tone: "ok", title: t("Schedule deleted") };
            })
          }
        />
      ) : null}
    </InspectorFrame>
  );
}

export function ScheduleInspector({ id, onClose }: BodyProps) {
  const q = useSchedules();
  if (id === "new") return <ScheduleForm initial={null} onClose={onClose} />;
  const s = q.data?.find((x) => x.id === id);
  if (s) return <ScheduleForm key={s.id} initial={s} onClose={onClose} />;
  return (
    <InspectorFrame title={t("Schedule")} onClose={onClose}>
      {q.isLoading ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The schedule could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState heading={t("This schedule does not exist. It may have been deleted.")} />
      )}
    </InspectorFrame>
  );
}

export const REPORTS_BODIES: Record<string, ComponentType<BodyProps>> = {
  report: ReportInspector,
  schedule: ScheduleInspector,
  webhook: WebhookInspector,
  delivery: DeliveryInspector,
  policypack: PolicyPackInspector,
  digest: DigestInspector,
};
