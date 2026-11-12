"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { putSemanticType, type SemanticType, type TrustParts } from "@/lib/api/v2/step9";
import { t } from "@/lib/v2/i18n";
import { useV2Session } from "@/lib/v2/hooks";
import { f1, int } from "@/lib/v2/score";
import { s9Keys, useSemanticTypes } from "@/lib/v2/step9-queries";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { Mono, V2Link } from "../parts";

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
const pct = (x: number | null) => (x === null ? "—" : `${f1(100 * x)}%`);

/**
 * Semantic types and trust score of an uploaded run: each column's detected type with its confidence and the share of
 * values that conform, a select to confirm or override it, the dataset's trust score from its four parts, and the rules
 * the confirmed types suggest. Renders nothing for a run that was not profiled, such as an SAP extraction.
 */
export function RunSemantics({ id }: { id: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const fixture = useFixture();
  const q = useSemanticTypes(id);
  const { outcome, pending, run } = useOutcome("run-semantic");
  const d = q.data;
  if (!d?.profiled) return null;
  const can = session.can("upload");
  const set = (column: string, type: SemanticType | "none") =>
    void run(column, async () => {
      await putSemanticType(id, column, type);
      await qc.invalidateQueries({ queryKey: s9Keys.semantic(fixture, id) });
      return { tone: "ok", title: t("Type of {column} saved", { column }), detail: t("Suggested rules follow the confirmed types.") };
    });
  const parts = Object.keys(PART_LABEL) as (keyof TrustParts)[];
  return (
    <section className="m2-sec" aria-label={t("Column types and trust")} data-testid="run-semantics">
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Column types and trust")}</h2>
        <span className="m2-sub">
          {t("Detected from {n} sampled rows of the uploaded file. Only shares are kept, never a value.", { n: int(d.rows_sampled ?? 0) })}
        </span>
      </div>
      <div className="m2-frame" tabIndex={0}>
        <table className="m2-tbl" aria-label={t("Trust score")}>
          <thead>
            <tr>
              <th scope="col">{t("Part")}</th>
              <th scope="col" className="m2-r">{t("Weight")}</th>
              <th scope="col" className="m2-r">{t("Score")}</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((k) => (
              <tr key={k}>
                <th scope="row">{PART_LABEL[k]}</th>
                <td className="m2-r">{int(100 * d.trust.weights[k])}%</td>
                <td className="m2-r">{d.trust.parts[k] === null ? "—" : f1(d.trust.parts[k] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t("Trust score")}</th>
              <td />
              <td className="m2-r" data-testid="trust-score">{d.trust.score === null ? "—" : f1(d.trust.score)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="m2-prov">{t("A missing part gives its weight to the others.")}</p>
      <div className="m2-frame" tabIndex={0}>
        <table className="m2-tbl" aria-label={t("Column types")}>
          <thead>
            <tr>
              <th scope="col">{t("Column")}</th>
              <th scope="col">{t("Detected")}</th>
              <th scope="col" className="m2-r">{t("Confidence")}</th>
              <th scope="col" className="m2-r">{t("Filled")}</th>
              <th scope="col" className="m2-r">{t("Conforms")}</th>
              <th scope="col">{t("Type in force")}</th>
            </tr>
          </thead>
          <tbody>
            {d.columns.map((c) => (
              <tr key={c.column}>
                <th scope="row"><Mono>{c.column}</Mono></th>
                <td>{c.detected ? TYPE_LABEL[c.detected] : t("No type")}</td>
                <td className="m2-r">{c.detected ? pct(c.confidence) : "—"}</td>
                <td className="m2-r">{pct(c.filled)}</td>
                <td className="m2-r">{pct(c.conformance)}</td>
                <td>
                  <select
                    aria-label={t("Type of {column}", { column: c.column })}
                    value={c.confirmed ? (c.type ?? "none") : ""}
                    disabled={!can || pending !== null}
                    onChange={(e) => set(c.column, e.target.value as SemanticType | "none")}
                  >
                    <option value="" disabled>
                      {c.type ? t("{type}, not confirmed", { type: TYPE_LABEL[c.type] }) : t("No type, not confirmed")}
                    </option>
                    {d.types.map((ty) => (
                      <option key={ty} value={ty}>{TYPE_LABEL[ty]}</option>
                    ))}
                    <option value="none">{t("No type")}</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!can ? <p className="m2-prov">{t("Confirming a type needs the upload permission.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <h3 className="m2-h2">{t("Rules suggested from confirmed types")}</h3>
      {d.suggested_rules.length === 0 ? (
        <p className="m2-prov">{t("Confirm a column's type to see the rules it suggests.")}</p>
      ) : (
        <div className="m2-frame" tabIndex={0}>
          <table className="m2-tbl" aria-label={t("Suggested rules")}>
            <thead>
              <tr>
                <th scope="col">{t("Column")}</th>
                <th scope="col">{t("Rule")}</th>
                <th scope="col">{t("Check")}</th>
              </tr>
            </thead>
            <tbody>
              {d.suggested_rules.map((r) => (
                <tr key={`${r.column}-${r.message}`}>
                  <th scope="row"><Mono>{r.column}</Mono></th>
                  <td>{r.message}</td>
                  <td><Mono>{r.check_class}</Mono></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.suggested_rules.length ? (
        <p className="m2-prov">
          <V2Link href="/rules">{t("Open rules to add them")}</V2Link>
        </p>
      ) : null}
    </section>
  );
}
