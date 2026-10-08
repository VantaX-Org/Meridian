"use client";

/**
 * Admin, Scoring and alerts: the tenant's DQS weights (with the composite
 * recomputed live against the latest run's dimension scores before saving),
 * the alert thresholds, and where notifications go. Saves need
 * manage_settings; everyone else can read.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Banner, Button, Field, Input, PageHeader, SectionCard, Select, TableSkeleton, Tally,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { getFindingsAggregate } from "@/lib/api/findings";
import { getSettings, saveNotificationSettings, savePlannerConfig, updateAlertThresholds, updateDqsWeights } from "@/lib/api/settings";
import { formatModuleName } from "@/lib/format";
import type { AlertThresholds, DimensionScores, PlannerConfig, TenantSettings } from "@/types/api";

const HREF = "/admin?tab=scoring";
const DIMS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;
type Dim = (typeof DIMS)[number];
const DEFAULT: DimensionScores = { completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1 };
const DEFAULT_THRESHOLDS: AlertThresholds = {
  critical_threshold: 1, high_threshold: 10, dqs_drop_threshold: 5, module_floors: {},
  readiness_dqs_threshold: 70, readiness_waves: {},
};
const DEFAULT_NOTIFY = { email: "", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: true };
const DEFAULT_PLANNER: PlannerConfig = { minutes_per_record: 3, investigation_hours: 1, cleaning_item_hours: 0.25, exception_hours: 2, sprint_hours: 40, cost_per_record: null, currency: "ZAR" };

/** Weighted composite over the measured dimensions, normalising the weights like the backend does. */
function composite(scores: Record<string, number>, weights: DimensionScores): number | null {
  const measured = DIMS.filter((d) => scores[d] != null);
  const total = measured.reduce((a, d) => a + weights[d], 0);
  if (!measured.length || total <= 0) return null;
  return Math.round((measured.reduce((a, d) => a + scores[d] * weights[d], 0) / total) * 100) / 100;
}

export function ScoringSettings() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  if (!settings.data) {
    return (
      <div className="ui-page">
        <PageHeader title="Scoring and alerts" />
        {settings.isError ? <Banner tone="danger" title="Settings could not be loaded">Try again in a moment.</Banner> : <TableSkeleton rows={6} label="Loading settings" />}
      </div>
    );
  }
  // keyed on the fetch so a saved value re-seeds the form without a setState-in-effect
  return <ScoringForm key={settings.dataUpdatedAt} initial={settings.data} />;
}

function ScoringForm({ initial }: { initial: TenantSettings }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const write = can("manage_settings");
  const agg = useQuery({ queryKey: ["findings.aggregate"], queryFn: () => getFindingsAggregate() });

  const [weights, setWeights] = useState<DimensionScores>(initial.dqs_weights ?? DEFAULT);
  const [thresholds, setThresholds] = useState<AlertThresholds>({ ...DEFAULT_THRESHOLDS, ...initial.alert_thresholds });
  const floors = thresholds.module_floors ?? {};
  const setFloor = (module: string, value: number | null) => {
    const next = { ...floors };
    if (value == null) delete next[module];
    else next[module] = value;
    setThresholds({ ...thresholds, module_floors: next });
  };
  const unfloored = (initial.licensed_modules ?? []).filter((m) => !(m in floors));
  const [notify, setNotify] = useState(initial.notification_config ?? DEFAULT_NOTIFY);
  const [planner, setPlanner] = useState<PlannerConfig>(initial.planner_config ?? DEFAULT_PLANNER);

  const sum = DIMS.reduce((a, d) => a + (Number(weights[d]) || 0), 0);
  const normalised = useMemo(() => {
    const out = { ...weights };
    if (sum > 0) DIMS.forEach((d) => { out[d] = (Number(weights[d]) || 0) / sum; });
    return out;
  }, [weights, sum]);
  const scores = agg.data?.dqs.dimension_scores ?? {};
  const current = agg.data?.dqs.composite ?? null;
  const rawPreview = composite(scores, normalised);
  const capped = agg.data?.dqs.capped;
  const criticals = agg.data?.severity.critical ?? 0;
  const capValue = capped && criticals > 0 ? (criticals >= 2 ? 70 : 85) : null;
  const preview = rawPreview !== null && capValue !== null ? Math.min(rawPreview, capValue) : rawPreview;

  const saveWeights = useMutation({
    mutationFn: () => updateDqsWeights(normalised),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Weights saved. They apply from the next analysis run"); },
    onError: (e) => toast.error((e as Error).message || "Weights not saved"),
  });
  const saveThresholds = useMutation({
    mutationFn: () => updateAlertThresholds(thresholds),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Alert thresholds saved"); },
    onError: (e) => toast.error((e as Error).message || "Thresholds not saved"),
  });
  const savePlanner = useMutation({
    mutationFn: () => savePlannerConfig(planner),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); qc.invalidateQueries({ queryKey: ["analytics.prescriptive"] }); toast.success("Planner assumptions saved"); },
    onError: (e) => toast.error((e as Error).message || "Assumptions not saved"),
  });
  const saveNotify = useMutation({
    mutationFn: () => saveNotificationSettings(notify),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Notification settings saved"); },
    onError: (e) => toast.error((e as Error).message || "Notification settings not saved"),
  });

  const delta = preview !== null && current !== null ? Math.round((preview - current) * 10) / 10 : null;

  return (
    <div className="ui-page">
      <PageHeader title="Scoring and alerts" summary="How the data quality score is weighted, when Meridian raises an alert, and who hears about it." />
      {!write ? <Banner tone="info" title="Read only">Changing these settings needs the manage_settings permission.</Banner> : null}

      <Tally level={4} label="Score preview" figures={[
        { label: "Score now", value: current === null ? null : Number(current.toFixed(1)), loading: agg.isLoading, tone: capped ? "danger" : undefined, verdict: capped ? "A severity cap is in force." : current === null ? "No analysis has run yet." : "From the latest run.", href: HREF },
        { label: "With these weights", value: preview === null ? null : Number(preview.toFixed(1)), loading: agg.isLoading, verdict: capValue !== null && rawPreview !== null && rawPreview > capValue ? `Capped at ${capValue} by ${criticals} critical ${criticals === 1 ? "finding" : "findings"}.` : delta === null ? "Needs a scored run." : delta === 0 ? "Same as now." : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} points.`, href: HREF },
        { label: "Weights sum", value: null, text: sum.toFixed(2), tone: Math.abs(sum - 1) < 0.005 ? undefined : "danger", verdict: Math.abs(sum - 1) < 0.005 ? "Sums to one." : "Must sum to 1.00 before you can save.", href: HREF },
      ]} />

      <SectionCard title="Dimension weights" meta="Normalised to 1 on save">
        <div className="ui-stack">
          <p className="ui-note">
            The score is each measured dimension times its weight. One critical finding caps it at 85, two or more at 70. The cap is fixed.
          </p>
          <table className="ui-mini-table">
            <thead><tr><th>Dimension</th><th>Weight</th><th className="ui-num">Normalised</th><th className="ui-num">Latest score</th><th className="ui-num">Contribution</th></tr></thead>
            <tbody>
              {DIMS.map((d: Dim) => (
                <tr key={d}>
                  <td>{d[0].toUpperCase() + d.slice(1)}</td>
                  <td style={{ width: 140 }}>
                    <Input type="number" step="0.05" min="0" max="1" value={weights[d]} aria-label={`${d} weight`} disabled={!write}
                      onChange={(e) => setWeights({ ...weights, [d]: Number(e.target.value) })} />
                  </td>
                  <td className="ui-num">{Math.round(normalised[d] * 100)}%</td>
                  <td className="ui-num">{scores[d] == null ? "—" : scores[d].toFixed(1)}</td>
                  <td className="ui-num">{scores[d] == null ? "—" : (scores[d] * normalised[d]).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {write ? (
            <div className="ui-form__actions">
              <Button onClick={() => saveWeights.mutate()} disabled={saveWeights.isPending || Math.abs(sum - 1) >= 0.005}>Save weights</Button>
              <Button variant="ghost" onClick={() => setWeights(DEFAULT)}>Use DAMA defaults</Button>
              {Math.abs(sum - 1) >= 0.005 ? <span className="ui-micro">Weights sum to {sum.toFixed(2)}. Adjust them to 1.00 to save.</span> : null}
            </div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="When to alert">
        <form className="ui-form" onSubmit={(e) => { e.preventDefault(); saveThresholds.mutate(); }}>
          <div className="ui-form__grid">
            <Field label="Critical findings" helper="Alert when a run has at least this many critical findings.">
              {({ controlId }) => <Input id={controlId} type="number" min="0" value={thresholds.critical_threshold} disabled={!write}
                onChange={(e) => setThresholds({ ...thresholds, critical_threshold: Number(e.target.value) })} />}
            </Field>
            <Field label="High findings" helper="Alert when a run has at least this many high findings.">
              {({ controlId }) => <Input id={controlId} type="number" min="0" value={thresholds.high_threshold} disabled={!write}
                onChange={(e) => setThresholds({ ...thresholds, high_threshold: Number(e.target.value) })} />}
            </Field>
            <Field label="Score drop, points" helper="Alert when an object's score falls by more than this against the previous run of the same system.">
              {({ controlId }) => <Input id={controlId} type="number" min="0" step="0.5" value={thresholds.dqs_drop_threshold} disabled={!write}
                onChange={(e) => setThresholds({ ...thresholds, dqs_drop_threshold: Number(e.target.value) })} />}
            </Field>
          </div>
          <section className="ui-detail-part">
            <h3 className="ui-detail-part__title">Score floors per object</h3>
            <p className="ui-note">An analysis that scores an object below its floor raises an in-app alert, and an email or Teams message when configured.</p>
            <table className="ui-mini-table" style={{ maxWidth: 480 }}>
              <thead><tr><th>Object</th><th>Floor</th><th /></tr></thead>
              <tbody>
                {Object.entries(floors).sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => (
                  <tr key={m}>
                    <td>{formatModuleName(m)}</td>
                    <td>
                      <Input type="number" min="0" max="100" step="1" value={v} disabled={!write} aria-label={`${formatModuleName(m)} floor`}
                        className="aurora-number" onChange={(e) => setFloor(m, Math.min(100, Math.max(0, Number(e.target.value))))} />
                    </td>
                    <td>{write ? <Button type="button" variant="ghost" size="sm" onClick={() => setFloor(m, null)}>Remove</Button> : null}</td>
                  </tr>
                ))}
                {!Object.keys(floors).length ? <tr><td colSpan={3} className="ui-micro">No floors set.</td></tr> : null}
              </tbody>
            </table>
            {write && unfloored.length ? (
              <div style={{ marginTop: "var(--aurora-space-2)", maxWidth: 260 }}>
                <Select aria-label="Add a floor for" placeholder="Add a floor for" value=""
                  options={unfloored.map((m) => ({ value: m, label: formatModuleName(m) }))}
                  onValueChange={(m) => m && setFloor(m, 80)} />
              </div>
            ) : null}
          </section>
          {write ? <div className="ui-form__actions"><Button type="submit" disabled={saveThresholds.isPending}>Save thresholds</Button></div> : null}
        </form>
      </SectionCard>

      <SectionCard title="Planner assumptions">
        <form className="ui-form" onSubmit={(e) => { e.preventDefault(); savePlanner.mutate(); }}>
          <p className="ui-note">
            The next-sprint planner ranks open work by severity-weighted records per hour. Effort comes from these figures.
            Money appears only when you state what one failing record costs you.
          </p>
          <div className="ui-form__grid">
            <Field label="Minutes per record" helper="Steward time to correct one failing record.">
              {({ controlId }) => <Input id={controlId} type="number" min="0" step="0.5" value={planner.minutes_per_record} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, minutes_per_record: Number(e.target.value) })} />}
            </Field>
            <Field label="Hours per finding" helper="Investigation before the first record.">
              {({ controlId }) => <Input id={controlId} type="number" min="0" step="0.25" value={planner.investigation_hours} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, investigation_hours: Number(e.target.value) })} />}
            </Field>
            <Field label="Hours per exception" helper="Resolving one open exception.">
              {({ controlId }) => <Input id={controlId} type="number" min="0" step="0.5" value={planner.exception_hours} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, exception_hours: Number(e.target.value) })} />}
            </Field>
            <Field label="Sprint capacity, hours" helper="Steward hours per sprint bucket.">
              {({ controlId }) => <Input id={controlId} type="number" min="1" step="1" value={planner.sprint_hours} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, sprint_hours: Number(e.target.value) })} />}
            </Field>
            <Field label="Cost per failing record" helper="Optional. Leave blank and no monetary figure is shown anywhere.">
              {({ controlId }) => <Input id={controlId} type="number" min="0" step="1" value={planner.cost_per_record ?? ""} disabled={!write} placeholder="Not set"
                onChange={(e) => setPlanner({ ...planner, cost_per_record: e.target.value === "" ? null : Number(e.target.value) })} />}
            </Field>
            <Field label="Currency" helper="ISO code shown next to costs.">
              {({ controlId }) => <Input id={controlId} value={planner.currency} maxLength={3} disabled={!write} className="aurora-number"
                onChange={(e) => setPlanner({ ...planner, currency: e.target.value.toUpperCase() })} />}
            </Field>
          </div>
          {write ? <div className="ui-form__actions"><Button type="submit" disabled={savePlanner.isPending}>Save assumptions</Button></div> : null}
        </form>
      </SectionCard>

      <SectionCard title="Reports by email and Teams" meta="Scheduled summaries">
        <form className="ui-form" onSubmit={(e) => { e.preventDefault(); saveNotify.mutate(); }}>
          <div className="ui-form__grid">
            <Field label="Email" helper="Recipient for digests and alerts.">
              {({ controlId }) => <Input id={controlId} type="email" value={notify.email} disabled={!write} placeholder="dq-team@company.com"
                onChange={(e) => setNotify({ ...notify, email: e.target.value })} />}
            </Field>
            <Field label="Teams webhook" helper="Incoming webhook URL of the data quality channel.">
              {({ controlId }) => <Input id={controlId} type="url" value={notify.teams_webhook} disabled={!write}
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
          {write ? <div className="ui-form__actions"><Button type="submit" disabled={saveNotify.isPending}>Save notifications</Button></div> : null}
        </form>
      </SectionCard>
    </div>
  );
}
