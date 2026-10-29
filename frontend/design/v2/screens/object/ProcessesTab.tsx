"use client";

import { useMemo } from "react";
import type { BusinessProcessL1 } from "@/types/api";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { useProcessDocument } from "@/lib/v2/mdm-queries";
import { DQ_WORD, stepRef, stepsOf, worstOf, type StepView } from "@/lib/v2/process-tree";
import { useLandscape, useReceipt } from "@/lib/v2/queries";
import { f1, int, moduleFromSlug } from "@/lib/v2/score";
import { DqWord } from "../../inspector/step";
import "../../mdm.css";
import { Dash, Dot, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../../parts";
import { ScrollFrame } from "./ScrollFrame";

export const DESIGNER_HREF = "/insights/process/designer";

function StepBlock({ step, module, openId }: { step: StepView; module: string; openId: string | null }) {
  const { hrefFor } = useOpenItem();
  const ref = stepRef(module, step.id);
  return (
    <details className="m2-step-d" open={step.status !== "green"} data-testid="process-step" data-blocked={step.blocked ? "true" : undefined} data-status={step.status} data-current={openId === ref ? "true" : undefined}>
      <summary>
        <DqWord status={step.status} />
        <span className="m2-sname">{step.name}</span>
        {step.tcode ? <Mono>{step.tcode}</Mono> : null}
        <span className="m2-meta">{`Step ${step.number}`}</span>
      </summary>
      <div className="m2-sbody">
        <p className="m2-rp">
          {step.description}{" "}
          <V2Link href={hrefFor({ kind: "step", id: ref })} aria-label={`Open the step ${step.name}`}>
            Open the step
          </V2Link>
        </p>
        {step.activities.map((a) => (
          <div key={a.l5_id} className="m2-act5">
            <h5 className="m2-act5-h">{a.l5_name}</h5>
            {a.fields.length === 0 ? (
              <p className="m2-rp m2-meta">No field is mapped to this activity.</p>
            ) : (
              <ScrollFrame label={`Fields of ${a.l5_name}, scrollable`}>
                <table className="m2-tbl m2-ftbl" aria-label={`Fields of ${a.l5_name}`}>
                  <thead>
                    <tr>
                      <th scope="col">Field</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="m2-r">Pass rate</th>
                      <th scope="col" className="m2-r">Failing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.fields.map((f) => (
                      <tr key={f.field} data-status={f.dq_status}>
                        <th scope="row" className="m2-fcell">
                          <Mono>{f.field}</Mono>
                          <span className="m2-meta">{f.description}</span>
                        </th>
                        <td>
                          <DqWord status={f.dq_status} />
                        </td>
                        <td className="m2-r">{f.pass_rate == null ? <Dash why="No rule reads this field" /> : `${f1(f.pass_rate)}%`}</td>
                        <td className="m2-r">{f.check_id ? int(f.affected_count) : <Dash why="No rule reads this field" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollFrame>
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
    <section aria-label={l1.l1_name} className="m2-sec m2-l1" data-l1={l1.l1_id}>
      <div className="m2-sechead">
        <h2 className="m2-h2">
          {l1.l1_name} <Mono>{l1.l1_id}</Mono>
        </h2>
        <span className="m2-sub">
          <DqWord status={status} />
          {blocked > 0 ? (
            <>
              <Dot />
              {`${blocked} of ${steps.length} ${steps.length === 1 ? "step" : "steps"} blocked`}
            </>
          ) : null}
        </span>
      </div>
      {l1.l1_description ? <p className="m2-rp m2-meta">{l1.l1_description}</p> : null}
      {groups.map(({ g, steps: ss }) => (
        <div key={g.l2_id} className="m2-l2" data-l2={g.l2_id}>
          <h3 className="m2-h3">
            <span>{g.l2_name}</span>
            <span className="m2-meta">{DQ_WORD[worstOf(ss.map((s) => s.status))]}</span>
          </h3>
          {ss.map((s) => (
            <StepBlock key={s.id} step={s} module={module} openId={openId} />
          ))}
        </div>
      ))}
    </section>
  );
}

/** The Processes tab: the L1 to L5 readiness of the processes that read the object's fields, as a tree of steps. */
export function ProcessesTab({ module: moduleSegment }: { system: string; module: string }) {
  const run = useRunParam();
  const apiModule = moduleFromSlug(moduleSegment);
  const L = useLandscape(run);
  const label = L.data?.objects.find((o) => o.module === apiModule)?.label ?? apiModule.replace(/_/g, " ");
  const receiptQ = useReceipt(apiModule, run);
  const docQ = useProcessDocument(receiptQ.data?.run_id, apiModule);
  const { open } = useOpenItem();
  const processes = useMemo(() => docQ.data?.processes ?? [], [docQ.data]);
  const steps = useMemo(() => stepsOf(processes), [processes]);
  const blocked = steps.filter((s) => s.blocked);
  const openId = open?.kind === "step" ? open.id : null;

  const designer = (
    <section aria-label="Process designer" className="m2-sec m2-dframe">
      <div>
        <h2 className="m2-h2">Process designer</h2>
        <p className="m2-rp">Edit the process model, its steps and the fields each step reads in the designer of the current interface. Changes there show here on the next run.</p>
      </div>
      <V2Link href={DESIGNER_HREF} className="m2-btn">
        Open the designer
      </V2Link>
    </section>
  );

  if (receiptQ.isError || docQ.isError) {
    return <ErrorFrame onRetry={() => { void receiptQ.refetch(); void docQ.refetch(); }}>{`The process readiness of ${label} could not be read.`}</ErrorFrame>;
  }
  if (receiptQ.isPending || docQ.isPending) {
    return (
      <div aria-busy="true" data-testid="processes-loading">
        <Skeleton width="100%" height={220} />
      </div>
    );
  }
  if (processes.length === 0) {
    return (
      <>
        <EmptyFrame action={<V2Link href={DESIGNER_HREF} className="m2-btn">Open the designer</V2Link>}>
          {`No process step reads the fields of ${label}. Process readiness fills for objects that a step of the process model reads, such as Material master in Procure to Pay; add the object to a step in the designer.`}
        </EmptyFrame>
      </>
    );
  }
  return (
    <div className="m2-procs">
      <p className="m2-finding" data-testid="process-sentence">
        {blocked.length === 0
          ? `No process step is blocked by ${label}. Every step that reads its fields is ready in this run.`
          : `${blocked.length} of ${steps.length} process ${steps.length === 1 ? "step is" : "steps are"} blocked by ${label}: ${blocked.slice(0, 3).map((s) => `${s.l1Id} step ${s.number}`).join(", ")}${blocked.length > 3 ? ` and ${blocked.length - 3} more` : ""}.`}
      </p>
      {processes.map((l1) => (
        <L1Block key={l1.l1_id} l1={l1} steps={steps.filter((s) => s.l1Id === l1.l1_id)} module={apiModule} openId={openId} />
      ))}
      <p className="m2-prov">A step is blocked when a field it writes fails a critical or high rule, or passes under 70%. Failing counts are records, and a record can fail several rules.</p>
      {designer}
    </div>
  );
}
