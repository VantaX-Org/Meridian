"use client";

import { useSearchParams } from "next/navigation";
import { RuleActions, RuleAuthority, RuleBlocks, RuleContract, RuleDefinition, RuleFacts, RuleHistory, RuleLineage, RuleProve, RuleScopeSection, RuleVersions, SectionLevel, ruleStatLine, useRule } from "../inspector/rule";
import { EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";
import { LedgerSlot } from "./object/LedgerSlot";
import { t as tr } from "@/lib/v2/i18n";

type TabKey = "definition" | "failing" | "prove" | "impact" | "history";
const TABS: { key: TabKey; label: string }[] = [
  { key: "definition", get label() { return tr("Definition"); } },
  { key: "failing", get label() { return tr("Failing records"); } },
  { key: "prove", get label() { return tr("Prove in SAP"); } },
  { key: "impact", get label() { return tr("Impact"); } },
  { key: "history", get label() { return tr("History"); } },
];

function tabOf(value: string | null): TabKey {
  return TABS.some((t) => t.key === value) ? (value as TabKey) : "definition";
}

/**
 * The rule canvas, /r/{check_id}: one rule across systems. The header is the rule's own statistics in a line (no
 * ruler: a rule has no score of its own), then Definition, Failing records (the ledger scoped to the rule), Prove in
 * SAP (the SE16 selection that reproduces the count), Impact and History. The content is the inspector's, laid out as
 * a canvas.
 */
export function RuleCanvas({ id }: { id: string }) {
  const params = useSearchParams();
  const tab = tabOf(params.get("tab"));
  const state = useRule(id);

  if (state.status === "loading") {
    return (
      <div aria-busy="true" data-testid="rule-canvas-loading">
        <PageTitle>
          <Mono>{id}</Mono>
        </PageTitle>
        <p className="m2-statusline"><Skeleton width={420} height={14} /></p>
        <div className="m2-sec"><Skeleton width="100%" height={160} /></div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <PageTitle>
          <Mono>{id}</Mono>
        </PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={state.refetch}>{tr("This rule could not be read. It may not exist in this tenant, or the API may be unreachable.")}</ErrorFrame>
          <div style={{ marginTop: "var(--m2-s4)" }}>
            <EmptyFrame action={<V2Link href="/rules" className="m2-btn">{tr("Open the rules library")}</V2Link>}>
              {tr("The rules library lists every rule of the tenant; search it by code or name.")}
            </EmptyFrame>
          </div>
        </div>
      </>
    );
  }

  const v = state.view;
  const name = v.scope.name ?? v.scope.definition.message ?? null;
  const href = (key: TabKey) => {
    const next = new URLSearchParams(params.toString());
    if (key === "definition") next.delete("tab");
    else next.set("tab", key);
    next.delete("open");
    const qs = next.toString();
    return `/r/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`;
  };
  return (
    <>
      <PageTitle sub={name}>
        <Mono>{id}</Mono>
      </PageTitle>
      <p className="m2-statusline" data-testid="rule-stat-line">
        {ruleStatLine(v).map((t) => (
          <span key={t}>{t}</span>
        ))}
      </p>
      <p className="m2-prov">
        <V2Link href="/rules">{tr("All rules")}</V2Link>
      </p>
      <nav className="m2-tabs" aria-label={tr("Views of {id}", { id })}>
        {TABS.map((t) => (
          <V2Link key={t.key} href={href(t.key)} className="m2-tab" aria-current={tab === t.key ? "page" : undefined}>
            {t.label}
          </V2Link>
        ))}
      </nav>
      <div className="m2-tabpanel">
        <SectionLevel level="h2">
          {tab === "definition" ? (
            <div className="m2-rcols">
              <div>
                <RuleDefinition view={v} />
                <RuleAuthority view={v} />
                <RuleVersions view={v} />
              </div>
              <div>
                <RuleScopeSection view={v} />
                <RuleContract view={v} />
                <RuleActions view={v} canvas />
              </div>
            </div>
          ) : tab === "failing" ? (
            <LedgerSlot label={id} scope={{ module: v.scope.module ?? v.scope.objects[0]?.module, filters: { check_id: id } }} />
          ) : tab === "prove" ? (
            <RuleProve view={v} />
          ) : tab === "impact" ? (
            <div className="m2-rcols">
              <div>
                <RuleFacts view={v} />
              </div>
              <div>
                <RuleBlocks view={v} />
                <RuleLineage view={v} />
              </div>
            </div>
          ) : (
            <RuleHistory view={v} limit={30} />
          )}
        </SectionLevel>
      </div>
    </>
  );
}
