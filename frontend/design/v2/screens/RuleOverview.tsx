"use client";

import { useState } from "react";
import { int } from "@/lib/v2/score";
import { useRuleFailuresBy } from "@/lib/v2/object-queries";
import { t as tr } from "@/lib/v2/i18n";
import { RuleAuthority, RuleHistory, type RuleView } from "../inspector/rule";
import { Mono } from "../parts";
import { LedgerSlot } from "./object/LedgerSlot";

/**
 * The rule canvas Overview: why the rule exists, its trend over runs, and the failing records of its newest run counted
 * by the key parts the records carry (plant, company code...). A count is a button: it narrows the sample ledger below
 * to those records. The groups come from GET /rules/{id}/failures-by; a rule whose records key on one field has none.
 */
export function RuleOverview({ view }: { view: RuleView }) {
  const by = useRuleFailuresBy(view.id).data;
  const [part, setPart] = useState<string | null>(null);
  const mod = view.scope.module ?? view.scope.objects[0]?.module;
  return (
    <>
      <div className="m2-rcols">
        <div>
          <RuleAuthority view={view} />
        </div>
        <div>
          <RuleHistory view={view} limit={30} />
        </div>
      </div>
      <section className="m2-sec" aria-label={tr("Failing records")}>
        <div className="m2-sechead"><h2 className="m2-h2">{tr("Failing records")}</h2></div>
        {by?.groups.map((g) => (
          <div key={g.field} className="m2-rgroup" data-testid={`rule-by-${g.field}`}>
            <h3 className="m2-h3">{g.field === "WERKS" ? tr("Plant") : <Mono>{g.field}</Mono>}</h3>
            <div className="m2-chips" role="group" aria-label={g.field}>
              <button type="button" className="m2-chip" aria-pressed={part === null} onClick={() => setPart(null)}>{tr("All")}</button>
              {g.values.map((v) => (
                <button key={v.part} type="button" className="m2-chip" aria-pressed={part === v.part} onClick={() => setPart(part === v.part ? null : v.part)}>
                  <Mono>{v.value}</Mono> <span className="m2-meta">{int(v.records)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <LedgerSlot label={view.id} scope={{ module: mod, filters: { check_id: view.id, part: part ?? undefined } }} />
      </section>
    </>
  );
}
