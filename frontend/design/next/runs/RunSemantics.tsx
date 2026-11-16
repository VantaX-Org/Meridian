"use client";

/**
 * Semantic types and trust score of an uploaded run (GET/PUT /versions/{id}/semantic-types): each column's detected type,
 * a select to confirm or override it, the trust score from its four parts, and the rules the confirmed types suggest.
 * Renders nothing for a run that was not profiled, such as an SAP extraction.
 */
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Code, ErrorState, useToast } from "../kit";
import { useFixture } from "@/lib/api/v2/fixture";
import { putSemanticType, type SemanticType, type TrustParts } from "@/lib/api/v2/step9";
import { t } from "@/lib/v2/i18n";
import { useV2Session } from "@/lib/v2/hooks";
import { f1, int } from "@/lib/v2/score";
import { s9Keys, useSemanticTypes } from "@/lib/v2/step9-queries";
import "./runs.css";

const TYPE_LABEL: Record<SemanticType, string> = {
  iban: t("IBAN"),
  eu_vat: t("EU VAT number"),
  email: t("Email address"),
  url: t("Web address"),
  date: t("Date"),
  phone: t("Phone number"),
  postcode: t("Postal code"),
  country: t("Country code"),
  currency_amount: t("Amount"),
  person_name: t("Person name"),
};
const PART_LABEL: Record<keyof TrustParts, string> = {
  dqs: t("Data quality score"),
  conformance: t("Type conformance"),
  freshness: t("Freshness"),
  completeness: t("Completeness"),
};
const pct = (x: number | null) => (x === null ? "" : `${f1(100 * x)}%`);

export function RunSemantics({ id }: { id: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const fixture = useFixture();
  const toast = useToast();
  const q = useSemanticTypes(id);
  const [busy, setBusy] = useState<string | null>(null);
  if (q.isError) return <ErrorState error={q.error} fallback={t("The column types could not be loaded.")} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d?.profiled) return null;
  const can = session.can("upload");
  const set = async (column: string, type: SemanticType | "none") => {
    setBusy(column);
    try {
      await putSemanticType(id, column, type);
      await qc.invalidateQueries({ queryKey: s9Keys.semantic(fixture, id) });
      toast({ text: `${t("Type of {column} saved", { column })}. ${t("Suggested rules follow the confirmed types.")}`, tone: "good" });
    } catch {
      toast({ text: t("The type could not be saved."), tone: "bad" });
    } finally {
      setBusy(null);
    }
  };
  const parts = Object.keys(PART_LABEL) as (keyof TrustParts)[];
  return (
    <section className="nx-card" aria-label={t("Column types and trust")} data-testid="run-semantics">
      <h3 className="nx-rn-h3">{t("Column types and trust")}</h3>
      <p className="nx-rn-sub">{t("Detected from {n} sampled rows of the uploaded file. Only shares are kept, never a value.", { n: int(d.rows_sampled ?? 0) })}</p>
      <table className="nx-rn-table">
        <caption className="nx-rn-sr">{t("Trust score")}</caption>
        <thead><tr><th scope="col">{t("Part")}</th><th scope="col">{t("Weight")}</th><th scope="col">{t("Score")}</th></tr></thead>
        <tbody>
          {parts.map((k) => (
            <tr key={k}>
              <th scope="row">{PART_LABEL[k]}</th>
              <td>{int(100 * d.trust.weights[k])}%</td>
              <td>{d.trust.parts[k] == null ? t("Not measured") : f1(d.trust.parts[k] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><th scope="row">{t("Trust score")}</th><td /><td data-testid="trust-score">{d.trust.score === null ? t("Not measured") : f1(d.trust.score)}</td></tr>
        </tfoot>
      </table>
      <p className="nx-rn-sub">{t("A missing part gives its weight to the others.")}</p>
      <table className="nx-rn-table">
        <caption className="nx-rn-sr">{t("Column types")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Column")}</th><th scope="col">{t("Detected")}</th><th scope="col">{t("Confidence")}</th>
            <th scope="col">{t("Filled")}</th><th scope="col">{t("Conforms")}</th><th scope="col">{t("Type in force")}</th>
          </tr>
        </thead>
        <tbody>
          {d.columns.map((c) => (
            <tr key={c.column}>
              <th scope="row"><Code code={c.column} /></th>
              <td>{c.detected ? TYPE_LABEL[c.detected] : t("No type")}</td>
              <td>{c.detected ? pct(c.confidence) : ""}</td>
              <td>{pct(c.filled)}</td>
              <td>{pct(c.conformance)}</td>
              <td>
                <select
                  className="nx-input"
                  aria-label={t("Type of {column}", { column: c.column })}
                  value={c.confirmed ? (c.type ?? "none") : ""}
                  disabled={!can || busy !== null}
                  onChange={(e) => void set(c.column, e.target.value as SemanticType | "none")}
                >
                  <option value="" disabled>{c.type ? t("{type}, not confirmed", { type: TYPE_LABEL[c.type] }) : t("No type, not confirmed")}</option>
                  {d.types.map((ty) => <option key={ty} value={ty}>{TYPE_LABEL[ty]}</option>)}
                  <option value="none">{t("No type")}</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!can ? <p className="nx-rn-sub">{t("Confirming a type needs the upload permission.")}</p> : null}
      <h3 className="nx-rn-h3">{t("Rules suggested from confirmed types")}</h3>
      {d.suggested_rules.length === 0 ? (
        <p className="nx-rn-note">{t("Confirm a column's type to see the rules it suggests.")}</p>
      ) : (
        <>
          <table className="nx-rn-table">
            <caption className="nx-rn-sr">{t("Suggested rules")}</caption>
            <thead><tr><th scope="col">{t("Column")}</th><th scope="col">{t("Rule")}</th><th scope="col">{t("Check")}</th></tr></thead>
            <tbody>
              {d.suggested_rules.map((r) => (
                <tr key={`${r.column}-${r.message}`}>
                  <th scope="row"><Code code={r.column} /></th>
                  <td>{r.message}</td>
                  <td><Code code={r.check_class} text={r.message} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p><Link className="nx-rn-link" href="/more/rules">{t("Open rules to add them")}</Link></p>
        </>
      )}
    </section>
  );
}
