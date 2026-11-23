"use client";

import { useState } from "react";
import { Button, Card, EmptyState, Field, Input } from "@/ui/kit";
import { Frame, Num, useAct, useCan, useSectionChat, useSync } from "../common";
import { useCostModel, useTenantSettings } from "@/lib/v2/admin-queries";
import { patchTenant, putCostModel, saveAlertThresholds, savePlanner } from "@/lib/api/v2/admin";
import type { AlertThresholds, CostModel, PlannerConfig } from "@/types/api";
import { t } from "@/lib/v2/i18n";

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const sevLabel = (s: string) => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : t("Low"));

export function Settings() {
  const q = useTenantSettings();
  const cost = useCostModel();
  const can = useCan();
  const edit = can("manage_settings");
  const { run, busy } = useAct();
  const s = q.data;

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("");
  const [planner, setPlanner] = useState<PlannerConfig | null>(null);
  const [alerts, setAlerts] = useState<AlertThresholds | null>(null);
  const [model, setModel] = useState<CostModel | null>(null);

  useSync(s, (v) => { setName(v.name); setCurrency(v.currency ?? ""); setPlanner(v.planner_config); setAlerts(v.alert_thresholds); });
  useSync(cost.data, setModel);

  useSectionChat("settings", t("Tenant settings"), s ? [
    t("The tenant is {name} and reports in {currency}.", { name: s.name, currency: s.currency ?? "" }),
    planner ? t("A record takes {m} minutes to fix in the plan.", { m: planner.minutes_per_record }) : t("No effort plan is saved."),
    alerts ? t("A run alerts at {n} critical findings.", { n: alerts.critical_threshold }) : t("No alert thresholds are saved."),
  ] : [], [t("What currency do reports use?"), t("When does a run raise an alert?")]);

  const setP = <K extends keyof PlannerConfig>(k: K, v: PlannerConfig[K]) => setPlanner((p) => (p ? { ...p, [k]: v } : p));
  const setA = <K extends keyof AlertThresholds>(k: K, v: AlertThresholds[K]) => setAlerts((p) => (p ? { ...p, [k]: v } : p));

  return (
    <Frame slug="settings" title={t("Tenant settings")} lead={t("Name, currency, effort plan, alert thresholds and cost model for this tenant.")} loading={q.isLoading} error={q.isError}>
      {!s ? <EmptyState heading={t("No tenant settings are available")} body={t("Reload the page. If this stays empty, ask an administrator to check the tenant.")} /> : (
        <>
          <Card title={t("Tenant")}>
            <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => patchTenant({ name, currency }), t("Tenant saved."), ["settings"]); }}>
              <Field label={t("Name")}><Input value={name} disabled={!edit} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label={t("Currency")} hint={t("A three letter code such as ZAR or EUR.")}><Input value={currency} maxLength={3} disabled={!edit} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field>
              {edit && <div className="mx-links"><Button variant="primary" type="submit" disabled={busy}>{t("Save")}</Button></div>}
            </form>
          </Card>
          <Card title={t("Effort plan")} sub={t("Turns findings into hours and cost in the clean-up plan.")}>
            {!planner ? <EmptyState heading={t("No effort plan is saved")} body={t("Enter the effort and save the plan to see it here.")} /> : (
              <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => savePlanner(planner), t("Effort plan saved."), ["settings"]); }}>
                <Num label={t("Minutes to fix one record")} value={planner.minutes_per_record} step={0.5} onChange={(v) => setP("minutes_per_record", v)} />
                <Num label={t("Hours per investigation")} value={planner.investigation_hours} step={0.5} onChange={(v) => setP("investigation_hours", v)} />
                <Num label={t("Hours per cleaning item")} value={planner.cleaning_item_hours} step={0.5} onChange={(v) => setP("cleaning_item_hours", v)} />
                <Num label={t("Hours per exception")} value={planner.exception_hours} step={0.5} onChange={(v) => setP("exception_hours", v)} />
                <Num label={t("Hours in a sprint")} value={planner.sprint_hours} onChange={(v) => setP("sprint_hours", v)} />
                <Num label={t("Cost of one record")} value={planner.cost_per_record} step={0.5} onChange={(v) => setP("cost_per_record", v)} />
                {edit && <div className="mx-links"><Button variant="primary" type="submit" disabled={busy}>{t("Save")}</Button></div>}
              </form>
            )}
          </Card>
          <Card title={t("Alert thresholds")} sub={t("A run raises an alert when it crosses one of these.")}>
            {!alerts ? <EmptyState heading={t("No alert thresholds are saved")} body={t("Set a threshold and save it to be alerted.")} /> : (
              <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => saveAlertThresholds(alerts), t("Alert thresholds saved."), ["settings"]); }}>
                <Num label={t("Critical findings that raise an alert")} value={alerts.critical_threshold} onChange={(v) => setA("critical_threshold", v)} />
                <Num label={t("High findings that raise an alert")} value={alerts.high_threshold} onChange={(v) => setA("high_threshold", v)} />
                <Num label={t("Score drop that raises an alert")} hint={t("In points against the last run.")} value={alerts.dqs_drop_threshold} step={0.5} onChange={(v) => setA("dqs_drop_threshold", v)} />
                <Num label={t("Score for a go in the readiness grid")} value={alerts.readiness_dqs_threshold} max={100} onChange={(v) => setA("readiness_dqs_threshold", v)} />
                {edit && <div className="mx-links"><Button variant="primary" type="submit" disabled={busy}>{t("Save")}</Button></div>}
              </form>
            )}
          </Card>
          <Card title={t("Cost model")} sub={t("What one finding of each severity costs the business.")}>
            {!model ? <EmptyState heading={t("No cost model is available")} body={t("Enter your rates to build the cost model.")} /> : (
              <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => putCostModel(model), t("Cost model saved."), ["settings"]); }}>
                <Field label={t("Currency")}><Input value={model.currency} maxLength={3} disabled={!edit} onChange={(e) => setModel({ ...model, currency: e.target.value.toUpperCase() })} /></Field>
                {SEVERITIES.map((sev) => (
                  <Num key={sev} label={t("Cost of one {severity} record", { severity: sevLabel(sev).toLowerCase() })} value={model.severity[sev]?.per_record ?? 0} step={0.5}
                    onChange={(v) => setModel({ ...model, severity: { ...model.severity, [sev]: { ...model.severity[sev], per_record: v } } })} />
                ))}
                <Num label={t("Monthly subscription")} value={model.subscription_monthly ?? 0} onChange={(v) => setModel({ ...model, subscription_monthly: v })} />
                {edit && <div className="mx-links"><Button variant="primary" type="submit" disabled={busy}>{t("Save")}</Button></div>}
              </form>
            )}
          </Card>
        </>
      )}
    </Frame>
  );
}
