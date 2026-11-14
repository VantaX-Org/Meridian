"use client";

/**
 * Why the score is what it is: the failing rules of the shown run, worst first, each with its code and name, its field
 * and the field's words, how many records fail. "Why" opens the rule sheet. One Aletheia sentence and its evidence close it.
 */
import { useMemo } from "react";
import { Button, EmptyState, ErrorState, SegBar, Skeleton } from "@/design/next/kit";
import { useSheets } from "@/design/next/shell/SheetHost";
import { Coded, Mono } from "@/design/v2/parts";
import { SeverityMark } from "@/design/v2/marks";
import { useObjectRules } from "@/lib/v2/queries";
import { describeField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { useFindings, originSentence } from "./evidence";
import { dqsOf, score } from "./model";
import { compactCount, Denied, isDenied, Trunc } from "./edge";
import type { ObjectRun } from "./useObjectRun";

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const SEV = (s: string): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : t("Info"));

export function WhySection({ o, limit }: { o: ObjectRun; limit?: number }) {
  const sheets = useSheets();
  const rules = useObjectRules(o.module, o.runId);
  const found = useFindings(o.module);
  const rows = useMemo(
    () => (rules.data ?? []).filter((r) => r.affected_count > 0).sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || b.affected_count - a.affected_count),
    [rules.data],
  );
  const shown = limit ? rows.slice(0, limit) : rows;
  const now = dqsOf(o.run, o.module);
  const sentence = found.data ? originSentence(found.data.findings) : null;
  return (
    <section className="nx-why" aria-labelledby="nx-why-h" data-testid="why-section">
      <h2 id="nx-why-h" className="nx-sec-h">{now !== null ? t("Why the score is {score}", { score: score(now) }) : t("Why the score is what it is")}</h2>
      {rules.isLoading ? <Skeleton lines={4} label={t("Loading the rules")} /> : null}
      {rules.isError && isDenied(rules.error) ? <Denied what={t("the rules of this object")} /> : null}
      {rules.isError && !isDenied(rules.error) ? <ErrorState sentence={t("The rules could not be loaded.")} error={rules.error} onRetry={() => void rules.refetch()} /> : null}
      {rules.data && rows.length === 0 ? <EmptyState heading={t("No rule fails in this run")}>{t("Every rule that was measured passed for every record.")}</EmptyState> : null}
      {rows.length ? (
        <SegBar label={t("Records failing, by rule")} format={compactCount} segments={[...rows.slice(0, 2).map((r) => ({ label: r.check_id, value: r.affected_count })), { label: t("Other rules"), value: rows.slice(2).reduce((n, r) => n + r.affected_count, 0) }]} />
      ) : null}
      {shown.length ? (
        <table className="nx-table nx-why-table">
          <caption className="nx-sr">{t("Failing rules of {object}", { object: o.label })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Rule")}</th>
              <th scope="col">{t("Severity")}</th>
              <th scope="col" className="nx-r">{t("Records")}</th>
              <th scope="col"><span className="nx-sr">{t("Open")}</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.check_id}>
                <td>
                  <span className="nx-num">{i + 1}</span>{" "}
                  <Trunc text={`${r.check_id} ${r.name}`}><Coded code={r.check_id} text={r.name} /></Trunc>
                  {r.field ? <div className="nx-muted"><Coded code={r.field} text={r.field_description ?? describeField(r.field)} first /></div> : null}
                </td>
                <td><SeverityMark severity={r.severity === "info" ? "low" : r.severity} /> {SEV(r.severity)}</td>
                <td className="nx-r nx-num"><span title={int(r.affected_count)}>{t("{n} records", { n: compactCount(r.affected_count) })}</span></td>
                <td>
                  <Button variant="quiet" size={32} onClick={() => sheets.open({ kind: "rule", id: r.check_id })} aria-label={t("Why {rule} fails", { rule: r.name })}>{t("Why")}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {limit && rows.length > limit ? <p className="nx-muted">{t("{n} more rules fail. Open Why for all of them.", { n: rows.length - limit })}</p> : null}
      {sentence ? (
        <p className="nx-aletheia" data-testid="why-aletheia">
          <span className="nx-aletheia-by">{t("Aletheia")}</span> {sentence}{" "}
          <Button variant="quiet" size={32} onClick={() => sheets.open({ kind: "evidence", id: o.module })}>{t("Evidence ({n})", { n: found.data?.findings.length ?? 0 })}</Button>
        </p>
      ) : (
        <p className="nx-muted"><Mono>{t("Aletheia")}</Mono> {found.isLoading ? t("is reading the run.") : t("has no evidence for this yet.")}</p>
      )}
    </section>
  );
}
