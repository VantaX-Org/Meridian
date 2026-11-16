"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getLearnedReview, type DdicAnchor, type OutOfDictionary, type ProposalReview } from "@/lib/api/v2/object";
import { t } from "@/lib/v2/i18n";
import { int, pct1 } from "@/lib/v2/score";
import { DataTable, type Column } from "@/design/next/kit";
import { ExportTable } from "@/design/next/more/ExportTable";
import { Dash } from "./tabs-g-parts";
import "./tabs-f.css";

function Anchor({ a }: { a: DdicAnchor }) {
  if (!a.known) return <span className="nx-tf-sub">{t("{column} is not in the dictionary", { column: a.column })}</span>;
  return (
    <span className="nx-tf-pair">
      <span>
        <span className="nx-mono">{a.column}</span> {a.description}
      </span>
      <span className="nx-tf-sub">
        {t("Data element {element}", { element: a.data_element ?? "-" })}
        {a.check_table ? `, ${t("check table {table}-{field}", { table: a.check_table, field: a.check_field ?? "" })}` : ""}
        {a.fixed_values ? `, ${t("{n, plural, one {# fixed value} other {# fixed values}}", { n: a.fixed_values })}` : ""}
      </span>
    </span>
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
    <span className="nx-tf-pair" data-testid={testId}>
      {o.values.length ? <span className="nx-mono">{o.values.join(", ")}</span> : <span>{checked ? t("None") : <Dash />}</span>}
      <span className="nx-tf-sub">{checked ? t("against {source}, {n} codes", { source: SOURCE[o.source](), n: int(o.checked) }) : SOURCE[o.source]()}</span>
    </span>
  );
}

/** The DDIC review of the learned rules waiting: lift over the base rate, the dictionary anchor of each field, mined
 * values the dictionary does not know, and whether SAP already enforces the rule through a check table. */
export function DictionaryReview({ module }: { module: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["learned-review", fixture, module], queryFn: () => getLearnedReview(module), staleTime: 15_000, retry: false });
  const rows = q.data ?? [];
  const redundant = rows.filter((p) => p.redundant).length;
  const cols: Column<ProposalReview>[] = [
    {
      id: "field",
      label: t("Field and dictionary anchor"),
      cell: (p) => (
        <span className="nx-tf-pair" data-testid={`learned-review-${p.id}`}>
          <Anchor a={p.field_anchor} />
          {p.determinant_anchor ? (
            <span>
              {t("by")} <Anchor a={p.determinant_anchor} />
            </span>
          ) : null}
        </span>
      ),
    },
    { id: "support", label: t("Rows supporting"), cell: (p) => (p.support_rows != null ? int(p.support_rows) : <Dash />), align: "end" },
    { id: "confidence", label: t("Confidence"), cell: (p) => (p.confidence != null ? pct1(p.confidence) : <Dash />), align: "end" },
    {
      id: "lift",
      label: t("Lift"),
      align: "end",
      cell: (p) => (
        <span className="nx-tf-pair" data-testid={`learned-lift-${p.id}`}>
          {p.lift.lift != null ? (
            <>
              <span>{t("{lift} times", { lift: p.lift.lift.toFixed(2) })}</span>
              <span className="nx-tf-sub">
                {t("{p} hold it anyway", { p: pct1(p.lift.expected) })}
                {p.lift.sampled ? `, ${t("sampled")}` : ""}
              </span>
            </>
          ) : (
            <>
              <span>{t("Not derivable")}</span>
              <span className="nx-tf-sub">{p.lift.reason}</span>
            </>
          )}
        </span>
      ),
    },
    {
      id: "ood",
      label: t("Values not in the dictionary"),
      cell: (p) => (
        <span className="nx-tf-pair">
          {p.out_of_dictionary ? <Ood o={p.out_of_dictionary} testId={`learned-ood-${p.id}`} /> : <Dash />}
          {p.determinant_out_of_dictionary && p.determinant_out_of_dictionary.values.length ? (
            <span className="nx-tf-sub">{t("Determinant values not in the dictionary: {values}", { values: p.determinant_out_of_dictionary.values.join(", ") })}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "redundant",
      label: t("Redundant"),
      cell: (p) => (
        <span className="nx-tf-pair" data-testid={`learned-redundant-${p.id}`}>
          <span>{p.redundant ? t("Already enforced by SAP") : t("Not enforced by SAP")}</span>
          <span className="nx-tf-sub">{p.redundant_reason}</span>
        </span>
      ),
    },
    {
      id: "keys",
      label: t("Violating records"),
      cell: (p) => {
        const keys = p.sample_keys.map((k) => Object.entries(k).map(([f, v]) => `${f}=${String(v)}`).join(" "));
        return <span className="nx-mono">{keys.length ? keys.join(", ") : "-"}</span>;
      },
    },
  ];
  return (
    <section className="nx-card nx-tf-sec" data-testid="learned-review" aria-label={t("Dictionary review")}>
      <div className="nx-tf-head">
        <h3 className="nx-sec-h">{t("Dictionary review")}</h3>
        <span className="nx-tf-sub">{t("Each proposal checked against the SAP dictionary before you decide. A lift near 1 means the rule only restates how common the values are.")}</span>
      </div>
      {redundant ? (
        <p className="nx-tf-sub" data-testid="learned-review-redundant">
          {t("{n, plural, one {# proposal is} other {# proposals are}} already enforced by a check table; approving adds no protection.", { n: redundant })}
        </p>
      ) : null}
      <ExportTable>
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={(p) => p.id}
          rowLabel={(p) => p.field_anchor.column}
          caption={t("Learned rules checked against the SAP dictionary")}
          loading={q.isPending}
          error={q.isError ? { sentence: t("The dictionary review could not be read."), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("No learned rules are waiting.") }}
        />
      </ExportTable>
    </section>
  );
}
