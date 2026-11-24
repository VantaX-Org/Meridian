"use client";

/** The side panel for the rule open in the grid (`rules.open` in the URL). Tabs: Overview, Fix, Why. */
import { useState } from "react";
import { describeField } from "@/lib/v2/sap-fields";
import { t } from "@/lib/v2/i18n";
import { DASH, int } from "@/lib/v2/score";
import { Button, DetailPanel, FieldChip, SeverityPill, StatTile } from "@/ui/kit";
import { compactCount } from "./format";
import { sevLabel, type RuleView } from "./RuleGrid";
import type { ObjectData } from "./useObjectData";

export function RulePanel({ rule, siblings, d, side, canAct, fixHref, ruleHref, onOpen, onClose }: {
  rule: RuleView; siblings: RuleView[]; d: ObjectData; side: boolean; canAct: boolean;
  fixHref: (seg: "proposed" | "manual", rule: string) => string; ruleHref: string; onOpen: (id: string) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const i = siblings.findIndex((x) => x.check_id === rule.check_id);
  const step = (n: number) => { const x = siblings[i + n]; if (x) onOpen(x.check_id); };
  const g = d.groups.find((x) => x.check_id === rule.check_id);
  const prop = g ? Math.min(g.proposed, g.open) : 0;
  const desc = rule.field_description ?? (rule.field ? describeField(rule.field) ?? "" : "");
  return (
    <DetailPanel
      idBase="mx-rule"
      label={t("Selected rule")}
      tabsLabel={t("Rule detail")}
      side={side}
      onClose={onClose}
      onPrev={i > 0 ? () => step(-1) : undefined}
      onNext={i >= 0 && i < siblings.length - 1 ? () => step(1) : undefined}
      header={<><SeverityPill sev={rule.severity} label={sevLabel(rule.severity)} /> <h2 className="mx-card-t"><code className="mx-code">{rule.check_id}</code> {rule.name}</h2></>}
      tabs={[{ id: "overview", label: t("Overview") }, { id: "fix", label: t("Fix"), badge: g ? compactCount(g.open) : undefined }, { id: "why", label: t("Why") }]}
      value={tab}
      onChange={setTab}
    >
      {tab === "overview" ? (
        <dl className="mx-tiles">
          <StatTile label={t("Failing records")} value={int(rule.affected_count)} note={t("of {n} checked", { n: compactCount(rule.total_count) })} />
          <StatTile label={t("Pass rate")} value={rule.pass_rate === null ? DASH : `${Math.round(rule.pass_rate)}%`} bar={rule.pass_rate ?? 0} barTone="pass" />
          <StatTile label={t("Field")} value={rule.field ? <FieldChip code={rule.field} description={desc} /> : DASH} note={rule.field && !desc ? t("Description not in the API") : undefined} />
          <StatTile label={t("Sample failing records")} value={DASH} note={t("Not in the API yet")} />
        </dl>
      ) : null}
      {tab === "fix" ? (
        g ? (
          <>
            <dl className="mx-tiles">
              <StatTile label={t("Fix proposed")} value={compactCount(prop)} bar={g.open ? (100 * prop) / g.open : 0} barTone="pass" />
              <StatTile label={t("Needs a person")} value={compactCount(g.open - prop)} bar={g.open ? (100 * (g.open - prop)) / g.open : 0} barTone="data" />
            </dl>
            {canAct ? (
              <div className="mx-links">
                <Button variant="primary" href={fixHref("proposed", rule.check_id)}>{t("Review fixes")}</Button>
                <Button variant="secondary" href={fixHref("manual", rule.check_id)}>{t("Assign records")}</Button>
              </div>
            ) : <p className="mx-muted">{t("This is not the current run, so actions are off. Open the current run to act.")}</p>}
          </>
        ) : <p>{t("No work is open for this rule yet.")}</p>
      ) : null}
      {tab === "why" ? (
        <>
          <p>{rule.why || t("The rule sheet shows what it checks and which records fail.")}</p>
          <div className="mx-links"><Button variant="primary" href={ruleHref}>{t("Open the rule")}</Button></div>
        </>
      ) : null}
    </DetailPanel>
  );
}
