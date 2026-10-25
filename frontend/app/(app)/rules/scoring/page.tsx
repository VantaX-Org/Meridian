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
import { Button, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Radar, Select, Skeleton, Score } from "@/design";
import { SettingsSection, SettingsSheet } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import { getFindingsAggregate } from "@/lib/api/findings";
import { getCostModel, getSettings, saveNotificationSettings, updateCostModel, savePlannerConfig, updateAlertThresholds, updateDqsWeights } from "@/lib/api/settings";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { AlertThresholds, CostModel, DimensionScores, PlannerConfig, TenantSettings } from "@/types/api";
import { clsx } from "clsx";

const DIMS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;
type Dim = (typeof DIMS)[number];
const DEFAULT: DimensionScores = { completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1 };
const DEFAULT_THRESHOLDS: AlertThresholds = {
  critical_threshold: 1, high_threshold: 10, dqs_drop_threshold: 5, module_floors: {},
  readiness_dqs_threshold: 75, readiness_waves: {},
};
const DEFAULT_NOTIFY = { email: "", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: true };
const DEFAULT_PLANNER: PlannerConfig = { minutes_per_record: 3, investigation_hours: 1, cleaning_item_hours: 0.25, exception_hours: 2, sprint_hours: 40, cost_per_record: null, currency: "ZAR" };

/** Stored weights (tenants.dqs_weights) sum to 100; the form edits fractions of 1, so rescale on load. */
function fromStored(stored: DimensionScores | null): DimensionScores {
  const total = stored ? DIMS.reduce((a, d) => a + (Number(stored[d]) || 0), 0) : 0;
  if (!stored || total <= 0) return DEFAULT;
  const out = { ...stored };
  DIMS.forEach((d) => { out[d] = Math.round(((Number(stored[d]) || 0) / total) * 10000) / 10000; });
  return out;
}

/** The PATCH accepts weights that sum to 100, the scale the API stores and validates. */
function toStored(fractions: DimensionScores): DimensionScores {
  const out = { ...fractions };
  DIMS.forEach((d) => { out[d] = fractions[d] * 100; });
  return out;
}

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
      <div className="flex flex-col gap-4">
        <PageHeader title="Scoring and alerts" meta="How the quality score is weighted, when an alert fires and who is told" />
        {settings.isError ? (
          <ErrorState title="Settings could not be loaded." message={apiErrorMessage(settings.error)} onRetry={() => void settings.refetch()} />
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

  const [weights, setWeights] = useState<DimensionScores>(() => fromStored(initial.dqs_weights));
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
    mutationFn: () => updateDqsWeights(toStored(normalised)),
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
    <div className="flex flex-col gap-4">
      <PageHeader title="Scoring and alerts" meta="How the quality score is weighted, when an alert fires and who is told" />
      {!write ? <Notice tone="info">These settings are read only for your role</Notice> : null}

      {!agg.isError && !agg.isLoading && current === null ? (
        <p className="m-text-body m-ink-3">Save weights; the preview uses the latest findings once a run completes.</p>
      ) : null}

      {agg.isError ? (
        <ErrorState message={(agg.error as Error).message || "The latest findings could not be read."} onRetry={() => agg.refetch()} />
      ) : (
      <div className="flex gap-6">
        <Score
          size="hero"
          label="Score now"
          loading={agg.isLoading}
          value={current}
          hint={capped ? "A severity cap is in force" : current === null ? "No analysis has run yet" : "From the latest run"}
        />
        <Score
          size="hero"
          label="With these weights"
          loading={agg.isLoading}
          value={preview}
          tone={preview !== null && current !== null && preview < current ? "at-risk" : undefined}
          hint={capValue !== null && rawPreview !== null && rawPreview > capValue
            ? `Capped at ${capValue} by ${criticals} critical ${criticals === 1 ? "finding" : "findings"}`
            : delta === null ? "Needs a scored run" : delta === 0 ? "Same as now" : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} points`}
        />
        <div className="flex flex-col gap-1">
          <span className="m-text-meta m-ink-3">Weights sum</span>
          <span className={clsx("m-text-title font-semibold", !sumOk && "m-ink-critical")}>{sum.toFixed(2)}</span>
          <span className="m-text-meta m-ink-3">{sumOk ? "Sums to one" : "Must sum to 1.00 before you can save"}</span>
        </div>
      </div>
      )}

      {Object.keys(scores).length > 0 ? (
        <Radar label="Latest score per dimension" data={DIMS.filter((d) => scores[d] != null).map((d) => ({ x: d[0].toUpperCase() + d.slice(1), y: scores[d] }))} />
      ) : null}

      <SettingsSheet>
      <SettingsSection title="Dimension weights">
        <p className="m-text-body m-ink-3">
          The score is each measured dimension times its weight. One critical finding caps it at 85, two or more at 70. The cap is fixed.
        </p>
        <table className="m-text-body">
          <thead><tr><th className="text-left">Dimension</th><th className="text-left">Weight</th><th className="text-right">Normalised</th><th className="text-right">Latest score</th><th className="text-right">Contribution</th></tr></thead>
          <tbody>
            {DIMS.map((d: Dim) => (
              <tr key={d}>
                <td>{d[0].toUpperCase() + d.slice(1)}</td>
                <td className="[width:140px]">
                  <Input type="number" step="0.05" min="0" max="1" value={weights[d]} aria-label={`${d} weight`} disabled={!write}
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
            {!sumOk ? <span className="m-text-meta m-ink-3">Weights sum to {sum.toFixed(2)}. Adjust them to 1.00 to save.</span> : null}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title="When to alert">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); saveThresholds.mutate(); }}>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Critical findings">
              <Input type="number" min="0" value={thresholds.critical_threshold} disabled={!write}
                onChange={(e) => setThresholds({ ...thresholds, critical_threshold: Number(e.target.value) })} />
            </Field>
            <Field label="High findings">
              <Input type="number" min="0" value={thresholds.high_threshold} disabled={!write}
                onChange={(e) => setThresholds({ ...thresholds, high_threshold: Number(e.target.value) })} />
            </Field>
            <Field label="Score drop, points">
              <Input type="number" min="0" step="0.5" value={thresholds.dqs_drop_threshold} disabled={!write}
                onChange={(e) => setThresholds({ ...thresholds, dqs_drop_threshold: Number(e.target.value) })} />
            </Field>
          </div>
          <p className="m-text-meta m-ink-3">
            Alert when a run has at least this many critical or high findings, or an object&rsquo;s score falls by more than this against the previous run.
          </p>

          <div>
            <h3 className="m-text-body font-semibold mb-1">Score floors per object</h3>
            <p className="m-text-meta mb-2 m-ink-3">An analysis that scores an object below its floor raises an in-app alert, and an email or Teams message when configured.</p>
            <table className="m-text-body [max-width:480px]!">
              <thead><tr><th className="text-left">Object</th><th className="text-left">Floor</th><th /></tr></thead>
              <tbody>
                {Object.entries(floors).sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => (
                  <tr key={m}>
                    <td>{formatModuleName(m)}</td>
                    <td>
                      <Input type="number" min="0" max="100" step="1" value={v} disabled={!write} aria-label={`${formatModuleName(m)} floor`}
                        onChange={(e) => setFloor(m, Math.min(100, Math.max(0, Number(e.target.value))))} />
                    </td>
                    <td>{write ? <Button type="button" variant="ghost" onClick={() => setFloor(m, null)}>Remove</Button> : null}</td>
                  </tr>
                ))}
                {!Object.keys(floors).length ? <tr><td colSpan={3} className="m-text-meta m-ink-3">No floors set</td></tr> : null}
              </tbody>
            </table>
            {write && unfloored.length ? (
              <div className="mt-2 [max-width:260px]">
                <Select
                  label="Add a floor for"
                  value="" placeholder="Add a floor for"
                  options={unfloored.map((m) => ({ value: m, label: formatModuleName(m) }))}
                  onValueChange={(m) => m && setFloor(m, 80)} />
              </div>
            ) : null}
          </div>
          {write ? <div><Button type="submit" disabled={saveThresholds.isPending}>Save thresholds</Button></div> : null}
        </form>
      </SettingsSection>

      <SettingsSection title="Planner assumptions">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); savePlanner.mutate(); }}>
          <p className="m-text-body m-ink-3">
            The next-sprint planner ranks open work by severity-weighted records per hour. Effort comes from these figures.
            Money appears only when you state what one failing record costs you.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Minutes per record">
              <Input type="number" min="0" step="0.5" value={planner.minutes_per_record} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, minutes_per_record: Number(e.target.value) })} />
            </Field>
            <Field label="Hours per finding">
              <Input type="number" min="0" step="0.25" value={planner.investigation_hours} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, investigation_hours: Number(e.target.value) })} />
            </Field>
            <Field label="Hours per exception">
              <Input type="number" min="0" step="0.5" value={planner.exception_hours} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, exception_hours: Number(e.target.value) })} />
            </Field>
            <Field label="Sprint capacity, hours">
              <Input type="number" min="1" step="1" value={planner.sprint_hours} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, sprint_hours: Number(e.target.value) })} />
            </Field>
            <Field label="Cost per failing record">
              <Input type="number" min="0" step="1" value={planner.cost_per_record ?? ""} disabled={!write} placeholder="Not set"
                onChange={(e) => setPlanner({ ...planner, cost_per_record: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Currency">
              <Input value={planner.currency} maxLength={3} disabled={!write}
                onChange={(e) => setPlanner({ ...planner, currency: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          {write ? <div><Button type="submit" disabled={savePlanner.isPending}>Save assumptions</Button></div> : null}
        </form>
      </SettingsSection>

      <SettingsSection title="Reports by email and Teams">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); saveNotify.mutate(); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <Input type="email" value={notify.email} disabled={!write} placeholder="dq-team@company.com"
                onChange={(e) => setNotify({ ...notify, email: e.target.value })} />
            </Field>
            <Field label="Teams webhook">
              <Input type="url" value={notify.teams_webhook} disabled={!write}
                onChange={(e) => setNotify({ ...notify, teams_webhook: e.target.value })} />
            </Field>
          </div>
          <fieldset className="flex gap-4 [border:0] [margin:0] [padding:0]">
            <legend className="sr-only">Scheduled reports</legend>
            {([["daily_digest", "Daily digest"], ["weekly_summary", "Weekly summary"], ["monthly_report", "Monthly report"]] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 m-text-body">
                <input type="checkbox" checked={notify[k]} disabled={!write} onChange={(e) => setNotify({ ...notify, [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </fieldset>
          {write ? <div><Button type="submit" disabled={saveNotify.isPending}>Save notifications</Button></div> : null}
        </form>
      </SettingsSection>
      <CostModelCard write={write} />
      </SettingsSheet>
    </div>
  );
}

const COST_LABELS: Record<string, string> = { critical: "Critical finding cost", high: "High finding cost", medium: "Medium finding cost", low: "Low finding cost", info: "Info finding cost" };
/** The severities a new cost model starts with: one field each, at zero, for the user to fill in and save. */
const COST_SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** Cost per blocked record by severity. Feeds value-at-risk on the insight pages. */
function CostModelCard({ write }: { write: boolean }) {
  const q = useQuery({ queryKey: ["cost-model"], queryFn: getCostModel });
  const [draft, setDraft] = useState<Record<string, number>>({});
  const m = useMutation({
    mutationFn: (base: CostModel) => updateCostModel({ ...base, severity: { ...base.severity, ...draft } }),
    onSuccess: () => { toast.success("Cost model saved"); setDraft({}); void q.refetch(); },
    onError: (e) => toast.error((e as Error).message || "Cost model not saved"),
  });
  if (q.isError) return <ErrorState message="The cost model could not be read." onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton height={64} />;
  const sev = { ...q.data.severity, ...draft };
  return (
    <SettingsSection title={`Cost model (${q.data.currency})`}>
      <p className="m-text-body m-ink-3">What one blocked record costs, by severity.</p>
      {Object.keys(sev).length === 0 && (
        <EmptyState
          title="No severity costs set"
          detail="Enter a cost per blocked record to value findings."
          action={write ? <Button onClick={() => setDraft(Object.fromEntries(COST_SEVERITIES.map((k) => [k, 0])))}>Add severity costs</Button> : undefined}
        />
      )}
      <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(q.data); }}>
        {Object.entries(sev).map(([k, v]) => (
          <Field key={k} label={COST_LABELS[k] ?? `${formatModuleName(k)} finding cost`}>
            <Input type="number" min={0} value={v} disabled={!write} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} />
          </Field>
        ))}
        {write && Object.keys(sev).length > 0 && <Button type="submit" disabled={m.isPending}>Save cost model</Button>}
      </form>
    </SettingsSection>
  );
}
