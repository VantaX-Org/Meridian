"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SyncProfile } from "@/types/api";
import type { Job } from "@/types/jobs";
import * as api from "@/lib/api/v2/admin";
import { analyseRun, loadSystemConfig, retryJobById, uploadDataFile } from "@/lib/api/v2/runs";
import { getTemplates } from "@/lib/api/v2/migration";
import type { ExtractTargetChoice } from "@/lib/api/v2/extract-target";
import { useFixture } from "@/lib/api/v2/fixture";
import { getTriggerModules, triggerModules, type ModuleStatus } from "@/lib/api/v2/syncTrigger";
import { formatDate, MODULE_LABELS } from "@/lib/format";
import { refreshAdmin } from "@/lib/v2/admin-queries";
import { describeCron } from "@/lib/v2/cron";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobDoing } from "@/lib/v2/jobs";
import { labelText, moduleText } from "@/lib/v2/labels";
import { useSystemConfigLoad, useSystemExtractions, useSystemObjectList, useSystemsExtended, useV2Jobs } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { V2Link } from "@/design/v2/parts";
import { RunForecast } from "@/design/v2/screens/step10/Prediction";
import { Button, Chip, Code, Confirm, DataTable, EmptyState, Sheet, useToast, type Column } from "../kit";
import { Denied } from "../more/states";
import { OpsBlock, OpsLoaded, OpsPage, TONE, type V2Tone } from "./ops-kit";

const list = (s: string): string[] | undefined => {
  const v = s.split(/[\s,;]+/).filter(Boolean);
  return v.length ? v : undefined;
};

/** A cron line from a cadence, a time and a day. */
export function cronFor(cadence: "daily" | "weekly" | "monthly", time: string, weekday: number, day: number): string {
  const [h, m] = time.split(":").map((x) => Number(x) || 0);
  return cadence === "daily" ? `${m} ${h} * * *` : cadence === "weekly" ? `${m} ${h} * * ${weekday}` : `${m} ${h} ${day} * *`;
}

/** As v2 canRetry: a failed job can start again only when it recorded how it started. */
export function canRetry(job: Job): boolean {
  if (job.kind === "analysis") return Boolean(job.version_id);
  if (job.kind === "extraction") return Boolean(job.retry) && Boolean(job.system_id);
  return ["config_load", "process_discovery"].includes(job.kind) && Boolean(job.system_id);
}

type Outcome = { tone: "ok" | "fail"; title: string; detail?: string; job?: string | null; undo?: () => Promise<void> };

/** v2 useOutcome as a toast: one pending key at a time, the answer as a toast that opens the job it started. */
function useRun() {
  const toast = useToast();
  const { openItem } = useOpenItem();
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<Outcome>) => {
      setPending(key);
      let o: Outcome;
      try {
        o = await fn();
      } catch (e) {
        o = { tone: "fail", title: t("It did not go through"), detail: failureText(e) };
      } finally {
        setPending(null);
      }
      const job = o.job;
      toast({
        tone: o.tone === "ok" ? "good" : "bad",
        text: o.detail ? `${o.title}. ${o.detail}` : o.title,
        onUndo: o.undo,
        action: job ? { label: t("Open the job"), onClick: () => openItem({ kind: "job", id: job }) } : undefined,
      });
    },
    [toast, openItem],
  );
  return { pending, run };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="nx-field">
      <span>{label}</span>
      {children}
      {hint ? <small className="nx-note">{hint}</small> : null}
    </label>
  );
}

/** The choice the API takes: the system only when it differs from the paired one, a template only when it was picked by hand. */
export function buildChoice(paired: string | null, system: string | null, picks: Record<string, string>, modules: string[]): ExtractTargetChoice | undefined {
  const out: ExtractTargetChoice = {};
  if (system && system !== paired) out.target_system_id = system;
  const ids = Object.fromEntries(modules.filter((m) => m in picks).map((m) => [m, picks[m]]));
  if (Object.keys(ids).length) out.target_template_ids = ids;
  return Object.keys(out).length ? out : undefined;
}

function previewLine(rows: { module: string; name: string | null }[]): string {
  const named = rows.filter((r) => r.name);
  return named.length ? t("Will fill: {list}", { list: named.map((r) => t("{template} for {object}", { template: r.name ?? "", object: labelText(r.module) })).join(", ") }) : t("No template will be filled automatically.");
}

/** The Target step of an extraction: the target system (the paired one unless changed) and, per picked object, the template filled when the run is stored. */
function TargetStep({ system, modules, disabled, onChange }: { system: string; modules: string[]; disabled?: boolean; onChange: (c: ExtractTargetChoice | undefined) => void }) {
  const fixture = useFixture();
  const systems = useSystemsExtended();
  const [sys, setSys] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const all = systems.data ?? [];
  const paired = all.find((s) => s.id === system)?.target_system_id ?? null;
  const options = all.filter((s) => s.id !== system && (s.role === "target" || s.id === paired));
  const chosenSystem = sys ?? paired ?? "";
  const tpls = useQueries({
    queries: modules.map((m) => ({ queryKey: ["v2", "extract-target-templates", fixture, m], queryFn: () => getTemplates(m), retry: false, staleTime: 30_000 })),
  });
  const rows = modules.map((m, i) => {
    const found = [...(tpls[i]?.data?.templates ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const picked = m in picks ? picks[m] : found[0]?.id ?? "";
    return { module: m, list: found, loading: !!tpls[i]?.isLoading, picked, name: found.find((x) => x.id === picked)?.name ?? null };
  });
  const key = JSON.stringify(buildChoice(paired, chosenSystem || null, picks, modules) ?? null);
  useEffect(() => onChange(JSON.parse(key) ?? undefined), [key, onChange]);
  if (modules.length === 0) return null;
  return (
    <fieldset className="nx-field" data-testid="extract-target-step" disabled={disabled}>
      <legend>{t("Target")}</legend>
      <Field label={t("Target system")} hint={t("The system the extracted data is being prepared for. Defaults to the one paired with this system.")}>
        <select className="nx-input" value={chosenSystem} onChange={(e) => setSys(e.target.value)} data-testid="extract-target-system">
          {options.length === 0 && !chosenSystem ? <option value="">{t("No target system")}</option> : null}
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {`${s.name} (${s.role === "target" ? t("target system") : t("source system")}${s.id === paired ? t(", paired") : ""})`}
            </option>
          ))}
        </select>
      </Field>
      {!paired && options.length === 0 ? <p className="nx-note" data-testid="extract-target-nopair">{t("No target system is paired with this system. Pair one under Systems to prepare data for it.")}</p> : null}
      <ul className="nx-ops-picks" aria-label={t("Target templates")}>
        {rows.map((r) => (
          <li key={r.module}>
            <label>
              <span>{labelText(r.module)}</span>
              {r.loading ? (
                <span className="nx-note">{t("Reading templates…")}</span>
              ) : r.list.length === 0 ? (
                <span className="nx-note" data-testid={`extract-target-none-${r.module}`}>
                  {t("No template uploaded yet.")} <V2Link href="/migration">{t("Upload a template")}</V2Link>
                </span>
              ) : (
                <select className="nx-input" value={r.picked} aria-label={t("Template for {object}", { object: labelText(r.module) })} onChange={(e) => setPicks((p) => ({ ...p, [r.module]: e.target.value }))} data-testid={`extract-target-tpl-${r.module}`}>
                  <option value="">{t("None")}</option>
                  {r.list.map((x) => (
                    <option key={x.id} value={x.id}>
                      {`${x.name}, ${t("version {v}", { v: x.version })}`}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </li>
        ))}
      </ul>
      <p className="nx-note" data-testid="extract-target-preview">{previewLine(rows)}</p>
    </fieldset>
  );
}

function Extraction({ system }: { system: string }) {
  const qc = useQueryClient();
  const { can: allowed } = useV2Session();
  const can = allowed("trigger_sync");
  const canAnalyse = allowed("analyse");
  const objects = useSystemObjectList(system, !!system);
  const [picked, setPicked] = useState<string[]>([]);
  const [analyse, setAnalyse] = useState(true);
  const [delta, setDelta] = useState(false);
  const [target, setTarget] = useState<ExtractTargetChoice | undefined>();
  const [codes, setCodes] = useState("");
  const [plants, setPlants] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { pending, run } = useRun();
  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  const all = objects.data?.objects ?? [];
  const maxRecords = Math.max(1, ...all.map((o) => o.last_download?.records ?? 0));
  const start = () =>
    void run("extract", async () => {
      const r = await api.startExtraction(system, picked, analyse && canAnalyse, { company_codes: list(codes), plants: list(plants), date_from: from || undefined, date_to: to || undefined }, delta, target);
      void qc.invalidateQueries({ queryKey: ["v2"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      return {
        tone: "ok",
        title: delta ? t("Extraction of changes started") : t("Extraction started"),
        detail: t("{pickedCount} {pickedCount, plural, one {object} other {objects}}{value}.", { pickedCount: picked.length, value: `${delta ? t(", changes only since the last full download") : ""}${analyse && canAnalyse ? t(", analysed straight after") : ""}` }),
        job: r.job_id,
      };
    });
  return (
    <OpsBlock title={t("Start an extraction")} hint={t("Reads the chosen objects from the system into a new stored run. Leave the scope empty to read everything.")} testid="ops-runs-extract">
      <OpsLoaded q={objects} what={t("The objects")} rows={3}>
        {() => (
          <ul className="nx-ops-picks" aria-label={t("Objects to extract")}>
            {all.map((o) => (
              <li key={o.object}>
                <label>
                  <input type="checkbox" checked={picked.includes(o.object)} disabled={!can} onChange={() => toggle(o.object)} />
                  <span>{labelText(o.object)}</span>
                  <progress max={maxRecords} value={o.last_download?.records ?? 0} aria-hidden="true" />
                  <span className="nx-mono">{o.last_download?.records != null ? t("{n} records", { n: int(o.last_download.records) }) : "—"}</span>
                  <span className="nx-note">{o.last_download ? t("last {at}", { at: formatDate(o.last_download.at) }) : t("never")}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </OpsLoaded>
      <div className="nx-ops-form">
        <Field label={t("Company codes")} hint={t("Separated by commas.")}>
          <input className="nx-input" value={codes} disabled={!can} onChange={(e) => setCodes(e.target.value)} />
        </Field>
        <Field label={t("Plants")}>
          <input className="nx-input" value={plants} disabled={!can} onChange={(e) => setPlants(e.target.value)} />
        </Field>
        <Field label={t("Documents from")}>
          <input className="nx-input" type="date" value={from} disabled={!can} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("Documents to")}>
          <input className="nx-input" type="date" value={to} disabled={!can} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <label className="nx-row">
        <input type="checkbox" checked={analyse && canAnalyse} disabled={!canAnalyse || !can} onChange={(e) => setAnalyse(e.target.checked)} />
        <span>{t("Analyse straight after extracting")}</span>
      </label>
      <label className="nx-row">
        <input type="checkbox" checked={delta} disabled={!can} onChange={(e) => setDelta(e.target.checked)} data-testid="extract-delta" />
        <span>
          {t("Changes only since last full download")}{" "}
          <small className="nx-note">{t("Re-reads only the records whose SAP change date is after the last full download of the same objects and scope; tables without change dates are read in full. With no earlier download, everything is read.")}</small>
        </span>
      </label>
      <TargetStep system={system} modules={picked} disabled={!can} onChange={setTarget} />
      {picked.length ? <RunForecast systemId={system || null} modules={picked} delta={delta} what="extraction" /> : null}
      <div className="nx-ops-actions">
        <Button variant="primary" disabled={!can || picked.length === 0 || (pending !== null && pending !== "extract")} loading={pending === "extract"} loadingLabel={t("Starting…")} onClick={start}>
          {picked.length ? t("Extract {pickedCount} {pickedCount, plural, one {object} other {objects}}", { pickedCount: picked.length }) : t("Choose objects to extract")}
        </Button>
      </div>
      {!can ? <p className="nx-note">{t("Starting an extraction needs the trigger sync permission on this system.")}</p> : null}
    </OpsBlock>
  );
}

function Analysis({ system }: { system: string }) {
  const qc = useQueryClient();
  const can = useV2Session().can("analyse");
  const versions = useSystemExtractions(system, !!system);
  const seen = new Set<string>();
  const rows = (versions.data?.versions ?? []).filter((v) => v.analysable && !seen.has(v.id) && !!seen.add(v.id));
  const [picked, setPicked] = useState("");
  const chosen = picked || rows[0]?.id || "";
  const { pending, run } = useRun();
  const start = () =>
    void run("analyse", async () => {
      const r = await analyseRun(chosen);
      void qc.invalidateQueries({ queryKey: ["v2"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      return { tone: "ok", title: t("Analysis started"), detail: t("The extraction is being scored."), job: r.job_id };
    });
  return (
    <OpsBlock title={t("Start an analysis")} hint={t("Scores a stored extraction against the rules as they stand now. Earlier scores are kept as they were.")} testid="ops-runs-analyse">
      <OpsLoaded q={versions} what={t("Extraction")} rows={2}>
        {() => (
          <div className="nx-ops-form">
            <Field label={t("Extraction")}>
              <select className="nx-input" value={chosen} disabled={!can} onChange={(e) => setPicked(e.target.value)}>
                {rows.length === 0 ? <option value="">{t("No extraction can be analysed")}</option> : null}
                {rows.map((v) => (
                  <option key={v.id} value={v.id}>
                    {`${v.label ?? formatDate(v.run_at, "datetime")}${v.analysed_at ? t(", analysed with {rule_set}", { rule_set: v.rule_set ?? t("the rules") }) : t(", not analysed yet")}`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </OpsLoaded>
      {chosen ? <RunForecast systemId={system || null} modules={rows.find((v) => v.id === chosen)?.objects ?? []} what="analysis" /> : null}
      <div className="nx-ops-actions">
        <Button variant="primary" disabled={!can || !chosen || (pending !== null && pending !== "analyse")} loading={pending === "analyse"} loadingLabel={t("Starting…")} onClick={start}>
          {t("Run the analysis")}
        </Button>
      </div>
      {!can ? <p className="nx-note">{t("Starting an analysis needs the analyse permission.")}</p> : null}
    </OpsBlock>
  );
}

const UPLOAD_ACCEPT = ".csv,.tsv,.txt,.xlsx,.xls,.json,.parquet";
const UPLOAD_MODULES = Object.keys(MODULE_LABELS).sort((a, b) => labelText(a).localeCompare(labelText(b)));

/** A file of one object becomes a stored run and is analysed at once. Columns are matched by the field mappings. */
function FileUpload({ system }: { system: string }) {
  const qc = useQueryClient();
  const can = useV2Session().can("upload");
  const systems = useSystemsExtended();
  const [file, setFile] = useState<File | null>(null);
  const [module, setModule] = useState("");
  const [attach, setAttach] = useState(Boolean(system));
  const [pct, setPct] = useState(0);
  const { pending, run } = useRun();
  const systemName = systems.data?.find((s) => s.id === system)?.name ?? null;
  const upload = () =>
    void run("upload", async () => {
      if (!file) throw new Error(t("Choose a file first."));
      setPct(0);
      const r = await uploadDataFile(file, module, attach && system ? system : null, setPct);
      setFile(null);
      void qc.invalidateQueries({ queryKey: ["v2"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      return { tone: "ok", title: t("File uploaded, analysis started"), detail: t("{name} is being scored as {object}.", { name: file.name, object: labelText(module) }), job: r.job_id };
    });
  return (
    <OpsBlock title={t("Upload a file")} hint={t("A file of one object (CSV, TSV, Excel, JSON or Parquet) becomes a new stored run and is analysed at once. Its columns are matched by the field mappings under Administration.")} testid="ops-runs-upload">
      <div className="nx-ops-form">
        <Field label={t("File")}>
          <input className="nx-input" type="file" accept={UPLOAD_ACCEPT} disabled={!can} data-testid="upload-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label={t("Object")}>
          <select className="nx-input" value={module} disabled={!can} onChange={(e) => setModule(e.target.value)}>
            <option value="">{t("Choose the object the file holds")}</option>
            {UPLOAD_MODULES.map((m) => (
              <option key={m} value={m}>
                {labelText(m)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {system && systemName ? (
        <label className="nx-row">
          <input type="checkbox" checked={attach} disabled={!can} onChange={(e) => setAttach(e.target.checked)} />
          <span>{t("Attach the run to {name}", { name: systemName })}</span>
        </label>
      ) : null}
      <div className="nx-ops-actions">
        <Button variant="primary" disabled={!can || !file || !module || (pending !== null && pending !== "upload")} loading={pending === "upload"} loadingLabel={t("Uploading {pct}%", { pct })} onClick={upload}>
          {t("Upload and analyse")}
        </Button>
      </div>
      {!can ? <p className="nx-note">{t("Uploading a file needs the upload permission.")}</p> : null}
    </OpsBlock>
  );
}

function ConfigLoad({ system }: { system: string }) {
  const qc = useQueryClient();
  const can = useV2Session().can("trigger_sync");
  const load = useSystemConfigLoad(system, !!system);
  const { pending, run } = useRun();
  const start = () =>
    void run("config", async () => {
      const r = await loadSystemConfig(system);
      void qc.invalidateQueries({ queryKey: ["v2"] });
      return { tone: "ok", title: t("Configuration load started"), job: r.job_id };
    });
  return (
    <OpsBlock title={t("Load configuration")} hint={t("Reads the system's configuration tables, then derives the process flows. The last load is shown.")} testid="ops-runs-config">
      <p className="nx-note">
        {load.data
          ? t("Last load: {areas_loaded} of {areas_total} areas, {value}.", { areas_loaded: load.data.areas_loaded, areas_total: load.data.areas_total, value: load.data.finished_at ? formatDate(load.data.finished_at, "datetime") : t("Running") })
          : t("No configuration has been loaded yet.")}
      </p>
      <div className="nx-ops-actions">
        <Button variant="secondary" disabled={!can || !system || (pending !== null && pending !== "config")} loading={pending === "config"} loadingLabel={t("Starting…")} onClick={start}>
          {t("Load the configuration")}
        </Button>
      </div>
    </OpsBlock>
  );
}

const WEEKDAYS = () => [t("Sunday"), t("Monday"), t("Tuesday"), t("Wednesday"), t("Thursday"), t("Friday"), t("Saturday")];

function ProfileSheet({ system, profile, onClose }: { system: string; profile: SyncProfile | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const objects = useSystemObjectList(system, !profile);
  const [object, setObject] = useState(profile?.domain ?? "");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [time, setTime] = useState("04:00");
  const [weekday, setWeekday] = useState(1);
  const [day, setDay] = useState(1);
  const [cron, setCron] = useState(profile?.schedule_cron ?? "");
  const [custom, setCustom] = useState(!!profile);
  const [mode, setMode] = useState<"full" | "delta">(profile?.extraction_mode ?? "full");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const line = custom ? cron.trim() : cronFor(cadence, time, weekday, day);
  const valid = (profile || !!object) && line.split(/\s+/).length === 5;
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    setTouched(true);
    set(v);
  };
  const save = async () => {
    setSaving(true);
    setFailed(null);
    try {
      if (profile) {
        const prev = { schedule_cron: profile.schedule_cron ?? "", active: profile.active, extraction_mode: profile.extraction_mode };
        await api.updateProfile(system, profile.id, { schedule_cron: line, extraction_mode: mode });
        await refreshAdmin(qc, "profiles");
        toast({
          tone: "good",
          text: t("Schedule saved"),
          onUndo: async () => {
            await api.updateProfile(system, profile.id, prev);
            await refreshAdmin(qc, "profiles");
          },
        });
      } else {
        const o = objects.data?.objects.find((x) => x.object === object);
        await api.createProfile(system, { system_id: system, domain: object, tables: o?.tables ?? [], schedule_cron: line, active: true, extraction_mode: mode });
        await refreshAdmin(qc, "profiles");
        toast({ tone: "good", text: t("Schedule created") });
      }
      onClose();
    } catch (e) {
      setFailed(failureText(e));
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
      title={profile ? t("Edit the schedule of {domain}", { domain: labelText(profile.domain) }) : t("Schedule a run")}
      meta={t("The system extracts the object on this rhythm. Changing it never fires a run at once.")}
      secondary={
        <Button variant="secondary" onClick={onClose}>
          {t("Cancel")}
        </Button>
      }
      primary={
        <Button variant="primary" disabled={!valid} loading={saving} loadingLabel={t("Saving…")} onClick={() => void save()}>
          {profile ? t("Save the schedule") : t("Create the schedule")}
        </Button>
      }
    >
      <div className="nx-ops-form">
        {!profile ? (
          <Field label={t("Object")}>
            <select className="nx-input" value={object} onChange={(e) => edit(setObject)(e.target.value)}>
              <option value="">{t("Choose an object")}</option>
              {(objects.data?.objects ?? []).map((o) => (
                <option key={o.object} value={o.object}>
                  {labelText(o.object)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {custom ? (
          <Field label={t("Cron line (minute hour day month weekday)")}>
            <input className="nx-input" value={cron} onChange={(e) => edit(setCron)(e.target.value)} placeholder="0 4 * * 1" />
          </Field>
        ) : (
          <>
            <Field label={t("Cadence")}>
              <select className="nx-input" value={cadence} onChange={(e) => edit(setCadence)(e.target.value as typeof cadence)}>
                <option value="daily">{t("Every day")}</option>
                <option value="weekly">{t("Every week")}</option>
                <option value="monthly">{t("Every month")}</option>
              </select>
            </Field>
            {cadence === "weekly" ? (
              <Field label={t("On")}>
                <select className="nx-input" value={weekday} onChange={(e) => edit(setWeekday)(Number(e.target.value))}>
                  {WEEKDAYS().map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {cadence === "monthly" ? (
              <Field label={t("On day of the month")}>
                <input className="nx-input" type="number" min={1} max={28} value={day} onChange={(e) => edit(setDay)(Math.max(1, Math.min(28, Number(e.target.value) || 1)))} />
              </Field>
            ) : null}
            <Field label={t("At (UTC)")}>
              <input className="nx-input" type="time" value={time} onChange={(e) => edit(setTime)(e.target.value)} />
            </Field>
          </>
        )}
        <Field label={t("What it reads")}>
          <select className="nx-input" value={mode} onChange={(e) => edit(setMode)(e.target.value as "full" | "delta")}>
            <option value="full">{t("Everything each time")}</option>
            <option value="delta">{t("Only what changed since the last run")}</option>
          </select>
        </Field>
      </div>
      <div className="nx-ops-actions">
        <Button variant="quiet" onClick={() => setCustom(!custom)}>
          {custom ? t("Choose a cadence instead") : t("Write a cron line instead")}
        </Button>
      </div>
      <p className="nx-note" role="status">
        {t("Runs {describeCron}.", { describeCron: describeCron(line) })}
      </p>
      {failed ? (
        <p className="nx-ops-bad" role="alert">
          {t("It did not go through")}. {failed}
        </p>
      ) : null}
    </Sheet>
  );
}

function Schedules({ system }: { system: string }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const can = useV2Session().can("manage_systems");
  const q = useQuery({ queryKey: ["v2", "admin", fixture, "profiles", system], queryFn: () => api.listProfiles(system), enabled: !!system, staleTime: 15_000, retry: false });
  const [editing, setEditing] = useState<SyncProfile | "new" | null>(null);
  const [removing, setRemoving] = useState<SyncProfile | null>(null);
  const { pending, run } = useRun();
  const toggle = (p: SyncProfile) =>
    void run(`pause-${p.id}`, async () => {
      await api.updateProfile(system, p.id, { active: !p.active });
      await refreshAdmin(qc, "profiles");
      return {
        tone: "ok",
        title: p.active ? t("{domain} schedule paused", { domain: labelText(p.domain) }) : t("{domain} schedule resumed", { domain: labelText(p.domain) }),
        undo: async () => {
          await api.updateProfile(system, p.id, { active: p.active });
          await refreshAdmin(qc, "profiles");
        },
      };
    });
  const columns: Column<SyncProfile>[] = [
    { id: "object", label: t("Object"), cell: (p) => labelText(p.domain) },
    { id: "when", label: t("Rhythm"), cell: (p) => describeCron(p.schedule_cron) },
    { id: "mode", label: t("Reads"), cell: (p) => (p.extraction_mode === "delta" ? t("Changes") : t("Everything")) },
    { id: "next", label: t("Next run"), cell: (p) => (p.active && p.next_run_at ? formatDate(p.next_run_at, "datetime") : <Chip tone="neutral">{t("Paused")}</Chip>) },
    { id: "last", label: t("Last run"), cell: (p) => (p.last_run_at ? formatDate(p.last_run_at, "datetime") : t("Never")) },
    {
      id: "act",
      label: t("Actions"),
      cell: (p) => (
        <span className="nx-ops-actions">
          <Button size={32} variant="secondary" disabled={!can || pending !== null} aria-label={`${p.active ? t("Pause") : t("Resume")} ${labelText(p.domain)}`} onClick={() => toggle(p)}>
            {p.active ? t("Pause") : t("Resume")}
          </Button>
          <Button size={32} variant="secondary" disabled={!can} aria-label={t("Edit {domain}", { domain: labelText(p.domain) })} onClick={() => setEditing(p)}>
            {t("Edit")}
          </Button>
          <Button size={32} variant="danger" disabled={!can} aria-label={t("Delete {domain}", { domain: labelText(p.domain) })} onClick={() => setRemoving(p)}>
            {t("Delete")}
          </Button>
        </span>
      ),
    },
  ];
  return (
    <OpsBlock
      title={t("Scheduled runs")}
      hint={t("Objects this system extracts on a rhythm. A paused schedule keeps its settings.")}
      testid="ops-runs-profiles"
      actions={
        <Button variant="secondary" disabled={!can || !system} onClick={() => setEditing("new")}>
          {t("Schedule a run")}
        </Button>
      }
    >
      <DataTable
        caption={t("Scheduled runs")}
        rows={q.data ?? []}
        columns={columns}
        rowKey={(p) => p.id}
        rowLabel={(p) => labelText(p.domain)}
        loading={q.isPending && !!system}
        error={q.isError ? { sentence: t("The schedules could not be read."), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: t("No run is scheduled for this system. Schedule one and the extraction arrives on its own.") }}
        density="compact"
      />
      {!can ? <p className="nx-note">{t("Scheduling needs the manage systems permission.")}</p> : null}
      {editing ? <ProfileSheet system={system} profile={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      <Confirm
        open={!!removing}
        title={removing ? t("Delete the schedule of {domain}", { domain: labelText(removing.domain) }) : ""}
        consequence={t("The object is no longer extracted on a rhythm. Runs it already made stay.")}
        confirmLabel={t("Delete the schedule")}
        danger
        blocked={pending === "delete" ? t("Working…") : undefined}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          const target = removing;
          void run("delete", async () => {
            await api.deleteProfile(system, target.id);
            await refreshAdmin(qc, "profiles");
            setRemoving(null);
            return { tone: "ok", title: t("Schedule deleted") };
          });
        }}
      />
    </OpsBlock>
  );
}

const RUN_TONE: Record<string, V2Tone> = { completed: "go", success: "go", running: "at-risk", pending: "neutral", failed: "no-go", error: "no-go" };

/** Every run the schedules of one system made, newest first, with a button that runs every active schedule now. */
function SyncHistory({ system }: { system: string }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const can = useV2Session().can("trigger_sync");
  const q = useQuery({ queryKey: ["v2", "admin", fixture, "sync-runs", system], queryFn: () => api.listSyncRuns(system, 50), enabled: !!system, staleTime: 15_000, retry: false });
  const profiles = useQuery({ queryKey: ["v2", "admin", fixture, "profiles", system], queryFn: () => api.listProfiles(system), enabled: !!system, staleTime: 15_000, retry: false });
  const { pending, run } = useRun();
  const domainOf = (id: string) => {
    const p = (profiles.data ?? []).find((x) => x.id === id);
    return p ? labelText(p.domain) : "—";
  };
  const word: Record<string, string> = { completed: t("Done"), success: t("Done"), running: t("Running"), pending: t("Waiting"), failed: t("Failed"), error: t("Failed") };
  const columns: Column<api.SyncRun>[] = [
    { id: "started", label: t("Started"), cell: (r) => formatDate(r.started_at, "datetime") },
    { id: "object", label: t("Object"), cell: (r) => domainOf(r.profile_id) },
    { id: "status", label: t("Status"), cell: (r) => <Chip tone={TONE[RUN_TONE[r.status] ?? "neutral"]}>{word[r.status] ?? r.status}</Chip> },
    { id: "rows", label: t("Rows read"), align: "end", cell: (r) => (r.completed_at ? int(r.rows_extracted) : "—") },
    { id: "delta", label: t("Findings change"), align: "end", cell: (r) => (r.completed_at ? `${r.findings_delta > 0 ? "+" : ""}${int(r.findings_delta)}` : "—") },
    { id: "golden", label: t("Golden records updated"), align: "end", cell: (r) => (r.completed_at ? int(r.golden_records_updated) : "—") },
    { id: "error", label: t("Why it failed"), cell: (r) => r.error_detail ?? "—" },
  ];
  const syncAll = () =>
    void run("sync", async () => {
      const r = await api.syncSystem(system);
      void qc.invalidateQueries({ queryKey: ["v2", "admin", fixture, "sync-runs", system] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      return { tone: "ok", title: t("{n, plural, one {# schedule} other {# schedules}} started", { n: r.profile_count }), detail: t("Follow them in the job line.") };
    });
  return (
    <OpsBlock
      title={t("Sync history")}
      hint={t("Each run a schedule made on this system. A rise in findings means the data got worse since the run before.")}
      testid="ops-runs-sync"
      actions={
        <Button variant="secondary" disabled={!can || !system || (pending !== null && pending !== "sync")} loading={pending === "sync"} loadingLabel={t("Starting…")} onClick={syncAll}>
          {t("Run every schedule now")}
        </Button>
      }
    >
      <DataTable
        caption={t("Sync history")}
        rows={q.data ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        rowLabel={(r) => `${domainOf(r.profile_id)} ${formatDate(r.started_at, "datetime")}`}
        loading={q.isPending && !!system}
        error={q.isError ? { sentence: t("The sync history could not be read."), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: t("No schedule of this system has run yet.") }}
        density="compact"
      />
      {!can ? <p className="nx-note">{t("Running schedules needs the trigger_sync permission.")}</p> : null}
    </OpsBlock>
  );
}

const JOB_TONE: Record<string, V2Tone> = { completed: "go", failed: "no-go", running: "at-risk" };

function RecentJobs() {
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const jobs = useV2Jobs();
  const { can } = useV2Session();
  const { pending, run } = useRun();
  const rows = jobs.jobs.filter((j, i, all) => all.findIndex((x) => x.id === j.id) === i).slice(0, 12);
  const columns: Column<Job>[] = [
    { id: "job", label: t("Job"), cell: (j) => jobDoing(j) },
    { id: "kind", label: t("Kind"), cell: (j) => JOB_KIND_LABEL[j.kind] ?? labelText(j.kind) },
    { id: "status", label: t("Status"), cell: (j) => <Chip tone={TONE[JOB_TONE[j.status] ?? "neutral"]}>{JOB_STATUS_LABEL[j.status]}</Chip> },
    { id: "started", label: t("Started"), cell: (j) => formatDate(j.started_at * 1000, "datetime") },
    {
      id: "act",
      label: t("Actions"),
      cell: (j) => (
        <span className="nx-ops-actions">
          <Button size={32} variant="secondary" onClick={() => openItem({ kind: "job", id: j.id })} aria-label={t("Open {jobDoing}", { jobDoing: jobDoing(j) })}>
            {t("Open")}
          </Button>
          {j.status === "failed" ? (
            <Button
              size={32}
              variant="secondary"
              disabled={!canRetry(j) || !can("trigger_sync") || pending !== null}
              aria-label={t("Retry {jobDoing}", { jobDoing: jobDoing(j) })}
              onClick={() =>
                void run(`retry-${j.id}`, async () => {
                  const r = await retryJobById(j.id);
                  void qc.invalidateQueries({ queryKey: ["v2"] });
                  void qc.invalidateQueries({ queryKey: ["jobs"] });
                  return { tone: "ok", title: t("Started again"), job: r.job_id ?? null };
                })
              }
            >
              {t("Retry")}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <OpsBlock title={t("Recent jobs")} hint={t("Open a job for its stages and tables. A failed job that recorded how it started can be retried; a running job cannot be cancelled, because the API has no cancel.")} testid="ops-runs-jobs">
      <DataTable
        caption={t("Recent jobs")}
        rows={rows}
        columns={columns}
        rowKey={(j) => j.id}
        rowLabel={(j) => jobDoing(j)}
        loading={jobs.isPending}
        empty={{ heading: t("No job has run yet.") }}
        onOpenRow={(j) => openItem({ kind: "job", id: j.id })}
        density="compact"
      />
    </OpsBlock>
  );
}

const RECHECK_STATUS: Record<ModuleStatus["status"], () => [V2Tone, string]> = {
  completed: () => ["go", t("Analysed")],
  running: () => ["at-risk", t("Running")],
  failed: () => ["no-go", t("Failed")],
  idle: () => ["neutral", t("Not analysed")],
};

/** Re-check objects: re-score the latest stored extraction of each picked object, across every system, without a new extraction. */
function Recheck() {
  const qc = useQueryClient();
  const f = useFixture();
  const can = useV2Session().can("trigger_sync");
  const q = useQuery({ queryKey: ["v2", "sync-trigger", f], queryFn: getTriggerModules, retry: false });
  const [picked, setPicked] = useState<string[]>([]);
  const { pending, run } = useRun();
  const rows = (q.data ?? []).filter((m) => m.last_run_at);
  const never = (q.data ?? []).length - rows.length;
  const flip = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const recheck = () =>
    void run("recheck", async () => {
      const r = await triggerModules(picked);
      setPicked([]);
      void qc.invalidateQueries({ queryKey: ["v2"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      const names = (ids: string[]) => ids.map(moduleText).join(", ");
      if (!r.queued.length) return { tone: "fail", title: t("Nothing was queued"), detail: t("Not queued: {objects}.", { objects: names(r.skipped) }) };
      return { tone: "ok", title: t("{n, plural, one {# object} other {# objects}} queued for a re-check", { n: r.queued.length }), detail: r.skipped.length ? t("Not queued: {objects}.", { objects: names(r.skipped) }) : names(r.queued) };
    });
  const columns: Column<ModuleStatus>[] = [
    {
      id: "pick",
      label: t("Re-check objects"),
      cell: (m) => <input type="checkbox" disabled={!can || m.status === "running"} checked={picked.includes(m.module_id)} aria-label={t("Re-check {object}", { object: moduleText(m.module_id) })} onChange={() => flip(m.module_id)} />,
    },
    { id: "object", label: t("Object"), cell: (m) => <Code code={m.module_id} text={moduleText(m.module_id)} /> },
    { id: "category", label: t("System type"), cell: (m) => m.category },
    {
      id: "status",
      label: t("Latest analysis"),
      cell: (m) => {
        const [tone, text] = RECHECK_STATUS[m.status]();
        return <Chip tone={TONE[tone]}>{text}</Chip>;
      },
    },
    { id: "last", label: t("Last run"), cell: (m) => (m.last_run_at ? formatDate(m.last_run_at, "datetime") : "–") },
  ];
  return (
    <OpsBlock title={t("Re-check objects")} hint={t("Scores the latest stored extraction of each object again against the rules as they stand now. Nothing is read from SAP.")} testid="ops-runs-recheck">
      <OpsLoaded q={q} what={t("The objects")} rows={3}>
        {() =>
          rows.length === 0 ? (
            <EmptyState heading={t("No object has a stored extraction to re-check yet.")} />
          ) : (
            <DataTable caption={t("Objects to re-check")} rows={rows} columns={columns} rowKey={(m) => m.module_id} rowLabel={(m) => moduleText(m.module_id)} density="compact" />
          )
        }
      </OpsLoaded>
      {never > 0 ? <p className="nx-note">{t("{n, plural, one {# more object has} other {# more objects have}} no stored extraction. Start an extraction first.", { n: never })}</p> : null}
      {can ? (
        <div className="nx-ops-actions">
          <Button variant="primary" disabled={picked.length === 0 || (pending !== null && pending !== "recheck")} loading={pending === "recheck"} loadingLabel={t("Starting…")} onClick={recheck}>
            {t("Re-check {n, plural, one {# object} other {# objects}}", { n: picked.length })}
          </Button>
        </div>
      ) : (
        <p className="nx-note">{t("Re-checking objects needs the trigger_sync permission.")}</p>
      )}
    </OpsBlock>
  );
}

/** Admin > Start and schedule: start an extraction, an analysis or a configuration load, schedule runs, upload a file, re-check objects and retry what failed. */
export function OpsRuns() {
  const { can } = useV2Session();
  const systems = useSystemsExtended();
  const [picked, setPicked] = useState("");
  const system = picked || systems.data?.[0]?.id || "";
  const allowed = can("trigger_sync") || can("analyse") || can("manage_systems") || can("upload");
  if (!allowed) return <Denied what={t("Starting runs")} />;
  return (
    <OpsPage lead={t("Start work here and follow it in the job line. Everything below acts on one system at a time.")}>
      <OpsLoaded q={systems} what={t("System")} rows={2}>
        {(all) =>
          all.length === 0 ? (
            <EmptyState heading={t("No system is connected yet. Connect one from the landscape, then start an extraction here.")} />
          ) : (
            <>
              <div className="nx-ops-form">
                <Field label={t("System")}>
                  <select className="nx-input" value={system} onChange={(e) => setPicked(e.target.value)}>
                    {all.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Extraction key={`x-${system}`} system={system} />
              <Analysis key={`a-${system}`} system={system} />
              <ConfigLoad key={`c-${system}`} system={system} />
              <Schedules key={`s-${system}`} system={system} />
              <SyncHistory key={`h-${system}`} system={system} />
            </>
          )
        }
      </OpsLoaded>
      <FileUpload key={`u-${system}`} system={system} />
      <Recheck />
      <RecentJobs />
    </OpsPage>
  );
}
