"use client";

import { useQuery } from "@tanstack/react-query";
import { getLoadPlan, type LoadObject, type LoadStatus, type PrerequisiteKind } from "@/lib/api/v2/load-plan";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int, VERDICT_LABEL } from "@/lib/v2/score";
import { Coded, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { Guide } from "./Guide";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Load plan: the order in which the migration objects load into the target, derived from the data dictionary. Every
 * dependency names the field, its check table and the dictionary text, so a reader can check it in SE11. The state of
 * each object comes from its latest migration analysis; an object that needs a no-go object through a required field
 * is blocked until that object is fixed.
 */

const STATUS_TEXT: Record<LoadStatus, () => string> = {
  go: () => VERDICT_LABEL.go,
  no_go: () => VERDICT_LABEL["no-go"],
  not_run: () => t("Not analysed yet"),
};

const KIND_TEXT: Record<PrerequisiteKind, () => string> = {
  configuration: () => t("Configuration"),
  master_data: () => t("Master data from outside the plan"),
  unclassified: () => t("Not classified in the dictionary"),
};

function ObjectRow({ o, names }: { o: LoadObject; names: Map<string, string> }) {
  return (
    <li data-testid={`lp-object-${o.module}`}>
      <strong>{moduleText(o.module)}</strong>{" "}
      <Coded code={o.anchor} text={o.anchor_text} />{" "}
      <span className="m2-meta" data-status={o.status}>{STATUS_TEXT[o.status]()}</span>
      {o.status === "no_go" ? <span className="m2-meta"> {t("{n, plural, one {# blocking gap} other {# blocking gaps}}", { n: o.blocking })}</span> : null}
      {o.group.length ? <p className="m2-meta">{t("Loads together with {list}", { list: o.group.map((m) => names.get(m) ?? m).join(", ") })}</p> : null}
      {o.blocked_by.length ? (
        <p className="m2-meta" data-testid={`lp-blocked-${o.module}`}>
          {t("Blocked until {list} is fixed", { list: o.blocked_by.map((m) => names.get(m) ?? m).join(", ") })}
        </p>
      ) : null}
    </li>
  );
}

export function LoadPlan() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["load-plan", fixture], queryFn: () => getLoadPlan(), staleTime: 60_000 });
  const title = t("Load plan");
  if (q.isPending) return <CcPage title={title}><Skeleton width="100%" height={320} /></CcPage>;
  if (q.isError) return <CcPage title={title}><ErrorFrame onRetry={() => void q.refetch()}>{t("The load plan could not be read.")}</ErrorFrame></CcPage>;
  const plan = q.data;
  if (plan.objects.length === 0) return <CcPage title={title}><EmptyFrame>{t("No licensed object can be planned against this dictionary.")}</EmptyFrame></CcPage>;
  const names = new Map(plan.objects.map((o) => [o.module, moduleText(o.module)]));
  const noGo = plan.objects.filter((o) => o.status === "no_go").length;
  const blocked = plan.objects.filter((o) => o.blocked_by.length > 0).length;
  const notRun = plan.objects.filter((o) => o.status === "not_run").length;
  const steps = Array.from({ length: plan.steps }, (_, i) => i + 1);
  const verdict = noGo || blocked ? "no-go" : notRun ? "at-risk" : "go";
  return (
    <CcPage title={title}>
      <Guide
        steps={{ labels: [t("Read the order"), t("Fix the no-go objects"), t("Load step by step"), t("Reconcile after each step")], current: noGo ? 1 : 2 }}
        shows={t("Shows the order in which the migration objects load, and why, from the data dictionary.")}
        next={{ href: "/migration", label: t("Open the migration analysis") }}
        means={[
          [t("Required"), t("The target refuses the record without this field, so the other object must load first.")],
          [t("Reference"), t("The record loads, but the reference stays empty or is rejected until the other object is in.")],
          [t("Deferred"), t("A reference inside a cycle. It is loaded as a delta after both objects.")],
          [t("Prerequisite"), t("A check table no object in the plan owns. It must already be in the target.")],
        ]}
      />
      <CcBanner
        testId="load-plan"
        label={title}
        eyebrow={title}
        verdict={verdict}
        headline={t("{n, plural, one {# object loads in {s} steps} other {# objects load in {s} steps}}", { n: plan.objects.length, s: plan.steps })}
        why={t("Each dependency is a field whose check table another object owns. The state of each object is its latest migration analysis.")}
        figs={[
          { label: t("Steps"), value: int(plan.steps) },
          { label: VERDICT_LABEL["no-go"], value: int(noGo) },
          { label: t("Blocked"), value: int(blocked), hint: t("Objects that need a no-go object through a required field") },
          { label: t("Not analysed yet"), value: int(notRun) },
        ]}
        action={<span className="m2-meta">{t("Dictionary: {release}", { release: plan.release })}</span>}
      />
      <Panel title={t("Steps")} meta={t("Objects in the same step have no dependency on each other and can load in parallel.")} testId="lp-steps">
        <ol className="m2-cl-changes">
          {steps.map((s) => (
            <li key={s} data-testid={`lp-step-${s}`}>
              <strong>{t("Step {n}", { n: s })}</strong>
              <ul className="m2-cl-changes">
                {plan.objects.filter((o) => o.step === s).map((o) => <ObjectRow key={o.module} o={o} names={names} />)}
              </ul>
            </li>
          ))}
        </ol>
        {plan.unknown.length ? <p className="m2-meta" data-testid="lp-unknown">{t("Not planned, no load object in this dictionary: {list}", { list: plan.unknown.map(moduleText).join(", ") })}</p> : null}
      </Panel>
      <Panel title={t("Dependencies")} meta={t("Every field that makes one object load before another.")} testId="lp-edges">
        {plan.edges.length === 0 ? <EmptyFrame>{t("These objects do not depend on each other.")}</EmptyFrame> : (
          <ScrollFrame label={t("Dependencies, scrollable")}>
            <table className="m2-tbl">
              <caption className="m2-sr">{t("Dependencies between migration objects")}</caption>
              <thead><tr><th scope="col">{t("Loads first")}</th><th scope="col">{t("Then")}</th><th scope="col">{t("Kind")}</th><th scope="col">{t("Field")}</th><th scope="col">{t("Check table")}</th><th scope="col">{t("Why")}</th></tr></thead>
              <tbody>
                {plan.edges.flatMap((e) => e.evidence.map((x, i) => (
                  <tr key={`${e.before}-${e.after}-${x.field}`} data-testid={`lp-edge-${e.before}-${e.after}-${x.field}`}>
                    <td>{i === 0 ? names.get(e.before) ?? e.before : null}</td>
                    <td>{i === 0 ? names.get(e.after) ?? e.after : null}</td>
                    <td>{i === 0 ? (e.deferred ? t("Deferred") : e.kind === "required" ? t("Required") : t("Reference")) : null}</td>
                    <td><Coded code={x.field} text={x.text} /></td>
                    <td><Coded code={x.check_table} text={x.check_table_text} /></td>
                    <td><span className="m2-meta">{x.reason ?? (x.required ? t("Required") : t("Reference"))}</span></td>
                  </tr>
                )))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>
      <Panel title={t("Prerequisites")} meta={t("Check tables no object in the plan owns. Load or transport them before step 1.")} testId="lp-prereq">
        <ScrollFrame label={t("Prerequisites, scrollable")}>
          <table className="m2-tbl">
            <caption className="m2-sr">{t("Prerequisites of each object")}</caption>
            <thead><tr><th scope="col">{t("Object")}</th><th scope="col">{t("Check table")}</th><th scope="col">{t("Kind")}</th><th scope="col">{t("Fields")}</th></tr></thead>
            <tbody>
              {plan.objects.flatMap((o) => o.prerequisites.map((p) => (
                <tr key={`${o.module}-${p.table}`} data-testid={`lp-prereq-${o.module}-${p.table}`}>
                  <td>{names.get(o.module)}</td>
                  <td><Coded code={p.table} text={p.text} /></td>
                  <td>{KIND_TEXT[p.kind]()}</td>
                  <td><span className="m2-meta">{p.fields.join(", ")}</span></td>
                </tr>
              )))}
            </tbody>
          </table>
        </ScrollFrame>
      </Panel>
    </CcPage>
  );
}
