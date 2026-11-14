"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { createRunSchedule, type SchedulePreset } from "@/lib/api/v2/admin";
import { startRun, useRunsPage, useTemplatesFor } from "@/lib/api/next/runs";
import type { DownloadScope } from "@/lib/api/system-objects";
import { Button, EmptyState, ErrorState, Sheet, Skeleton, useToast } from "../kit";
import { clearDraft, loadDraft, saveDraft } from "./draft";
import "./runs.css";

export interface RunDraft {
  system: string;
  objects: string[];
  companyCodes: string;
  plants: string;
  dateFrom: string;
  dateTo: string;
  delta: boolean;
  /** undefined: the source system's paired target. "": none. */
  target: string | undefined;
  templates: Record<string, string>;
  when: "now" | "schedule";
  preset: SchedulePreset;
}

export const EMPTY_DRAFT: RunDraft = { system: "", objects: [], companyCodes: "", plants: "", dateFrom: "", dateTo: "", delta: false, target: undefined, templates: {}, when: "now", preset: "daily" };
export const SHEET_ID = "run:new";
export const STEP_COUNT = 5;
const PRESETS: SchedulePreset[] = ["hourly", "daily", "weekdays", "weekly", "monthly"];
const PRESET_LABEL: Record<SchedulePreset, () => string> = {
  hourly: () => t("Every hour"),
  daily: () => t("Every day"),
  weekdays: () => t("Every weekday"),
  weekly: () => t("Every week"),
  monthly: () => t("Every month"),
};

const list = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

/** The scope a draft sends: only the fields that have a value, so an empty scope is the default extraction. */
export function scopeOf(d: RunDraft): DownloadScope {
  const out: DownloadScope = {};
  if (list(d.companyCodes).length) out.company_codes = list(d.companyCodes);
  if (list(d.plants).length) out.plants = list(d.plants);
  if (d.dateFrom) out.date_from = d.dateFrom;
  if (d.dateTo) out.date_to = d.dateTo;
  return out;
}

/** The first step that cannot be passed yet (1 to 5), or null when every step before Review is valid. Deep links clamp to it. */
export function firstInvalidStep(d: RunDraft, known: { targets: string[] | null; templates: Record<string, string[] | null> }): number | null {
  if (!d.system || !d.objects.length) return 1;
  if (d.dateFrom && d.dateTo && d.dateFrom > d.dateTo) return 2;
  if (d.target && known.targets && !known.targets.includes(d.target)) return 3;
  for (const [m, id] of Object.entries(d.templates)) if (id && known.templates[m] && !known.templates[m]?.includes(id)) return 3;
  return null;
}

const STEP_KEYS = ["objects", "scope", "target", "when", "review"] as const;

export function RunSheet({ step, setStep, close, under }: { step: number; setStep: (n: number) => void; close: () => void; under?: boolean }) {
  const { can } = useV2Session();
  const href = useV2Href();
  const toast = useToast();
  const qc = useQueryClient();
  const landscape = useLandscape(null);
  const systems = useSystemsExtended();
  const [draft, setDraft] = useState<RunDraft>(() => loadDraft(SHEET_ID, EMPTY_DRAFT));
  const [sent, setSent] = useState(false);
  const busy = useRef(false);
  const patch = (p: Partial<RunDraft>) => setDraft((d) => ({ ...d, ...p }));

  useEffect(() => { if (!sent) saveDraft(SHEET_ID, draft); }, [draft, sent]);

  const sources = useMemo(() => (systems.data ?? []).filter((s) => s.is_active !== false && s.role !== "target"), [systems.data]);
  const system = sources.find((s) => s.id === draft.system) ?? null;
  const objects = useMemo(() => {
    const l = landscape.data;
    if (!l || !draft.system) return [] as Array<{ module: string; label: string; records: number | null }>;
    return l.objects
      .map((o) => ({ module: o.module, label: o.label, cell: l.cells.find((c) => c.system_id === draft.system && c.module === o.module) }))
      .filter((o) => o.cell)
      .map((o) => ({ module: o.module, label: o.label, records: o.cell?.records_checked ?? null }));
  }, [landscape.data, draft.system]);

  const targets = useMemo(() => (systems.data ?? []).filter((s) => s.role === "target" && s.is_active !== false), [systems.data]);
  const paired = system?.target_system_id ?? "";
  const targetId = draft.target === undefined ? paired : draft.target;
  const targetKnown = !targetId || targets.some((s) => s.id === targetId);
  const tpls = useTemplatesFor(draft.objects);
  const known = useMemo(() => ({
    targets: systems.data ? targets.map((s) => s.id) : null,
    templates: Object.fromEntries(draft.objects.map((m) => [m, tpls[m]?.loading || tpls[m]?.error ? null : tpls[m].templates.map((x) => x.id)])),
  }), [systems.data, targets, draft.objects, tpls]);
  const invalid = firstInvalidStep({ ...draft, target: draft.target === undefined ? paired || undefined : draft.target }, known);
  const maxStep = invalid ?? STEP_COUNT;
  const at = Math.max(1, Math.min(step, maxStep));
  useEffect(() => { if (systems.data && landscape.data && at !== step) setStep(at); }, [at, step, setStep, systems.data, landscape.data]);

  const active = useRunsPage({ system_id: draft.system || null, status: "active", limit: 50 }, !!draft.system);
  const blocking = (active.data?.versions ?? []).find((v) => {
    const mods = v.metadata?.modules;
    return !mods?.length || mods.some((m) => draft.objects.includes(m));
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const scope = scopeOf(draft);
      if (draft.when === "schedule") return createRunSchedule({ system_id: draft.system, modules: draft.objects, preset: draft.preset, scope, extraction_mode: draft.delta ? "delta" : "full", active: true });
      const ids = Object.fromEntries(Object.entries(draft.templates).filter(([m, id]) => id && draft.objects.includes(m)));
      return startRun(draft.system, { objects: draft.objects, scope, analyse: true, delta: draft.delta, target_system_id: targetId || null, target_template_ids: ids });
    },
    onSuccess: () => {
      clearDraft(SHEET_ID);
      setSent(true);
      for (const k of ["v2", "jobs", "next"]) void qc.invalidateQueries({ queryKey: [k] });
      toast({ text: draft.when === "schedule" ? t("The schedule is set.") : t("The run has started."), tone: "good" });
      close();
    },
    onSettled: () => { busy.current = false; },
  });
  const submit = () => {
    if (busy.current || blocking) return;
    busy.current = true;
    mutation.mutate();
  };

  const steps = [t("Objects"), t("Scope"), t("Target"), t("When"), t("Review and confirm")].map((label, i) => ({ id: STEP_KEYS[i], label }));
  const dirty = !sent && (draft.objects.length > 0 || !!draft.system);

  if (!can("analyse")) {
    return (
      <Sheet open onClose={close} title={t("Start a run")} size="medium" under={under}>
        <EmptyState icon="alert" heading={t("Your role cannot start a run")}>{t("Ask an administrator for the analyse permission, or open a run that already exists.")}</EmptyState>
      </Sheet>
    );
  }

  const nextOk = at === 1 ? !!draft.system && draft.objects.length > 0 : at === 2 ? !(draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) : at === 3 ? targetKnown && draft.objects.every((m) => !draft.templates[m] || known.templates[m] === null || known.templates[m]?.includes(draft.templates[m])) : true;
  const confirmLabel = draft.when === "schedule" ? t("Set the schedule") : t("Start the run");
  const primary = at < STEP_COUNT
    ? <Button variant="primary" disabled={!nextOk} reason={nextOk ? undefined : t("Finish this step first.")} onClick={() => setStep(at + 1)}>{t("Next")}</Button>
    : <Button variant="primary" loading={mutation.isPending} disabled={!!blocking || invalid !== null} reason={blocking ? t("A run is already in progress for this object.") : undefined} onClick={submit}>{confirmLabel}</Button>;
  const secondary = at > 1 ? <Button variant="secondary" onClick={() => setStep(at - 1)}>{t("Back")}</Button> : undefined;

  const loading = systems.isLoading || landscape.isLoading;
  const failed = systems.isError || landscape.isError;

  return (
    <Sheet open onClose={close} title={t("Start a run")} size="large" steps={steps} step={at} onStep={(n) => n < at && setStep(n)} dirty={dirty} primary={primary} secondary={secondary} under={under}>
      <div className="nx-rs" data-testid="run-sheet" data-step={STEP_KEYS[at - 1]}>
        {loading ? <Skeleton lines={5} label={t("Loading systems and objects")} /> : failed ? (
          <ErrorState sentence={t("The systems could not be loaded.")} onRetry={() => { void systems.refetch(); void landscape.refetch(); }} />
        ) : sources.length === 0 ? (
          <EmptyState icon="inbox" heading={t("No system to run")} action={<Link className="nx-rn-link" href={href("/more/systems")}>{t("Connect a system")}</Link>}>{t("A run reads from a connected source system. Connect one first.")}</EmptyState>
        ) : at === 1 ? (
          <fieldset className="nx-rs-f">
            <legend>{t("Which system and which objects")}</legend>
            <label className="nx-rs-l">{t("Source system")}
              <select value={draft.system} onChange={(e) => patch({ system: e.target.value, objects: [], templates: {}, target: undefined })}>
                <option value="">{t("Choose a system")}</option>
                {sources.map((s) => <option key={s.id} value={s.id} title={s.name}>{s.name}</option>)}
              </select>
            </label>
            {draft.system && objects.length === 0 ? <p className="nx-rs-note">{t("This system has no object with a run yet. Load its data first.")}</p> : null}
            {objects.length ? (
              <>
                <div className="nx-rs-row">
                  <Button variant="quiet" size={32} onClick={() => patch({ objects: objects.map((o) => o.module) })}>{t("Select all")}</Button>
                  <Button variant="quiet" size={32} onClick={() => patch({ objects: [] })}>{t("Clear")}</Button>
                  <span aria-live="polite">{t("{n} of {m} chosen", { n: formatInt(draft.objects.length), m: formatInt(objects.length) })}</span>
                </div>
                <ul className="nx-rs-list">
                  {objects.map((o) => (
                    <li key={o.module}>
                      <label className="nx-rs-check">
                        <input type="checkbox" checked={draft.objects.includes(o.module)} onChange={(e) => patch({ objects: e.target.checked ? [...draft.objects, o.module] : draft.objects.filter((m) => m !== o.module) })} />
                        <span className="nx-rs-name" title={moduleText(o.module) || o.label}>{moduleText(o.module) || o.label}</span>
                        <span className="nx-rs-count">{o.records == null ? t("Not counted yet") : `${formatInt(o.records)} ${t("{n, plural, one {record} other {records}}", { n: o.records })}`}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </fieldset>
        ) : at === 2 ? (
          <fieldset className="nx-rs-f">
            <legend>{t("How much to read")}</legend>
            <p className="nx-rs-note">{t("Leave a field empty to read everything.")}</p>
            <label className="nx-rs-l">{t("Company codes")}<input value={draft.companyCodes} onChange={(e) => patch({ companyCodes: e.target.value })} placeholder={t("1000, 2000")} /></label>
            <label className="nx-rs-l">{t("Plants")}<input value={draft.plants} onChange={(e) => patch({ plants: e.target.value })} placeholder={t("P100, P200")} /></label>
            <div className="nx-rs-row">
              <label className="nx-rs-l">{t("From date")}<input type="date" value={draft.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} /></label>
              <label className="nx-rs-l">{t("To date")}<input type="date" value={draft.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} /></label>
            </div>
            {draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo ? <p role="alert" className="nx-rs-bad">{t("The from date is after the to date.")}</p> : null}
            <label className="nx-rs-check"><input type="checkbox" checked={draft.delta} onChange={(e) => patch({ delta: e.target.checked })} /><span>{t("Only read what changed since the last run")}</span></label>
          </fieldset>
        ) : at === 3 ? (
          <fieldset className="nx-rs-f">
            <legend>{t("Where the cleaned data will go")}</legend>
            <label className="nx-rs-l">{t("Target system")}
              <select value={targetId} onChange={(e) => patch({ target: e.target.value })}>
                <option value="">{t("None")}</option>
                {targetId && !targetKnown ? <option value={targetId}>{t("Missing target")}</option> : null}
                {targets.map((s) => <option key={s.id} value={s.id} title={s.name}>{s.name}{s.id === paired ? ` (${t("paired")})` : ""}</option>)}
              </select>
            </label>
            {!targetKnown ? <p role="alert" className="nx-rs-bad">{t("The chosen target no longer exists. Pick another one or choose None.")}</p> : null}
            {!paired && draft.target === undefined ? <p className="nx-rs-note">{t("This system has no paired target.")}</p> : null}
            <h3 className="nx-rs-h">{t("Target template for each object")}</h3>
            <ul className="nx-rs-list">
              {draft.objects.map((m) => {
                const q = tpls[m];
                const chosen = draft.templates[m] ?? q.templates[0]?.id ?? "";
                const gone = !!draft.templates[m] && !q.loading && !q.error && !q.templates.some((x) => x.id === draft.templates[m]);
                return (
                  <li key={m} className="nx-rs-tpl">
                    <span className="nx-rs-name" title={moduleText(m)}>{moduleText(m)}</span>
                    {q.loading ? <Skeleton lines={1} /> : q.error ? <span className="nx-rs-bad">{t("The templates could not be read.")}</span> : q.templates.length === 0 ? (
                      <span className="nx-rs-note">{t("No template yet.")} <Link className="nx-rn-link" href={href(`/migration?tpl_module=${encodeURIComponent(m)}`)}>{t("Open the template library")}</Link></span>
                    ) : (
                      <select aria-label={t("Template for {object}", { object: moduleText(m) })} value={gone ? draft.templates[m] : chosen} onChange={(e) => patch({ templates: { ...draft.templates, [m]: e.target.value } })}>
                        {gone ? <option value={draft.templates[m]}>{t("Missing template")}</option> : null}
                        {q.templates.map((x, i) => <option key={x.id} value={x.id} title={x.name}>{x.name} v{x.version}{i === 0 ? ` (${t("latest")})` : ""}</option>)}
                      </select>
                    )}
                    {gone ? <span role="alert" className="nx-rs-bad">{t("That template was deleted. Pick another one.")}</span> : null}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : at === 4 ? (
          <fieldset className="nx-rs-f">
            <legend>{t("When to run")}</legend>
            <label className="nx-rs-check"><input type="radio" name="when" checked={draft.when === "now"} onChange={() => patch({ when: "now" })} /><span>{t("Now")}</span></label>
            <label className="nx-rs-check"><input type="radio" name="when" checked={draft.when === "schedule"} onChange={() => patch({ when: "schedule" })} /><span>{t("On a schedule")}</span></label>
            {draft.when === "schedule" ? (
              <label className="nx-rs-l">{t("Repeat")}
                <select value={draft.preset} onChange={(e) => patch({ preset: e.target.value as SchedulePreset })}>
                  {PRESETS.map((p) => <option key={p} value={p}>{PRESET_LABEL[p]()}</option>)}
                </select>
              </label>
            ) : null}
          </fieldset>
        ) : (
          <div className="nx-rs-review">
            {blocking ? (
              <p role="alert" className="nx-rs-bad">
                {t("A run is already in progress for this system.")} <Link className="nx-rn-link" href={href(`/next/run/${blocking.id}`)}>{t("Open that run")}</Link>
              </p>
            ) : null}
            {mutation.isError ? <ErrorState error={mutation.error} fallback={t("The run could not be started.")} onRetry={submit} /> : null}
            <dl className="nx-rs-dl">
              <dt>{t("Source system")}</dt><dd title={system?.name}>{system?.name ?? ""}</dd>
              <dt>{t("Objects")}</dt><dd>{`${formatInt(draft.objects.length)} ${t("{n, plural, one {object} other {objects}}", { n: draft.objects.length })}`}: {draft.objects.map((m) => moduleText(m)).join(", ")}</dd>
              <dt>{t("Scope")}</dt><dd>{Object.keys(scopeOf(draft)).length ? [draft.companyCodes && `${t("Company codes")} ${list(draft.companyCodes).join(", ")}`, draft.plants && `${t("Plants")} ${list(draft.plants).join(", ")}`, draft.dateFrom && `${t("From date")} ${draft.dateFrom}`, draft.dateTo && `${t("To date")} ${draft.dateTo}`].filter(Boolean).join("; ") : t("Everything")}{draft.delta ? `; ${t("only what changed")}` : ""}</dd>
              <dt>{t("Target")}</dt><dd data-testid="review-target">{targetId ? (targets.find((s) => s.id === targetId)?.name ?? t("Missing target")) : t("None")}</dd>
              <dt>{t("Target templates")}</dt><dd>{draft.objects.map((m) => { const id = draft.templates[m] ?? tpls[m]?.templates[0]?.id; const x = tpls[m]?.templates.find((y) => y.id === id); return `${moduleText(m)}: ${x ? `${x.name} v${x.version}` : t("No template")}`; }).join("; ")}</dd>
              <dt>{t("When")}</dt><dd>{draft.when === "now" ? t("Now") : PRESET_LABEL[draft.preset]()}</dd>
            </dl>
            <p className="nx-rs-note">{t("Aletheia checks the run once it is scored.")}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
