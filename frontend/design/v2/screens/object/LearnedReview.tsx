"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getLearnedReview, type DdicAnchor, type OutOfDictionary, type ProposalReview } from "@/lib/api/v2/object";
import { t } from "@/lib/v2/i18n";
import { int, pct1 } from "@/lib/v2/score";
import { Coded, Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../../parts";
import { Panel } from "../Mining";
import { ScrollFrame } from "./ScrollFrame";

function Anchor({ a }: { a: DdicAnchor }) {
  if (!a.known) return <span className="m2-meta">{t("{column} is not in the dictionary", { column: a.column })}</span>;
  return (
    <div className="m2-rn">
      <Coded code={a.column} text={a.description} first />
      <span className="m2-rs m2-meta">
        {t("Data element {element}", { element: a.data_element ?? "-" })}
        {a.check_table ? `, ${t("check table {table}-{field}", { table: a.check_table, field: a.check_field ?? "" })}` : ""}
        {a.fixed_values ? `, ${t("{n, plural, one {# fixed value} other {# fixed values}}", { n: a.fixed_values })}` : ""}
      </span>
    </div>
  );
}

const SOURCE: Record<OutOfDictionary["source"], () => string> = {
  domain: () => t("domain fixed values"),
  live: () => t("live configuration"),
  baseline: () => t("SAP standard baseline"),
  no_reference: () => t("no check table or fixed values"),
  unverified: () => t("not verified: no codes read"),
};

function Ood({ o, testId }: { o: OutOfDictionary; testId: string }) {
  const checked = o.source === "domain" || o.source === "live" || o.source === "baseline";
  return (
    <div className="m2-rn" data-testid={testId}>
      {o.values.length ? <span>{o.values.map((v, i) => <span key={v}>{i ? ", " : ""}<Mono>{v}</Mono></span>)}</span> : <span>{checked ? t("None") : <Dash />}</span>}
      <span className="m2-rs m2-meta">{checked ? t("against {source}, {n} codes", { source: SOURCE[o.source](), n: int(o.checked) }) : SOURCE[o.source]()}</span>
    </div>
  );
}

function Row({ p }: { p: ProposalReview }) {
  const keys = p.sample_keys.map((k) => Object.entries(k).map(([f, v]) => `${f}=${String(v)}`).join(" "));
  return (
    <tr data-testid={`learned-review-${p.id}`}>
      <th scope="row">
        <Anchor a={p.field_anchor} />
        {p.determinant_anchor ? <div className="m2-rs">{t("by")} <Anchor a={p.determinant_anchor} /></div> : null}
      </th>
      <td className="m2-r">{p.support_rows != null ? int(p.support_rows) : <Dash />}</td>
      <td className="m2-r">{p.confidence != null ? pct1(p.confidence) : <Dash />}</td>
      <td className="m2-r" data-testid={`learned-lift-${p.id}`}>
        {p.lift.lift != null ? (
          <div className="m2-rn">
            <span>{t("{lift} times", { lift: p.lift.lift.toFixed(2) })}</span>
            <span className="m2-rs m2-meta">{t("{p} hold it anyway", { p: pct1(p.lift.expected) })}{p.lift.sampled ? `, ${t("sampled")}` : ""}</span>
          </div>
        ) : (
          <div className="m2-rn">
            <span>{t("Not derivable")}</span>
            <span className="m2-rs m2-meta">{p.lift.reason}</span>
          </div>
        )}
      </td>
      <td>
        {p.out_of_dictionary ? <Ood o={p.out_of_dictionary} testId={`learned-ood-${p.id}`} /> : <Dash />}
        {p.determinant_out_of_dictionary && p.determinant_out_of_dictionary.values.length ? (
          <div className="m2-rs m2-meta">{t("Determinant values not in the dictionary: {values}", { values: p.determinant_out_of_dictionary.values.join(", ") })}</div>
        ) : null}
      </td>
      <td data-testid={`learned-redundant-${p.id}`}>
        <div className="m2-rn">
          <span>{p.redundant ? t("Already enforced by SAP") : t("Not enforced by SAP")}</span>
          <span className="m2-rs m2-meta">{p.redundant_reason}</span>
        </div>
      </td>
      <td><span className="m2-mono m2-meta">{keys.length ? keys.join(", ") : "-"}</span></td>
    </tr>
  );
}

/** The DDIC review of the learned rules waiting: lift over the base rate, the dictionary anchor of each field, mined
 * values the dictionary does not know, and whether SAP already enforces the rule through a check table. */
export function LearnedReview({ module }: { module: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["learned-review", fixture, module], queryFn: () => getLearnedReview(module), staleTime: 15_000, retry: false });
  const title = t("Dictionary review");
  const meta = t("Each proposal checked against the SAP dictionary before you decide. A lift near 1 means the rule only restates how common the values are.");
  if (q.isPending) return <Panel title={title} meta={meta} testId="learned-review"><Skeleton width="100%" height={120} /></Panel>;
  if (q.isError) return <Panel title={title} meta={meta} testId="learned-review"><ErrorFrame onRetry={() => void q.refetch()}>{t("The dictionary review could not be read.")}</ErrorFrame></Panel>;
  if (q.data.length === 0) return <Panel title={title} meta={meta} testId="learned-review"><EmptyFrame>{t("No learned rules are waiting.")}</EmptyFrame></Panel>;
  const redundant = q.data.filter((p) => p.redundant).length;
  return (
    <Panel title={title} meta={meta} testId="learned-review">
      {redundant ? <p className="m2-meta" data-testid="learned-review-redundant">{t("{n, plural, one {# proposal is} other {# proposals are}} already enforced by a check table; approving adds no protection.", { n: redundant })}</p> : null}
      <ScrollFrame label={t("Dictionary review, scrollable")}>
        <table className="m2-tbl">
          <caption className="m2-sr">{t("Learned rules checked against the SAP dictionary")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Field and dictionary anchor")}</th>
              <th scope="col" className="m2-r">{t("Rows supporting")}</th>
              <th scope="col" className="m2-r">{t("Confidence")}</th>
              <th scope="col" className="m2-r">{t("Lift")}</th>
              <th scope="col">{t("Values not in the dictionary")}</th>
              <th scope="col">{t("Redundant")}</th>
              <th scope="col">{t("Violating records")}</th>
            </tr>
          </thead>
          <tbody>{q.data.map((p) => <Row key={p.id} p={p} />)}</tbody>
        </table>
      </ScrollFrame>
    </Panel>
  );
}
