"use client";

/**
 * Settings → Scoring and alerts. The DQS weights (with the composite
 * recomputed against the latest run before saving), pass and warn bands,
 * per-object weights, score history re-weighted under today's settings, the
 * cost model, alert thresholds and channels, and the planner assumptions.
 * Saving needs manage_settings; everyone else reads.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Banner, Button, EmptyState, Field, Input, Metric, MetricStrip, PageHeader, SectionCard, Tabs, TableSkeleton,
} from "@/components/ui-core";
import { AlertChannels } from "@/components/admin/alert-channels";
import { CostModelEditor } from "@/components/admin/cost-model";
import { useRole } from "@/hooks/use-role";
import { getFindingsAggregate } from "@/lib/api/findings";
import { apiErrorMessage } from "@/lib/api/optional";
import { getScoreHistory, getScoring, putScoring, type ScoringSettings as ScoringApi } from "@/lib/api/scoring";
import { getSettings, saveNotificationSettings, savePlannerConfig, updateAlertThresholds, updateDqsWeights } from "@/lib/api/settings";
import { formatModuleName } from "@/lib/format";
import type { DimensionScores, PlannerConfig, TenantSettings } from "@/types/api";

const DIMS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;
const DEFAULT: DimensionScores = { completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1 };
const DEFAULT_THRESHOLDS = { critical_threshold: 1, high_threshold: 10, dqs_drop_threshold: 5 };
const DEFAULT_NOTIFY = { email: "", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: true };
const DEFAULT_PLANNER: PlannerConfig = { minutes_per_record: 3, investigation_hours: 1, cleaning_item_hours: 0.25, exception_hours: 2, sprint_hours: 40, cost_per_record: null, currency: "ZAR" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmt = (n?: number | null) => (n == null ? "—" : n.toFixed(1));
const toPct = (w: Record<string, number> | DimensionScores) => Object.fromEntries(DIMS.map((d) => [d, Math.round(((w as Record<string, number>)[d] ?? 0) * 1000) / 10]));

/** Weighted composite over the measured dimensions, normalising the weights like the backend does. */
function composite(scores: Record<string, number>, weights: Record<string, number>): number | null {
  const measured = DIMS.filter((d) => scores[d] != null);
  const total = measured.reduce((a, d) => a + (weights[d] ?? 0), 0);
  if (!measured.length || total <= 0) return null;
  return Math.round((measured.reduce((a, d) => a + scores[d] * weights[d], 0) / total) * 100) / 100;
}

type TabId = "score" | "cost" | "alerts" | "planner";

export function ScoringSettings() {
  const [tab, setTab] = useState<TabId>("score");
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const scoring = useQuery({ queryKey: ["settings.scoring"], queryFn: getScoring, retry: false, meta: { ignoreError: true } });
  const { can } = useRole();
  const ready = settings.data && !scoring.isLoading;

  return (
    <div className="ui-page">
      <PageHeader title="Scoring and alerts"
        summary="How the data quality score is weighted, what a failing record costs, and who hears about it. Changes apply from the next analysis run." />
      {!can("manage_settings") ? <Banner tone="info" title="Read only">Changing these settings needs the manage settings permission.</Banner> : null}
      <Tabs ariaLabel="Scoring sections" value={tab} onValueChange={(v) => setTab(v as TabId)}
        items={[{ id: "score", label: "Score" }, { id: "cost", label: "Cost model" }, { id: "alerts", label: "Alerts" }, { id: "planner", label: "Planner" }]} />
      {settings.isError ? <Banner tone="danger" title="Settings could not be read">{apiErrorMessage(settings.error)}</Banner>
        : !ready ? <TableSkeleton rows={8} label="Loading settings" />
        : tab === "score" ? <ScoreTab key={`${settings.dataUpdatedAt}-${scoring.dataUpdatedAt}`} initial={settings.data!} scoring={scoring.data ?? null} />
        : tab === "cost" ? <CostModelEditor />
        : tab === "alerts" ? <AlertsTab key={settings.dataUpdatedAt} initial={settings.data!} />
        : <PlannerTab key={settings.dataUpdatedAt} initial={settings.data!} />}
    </div>
  );
}

/* ── Score ─────────────────────────────────────────────────────────── */

function ScoreTab({ initial, scoring }: { initial: TenantSettings; scoring: ScoringApi | null }) {
  const qc = useQueryClient();
  const write = useRole().can("manage_settings");
  const agg = useQuery({ queryKey: ["findings.aggregate"], queryFn: () => getFindingsAggregate() });
  const v2 = scoring !== null;
  const defaults = toPct(scoring?.defaults?.dimension_weights ?? DEFAULT);
  const [weights, setWeights] = useState<Record<string, number>>(toPct(scoring?.dimension_weights ?? initial.dqs_weights ?? DEFAULT));
  const [modules, setModules] = useState<Record<string, number>>(scoring?.module_weights ?? {});
  const [pass, setPass] = useState(scoring?.thresholds?.pass ?? scoring?.defaults?.thresholds?.pass ?? 90);
  const [warn, setWarn] = useState(scoring?.thresholds?.warn ?? scoring?.defaults?.thresholds?.warn ?? 75);

  const sum = DIMS.reduce((a, d) => a + (Number(weights[d]) || 0), 0);
  const normalised = useMemo(() => Object.fromEntries(DIMS.map((d) => [d, sum > 0 ? (Number(weights[d]) || 0) / sum : 0])), [weights, sum]);
  const scores = agg.data?.dqs.dimension_scores ?? {};
  const current = agg.data?.dqs.composite ?? null;
  const preview = composite(scores, normalised);
  const moduleList = useMemo(() => Array.from(new Set([...(agg.data?.by_module ?? []).map((m) => m.module), ...Object.keys(modules)])).sort(), [agg.data, modules]);
  const sumOk = Math.abs(sum - 100) < 0.05;
  const bandError = warn > pass ? "The warn band must sit at or below the pass band." : undefined;

  const save = useMutation({
    mutationFn: async () => {
      if (v2) {
        await putScoring({ dimension_weights: weights, module_weights: modules, thresholds: { pass, warn } });
      } else {
        await updateDqsWeights(normalised as unknown as DimensionScores);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["settings.scoring"] });
      qc.invalidateQueries({ queryKey: ["scores.history"] });
      toast.success("Scoring saved. It applies from the next analysis run.");
    },
    onError: (e) => toast.error(`Scoring not saved. ${apiErrorMessage(e)}`),
  });

  return (
    <>
      <MetricStrip label="Score preview">
        <Metric label="Score now" value={fmt(current)} />
        <Metric label="With these weights" value={fmt(preview)}
          delta={preview !== null && current !== null && Math.abs(preview - current) >= 0.05
            ? { value: Math.round((preview - current) * 10) / 10, unit: " pts", good: "up" as const } : undefined} />
        <Metric label="Weights sum" value={sum.toFixed(1)} unit="%" tone={sumOk ? "default" : "warning"} />
        {agg.data?.dqs.capped ? <Metric label="Critical cap" value="In force" tone="danger" /> : null}
      </MetricStrip>

      <div className="ui-columns">
        <div className="ui-stack">
          <SectionCard title="Dimension weights" meta="Percent of the score">
            <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
              <p className="ui-note">The score is each measured dimension times its weight. One critical finding caps it at 85, two or more at 70. The cap is fixed.</p>
              <table className="ui-mini-table">
                <thead><tr><th>Dimension</th><th>Weight %</th><th className="ui-num">Default</th><th className="ui-num">Latest score</th><th className="ui-num">Contribution</th></tr></thead>
                <tbody>
                  {DIMS.map((d) => (
                    <tr key={d}>
                      <td>{cap(d)}</td>
                      <td style={{ width: 110 }}>
                        <Input type="number" step="1" min="0" max="100" value={weights[d]} aria-label={`${cap(d)} weight, percent`} disabled={!write}
                          onChange={(e) => setWeights({ ...weights, [d]: Number(e.target.value) })} />
                      </td>
                      <td className="ui-num">{defaults[d]}</td>
                      <td className="ui-num">{fmt(scores[d])}</td>
                      <td className="ui-num">{scores[d] == null ? "—" : (scores[d] * normalised[d]).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!sumOk ? (
                <p className="ui-micro" role="status">Weights sum to {sum.toFixed(1)}%. {v2 ? "They must sum to 100 before saving." : "They are scaled to 100 on save."}</p>
              ) : null}
              {write ? (
                <div className="ui-form__actions">
                  {!sumOk ? <Button variant="secondary" disabled={sum <= 0} onClick={() => setWeights(Object.fromEntries(DIMS.map((d) => [d, Math.round(normalised[d] * 1000) / 10])))}>Scale to 100</Button> : null}
                  <Button variant="ghost" onClick={() => setWeights(defaults)}>Use defaults</Button>
                </div>
              ) : null}
            </div>
          </SectionCard>

          {v2 ? (
            <SectionCard title="Bands" meta="Score at or above">
              <div className="ui-form__grid">
                <Field label="Pass" error={bandError}>
                  {({ controlId }) => <Input id={controlId} type="number" min="0" max="100" value={pass} disabled={!write} invalid={!!bandError}
                    onChange={(e) => setPass(Number(e.target.value))} />}
                </Field>
                <Field label="Warn" helper="Below this the object fails.">
                  {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} type="number" min="0" max="100" value={warn} disabled={!write}
                    invalid={!!bandError} onChange={(e) => setWarn(Number(e.target.value))} />}
                </Field>
              </div>
            </SectionCard>
          ) : null}
        </div>

        <div className="ui-stack">
          {v2 ? (
            <SectionCard title="Object weights" meta="Share of the estate score">
              {moduleList.length ? (
                <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
                  <p className="ui-note">Leave empty to weight an object by its check count. A higher number makes that object count for more in the estate score.</p>
                  <table className="ui-mini-table">
                    <thead><tr><th>Object</th><th>Weight</th><th className="ui-num">Latest score</th></tr></thead>
                    <tbody>
                      {moduleList.map((m) => (
                        <tr key={m}>
                          <td>{formatModuleName(m)}</td>
                          <td style={{ width: 110 }}>
                            <Input type="number" min="0" step="0.5" aria-label={`${formatModuleName(m)} weight`} disabled={!write}
                              value={modules[m] ?? ""} placeholder="Auto"
                              onChange={(e) => {
                                const next = { ...modules };
                                if (e.target.value === "") delete next[m]; else next[m] = Number(e.target.value);
                                setModules(next);
                              }} />
                          </td>
                          <td className="ui-num">{fmt(agg.data?.dqs.modules?.[m])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState>Objects appear here after the first analysis run.</EmptyState>}
            </SectionCard>
          ) : null}
          <ScoreHistory />
        </div>
      </div>

      {write ? (
        <div className="ui-form__actions">
          <Button onClick={() => save.mutate()} disabled={save.isPending || sum <= 0 || (v2 && (!sumOk || !!bandError))}>Save scoring</Button>
          <span className="ui-micro">Past runs keep the score they were given. History shows both.</span>
        </div>
      ) : null}
    </>
  );
}

function ScoreHistory() {
  const q = useQuery({ queryKey: ["scores.history"], queryFn: () => getScoreHistory(20), retry: false, meta: { ignoreError: true } });
  const rows = q.data?.history ?? [];
  return (
    <SectionCard title="Score history" meta="Recorded and under today's weights">
      {q.isLoading ? <TableSkeleton rows={4} label="Loading score history" />
        : q.error ? <Banner tone="danger" title="History could not be read">{apiErrorMessage(q.error)}</Banner>
        : !q.data ? <EmptyState>Score history is not available on this server.</EmptyState>
        : !rows.length ? <EmptyState>No scored runs yet.</EmptyState>
        : (
          <table className="ui-mini-table">
            <thead><tr><th>Run</th><th className="ui-num">Recorded</th><th className="ui-num">Re-weighted</th><th className="ui-num">Change</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const was = r.at_the_time?.composite ?? null;
                const now = r.under_current?.composite ?? null;
                const d = was != null && now != null ? now - was : null;
                return (
                  <tr key={`${r.version_id}-${i}`}>
                    <td>{day(r.run_at)}{r.scoring_recorded === false ? <span className="ui-micro"> (weights not recorded)</span> : null}</td>
                    <td className="ui-num">{fmt(was)}{r.at_the_time?.tier ? ` ${r.at_the_time.tier}` : ""}</td>
                    <td className="ui-num">{fmt(now)}{r.under_current?.tier ? ` ${r.under_current.tier}` : ""}</td>
                    <td className={`ui-num ${d && d > 0 ? "ui-delta-up" : d && d < 0 ? "ui-delta-down" : ""}`}>
                      {d == null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(1)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </SectionCard>
  );
}

/* ── Alerts ────────────────────────────────────────────────────────── */

function AlertsTab({ initial }: { initial: TenantSettings }) {
  const qc = useQueryClient();
  const write = useRole().can("manage_settings");
  const [t, setT] = useState(initial.alert_thresholds ?? DEFAULT_THRESHOLDS);
  const [notify, setNotify] = useState(initial.notification_config ?? DEFAULT_NOTIFY);
  const saveT = useMutation({
    mutationFn: () => updateAlertThresholds(t),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Alert thresholds saved"); },
    onError: (e) => toast.error(`Thresholds not saved. ${apiErrorMessage(e)}`),
  });
  const saveN = useMutation({
    mutationFn: () => saveNotificationSettings(notify),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Notification settings saved"); },
    onError: (e) => toast.error(`Notification settings not saved. ${apiErrorMessage(e)}`),
  });
  const num = (k: keyof typeof t, label: string, helper: string, step = "1") => (
    <Field label={label} helper={helper}>
      {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} type="number" min="0" step={step} value={t[k]} disabled={!write}
        onChange={(e) => setT({ ...t, [k]: Number(e.target.value) })} />}
    </Field>
  );
  return (
    <div className="ui-stack">
      <SectionCard title="When to alert">
        <form className="ui-form" onSubmit={(e) => { e.preventDefault(); saveT.mutate(); }}>
          <div className="ui-form__grid">
            {num("critical_threshold", "Critical findings", "Alert when a run has at least this many.")}
            {num("high_threshold", "High findings", "Alert when a run has at least this many.")}
            {num("dqs_drop_threshold", "Score drop, points", "Alert when the score falls this far against the previous run.", "0.5")}
          </div>
          {write ? <div className="ui-form__actions"><Button type="submit" disabled={saveT.isPending}>Save thresholds</Button></div> : null}
        </form>
      </SectionCard>

      <AlertChannels />

      <SectionCard title="Reports by email and Teams" meta="Scheduled summaries">
        <form className="ui-form" onSubmit={(e) => { e.preventDefault(); saveN.mutate(); }}>
          <div className="ui-form__grid">
            <Field label="Email" helper="Recipient for digests and alerts.">
              {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} type="email" value={notify.email} disabled={!write}
                onChange={(e) => setNotify({ ...notify, email: e.target.value })} />}
            </Field>
            <Field label="Teams webhook" helper="Incoming webhook URL of the data quality channel.">
              {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} type="url" value={notify.teams_webhook} disabled={!write}
                onChange={(e) => setNotify({ ...notify, teams_webhook: e.target.value })} />}
            </Field>
          </div>
          <fieldset className="ui-form__actions" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="ui-visually-hidden">Scheduled reports</legend>
            {([["daily_digest", "Daily digest"], ["weekly_summary", "Weekly summary"], ["monthly_report", "Monthly report"]] as const).map(([k, label]) => (
              <label key={k} className="ui-check" data-disabled={!write}>
                <input type="checkbox" checked={notify[k]} disabled={!write} onChange={(e) => setNotify({ ...notify, [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </fieldset>
          {write ? <div className="ui-form__actions"><Button type="submit" disabled={saveN.isPending}>Save notifications</Button></div> : null}
        </form>
      </SectionCard>
    </div>
  );
}

/* ── Planner ───────────────────────────────────────────────────────── */

function PlannerTab({ initial }: { initial: TenantSettings }) {
  const qc = useQueryClient();
  const write = useRole().can("manage_settings");
  const [p, setP] = useState<PlannerConfig>(initial.planner_config ?? DEFAULT_PLANNER);
  const save = useMutation({
    mutationFn: () => savePlannerConfig(p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); qc.invalidateQueries({ queryKey: ["analytics.prescriptive"] }); toast.success("Planner assumptions saved"); },
    onError: (e) => toast.error(`Assumptions not saved. ${apiErrorMessage(e)}`),
  });
  const num = (k: "minutes_per_record" | "investigation_hours" | "exception_hours" | "sprint_hours", label: string, helper: string, step: string) => (
    <Field label={label} helper={helper}>
      {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} type="number" min="0" step={step} value={p[k]} disabled={!write}
        onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} />}
    </Field>
  );
  return (
    <SectionCard title="Planner assumptions">
      <form className="ui-form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <p className="ui-note">The sprint planner ranks open work by severity-weighted records per hour. Effort comes from these figures.</p>
        <div className="ui-form__grid">
          {num("minutes_per_record", "Minutes per record", "Steward time to correct one failing record.", "0.5")}
          {num("investigation_hours", "Hours per finding", "Investigation before the first record.", "0.25")}
          {num("exception_hours", "Hours per exception", "Resolving one open exception.", "0.5")}
          {num("sprint_hours", "Sprint capacity, hours", "Steward hours in one sprint.", "1")}
          <Field label="Cost per failing record" helper="Optional. Leave empty and the planner shows no money.">
            {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} type="number" min="0" step="1" value={p.cost_per_record ?? ""} disabled={!write}
              onChange={(e) => setP({ ...p, cost_per_record: e.target.value === "" ? null : Number(e.target.value) })} />}
          </Field>
          <Field label="Currency" helper="ISO code, for example ZAR.">
            {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} value={p.currency} maxLength={3} disabled={!write}
              onChange={(e) => setP({ ...p, currency: e.target.value.toUpperCase() })} />}
          </Field>
        </div>
        {write ? <div className="ui-form__actions"><Button type="submit" disabled={save.isPending}>Save assumptions</Button></div> : null}
      </form>
    </SectionCard>
  );
}
