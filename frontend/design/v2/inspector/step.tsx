"use client";

import { useMemo } from "react";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { useProcessDocument } from "@/lib/v2/mdm-queries";
import { DQ_VERDICT, DQ_WORD, parseStepRef, stepsOf } from "@/lib/v2/process-tree";
import { useReceipt } from "@/lib/v2/queries";
import { f1, int } from "@/lib/v2/score";
import { Fact, InspectorFrame } from "../Inspector";
import { FactList, Sec } from "./mdm-parts";
import { VerdictMark } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";

export function DqWord({ status }: { status: "green" | "amber" | "red" }) {
  return (
    <span className="m2-v">
      <VerdictMark verdict={DQ_VERDICT[status]} />
      {DQ_WORD[status]}
    </span>
  );
}

/** `?open=step:<module>:<step id>`: one process step, the fields it writes, the rules failing them, and the way to fix. */
export function StepInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const { hrefFor } = useOpenItem();
  const run = useRunParam();
  const ref = parseStepRef(id);
  const mod = ref?.module ?? "";
  const receipt = useReceipt(mod, run, Boolean(ref));
  const doc = useProcessDocument(receipt.data?.run_id, mod, Boolean(ref));
  const step = useMemo(() => stepsOf(doc.data?.processes ?? []).find((s) => s.id === ref?.step), [doc.data, ref?.step]);

  return (
    <InspectorFrame title={step ? step.name : "Process step"} status={step ? `Process step, ${DQ_WORD[step.status].toLowerCase()}` : "Process step"} onClose={onClose}>
      {!ref ? (
        <EmptyFrame>This address does not name a process step.</EmptyFrame>
      ) : receipt.isError || doc.isError ? (
        <ErrorFrame onRetry={() => { void receipt.refetch(); void doc.refetch(); }}>The process readiness could not be read for this run.</ErrorFrame>
      ) : receipt.isPending || doc.isPending ? (
        <div aria-busy="true">
          <Skeleton width="100%" height={140} />
        </div>
      ) : !step ? (
        <EmptyFrame>This run has no step with that id for the object. The process definition may have changed since the link was made.</EmptyFrame>
      ) : (
        <>
          <Sec title="Facts">
            <FactList>
              <Fact label="Status">
                <DqWord status={step.status} />
              </Fact>
              <Fact label="Process">{`${step.l1Name}, step ${step.number}`}</Fact>
              <Fact label="Area">{step.l2Name}</Fact>
              <Fact label="Transaction">{step.tcode ? <Mono>{step.tcode}</Mono> : <Dash />}</Fact>
              <Fact label="Records affected">{step.rules.length === 0 ? "0" : step.rules.length === 1 ? int(step.recordsAtLeast) : `${int(step.recordsAtLeast)} or more`}</Fact>
            </FactList>
            {step.description ? <p className="m2-rp m2-meta">{step.description}</p> : null}
          </Sec>
          <Sec title={`Fields: ${step.fields.length}`}>
            <table className="m2-tbl m2-ftbl" aria-label="Fields this step writes">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="m2-r">Failing</th>
                </tr>
              </thead>
              <tbody>
                {step.fields.map((f, i) => (
                  <tr key={`${f.field}:${i}`}>
                    <th scope="row" className="m2-fcell">
                      <Mono>{f.field}</Mono>
                      <span className="m2-meta">{f.description}</span>
                    </th>
                    <td>
                      <DqWord status={f.dq_status} />
                    </td>
                    <td className="m2-r">{f.check_id ? int(f.affected_count) : <Dash why="No rule reads this field" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Sec>
          <Sec title={`Rules failing: ${step.rules.length}`}>
            {step.rules.length === 0 ? (
              <p className="m2-rp m2-meta">No rule fails on a field of this step.</p>
            ) : (
              <ul className="m2-lk" aria-label="Rules failing on this step">
                {step.rules.map((r) => (
                  <li key={r.checkId}>
                    <span>
                      <V2Link href={hrefFor({ kind: "rule", id: r.checkId })} className="m2-mono">
                        {r.checkId}
                      </V2Link>{" "}
                      {r.message}
                    </span>
                    <span className="m2-meta">{`${int(r.affected)} failing${r.passRate != null ? `, ${f1(r.passRate)}% pass` : ""}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
          <Sec title="Actions">
            <div className="m2-acts">
              {step.rules.map((r, i) => (
                <V2Link key={r.checkId} href={`/v2/work?rule=${encodeURIComponent(r.checkId)}&module=${encodeURIComponent(mod)}`} className={`m2-btn${i === 0 ? " m2-strong" : ""}`}>
                  <>Fix <Mono>{r.checkId}</Mono> in Work</>
                </V2Link>
              ))}
              <V2Link href="/insights/process/designer" className="m2-btn m2-ghost">
                Open the designer
              </V2Link>
            </div>
          </Sec>
        </>
      )}
    </InspectorFrame>
  );
}
