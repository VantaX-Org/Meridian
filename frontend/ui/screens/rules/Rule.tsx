"use client";

import { useSearchParams } from "next/navigation";
import "./rules.css";
import { useState } from "react";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useRuleHistory, useRuleScope } from "@/lib/v2/object-queries";
import { Button, DetailPanel, ErrorState, PageHeader, Skeleton, useAletheia, useAletheiaScope } from "@/ui/kit";
import { checkId, compactCount, pct, sevLabel } from "./format";
import { RuleFix } from "./RuleFix";
import { HistoryTab, OverviewTab, RecordsTab, WhyTab } from "./RuleTabs";

/** One rule: what it checks, why, who fails it, and every way to change it. Journey J5 step two and three. */
export function Rule({ id: raw }: { id: string }) {
  useInterfaceLang();
  const id = checkId(decodeURIComponent(raw));
  const fx = useFixture();
  const chat = useAletheia();
  const [tab, setTab] = useState(useSearchParams().get("tab") ?? "overview");
  const scope = useRuleScope(id);
  const hist = useRuleHistory(id).data;
  const href = (p: string) => withFixture(p, fx);
  const s = scope.data;

  useAletheiaScope({
    key: `rule/${id}`,
    label: t("Asking about {rule}", { rule: id }),
    suggestions: [t("Why does this rule fail?"), t("Is this rule too noisy?")],
    answer: (prompt) => {
      const why = prompt === t("Why does this rule fail?");
      const last = hist?.[0];
      return {
        text: why
          ? (s?.authority.why_it_matters ?? t("{rule} checks {message}", { rule: id, message: s?.definition.message ?? id }))
          : t("{rule} fails {n} records in its latest run, a pass rate of {p}.", { rule: id, n: compactCount(last?.affected_count ?? 0), p: pct(last?.pass_rate) }),
        evidence: s ? [s.definition.message ?? id, t("{n} records fail now", { n: compactCount(s.failing_records) })] : [],
        actions: [{ id: "fix", label: t("Open the fix tab"), onClick: () => { setTab("fix"); chat.setOpen(false); } }],
      };
    },
  });

  if (scope.isLoading) return <Skeleton lines={8} label={t("Loading the rule")} />;
  if (scope.isError || !s) return <ErrorState heading={t("The rule could not be loaded")} />;

  return (
    <>
      <PageHeader
        title={s.name ?? id}
        context={<><code className="mx-code">{id}</code> {s.module ? `, ${s.module}` : ""}</>}
        actions={<>
          <Button variant="primary" href={href(`/rules/dry-run?rule=${encodeURIComponent(id)}${s.module ? `&module=${encodeURIComponent(s.module)}` : ""}`)}>{t("Try a change")}</Button>
          <Button variant="secondary" href={href("/rules")}>{t("Back to the library")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      <DetailPanel
        idBase="mx-rule-tabs"
        label={t("Rule")}
        tabsLabel={t("Rule detail")}
        header={<><span className="mx-sev" data-sev={s.definition.severity}><i className="mx-dot" aria-hidden="true" />{sevLabel(s.definition.severity)}</span> <h2 className="mx-card-t">{s.name ?? id}</h2></>}
        tabs={[{ id: "overview", label: t("Overview") }, { id: "fix", label: t("Fix") }, { id: "why", label: t("Why") }, { id: "records", label: t("Records"), badge: compactCount(s.failing_records) }, { id: "history", label: t("History") }]}
        value={tab}
        onChange={setTab}
      >
        {tab === "overview" ? <OverviewTab id={id} scope={s} /> : null}
        {tab === "fix" ? <RuleFix id={id} scope={s} /> : null}
        {tab === "why" ? <WhyTab id={id} scope={s} /> : null}
        {tab === "records" ? <RecordsTab id={id} /> : null}
        {tab === "history" ? <HistoryTab id={id} /> : null}
      </DetailPanel>
    </>
  );
}
