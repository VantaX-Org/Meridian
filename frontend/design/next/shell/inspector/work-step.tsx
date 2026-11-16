"use client";

import { useMemo } from "react";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { useProcessDocument } from "@/lib/v2/mdm-queries";
import { DQ_WORD, parseStepRef, stepsOf } from "@/lib/v2/process-tree";
import { useReceipt } from "@/lib/v2/queries";
import { useDesignerHref } from "@/lib/v2/sys-queries";
import { f1, int } from "@/lib/v2/score";
import { t, lc } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { Chip, Code, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Sec } from "./work-common";

type Dq = "green" | "amber" | "red";

/** The step's readiness word, with its shape (the chip icon) so colour is never the only signal. */
function DqWord({ status }: { status: Dq }) {
  return <Chip tone={status === "green" ? "good" : status === "red" ? "bad" : "neutral"}>{DQ_WORD[status]}</Chip>;
}

/** `?open=step:<module>:<step id>`: one process step, the fields it writes, the rules failing them, and the way to fix. */
export function StepBodyView({ id, onClose }: BodyProps) {
  const { hrefFor } = useOpenItem();
  const run = useRunParam();
  const ref = parseStepRef(id);
  const mod = ref?.module ?? "";
  const designer = useDesignerHref(mod);
  const receipt = useReceipt(mod, run, Boolean(ref));
  const doc = useProcessDocument(receipt.data?.run_id, mod, Boolean(ref));
  const step = useMemo(() => stepsOf(doc.data?.processes ?? []).find((s) => s.id === ref?.step), [doc.data, ref?.step]);

  return (
    <InspectorFrame title={step ? step.name : t("Process step")} status={step ? t("Process step, {DQ_WORD}", { DQ_WORD: lc(DQ_WORD[step.status]) }) : t("Process step")} onClose={onClose}>
      {!ref ? (
        <EmptyState heading={t("Process step")}>{t("This address does not name a process step.")}</EmptyState>
      ) : receipt.isError || doc.isError ? (
        <ErrorState sentence={t("The process readiness could not be read for this run.")} onRetry={() => { void receipt.refetch(); void doc.refetch(); }} />
      ) : receipt.isPending || doc.isPending ? (
        <Skeleton lines={5} label={t("Process step")} />
      ) : !step ? (
        <EmptyState heading={t("Not found")}>{t("This run has no step with that id for the object. The process definition may have changed since the link was made.")}</EmptyState>
      ) : (
        <>
          <Sec title={t("Facts")}>
            <Facts>
              <Fact label={t("Status")}><DqWord status={step.status} /></Fact>
              <Fact label={t("Process")}>{t("{l1Name}, step {number}", { l1Name: step.l1Name, number: step.number })}</Fact>
              <Fact label={t("Area")}>{step.l2Name}</Fact>
              <Fact label={t("Transaction")}>{step.tcode ? <Code code={step.tcode} /> : <Dash />}</Fact>
              <Fact label={t("Records affected")}>{step.rules.length === 0 ? "0" : step.rules.length === 1 ? int(step.recordsAtLeast) : t("{recordsAtLeast} or more", { recordsAtLeast: int(step.recordsAtLeast) })}</Fact>
            </Facts>
            {step.description ? <p className="nx-ib-meta">{step.description}</p> : null}
          </Sec>
          <Sec title={t("Fields: {count}", { count: step.fields.length })}>
            <div className="nx-wk-scroll">
              <table className="nx-wk-table" tabIndex={0} aria-label={t("Fields this step writes")} data-testid="step-fields">
                <thead>
                  <tr>
                    <th scope="col">{t("Field")}</th>
                    <th scope="col">{t("Status")}</th>
                    <th scope="col" className="nx-wk-num">{t("Failing")}</th>
                  </tr>
                </thead>
                <tbody>
                  {step.fields.map((f, i) => (
                    <tr key={`${f.field}:${i}`}>
                      <th scope="row"><Code code={f.field} text={f.description || undefined} /></th>
                      <td><DqWord status={f.dq_status} /></td>
                      <td className="nx-wk-num">{f.check_id ? int(f.affected_count) : <Dash why={t("No rule reads this field")} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Sec>
          <Sec title={t("Rules failing: {rulesCount}", { rulesCount: step.rules.length })}>
            {step.rules.length === 0 ? (
              <p className="nx-ib-meta">{t("No rule fails on a field of this step.")}</p>
            ) : (
              <ul className="nx-ib-list" aria-label={t("Rules failing on this step")} data-testid="step-rules">
                {step.rules.map((r) => (
                  <li key={r.checkId} className="nx-ib-row">
                    <span>
                      <V2Link href={hrefFor({ kind: "rule", id: r.checkId })} className="nx-wk-mono">{r.checkId}</V2Link>{" "}
                      {r.message}
                    </span>
                    <span className="nx-ib-meta">{t("{affected} failing{value}", { affected: int(r.affected), value: r.passRate != null ? t(", {passRate}% pass", { passRate: f1(r.passRate) }) : "" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
          <Sec title={t("Actions")}>
            <Actions>
              {step.rules.map((r) => (
                <V2Link key={r.checkId} href={`/work?rule=${encodeURIComponent(r.checkId)}&module=${encodeURIComponent(mod)}`} data-testid="step-fix">
                  <>{t("Fix")}{" "}<span className="nx-wk-mono">{r.checkId}</span>{" "}{t("in Work")}</>
                </V2Link>
              ))}
              <V2Link href={designer}>{t("Open the designer")}</V2Link>
            </Actions>
          </Sec>
        </>
      )}
    </InspectorFrame>
  );
}
