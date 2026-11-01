"use client";

import type { RootCauseOrigin } from "@/lib/api/v2/object";
import { useFindingRootCause } from "@/lib/v2/object-queries";
import { describeField } from "@/lib/v2/sap-fields";
import { f1, int } from "@/lib/v2/score";
import { t as tr } from "@/lib/v2/i18n";
import { Coded, Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import type { RuleView } from "../inspector/rule";
import { ScrollFrame } from "./object/ScrollFrame";

const ORIGIN: Record<RootCauseOrigin["origin"], () => string> = {
  interface: () => tr("Interface or batch user"),
  dialog: () => tr("Person in a dialog transaction"),
  migration: () => tr("Migration load before go-live"),
  unknown: () => tr("No change document"),
};

/** Who set the failing values of a rule in its newest run, from SAP change documents (GET /versions/{id}/findings/{check}/root-cause). */
export function RuleRootCause({ view }: { view: RuleView }) {
  const run = view.scope.objects[0]?.run_id;
  const q = useFindingRootCause(view.id, run);
  const title = tr("Who set these values");
  let body;
  if (!run) body = <EmptyFrame>{tr("This rule has no run yet.")}</EmptyFrame>;
  else if (q.isError) body = <ErrorFrame onRetry={() => void q.refetch()}>{tr("Who set the values of this rule could not be read.")}</ErrorFrame>;
  else if (q.isPending) body = <Skeleton width="100%" height={96} />;
  else if (q.data.status === "not_computed") body = <EmptyFrame>{tr("Not worked out for this run. It is read from SAP change documents after an analysis of a connected SAP system.")}</EmptyFrame>;
  else if (q.data.status !== "computed") body = <EmptyFrame>{q.data.detail || tr("Not available for this rule.")}</EmptyFrame>;
  else {
    const d = q.data;
    body = (
      <>
        {d.summary ? <p className="m2-finding" data-testid="root-cause-sentence">{d.summary}</p> : null}
        <p className="m2-meta">
          {d.field ? <Coded code={d.field} text={describeField(d.field)} /> : <Dash />}{" "}
          {tr("{analysed} of {total} failing records traced.", { analysed: int(d.analysed), total: int(d.total) })}
        </p>
        <ScrollFrame label={tr("Who set these values, scrollable")}>
          <table className="m2-tbl" aria-label={title}>
            <thead>
              <tr>
                <th scope="col">{tr("Origin")}</th>
                <th scope="col">{tr("SAP user")}</th>
                <th scope="col">{tr("Transaction")}</th>
                <th scope="col" className="m2-r">{tr("Records")}</th>
                <th scope="col" className="m2-r">{tr("Share")}</th>
              </tr>
            </thead>
            <tbody>
              {d.origins.map((o) => (
                <tr key={`${o.origin}|${o.username}|${o.tcode}`} data-testid="root-cause-origin">
                  <td>{ORIGIN[o.origin]()}</td>
                  <td>{o.username ? <Mono>{o.username}</Mono> : <Dash />}</td>
                  <td>{o.tcode ? <Mono>{o.tcode}</Mono> : <Dash />}</td>
                  <td className="m2-r">{int(o.records)}</td>
                  <td className="m2-r">{`${f1(o.share)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      </>
    );
  }
  return (
    <section className="m2-sec" aria-label={title}>
      <div className="m2-sechead"><h2 className="m2-h2">{title}</h2></div>
      {body}
    </section>
  );
}
