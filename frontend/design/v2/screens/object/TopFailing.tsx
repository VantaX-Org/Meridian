"use client";

import { Sparkline } from "../../charts/Sparkline";
import { SeverityMark } from "../../marks";
import { V2Link } from "../../parts";
import { useOpenItem } from "@/lib/v2/hooks";
import { useRuleHistory } from "@/lib/v2/object-queries";
import { useObjectRules } from "@/lib/v2/queries";
import { rankRules } from "@/lib/v2/rules-pivot";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";

const N = 12;

/** One rule's failing rows over its last runs, read from the rule's own history. */
function Trend({ id }: { id: string }) {
  const runs = useRuleHistory(id).data;
  const vals = (runs ?? []).slice(-N).map((r) => r.affected_count);
  if (vals.length < 2) return null;
  return <Sparkline values={vals} width={96} height={20} domain={[0, Math.max(...vals, 1)]} label={t("Failing rows over the last {n} runs", { n: String(vals.length) })} testId={`top-trend-${id}`} />;
}

/** The object's worst rules by value at risk, each with its run-by-run trend. */
export function TopFailing({ module, run }: { module: string; run: string | null }) {
  const rows = useObjectRules(module, run).data;
  const { hrefFor } = useOpenItem();
  const top = rankRules((rows ?? []).filter((r) => r.affected_count > 0)).slice(0, 5);
  if (!top.length) return null;
  return (
    <section className="m2-sec" data-testid="top-failing">
      <h2 className="m2-h2">{t("Top failing rules")}</h2>
      <table className="m2-tbl">
        <thead>
          <tr>
            <th scope="col">{t("Rule")}</th>
            <th scope="col" className="m2-r">{t("Failing rows")}</th>
            <th scope="col">{t("Trend")}</th>
          </tr>
        </thead>
        <tbody>
          {top.map((r) => (
            <tr key={r.check_id}>
              <td>
                <SeverityMark severity={r.severity} />{" "}
                <V2Link href={hrefFor({ kind: "rule", id: r.check_id })} className="m2-mono">{r.check_id}</V2Link> {r.name}
              </td>
              <td className="m2-r">{int(r.affected_count)}</td>
              <td><Trend id={r.check_id} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
