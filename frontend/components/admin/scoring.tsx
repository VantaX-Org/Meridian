"use client";

/**
 * Admin → Scoring & alerts: the tenant's DQS weights (with the composite
 * recomputed live against the latest run's dimension scores before saving),
 * the alert thresholds, and where notifications go. Saves need
 * manage_settings; everyone else can read.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, Chip, Field, Input, KpiRail, Select, Stack, Stat, Text } from "@/components/aurora";
import { useRole } from "@/hooks/use-role";
import { getFindingsAggregate } from "@/lib/api/findings";
import { getSettings, saveNotificationSettings, savePlannerConfig, updateAlertThresholds, updateDqsWeights } from "@/lib/api/settings";
import { formatModuleName } from "@/lib/format";
import type { AlertThresholds, DimensionScores, PlannerConfig, TenantSettings } from "@/types/api";

const DIMS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;
type Dim = (typeof DIMS)[number];
const DEFAULT: DimensionScores = { completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1 };
const DEFAULT_THRESHOLDS: AlertThresholds = { critical_threshold: 1, high_threshold: 10, dqs_drop_threshold: 5, module_floors: {} };
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
  if (!settings.data) return <Text tone="muted" className="aurora-page">{settings.isError ? "Settings could not be loaded." : "Loading settings…"}</Text>;
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
  const preview = composite(scores, normalised);
  const capped = agg.data?.dqs.capped;

  const saveWeights = useMutation({
    mutationFn: () => updateDqsWeights(normalised),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Weights saved — they apply from the next analysis run"); },
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

  return (
    <Stack gap={6} className="aurora-page">
      <section aria-labelledby="scoring-weights">
        <Text as="h2" id="scoring-weights" variant="text-lead" className="aurora-runs__h">DQS weights</Text>
        <Text variant="text-small" tone="secondary" as="p" className="aurora-runs__sub">
          DQS = Σ dimension score × weight, over the dimensions a run measures. Weights are normalised to 1 on save.
          One critical finding caps the score at 85, two or more at 70 — the cap is not configurable.
        </Text>
        <KpiRail>
          <Stat label="Composite now" value={current === null ? "—" : current.toFixed(1)} />
          <Stat label="With these weights" value={preview === null ? "—" : preview.toFixed(1)}
                tone={preview !== null && current !== null ? (preview > current ? "success" : preview < current ? "warning" : "neutral") : "neutral"}
                delta={preview !== null && current !== null ? { value: Math.round((preview - current) * 10) / 10, unit: " pts",
                  direction: preview > current ? "up" : preview < current ? "down" : "flat" } : undefined} />
          <Stat label="Weights sum" value={sum.toFixed(2)} tone={Math.abs(sum - 1) < 0.005 ? "success" : "warning"} />
          {capped ? <Stat label="Cap in force" value="Yes" tone="danger" /> : null}
        </KpiRail>
        <table className="aurora-exec__table" style={{ marginTop: "var(--aurora-space-4)" }}>
          <thead><tr><th>Dimension</th><th>Weight</th><th>Normalised</th><th>Latest score</th><th>Contribution</th></tr></thead>
          <tbody>
            {DIMS.map((d: Dim) => (
              <tr key={d}>
                <td>{d[0].toUpperCase() + d.slice(1)}</td>
                <td style={{ width: 140 }}>
                  <Input type="number" step="0.05" min="0" max="1" value={weights[d]} aria-label={`${d} weight`} disabled={!write}
                    onChange={(e) => setWeights({ ...weights, [d]: Number(e.target.value) })} />
                </td>
                <td className="aurora-number">{Math.round(normalised[d] * 100)}%</td>
                <td className="aurora-number">{scores[d] == null ? "—" : scores[d].toFixed(1)}</td>
                <td className="aurora-number">{scores[d] == null ? "—" : (scores[d] * normalised[d]).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {write ? (
          <Stack direction="row" gap={2} style={{ marginTop: "var(--aurora-space-3)" }}>
            <Button onClick={() => saveWeights.mutate()} disabled={saveWeights.isPending || sum <= 0}>Save weights</Button>
            <Button variant="ghost" onClick={() => setWeights(DEFAULT)}>Use DAMA defaults</Button>
          </Stack>
        ) : <Banner tone="info" title="Read only">Changing weights needs the manage_settings permission.</Banner>}
      </section>

      <section aria-labelledby="scoring-alerts">
        <Text as="h2" id="scoring-alerts" variant="text-lead" className="aurora-runs__h">Alert thresholds</Text>
        <Stack direction="row" gap={4} wrap className="aurora-filters">
          <Field label="Critical findings" helper="Alert when a run has at least this many critical findings">
            {({ controlId }) => <Input id={controlId} type="number" min="0" value={thresholds.critical_threshold} disabled={!write}
              onChange={(e) => setThresholds({ ...thresholds, critical_threshold: Number(e.target.value) })} />}
          </Field>
          <Field label="High findings" helper="Alert when a run has at least this many high findings">
            {({ controlId }) => <Input id={controlId} type="number" min="0" value={thresholds.high_threshold} disabled={!write}
              onChange={(e) => setThresholds({ ...thresholds, high_threshold: Number(e.target.value) })} />}
          </Field>
          <Field label="DQS drop (points)" helper="Alert when an object's DQS falls by more than this against the previous run of the same system">
            {({ controlId }) => <Input id={controlId} type="number" min="0" step="0.5" value={thresholds.dqs_drop_threshold} disabled={!write}
              onChange={(e) => setThresholds({ ...thresholds, dqs_drop_threshold: Number(e.target.value) })} />}
          </Field>
        </Stack>
        <Text as="h3" variant="text-body" style={{ marginTop: "var(--aurora-space-4)" }}>DQS floors per object</Text>
        <Text variant="text-small" tone="secondary" as="p" className="aurora-runs__sub">
          An analysis that scores an object below its floor raises an in-app alert (and email or Teams, when configured).
        </Text>
        <table className="aurora-exec__table" style={{ maxWidth: 480 }}>
          <thead><tr><th>Object</th><th>Floor (DQS)</th><th /></tr></thead>
          <tbody>
            {Object.entries(floors).sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => (
              <tr key={m}>
                <td>{formatModuleName(m)}</td>
                <td>
                  <Input type="number" min="0" max="100" step="1" value={v} disabled={!write} aria-label={`${formatModuleName(m)} floor`}
                    className="aurora-number" onChange={(e) => setFloor(m, Math.min(100, Math.max(0, Number(e.target.value))))} />
                </td>
                <td>{write ? <Button variant="ghost" size="sm" onClick={() => setFloor(m, null)}>Remove</Button> : null}</td>
              </tr>
            ))}
            {!Object.keys(floors).length ? <tr><td colSpan={3}><Text tone="muted">No floors set.</Text></td></tr> : null}
          </tbody>
        </table>
        {write && unfloored.length ? (
          <div style={{ marginTop: "var(--aurora-space-2)", maxWidth: 260 }}>
            <Select aria-label="Add a floor for" placeholder="Add a floor for…" value=""
              options={unfloored.map((m) => ({ value: m, label: formatModuleName(m) }))}
              onValueChange={(m) => m && setFloor(m, 80)} />
          </div>
        ) : null}
        {write ? <div style={{ marginTop: "var(--aurora-space-3)" }}><Button onClick={() => saveThresholds.mutate()} disabled={saveThresholds.isPending}>Save thresholds</Button></div> : null}
      </section>

      <section aria-labelledby="scoring-planner">
        <Text as="h2" id="scoring-planner" variant="text-lead" className="aurora-runs__h">Planner assumptions</Text>
        <Text variant="text-small" tone="secondary" as="p" className="aurora-runs__sub">
          The next-sprint planner ranks open work by severity-weighted records per hour. Effort comes from these figures;
          money appears only when you state what one failing record costs you.
        </Text>
        <Stack direction="row" gap={4} wrap className="aurora-filters">
          <Field label="Minutes per record" helper="Steward time to correct one failing record">
            {({ controlId }) => <Input id={controlId} type="number" min="0" step="0.5" value={planner.minutes_per_record} disabled={!write}
              onChange={(e) => setPlanner({ ...planner, minutes_per_record: Number(e.target.value) })} />}
          </Field>
          <Field label="Hours per finding" helper="Investigation before the first record">
            {({ controlId }) => <Input id={controlId} type="number" min="0" step="0.25" value={planner.investigation_hours} disabled={!write}
              onChange={(e) => setPlanner({ ...planner, investigation_hours: Number(e.target.value) })} />}
          </Field>
          <Field label="Hours per exception" helper="Resolving one open exception">
            {({ controlId }) => <Input id={controlId} type="number" min="0" step="0.5" value={planner.exception_hours} disabled={!write}
              onChange={(e) => setPlanner({ ...planner, exception_hours: Number(e.target.value) })} />}
          </Field>
          <Field label="Sprint capacity (h)" helper="Steward hours per sprint bucket">
            {({ controlId }) => <Input id={controlId} type="number" min="1" step="1" value={planner.sprint_hours} disabled={!write}
              onChange={(e) => setPlanner({ ...planner, sprint_hours: Number(e.target.value) })} />}
          </Field>
          <Field label="Cost per failing record" helper="Optional. Leave blank and no monetary figure is shown anywhere.">
            {({ controlId }) => <Input id={controlId} type="number" min="0" step="1" value={planner.cost_per_record ?? ""} disabled={!write} placeholder="not set"
              onChange={(e) => setPlanner({ ...planner, cost_per_record: e.target.value === "" ? null : Number(e.target.value) })} />}
          </Field>
          <Field label="Currency" helper="ISO code shown next to costs">
            {({ controlId }) => <Input id={controlId} value={planner.currency} maxLength={3} disabled={!write} className="aurora-number"
              onChange={(e) => setPlanner({ ...planner, currency: e.target.value.toUpperCase() })} />}
          </Field>
        </Stack>
        {write ? <div style={{ marginTop: "var(--aurora-space-3)" }}><Button onClick={() => savePlanner.mutate()} disabled={savePlanner.isPending}>Save assumptions</Button></div> : null}
      </section>

      <section aria-labelledby="scoring-notify">
        <Text as="h2" id="scoring-notify" variant="text-lead" className="aurora-runs__h">Notifications</Text>
        <Stack gap={3}>
          <Stack direction="row" gap={4} wrap className="aurora-filters">
            <Field label="Email" helper="Digest and alert recipient">
              {({ controlId }) => <Input id={controlId} type="email" value={notify.email} disabled={!write} placeholder="dq-team@company.com"
                onChange={(e) => setNotify({ ...notify, email: e.target.value })} />}
            </Field>
            <Field label="Teams webhook" helper="Incoming webhook URL for the DQ channel">
              {({ controlId }) => <Input id={controlId} type="url" value={notify.teams_webhook} disabled={!write} placeholder="https://…webhook.office.com/…"
                onChange={(e) => setNotify({ ...notify, teams_webhook: e.target.value })} />}
            </Field>
          </Stack>
          <Stack direction="row" gap={2} wrap>
            {([["daily_digest", "Daily digest"], ["weekly_summary", "Weekly summary"], ["monthly_report", "Monthly report"]] as const).map(([k, label]) => (
              <Chip key={k} tone={notify[k] ? "info" : "neutral"} selected={notify[k]}
                onClick={write ? () => setNotify({ ...notify, [k]: !notify[k] }) : undefined}
                role="switch" aria-checked={notify[k]} style={{ cursor: write ? "pointer" : "default" }}>
                {label}
              </Chip>
            ))}
          </Stack>
          {write ? <div><Button onClick={() => saveNotify.mutate()} disabled={saveNotify.isPending}>Save notifications</Button></div> : null}
        </Stack>
      </section>
    </Stack>
  );
}
