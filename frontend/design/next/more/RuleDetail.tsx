"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { t } from "@/lib/v2/i18n";
import { int, f1 } from "@/lib/v2/score";
import { moneyCompactText } from "@/lib/v2/labels";
import { Button, Code, EmptyState, ErrorState, NxLink, Skeleton, StatCard, Tabs } from "../kit";
import {
  RuleAuthority,
  RuleBlocks,
  RuleContract,
  RuleDefinition,
  RuleFacts,
  RuleHistory,
  RuleLineage,
  RuleScopeSection,
  RuleVersions,
  useRule,
  type RuleView,
} from "../shell/inspector/rule";
import { RuleProve } from "../shell/inspector/rule-prove";
import { BlastRadius, FailingRecords, RuleActionsNative, RuleFailuresBy, RuleRootCause } from "./rule-detail-parts";
import "./rule-detail.css";

type TabKey = "overview" | "blast" | "definition" | "failing" | "prove" | "impact" | "history";
const KEYS: TabKey[] = ["overview", "blast", "definition", "failing", "prove", "impact", "history"];

const LABEL: Record<TabKey, () => string> = {
  overview: () => t("Overview"),
  blast: () => t("Blast radius"),
  definition: () => t("Definition"),
  failing: () => t("Failing records"),
  prove: () => t("Prove in SAP"),
  impact: () => t("Impact"),
  history: () => t("History"),
};
const HINT: Record<TabKey, () => string> = {
  overview: () => t("Where the failures are, who set the values, and why the rule exists."),
  blast: () => t("What this rule's failures reach."),
  definition: () => t("How the rule is written, where it comes from and what you can do to it."),
  failing: () => t("The records to fix, one per row."),
  prove: () => t("Reproduce the failing count in SAP yourself."),
  impact: () => t("Facts about the rule's effect and what it depends on."),
  history: () => t("How the rule and its failures changed over runs."),
};
const tabOf = (v: string | null): TabKey => (KEYS.includes(v as TabKey) ? (v as TabKey) : "overview");

const SEV_WORD: Record<string, () => string> = {
  critical: () => t("Critical"),
  high: () => t("High"),
  medium: () => t("Medium"),
  low: () => t("Low"),
  info: () => t("Info"),
};
const DIM_WORD = (d: string): string => d.charAt(0).toUpperCase() + d.slice(1);
const pct2 = (n: number): string => `${(Math.round(n * 100) / 100).toFixed(2)}%`;

/** The rule's statistics as short phrases, as the v2 canvas shows them under the banner. */
function ruleStatLine(v: RuleView): string[] {
  const s = v.scope;
  const out: string[] = [];
  if (v.severity) out.push(SEV_WORD[v.severity]?.() ?? v.severity);
  if (s.definition.dimension) out.push(DIM_WORD(s.definition.dimension));
  out.push(t("{failing_records} failing across {objectsCount} {objectsCount, plural, one {object} other {objects}}", { failing_records: int(s.failing_records), objectsCount: s.objects.length }));
  if (v.failingPct != null) out.push(t("{pct2} of records checked", { pct2: pct2(v.failingPct) }));
  if (v.row?.value_at_risk != null) out.push(t("{formatMoneyCompact} at risk, estimated", { formatMoneyCompact: moneyCompactText(v.row.value_at_risk, v.currency) }));
  if (v.overTolerance != null) out.push(v.overTolerance ? t("fails on too many records") : t("within the allowed limit"));
  if (s.features.length > 0) out.push(t("blocks {featuresCount} S/4 {featuresCount, plural, one {feature} other {features}}", { featuresCount: s.features.length }));
  return out;
}

/**
 * One rule across systems, /more/rules/{id}: the banner with the failing count and the one primary action, the
 * statistics line, then seven tabs. The sections are the native inspector's, laid out as a page.
 */
export function RuleDetail({ id }: { id: string }) {
  const router = useRouter();
  const path = usePathname() ?? "";
  const params = useSearchParams();
  const tab = tabOf(params?.get("tab") ?? null);
  const state = useRule(id);

  const go = (key: TabKey) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (key === "overview") next.delete("tab");
    else next.set("tab", key);
    next.delete("open");
    const qs = next.toString();
    router.replace(`${path}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  if (state.status === "loading") {
    return (
      <div className="nx-rd" aria-busy="true" data-testid="rule-detail-loading">
        <h1><Code code={id} text={t("Rule")} /></h1>
        <Skeleton lines={6} label={t("Loading the rule")} />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="nx-rd" data-testid="rule-detail-error">
        <h1><Code code={id} text={t("Rule")} /></h1>
        <ErrorState sentence={t("This rule could not be read. It may not exist in this tenant, or the API may be unreachable.")} onRetry={state.refetch} />
        <EmptyState heading={t("Find the rule in the library")} action={<NxLink href="/more/rules" className="nx-btn">{t("Open the rules library")}</NxLink>}>
          {t("The rules library lists every rule of the tenant; search it by code or name.")}
        </EmptyState>
      </div>
    );
  }

  const v = state.view;
  const s = v.scope;
  const name = s.name ?? s.definition.message ?? null;
  const fromParam = params?.get("from") ?? null;
  const from = fromParam && /^\/o\/[\w-]+\/[\w-]+$/.test(fromParam) ? fromParam : null;
  const run = params?.get("run") ?? null;
  const field = s.definition.field;

  return (
    <div className="nx-rd" data-testid="rule-detail">
      <header className="nx-rd-head">
        <h1>{name ?? <Code code={id} text={t("Rule")} />}</h1>
        {name ? <p className="nx-sub"><Code code={id} text={t("Rule")} /></p> : null}
        <p>{t("One rule and what it finds in the newest run. Start with the failing records, then use the tabs for where the rule comes from and who changed the values.")}</p>
      </header>

      <section className="nx-rd" aria-label={t("Rule summary")} data-testid="rule-banner">
        <h2>
          {s.failing_records === 0
            ? t("No record fails this rule")
            : t("{n} {count, plural, one {record fails} other {records fail}} this rule", { n: int(s.failing_records), count: s.failing_records })}
        </h2>
        {field ? (
          <p>
            {t("It checks")} <Code code={field} text={v.row?.field_description ?? undefined} />
          </p>
        ) : null}
        <div className="nx-rd-figs">
          <StatCard
            label={t("Failing records")}
            value={s.failing_records}
            format={int}
            note={v.failingPct != null ? t("{pct2} of records checked", { pct2: `${f1(v.failingPct)}%` }) : t("Records in the newest run that do not meet this rule.")}
          />
          <StatCard label={t("Objects affected")} value={s.objects.length} format={int} note={t("Objects that use this rule.")} />
        </div>
        <div>
          <Button variant="primary" onClick={() => go("failing")}>{t("Show the failing records")}</Button>
          <p className="nx-sub">{t("Seeing the records shows what to fix first.")}</p>
        </div>
      </section>

      <p className="nx-rd-line nx-sub" data-testid="rule-stat-line">
        {ruleStatLine(v).map((x) => (
          <span key={x}>{x}</span>
        ))}
      </p>
      <p className="nx-rd-line" data-testid="rule-back">
        {from ? <NxLink href={`${from}${run ? `?run=${encodeURIComponent(run)}` : ""}`}>{t("Back to the object")}</NxLink> : null}
        <NxLink href="/more/rules">{t("All rules")}</NxLink>
      </p>

      <Tabs
        items={KEYS.map((k) => ({ id: k, label: LABEL[k]() }))}
        value={tab}
        onChange={(k) => go(k as TabKey)}
        label={t("Views of {id}", { id })}
        idBase="rule-detail"
      />
      <div id={`rule-detail-panel-${tab}`} role="tabpanel" className="nx-rd" aria-labelledby={`rule-detail-tab-${tab}`}>
        <p className="nx-sub" data-testid="rule-tab-hint">{HINT[tab]()}</p>
        {tab === "overview" ? (
          <>
            <RuleFailuresBy id={id} />
            <RuleRootCause view={v} />
            <div className="nx-rd-cols" data-testid="rule-why">
              <div className="nx-rd-col"><RuleAuthority view={v} /></div>
              <div className="nx-rd-col"><RuleHistory view={v} /></div>
            </div>
          </>
        ) : tab === "blast" ? (
          <BlastRadius view={v} onFix={() => go("failing")} />
        ) : tab === "definition" ? (
          <div className="nx-rd-cols">
            <div className="nx-rd-col">
              <RuleDefinition view={v} />
              <RuleAuthority view={v} />
              <RuleVersions view={v} />
            </div>
            <div className="nx-rd-col">
              <RuleScopeSection view={v} />
              <RuleContract view={v} />
              <RuleActionsNative view={v} />
            </div>
          </div>
        ) : tab === "failing" ? (
          <FailingRecords view={v} />
        ) : tab === "prove" ? (
          <RuleProve view={v} />
        ) : tab === "impact" ? (
          <div className="nx-rd-cols">
            <div className="nx-rd-col"><RuleFacts view={v} /></div>
            <div className="nx-rd-col">
              <RuleBlocks view={v} />
              <RuleLineage view={v} />
            </div>
          </div>
        ) : (
          <RuleHistory view={v} />
        )}
      </div>
    </div>
  );
}
