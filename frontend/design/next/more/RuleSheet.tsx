"use client";

import { useQueryClient } from "@tanstack/react-query";
import { t } from "@/lib/v2/i18n";
import { failureText } from "@/lib/v2/errors";
import { setRuleEnabled } from "@/lib/api/v2/rulelib";
import { useRuleList } from "@/lib/v2/sys-queries";
import { Button, Chip, EmptyState, Sheet, Skeleton, useToast } from "../kit";
import type { SheetCtx } from "../shell/SheetHost";
import { useSubmitGuard } from "./states";

/** One rule, large: what it checks, how it did last time, and the switch. */
export function RuleBody({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useRuleList();
  const guard = useSubmitGuard();
  const rule = list.data?.rules.find((r) => r.id === id);
  if (list.isLoading) return <Skeleton lines={4} label={t("Loading the rule")} />;
  if (!rule) return <EmptyState heading={t("This rule was not found")}>{t("It may have been removed.")}</EmptyState>;
  const flip = () =>
    guard.run(async () => {
      try {
        await setRuleEnabled(rule.id, !rule.enabled);
        await qc.invalidateQueries();
        toast({ text: rule.enabled ? t("Rule turned off.") : t("Rule turned on."), tone: "good" });
      } catch (e) {
        toast({ text: failureText(e), tone: "bad" });
      }
    });
  return (
    <div className="nx-form">
      <p>{rule.description ?? t("No description.")}</p>
      <p className="nx-sub">{rule.module} / {rule.category} / {rule.source}</p>
      <p>{rule.last_pass_rate == null ? t("Not run yet.") : t("Passed {n} of records on the last run.", { n: `${Math.round(rule.last_pass_rate * 100)}%` })}</p>
      <Chip tone={rule.enabled ? "good" : "neutral"}>{rule.enabled ? t("On") : t("Off")}</Chip>
      <pre className="nx-notes">{JSON.stringify(rule.conditions ?? {}, null, 2)}</pre>
      <div><Button variant="secondary" loading={guard.busy} loadingLabel={t("Saving")} onClick={flip}>{rule.enabled ? t("Turn off") : t("Turn on")}</Button></div>
    </div>
  );
}

export function RuleSheet({ ctx }: { ctx: SheetCtx }) {
  return (
    <Sheet open onClose={ctx.close} title={t("Rule")} size="large" under={ctx.under}>
      <RuleBody id={ctx.id} />
    </Sheet>
  );
}
