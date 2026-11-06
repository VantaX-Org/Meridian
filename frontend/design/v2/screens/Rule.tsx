"use client";

import { useSearchParams } from "next/navigation";
import { RuleActions, RuleAuthority, RuleBlocks, RuleContract, RuleDefinition, RuleFacts, RuleHistory, RuleLineage, RuleProve, RuleScopeSection, RuleVersions, SectionLevel, ruleStatLine, useRule } from "../inspector/rule";
import { EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";
import { int } from "@/lib/v2/score";
import { Lede, PrimaryAction } from "../RunParts";
import { CcBanner, CcPage } from "./cc-parts";
import { LedgerSlot } from "./object/LedgerSlot";
import { RuleOverview } from "./RuleOverview";
import { BlastRadius } from "./BlastRadius";
import { t as tr } from "@/lib/v2/i18n";
import { useState } from "react";
import { exportFindingRecords } from "@/lib/api/findings";
import { useV2Session } from "@/lib/v2/hooks";
import { useToast } from "../Toast";
import { errorSentence } from "@/lib/api/v2/work";

type TabKey = "overview" | "blast" | "definition" | "failing" | "prove" | "impact" | "history";
const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", get label() { return tr("Overview"); } },
  { key: "blast", get label() { return tr("Blast radius"); } },
  { key: "definition", get label() { return tr("Definition"); } },
  { key: "failing", get label() { return tr("Failing records"); } },
  { key: "prove", get label() { return tr("Prove in SAP"); } },
  { key: "impact", get label() { return tr("Impact"); } },
  { key: "history", get label() { return tr("History"); } },
];

function tabOf(value: string | null): TabKey {
  return TABS.some((t) => t.key === value) ? (value as TabKey) : "overview";
}

/**
 * The rule canvas, /r/{check_id}: one rule across systems. The header is the rule's own statistics in a line (no
 * ruler: a rule has no score of its own), then Overview (why, trend, failures by plant), Definition, Failing records (the ledger scoped to the rule), Prove in
 * SAP (the SE16 selection that reproduces the count), Impact and History. The content is the inspector's, laid out as
 * a canvas.
 */
export function RuleCanvas({ id }: { id: string }) {
  const params = useSearchParams();
  const tab = tabOf(params.get("tab"));
  const state = useRule(id);

  if (state.status === "loading") {
    return (
      <CcPage>
        <div aria-busy="true" data-testid="rule-canvas-loading">
          <PageTitle>
            <Mono>{id}</Mono>
          </PageTitle>
          <p className="m2-statusline"><Skeleton width={420} height={14} /></p>
          <div className="m2-sec"><Skeleton width="100%" height={160} /></div>
        </div>
      </CcPage>
    );
  }
  if (state.status === "error") {
    return (
      <CcPage>
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
      </CcPage>
    );
  }

  const v = state.view;
  const name = v.scope.name ?? v.scope.definition.message ?? null;
  const href = (key: TabKey) => {
    const next = new URLSearchParams(params.toString());
    if (key === "overview") next.delete("tab");
    else next.set("tab", key);
    next.delete("open");
    const qs = next.toString();
    return `/r/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`;
  };
  return (
    <CcPage>
      <PageTitle sub={name ? <Mono>{id}</Mono> : undefined}>{name ?? <Mono>{id}</Mono>}</PageTitle>
      <Lede>{tr("One rule and what it finds in the newest run. Start with the failing records, then use the tabs for where the rule comes from and who changed the values.")}</Lede>
      <CcBanner
        testId="rule-banner"
        label={tr("Rule summary")}
        eyebrow={tr("This rule")}
        verdict={v.scope.failing_records === 0 ? "go" : v.overTolerance === false ? "at-risk" : "no-go"}
        headline={
          v.scope.failing_records === 0
            ? tr("No record fails this rule")
            : tr("{n} {count, plural, one {record fails} other {records fail}} this rule", { n: int(v.scope.failing_records), count: v.scope.failing_records })
        }
        why={
          v.scope.definition.field ? (
            <>
              {tr("It checks")} {v.row?.field_description ? <>{v.row.field_description} <span className="m2-meta"><Mono>{v.scope.definition.field}</Mono></span></> : <Mono>{v.scope.definition.field}</Mono>}
            </>
          ) : undefined
        }
        figs={[
          { label: tr("Failing records"), value: int(v.scope.failing_records), note: v.failingPct != null ? tr("{pct2} of records checked", { pct2: `${v.failingPct.toFixed(2)}%` }) : undefined, hint: tr("Records in the newest run that do not meet this rule.") },
          { label: tr("Objects affected"), value: int(v.scope.objects.length), hint: tr("Objects that use this rule.") },
        ]}
        action={
          <PrimaryAction
            action={<V2Link href={href("failing")} className="m2-btn m2-next">{tr("Show the failing records")}</V2Link>}
            why={tr("Seeing the records shows what to fix first.")}
          />
        }
      />
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
          {tab === "overview" ? (
            <RuleOverview view={v} />
          ) : tab === "blast" ? (
            <BlastRadius checkId={id} versionId={v.scope.objects[0]?.run_id ?? null} failing={v.scope.failing_records} fixHref={href("failing")} />
          ) : tab === "definition" ? (
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
            <>
              <RecordsExport checkId={id} runIds={[...new Set(v.scope.objects.map((o) => o.run_id).filter((r): r is string => !!r))]} />
              <LedgerSlot label={id} scope={{ module: v.scope.module ?? v.scope.objects[0]?.module, filters: { check_id: id } }} />
            </>
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
    </CcPage>
  );
}

/** Saves every record that fails the rule, one Excel file per run the rule was measured in. */
function RecordsExport({ checkId, runIds }: { checkId: string; runIds: string[] }) {
  const session = useV2Session();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!runIds.length) return null;
  return (
    <p className="m2-prov">
      <button
        type="button"
        className="m2-btn"
        disabled={busy || !session.can("export")}
        onClick={async () => {
          if (session.fixture) return toast.show(tr("Fixture mode: no file is produced"));
          setBusy(true);
          try {
            for (const r of runIds) await exportFindingRecords(r, checkId, "xlsx");
            toast.show(tr("Findings downloading"));
          } catch (err) {
            toast.show(errorSentence(err, tr("The export failed.")), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        {tr("Export the failing records")}
      </button>
    </p>
  );
}
