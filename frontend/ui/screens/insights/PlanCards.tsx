"use client";

/**
 * The remediation plan on the Forecast screen: open work ranked by severity-weighted records per hour
 * (GET /analytics/prescriptive), the same work cut into sprints of a chosen length (GET /analytics/sprints), and
 * what one finding costs (GET /analytics/impact/{id}). Every figure comes from those three reads.
 */
import { useState } from "react";
import { getFindingImpact, getPrescriptive, getSprintPlan, type PlanAction } from "@/lib/api/v2/analytics";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { BarList, Button, Card, FieldChip, Select, SeverityPill, StatTile, TrendArea } from "@/ui/kit";
import { Gate, Tbl, money, n0, n1, sevLabel, sevOf, useQ } from "./shared";

const HOURS = [20, 40, 80];
const kindText = (k: PlanAction["type"]): string => (k === "finding" ? t("Finding") : k === "cleaning" ? t("Cleaning item") : t("Exception"));
/** A finding is named by its rule; the other kinds have no code, so the kind stands in. */
const codeOf = (a: PlanAction): string => a.check_id ?? kindText(a.type);

function Impact({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQ("finding-impact", () => getFindingImpact(id), [id]);
  const rows = q.data?.impacts ?? [];
  return (
    <Card title={t("What this finding costs")} sub={t("Priced from the cost model, per category a year")} action={<Button variant="ghost" onClick={onClose}>{t("Close")}</Button>}>
      <Gate q={q} empty={rows.length === 0} emptyHeading={t("No cost recorded")} emptyBody={t("The cost model prices no category for this finding.")}>
        <div className="b8-stack">
          <BarList label={t("Annual risk by category")} items={rows.map((i) => ({ id: i.category, label: labelText(i.category), value: i.annual_risk, display: money(i.annual_risk, i.currency) }))} />
          <Tbl label={t("Finding cost calculation")} rows={rows} rowKey={(r) => r.category} cols={[
            { key: "c", label: t("Category"), render: (r) => <FieldChip code={r.category} description={labelText(r.category)} /> },
            { key: "r", label: t("Annual risk"), end: true, render: (r) => money(r.annual_risk, r.currency) },
            { key: "m", label: t("Mitigated"), end: true, render: (r) => money(r.mitigated, r.currency) },
            { key: "n", label: t("Findings"), end: true, render: (r) => n0(r.finding_count) },
            { key: "w", label: t("Method"), render: (r) => r.calculation_method },
          ]} />
        </div>
      </Gate>
    </Card>
  );
}

export function PlanCard() {
  useInterfaceLang();
  const [hours, setHours] = useState(40);
  const [pick, setPick] = useState<string | null>(null);
  const plan = useQ("prescriptive", getPrescriptive);
  const sprints = useQ("sprint-plan", () => getSprintPlan(hours), [hours]);
  const actions = (plan.data?.actions ?? []).slice(0, 8);
  const basis = plan.data?.basis;
  const sp = sprints.data?.sprints ?? [];
  return (
    <>
      <Card title={t("Remediation plan")} sub={t("Open work ranked by severity-weighted records fixed per hour")}>
        <Gate q={plan} empty={(plan.data?.actions.length ?? 0) === 0} emptyHeading={t("No open work")} emptyBody={t("Nothing is waiting to be fixed.")}>
          <div className="b8-stack">
            <dl className="mx-tiles">
              <StatTile label={t("Open actions")} value={n0(plan.data?.total_actions)} />
              <StatTile label={t("Findings")} value={n0(basis?.findings)} />
              <StatTile label={t("Cleaning items")} value={n0(basis?.cleaning_items)} />
              <StatTile label={t("Exceptions")} value={n0(basis?.exceptions)} />
            </dl>
            <BarList label={t("Records fixed per hour")} items={actions.map((a) => ({ id: a.id, label: a.title, value: a.value_per_hour, display: n1(a.value_per_hour), sev: sevOf(a.severity) }))} />
            <Tbl label={t("Ranked actions")} rows={actions} rowKey={(r) => `${r.type}/${r.id}`} cols={[
              { key: "a", label: t("Action"), render: (r) => <FieldChip code={codeOf(r)} description={r.title} /> },
              { key: "s", label: t("Severity"), render: (r) => <SeverityPill sev={sevOf(r.severity)} label={sevLabel(r.severity)} /> },
              { key: "n", label: t("Records"), end: true, render: (r) => t("{a} of {b}", { a: n0(r.affected_count), b: n0(r.total_count) }) },
              { key: "h", label: t("Hours"), end: true, render: (r) => n1(r.effort_hours) },
              { key: "v", label: t("Per hour"), end: true, render: (r) => n1(r.value_per_hour) },
              { key: "c", label: t("Cost"), end: true, render: (r) => money(r.estimated_cost, r.currency) },
              { key: "i", label: t("Impact"), render: (r) => (r.type === "finding"
                ? <Button variant="ghost" onClick={() => setPick(r.id)} aria-label={t("Show cost of {name}", { name: r.title })}>{t("Cost")}</Button>
                : null) },
            ]} />
          </div>
        </Gate>
      </Card>
      {pick ? <Impact id={pick} onClose={() => setPick(null)} /> : null}
      <Card title={t("Sprints")} sub={t("The same work cut into sprints, with the score each one should reach")}
        action={<Select aria-label={t("Hours per sprint")} value={String(hours)} onChange={(e) => setHours(Number(e.target.value))} options={HOURS.map((h) => ({ value: String(h), label: t("{n} hours a sprint", { n: String(h) }) }))} />}>
        <Gate q={sprints} empty={sp.length === 0} emptyHeading={t("No sprints to plan")} emptyBody={t("Sprints appear when there is open work.")}>
          <div className="b8-stack">
            <TrendArea label={t("Projected score after each sprint")} emptyLabel={t("No projection")}
              points={sp.filter((s) => s.dqs_projected !== null).map((s) => ({ axis: t("Sprint {n}", { n: String(s.sprint_number) }), title: t("Sprint {n}", { n: String(s.sprint_number) }), value: s.dqs_projected ?? 0 }))} />
            <Tbl label={t("Sprint plan")} rows={sp} rowKey={(r) => String(r.sprint_number)} cols={[
              { key: "s", label: t("Sprint"), render: (r) => String(r.sprint_number) },
              { key: "a", label: t("Actions"), end: true, render: (r) => n0(r.actions.length) },
              { key: "h", label: t("Hours"), end: true, render: (r) => n1(r.total_effort_hours) },
              { key: "r", label: t("Records fixed"), end: true, render: (r) => n0(r.records_fixed) },
              { key: "k", label: t("Critical cleared"), end: true, render: (r) => n0(r.critical_cleared) },
              { key: "d", label: t("Score"), end: true, render: (r) => t("{a} to {b}", { a: n1(r.dqs_now), b: n1(r.dqs_projected) }) },
              { key: "c", label: t("Cost"), end: true, render: (r) => money(r.estimated_cost, r.currency) },
            ]} />
          </div>
        </Gate>
      </Card>
    </>
  );
}
