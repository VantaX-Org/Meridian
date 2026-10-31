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

/** The object's worst rules by value at risk: the message, the rule id and SAP field with its business label, and a bar. */
export function TopFailing({ module, run }: { module: string; run: string | null }) {
  const rows = useObjectRules(module, run).data;
  const { hrefFor } = useOpenItem();
  const top = rankRules((rows ?? []).filter((r) => r.affected_count > 0)).slice(0, 5);
  if (!top.length) return null;
  const max = Math.max(1, ...top.map((r) => r.affected_count));
  return (
    <section className="m2-cc-card" aria-label={t("Top failing rules")} data-testid="top-failing">
      <h3>{t("Top failing rules")}</h3>
      <ol className="m2-cc-bars">
        {top.map((r) => (
          <li key={r.check_id}>
            <V2Link href={hrefFor({ kind: "rule", id: r.check_id })}>
              <span className="m2-cc-bmsg"><SeverityMark severity={r.severity} /> {r.name}</span>
              <span className="m2-cc-bmeta">
                <span className="m2-mono">{r.check_id}</span>
                {r.field ? <span><span className="m2-mono">{r.field}</span>{r.field_description ? ` ${r.field_description}` : ""}</span> : null}
                <Trend id={r.check_id} />
                <span>{t("{n} failing", { n: int(r.affected_count) })}</span>
              </span>
              <span className="m2-cc-bar" aria-hidden="true">
                <span style={{ width: `${(r.affected_count / max) * 100}%` }} />
              </span>
            </V2Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
