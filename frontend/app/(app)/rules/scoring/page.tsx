"use client";

/**
 * Rules, Scoring and alerts: the tenant's DQS weights (with the composite
 * recomputed live against the latest run's dimension scores before saving),
 * the alert thresholds, the planner assumptions, and report delivery.
 * Saves need manage_settings; everyone else can read.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, ErrorState, Field, Select, Skeleton } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getFindingsAggregate } from "@/lib/api/findings";
import { getSettings, saveNotificationSettings, savePlannerConfig, updateAlertThresholds, updateDqsWeights } from "@/lib/api/settings";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { AlertThresholds, DimensionScores, PlannerConfig, TenantSettings } from "@/types/api";

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

export default function ScoringPage() {
  const settings = useQuery({ queryKey: queryKeys.scoringSettings(), queryFn: getSettings });
  if (!settings.data) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <header><strong className="text-[17px]">Scoring and alerts</strong></header>
        {settings.isError ? (
          <div role="alert" className="text-[13px] rounded border p-3" style={{ borderColor: "var(--m-critical)", color: "var(--m-critical)" }}>
            Settings could not be loaded. Try again in a moment.
          </div>
        ) : (
          <div className="flex flex-col gap-2"><Skeleton height={32} /><Skeleton height={32} /><Skeleton height={32} /></div>
        )}
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
  const agg = useQuery({ queryKey: queryKeys.findingsAggregate("current"), queryFn: () => getFindingsAggregate() });

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
  const sumOk = Math.abs(sum - 1) < 0.005;
  const scores = agg.data?.dqs.dimension_scores ?? {};
  const current = agg.data?.dqs.composite ?? null;
  const rawPreview = composite(scores, normalised);
  const capped = agg.data?.dqs.capped;
  const criticals = agg.data?.severity.critical ?? 0;
  const capValue = capped && criticals > 0 ? (criticals >= 2 ? 70 : 85) : null;
  const preview = rawPreview !== null && capValue !== null ? Math.min(rawPreview, capValue) : rawPreview;
  const delta = preview !== null && current !== null ? Math.round((preview - current) * 10) / 10 : null;

  const saveWeights = useMutation({
    mutationFn: () => updateDqsWeights(normalised),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.scoringSettings() }); toast.success("Weights saved. They apply from the next analysis run"); },
    onError: (e) => toast.error((e as Error).message || "Weights not saved"),
  });
  const saveThresholds = useMutation({
    mutationFn: () => updateAlertThresholds(thresholds),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.scoringSettings() }); toast.success("Alert thresholds saved"); },
    onError: (e) => toast.error((e as Error).message || "Thresholds not saved"),
  });
  const savePlanner = useMutation({
    mutationFn: () => savePlannerConfig(planner),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.scoringSettings() }); qc.invalidateQueries({ queryKey: ["analytics.prescriptive"] }); toast.success("Planner assumptions saved"); },
    onError: (e) => toast.error((e as Error).message || "Assumptions not saved"),
  });
  const saveNotify = useMutation({
    mutationFn: () => saveNotificationSettings(notify),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.scoringSettings() }); toast.success("Notification settings saved"); },
    onError: (e) => toast.error((e as Error).message || "Notification settings not saved"),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <strong className="text-[17px]">Scoring and alerts</strong>
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
          How the data quality score is weighted, when Meridian raises an alert, and who hears about it.
        </p>
      </header>
      {!write ? <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Read only. Changing these settings needs the manage_settings permission.</p> : null}

      {agg.isError ? (
        <ErrorState message={(agg.error as Error).message || "The latest findings could not be read."} onRetry={() => agg.refetch()} />
      ) : (
      <section className="flex gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Score now</span>
          <span className="text-[18px] font-semibold">{agg.isLoading ? "–" : current === null ? "—" : current.toFixed(1)}</span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{capped ? "A severity cap is in force." : current === null ? "No analysis has run yet." : "From the latest run."}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>With these weights</span>
          <span className="text-[18px] font-semibold">{agg.isLoading ? "–" : preview === null ? "—" : preview.toFixed(1)}</span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>
            {capValue !== null && rawPreview !== null && rawPreview > capValue
              ? `Capped at ${capValue} by ${criticals} critical ${criticals === 1 ? "finding" : "findings"}.`
              : delta === null ? "Needs a scored run." : delta === 0 ? "Same as now." : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} points.`}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Weights sum</span>
          <span className="text-[18px] font-semibold" style={{ color: sumOk ? undefined : "var(--m-critical)" }}>{sum.toFixed(2)}</span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{sumOk ? "Sums to one." : "Must sum to 1.00 before you can save."}</span>
        </div>
      </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold">Dimension weights</h2>
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
          The score is each measured dimension times its weight. One critical finding caps it at 85, two or more at 70. The cap is fixed.
        </p>
        <table className="text-[13px]">
          <thead><tr><th className="text-left">Dimension</th><th className="text-left">Weight</th><th className="text-right">Normalised</th><th className="text-right">Latest score</th><th className="text-right">Contribution</th></tr></thead>
          <tbody>
            {DIMS.map((d: Dim) => (
              <tr key={d}>
                <td>{d[0].toUpperCase() + d.slice(1)}</td>
                <td style={{ width: 140 }}>
                  <input type="number" step="0.05" min="0" max="1" value={weights[d]} aria-label={`${d} weight`} disabled={!write}
                    onChange={(e) => setWeights({ ...weights, [d]: Number(e.target.value) })} />
                </td>
                <td className="text-right">{Math.round(normalised[d] * 100)}%</td>
                <td className="text-right">{scores[d] == null ? "—" : scores[d].toFixed(1)}</td>
                <td className="text-right">{scores[d] == null ? "—" : (scores[d] * normalised[d]).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {write ? (
          <div className="flex items-center gap-3">
            <Button onClick={() => saveWeights.mutate()} disabled={saveWeights.isPending || !sumOk}>Save weights</Button>
            <Button variant="ghost" onClick={() => setWeights(DEFAULT)}>Use DAMA defaults</Button>
            {!sumOk ? <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Weights sum to {sum.toFixed(2)}. Adjust them to 1.00 to save.</span> : null}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold">When to alert</h2>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); saveThresholds.mutate(); }}>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Critical findings">
              <input type="number" min="0" value={thresholds.critical_threshold} disabled={!write}
                onChange={(e) => setThresholds({ ...thresholds, critical_threshold: Number(e.target.value) })} />
            </Field>
            <Field label="High findings">
              <input type="number" min="0" value={thresholds.high_threshold} disabled={!write}
                onChange={(e) => setThresholds({ ...thresholds, high_threshold: Number(e.target.value) })} />
            </Field>
            <Field label="Score drop, points">
              <input type="number" min="0" step="0.5" value={thresholds.dqs_drop_threshold} disabled={!write}
                onChange={(e) => setThresholds({ ...thresholds, dqs_drop_threshold: Number(e.target.value) })} />
            </Field>
          </div>
          <p className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>
            Alert when a run has at least this many critical or high findings, or an object&rsquo;s score falls by more than this against the previous run.
          </p>

          <div>
            <h3 className="text-[13px] font-semibold mb-1">Score floors per object</h3>
            <p className="text-[12px] mb-2" style={{ color: "var(--m-ink-3)" }}>An analysis that scores an object below its floor raises an in-app alert, and an email or Teams message when configured.</p>
            <table className="text-[13px]" style={{ maxWidth: 480 }}>
              <thead><tr><th className="text-left">Object</th><th className="text-left">Floor</th><th /></tr></thead>
              <tbody>
                {Object.entries(floors).sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => (
                  <tr key={m}>
                    <td>{formatModuleName(m)}</td>
                    <td>
                      <input type="number" min="0" max="100" step="1" value={v} disabled={!write} aria-label={`${formatModuleName(m)} floor`}
                        onChange={(e) => setFloor(m, Math.min(100, Math.max(0, Number(e.target.value))))} />
                    </td>
                    <td>{write ? <Button type="button" variant="ghost" onClick={() => setFloor(m, null)}>Remove</Button> : null}</td>
                  </tr>
                ))}
                {!Object.keys(floors).length ? <tr><td colSpan={3} className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>No floors set.</td></tr> : null}
              </tbody>
            </table>
            {write && unfloored.length ? (
              <div className="mt-2" style={{ maxWidth: 260 }}>
                <Select value="" placeholder="Add a floor for"
                  options={unfloored.map((m) => ({ value: m, label: formatModuleName(m) }))}
                  onValueChange={(m) => m && setFloor(m, 80)} />
              </div>
            ) : null}
          </div>
          {write ? <div><Button type="submit" disabled={saveThresholds.isPending}>Save thresholds</Button></div> : null}
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold">Planner assumptions</h2>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); savePlanner.mutate(); }}>
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
            The next-sprint planner ranks open work by severity-weighted records per hour. Effort comes from these figures.
            Money appears only when you state what one failing record costs you.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Minutes per record">
              <input type="number" min="0" step="0.5" value={planner.minutes_per_record} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, minutes_per_record: Number(e.target.value) })} />
            </Field>
            <Field label="Hours per finding">
              <input type="number" min="0" step="0.25" value={planner.investigation_hours} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, investigation_hours: Number(e.target.value) })} />
            </Field>
            <Field label="Hours per exception">
              <input type="number" min="0" step="0.5" value={planner.exception_hours} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, exception_hours: Number(e.target.value) })} />
            </Field>
            <Field label="Sprint capacity, hours">
              <input type="number" min="1" step="1" value={planner.sprint_hours} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, sprint_hours: Number(e.target.value) })} />
            </Field>
            <Field label="Cost per failing record">
              <input type="number" min="0" step="1" value={planner.cost_per_record ?? ""} disabled={!write} placeholder="Not set"
                onChange={(e) => setPlanner({ ...planner, cost_per_record: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Currency">
              <input value={planner.currency} maxLength={3} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, currency: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          {write ? <div><Button type="submit" disabled={savePlanner.isPending}>Save assumptions</Button></div> : null}
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold">Reports by email and Teams</h2>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); saveNotify.mutate(); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input type="email" value={notify.email} disabled={!write} placeholder="dq-team@company.com"
                onChange={(e) => setNotify({ ...notify, email: e.target.value })} />
            </Field>
            <Field label="Teams webhook">
              <input type="url" value={notify.teams_webhook} disabled={!write}
                onChange={(e) => setNotify({ ...notify, teams_webhook: e.target.value })} />
            </Field>
          </div>
          <fieldset className="flex gap-4" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="sr-only">Scheduled reports</legend>
            {([["daily_digest", "Daily digest"], ["weekly_summary", "Weekly summary"], ["monthly_report", "Monthly report"]] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={notify[k]} disabled={!write} onChange={(e) => setNotify({ ...notify, [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </fieldset>
          {write ? <div><Button type="submit" disabled={saveNotify.isPending}>Save notifications</Button></div> : null}
        </form>
      </section>
    </div>
  );
}
