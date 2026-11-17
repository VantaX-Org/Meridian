"use client";

import "./rules.css";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { formatModuleName } from "@/lib/format";
import { useRuleScope } from "@/lib/v2/object-queries";
import { setRuleEnabled } from "@/lib/api/v2/rulelib";
import { Button, FieldChip, SeverityPill, Skeleton, StatTile, Toggle } from "@/ui/kit";
import type { Severity } from "@/ui/kit/SeverityStrip";
import { checkId, compactCount, pct, sevLabel, type RuleArg } from "./format";
import { useAct, useRuleLibrary } from "./queries";

/** The library row's quick view: what the rule is, whether it is on, and the way into its page. */
export function LibraryRuleSheet({ arg }: { arg: RuleArg }) {
  const fx = useFixture();
  const r = useRuleLibrary().data?.rules.find((x) => x.id === arg.id || checkId(x.id) === arg.id);
  const toggle = useAct((on: boolean) => setRuleEnabled(arg.id, on), () => t("Rule switch saved"));
  if (!r) return <Skeleton lines={4} label={t("Loading the rule")} />;
  return (
    <div className="mx-rules-form">
      <FieldChip code={checkId(r.id)} description={r.name} />
      <p>{r.description}</p>
      <p><SeverityPill sev={r.severity as Severity} label={sevLabel(r.severity)} /> <span className="mx-muted">{formatModuleName(r.module)}</span></p>
      <dl className="mx-tiles">
        <StatTile label={t("Pass rate")} value={pct(r.last_pass_rate)} />
        <StatTile label={t("Records failing")} value={r.last_affected_count == null ? t("n/a") : compactCount(r.last_affected_count)} />
      </dl>
      <Toggle label={t("Rule is on")} checked={r.enabled} onChange={(v) => toggle.mutate(v)} />
      <Button variant="primary" href={withFixture(`/r/${encodeURIComponent(checkId(r.id))}`, fx)}>{t("Open the rule")}</Button>
    </div>
  );
}

/** A rule named by its check id from anywhere in the app: its meaning, failing count and the way into its page. */
export function RuleSheet({ arg }: { arg: RuleArg }) {
  const fx = useFixture();
  const id = checkId(arg.id);
  const s = useRuleScope(id).data;
  if (!s) return <Skeleton lines={4} label={t("Loading the rule")} />;
  return (
    <div className="mx-rules-form">
      <FieldChip code={id} description={s.definition.message ?? undefined} />
      {s.authority.why_it_matters ? <p>{s.authority.why_it_matters}</p> : null}
      <dl className="mx-tiles">
        <StatTile label={t("Records failing")} value={compactCount(s.failing_records)} />
      </dl>
      <Button variant="primary" href={withFixture(`/r/${encodeURIComponent(id)}`, fx)}>{t("Open the rule")}</Button>
      <Button variant="ghost" href={withFixture(`/r/${encodeURIComponent(id)}?tab=fix`, fx)}>{t("Open the fix tab")}</Button>
    </div>
  );
}
