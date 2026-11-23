"use client";

import { useMemo } from "react";
import { useConfigImpact } from "@/lib/v2/object-queries";
import { useObjectRules } from "@/lib/v2/queries";
import { COLUMN_TITLES, buildLineage, type LineageNode, type NodeKind } from "@/lib/v2/lineage-graph";
import { t } from "@/lib/v2/i18n";
import { Card, EmptyState, ErrorState, FieldChip, Skeleton } from "@/ui/kit";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { Lead } from "./Lead";
import { useTabChat } from "./TabFrame";

const KINDS: NodeKind[] = ["table", "field", "rule", "feature"];

/** Source table, field, rule and S/4 feature the rules touch, as four columns. */
// ponytail: columns of lists, not a drawn graph; edges are shown as the "Leads to" line on each node.
export function Lineage({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const rules = useObjectRules(module, o.runId);
  const impact = useConfigImpact(o.runId);
  const g = useMemo(() => buildLineage(rules.data ?? [], impact.data ?? [], module), [rules.data, impact.data, module]);
  useTabChat(system, module, "lineage", o.label, [t("Which S/4 features do these rules block?")], () => ({
    text: t("{n} nodes are shown, {h} more are hidden.", { n: g.nodes.length, h: g.hidden }),
    evidence: g.nodes.filter((n) => n.kind === "feature").slice(0, 3).map((n) => n.label),
  }));
  if (rules.isLoading || o.runsLoading) return <Skeleton lines={6} label={t("Loading lineage")} />;
  if (rules.isError) return <ErrorState heading={t("Lineage could not be loaded.")} retryLabel={t("Try again")} onRetry={() => void rules.refetch()} />;
  if (!g.nodes.length) return <EmptyState heading={t("No rule with a table field exists for this object, so there is no lineage to show.")} body={t("Add a rule on a table field to this object to see its lineage.")} />;
  const next = (n: LineageNode) => g.edges.filter((e) => e.from === n.id).map((e) => g.nodes.find((m) => m.id === e.to)?.label).filter(Boolean).join(", ");
  return (
    <div className="mx-col">
    <Lead tab="lineage" title={t("Lineage nodes")} sentence={t("{n} nodes are shown, {h} more are hidden.", { n: g.nodes.length, h: g.hidden })}
      bars={KINDS.map((k) => ({ id: k, label: COLUMN_TITLES[k], value: g.nodes.filter((n) => n.kind === k).length }))} />
    <div className="mx-split">
      {KINDS.map((k) => (
        <Card key={k} title={COLUMN_TITLES[k]}>
          <ul className="mx-col">
            {g.nodes.filter((n) => n.kind === k).map((n) => (
              <li key={n.id}>
                <FieldChip code={n.label} />
                {next(n) ? <span className="mx-muted">{" "}{t("Leads to")}{" "}{next(n)}</span> : null}
                {n.facts.map(([a, b]) => <div key={a} className="mx-muted">{a}{": "}{b}</div>)}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
    </div>
  );
}
