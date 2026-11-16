"use client";

import "./tabs-g.css";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { BusinessProcessL1 } from "@/types/api";
import type { Receipt } from "@/lib/api/v2/types";
import { useOpenItem } from "@/lib/v2/hooks";
import { useProcessDocument } from "@/lib/v2/mdm-queries";
import { DQ_WORD, stepRef, stepsOf, worstOf, type StepView } from "@/lib/v2/process-tree";
import { useReceipt } from "@/lib/v2/queries";
import { f1, int } from "@/lib/v2/score";
import { describeField } from "@/lib/v2/sap-fields";
import { failingRules, simulate } from "@/lib/v2/what-if";
import { t } from "@/lib/v2/i18n";
import { Chip, DataTable, EmptyState, ErrorState, Skeleton, type Column } from "../../kit";
import { SegBar } from "../../kit/viz";
import type { ObjectRun } from "../useObjectRun";
import { ExportTable } from "@/design/next/more/ExportTable";
import { Dash, DqChip } from "./tabs-g-parts";

/** The process designer of an object: a canvas of its own under the object. */
export const designerHref = (system: string, module: string): string => `/next/o/${system}/${module}/processes/design`;

type FieldRow = StepView["activities"][number]["fields"][number];

function StepBlock({ step, module, openId }: { step: StepView; module: string; openId: string | null }) {
  const { hrefFor } = useOpenItem();
  const ref = stepRef(module, step.id);
  const columns: Column<FieldRow>[] = [
    {
      id: "field", label: t("Field"), compare: (a, b) => a.field.localeCompare(b.field),
      cell: (f) => (
        <span className="nx-tg-stack">
          <span className="nx-mono">{f.field}</span>
          <span className="nx-tg-sub">{f.description || describeField(f.field)}</span>
        </span>
      ),
    },
    { id: "status", label: t("Status"), cell: (f) => <DqChip dq={f.dq_status} /> },
    { id: "pass", label: t("Pass rate"), align: "end", compare: (a, b) => (a.pass_rate ?? -1) - (b.pass_rate ?? -1), cell: (f) => (f.pass_rate == null ? <Dash why={t("No rule reads this field")} /> : `${f1(f.pass_rate)}%`) },
    { id: "failing", label: t("Failing"), align: "end", compare: (a, b) => (a.affected_count ?? 0) - (b.affected_count ?? 0), cell: (f) => (f.check_id ? int(f.affected_count) : <Dash why={t("No rule reads this field")} />) },
  ];
  return (
    <details className="nx-tg-step" open={step.status !== "green"} data-testid="process-step" data-blocked={step.blocked ? "true" : undefined} data-status={step.status} data-current={openId === ref ? "true" : undefined}>
      <summary>
        <DqChip dq={step.status} />
        <span className="nx-tg-step-name">{step.name}</span>
        {step.tcode ? <span className="nx-mono">{step.tcode}</span> : null}
        <span className="nx-tg-sub">{t("Step {number}", { number: step.number })}</span>
      </summary>
      <div className="nx-tg-step-body">
        <p className="nx-tg-prov">
          {step.description}{" "}
          <Link href={hrefFor({ kind: "step", id: ref })} className="nx-link" aria-label={t("Open the step {name}", { name: step.name })}>
            {t("Open the step")}
          </Link>
        </p>
        {step.activities.map((a) => (
          <div key={a.l5_id} className="nx-tg-l2">
            <h3>{a.l5_name}</h3>
            {a.fields.length === 0 ? (
              <p className="nx-tg-prov">{t("No field is mapped to this activity.")}</p>
            ) : (
              <ExportTable><DataTable rows={a.fields} columns={columns} rowKey={(f) => f.field} rowLabel={(f) => f.field} caption={t("Fields of {l5_name}", { l5_name: a.l5_name })} density="compact" /></ExportTable>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function L1Block({ l1, steps, module, openId }: { l1: BusinessProcessL1; steps: StepView[]; module: string; openId: string | null }) {
  const blocked = steps.filter((s) => s.blocked).length;
  const status = worstOf(steps.map((s) => s.status));
  const groups = l1.l2_groups.map((g) => ({ g, steps: steps.filter((s) => g.l3_processes.some((l3) => l3.l4_subprocesses.some((l4) => l4.l4_id === s.id))) }));
  return (
    <section aria-label={l1.l1_name} className="nx-card nx-tg-sec" data-l1={l1.l1_id}>
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">
          {l1.l1_name} <span className="nx-mono">{l1.l1_id}</span>
        </h2>
        <span className="nx-tg-row">
          <DqChip dq={status} />
          {blocked > 0 ? <span className="nx-tg-sub">{t("{blocked} of {stepsCount} {stepsCount, plural, one {step} other {steps}} blocked", { blocked, stepsCount: steps.length })}</span> : null}
        </span>
      </div>
      {l1.l1_description ? <p className="nx-tg-prov">{l1.l1_description}</p> : null}
      {groups.map(({ g, steps: ss }) => (
        <div key={g.l2_id} className="nx-tg-l2" data-l2={g.l2_id}>
          <h3>
            <span>{g.l2_name}</span>
            <span className="nx-tg-sub">{DQ_WORD[worstOf(ss.map((s) => s.status))]}</span>
          </h3>
          {ss.map((s) => (
            <StepBlock key={s.id} step={s} module={module} openId={openId} />
          ))}
        </div>
      ))}
    </section>
  );
}

/** What happens to the cap, as the head of a sentence. */
function capSentence(before: number | null, after: number | null): string {
  if (after === null) return before === null ? t("The cap is released") : t("The cap of {capBefore} is released", { capBefore: before });
  return before === null ? t("The cap becomes {capAfter}", { capAfter: after }) : t("The cap of {capBefore} becomes {capAfter}", { capBefore: before, capAfter: after });
}

/** Tick the rules to fix and see which blocked steps would open and what the score cap would become. A simulation, never a forecast. */
function WhatIf({ steps, receipt, label }: { steps: readonly StepView[]; receipt: Receipt | null | undefined; label: string }) {
  const rules = useMemo(() => failingRules(steps), [steps]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const result = useMemo(() => simulate(steps, picked, receipt ?? null), [steps, picked, receipt]);
  if (!rules.length) return null;
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="nx-card nx-tg-sec" aria-label={t("What if these rules were fixed")} data-testid="what-if">
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{t("What if these rules were fixed")}</h2>
        <Chip tone="aletheia">{t("Simulation")}</Chip>
      </div>
      <p className="nx-tg-prov">{t("Tick the rules to fix. The steps of {label} are read again without their failures; nothing is changed and no data is read.", { label })}</p>
      <ul className="nx-tg-list" aria-label={t("Failing rules")}>
        {rules.map((r) => (
          <li key={r.checkId}>
            <label className="nx-tg-check">
              <input type="checkbox" checked={picked.has(r.checkId)} onChange={() => toggle(r.checkId)} />
              <span>
                <span className="nx-mono">{r.checkId}</span> {r.message}
                <small>{t("{affected} records at least, in {steps} {steps, plural, one {step} other {steps}}", { affected: int(r.affected), steps: r.steps })}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="nx-tg-out" role="status" data-testid="what-if-result">
        {picked.size === 0 ? (
          <span className="nx-tg-sub">{t("Choose at least one rule.")}</span>
        ) : (
          <>
            <span>{t("Blocked steps: {blockedBefore} now, {blockedAfter} if fixed.", { blockedBefore: result.blockedBefore, blockedAfter: result.blockedAfter })}</span>
            {result.released.length ? (
              <span>{t("Would open: {map}.", { map: result.released.map((s) => t("{l1Id} step {number} ({name})", { l1Id: s.l1Id, number: s.number, name: s.name })).join(", ") })}</span>
            ) : (
              <span className="nx-tg-sub">{t("No blocked step opens with these rules alone.")}</span>
            )}
            {result.steps
              .filter((s) => s.before !== s.after && !(s.before === "red" && s.after !== "red"))
              .map((s) => (
                <span key={s.id} className="nx-tg-sub">
                  {t("{l1Id} step {number}: {DQ_WORD} to {DQ_WORD2}", { l1Id: s.l1Id, number: s.number, DQ_WORD: DQ_WORD[s.before], DQ_WORD2: DQ_WORD[s.after] })}
                </span>
              ))}
            {result.score && result.score.before !== null ? (
              <span>
                {result.score.capAfter === result.score.capBefore
                  ? t("The score stays at {before}: {value}.", { before: f1(result.score.before), value: result.score.capAfter === null ? t("it is not capped") : t("still capped at {capAfter}", { capAfter: result.score.capAfter }) })
                  : t("{capText}: the score would show {after} (measured {measured}).", { capText: capSentence(result.score.capBefore, result.score.capAfter), after: f1(result.score.after), measured: f1(result.score.measured) })}
              </span>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/** The Processes tab: the L1 to L5 readiness of the processes that read the object's fields, as a tree of steps. */
export function ProcessesTab({ o }: { o: ObjectRun }) {
  const apiModule = o.module;
  const label = o.label;
  const receiptQ = useReceipt(apiModule, o.runId);
  const docQ = useProcessDocument(receiptQ.data?.run_id, apiModule);
  const { open } = useOpenItem();
  const processes = useMemo(() => docQ.data?.processes ?? [], [docQ.data]);
  const steps = useMemo(() => stepsOf(processes), [processes]);
  const blocked = steps.filter((s) => s.blocked);
  const openId = open?.kind === "step" ? open.id : null;
  const href = designerHref(o.systemSeg, o.moduleSeg);
  const openDesigner = (
    <Link href={href} className="nx-link">
      {t("Open the designer")}
    </Link>
  );

  if (receiptQ.isError || docQ.isError) {
    return (
      <ErrorState
        sentence={t("The process readiness of {label} could not be read.", { label })}
        error={receiptQ.error ?? docQ.error}
        onRetry={() => {
          void receiptQ.refetch();
          void docQ.refetch();
        }}
      />
    );
  }
  if (receiptQ.isPending || docQ.isPending) {
    return (
      <div aria-busy="true" data-testid="processes-loading">
        <Skeleton lines={5} />
      </div>
    );
  }
  if (processes.length === 0) {
    return (
      <EmptyState heading={t("Process designer")} action={openDesigner}>
        {t("No process step reads the fields of {label}. Process readiness fills for objects that a step of the process model reads, such as Material master in Procure to Pay; add the object to a step in the designer.", { label })}
      </EmptyState>
    );
  }
  return (
    <div className="nx-tg" data-testid="tab-processes">
      <section className="nx-card nx-tg-sec" aria-label={t("Processes")}>
        <p className="nx-tg-finding" data-testid="process-sentence">
          {blocked.length === 0
            ? t("No process step is blocked by {label}. Every step that reads its fields is ready in this run.", { label })
            : t("{blockedCount} of {stepsCount} process {stepsCount, plural, one {step is} other {steps are}} blocked by {label}: {map}{value}.", { blockedCount: blocked.length, stepsCount: steps.length, label, map: blocked.slice(0, 3).map((s) => t("{l1Id} step {number}", { l1Id: s.l1Id, number: s.number })).join(", "), value: blocked.length > 3 ? t(" and {count} more", { count: blocked.length - 3 }) : "" })}
        </p>
        <SegBar
          testid="process-status-mix"
          segs={[
            { key: "green", label: DQ_WORD.green, value: steps.filter((s) => s.status === "green").length, tone: "good" },
            { key: "amber", label: DQ_WORD.amber, value: steps.filter((s) => s.status === "amber").length, tone: "warn" },
            { key: "red", label: DQ_WORD.red, value: steps.filter((s) => s.status === "red").length, tone: "bad" },
          ]}
        />
      </section>
      {processes.map((l1) => (
        <L1Block key={l1.l1_id} l1={l1} steps={steps.filter((s) => s.l1Id === l1.l1_id)} module={apiModule} openId={openId} />
      ))}
      <p className="nx-tg-prov">{t("A step is blocked when a field it writes fails a critical or high rule, or passes under 70%. Failing counts are records, and a record can fail several rules.")}</p>
      <WhatIf steps={steps} receipt={receiptQ.data} label={label} />
      <section aria-label={t("Process designer")} className="nx-card nx-tg-sec">
        <div className="nx-tg-head">
          <h2 className="nx-sec-h">{t("Process designer")}</h2>
          {openDesigner}
        </div>
        <p className="nx-tg-prov">{t("Edit the process model, its steps and the fields each step reads in the process designer. Changes there show here on the next run.")}</p>
      </section>
    </div>
  );
}
