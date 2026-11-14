"use client";

import { useMemo, useState } from "react";
import { t } from "@/lib/v2/i18n";
import { AdminCanvas } from "@/design/v2/admin/Admin";
import { RulePromotion } from "@/design/v2/screens/RulePromotion";
import { useAllDrafts, useRuleList } from "@/lib/v2/sys-queries";
import type { Rule } from "@/lib/api/rules";
import { Chip, SegmentedControl } from "../kit";
import { useSheets } from "../shell/SheetHost";
import { LegacyMount } from "../shell/LegacyMount";
import { LongText, ListSearch, QueryView, VirtualList } from "./states";
import { PassRateCard, RulesCard } from "./cards";

type Seg = "active" | "drafts" | "promotion" | "learned" | "packs";
const TONE = { critical: "bad", high: "bad", medium: "warn", low: "neutral", info: "neutral" } as const;

const SEVERITY = () => ({ critical: t("Critical"), high: t("High"), medium: t("Medium"), low: t("Low"), info: t("Info") });

function RuleRows({ rules, label, empty }: { rules: Rule[]; label: string; empty: string }) {
  const sheets = useSheets();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? rules.filter((r) => `${r.name} ${r.module} ${r.category}`.toLowerCase().includes(n)) : rules;
  }, [rules, q]);
  const sev = SEVERITY();
  return (
    <>
      <ListSearch value={q} onChange={setQ} label={t("Search rules")} />
      <p className="nx-sub" role="status">{t("{n} rules", { n: shown.length })}</p>
      {shown.length === 0 ? (
        <p className="nx-sub">{q ? t("No rule matches this search.") : empty}</p>
      ) : (
        <VirtualList
          rows={shown}
          rowKey={(r) => r.id}
          label={label}
          render={(r) => (
            <button type="button" className="nx-row nx-row-main nx-link" onClick={() => sheets.open({ kind: "library-rule", id: r.id })}>
              <LongText text={r.name} className="nx-row-main" />
              <span className="nx-sub">{r.module}</span>
              <Chip tone={TONE[r.severity]}>{sev[r.severity]}</Chip>
              {r.enabled ? null : <Chip>{t("Off")}</Chip>}
            </button>
          )}
        />
      )}
    </>
  );
}

/** Rules in five segments. Active and Learned are drawn here; Promotion and Packs reuse the existing screens. */
export function Rules() {
  const [seg, setSeg] = useState<Seg>("active");
  const list = useRuleList();
  const drafts = useAllDrafts(seg === "drafts");
  const rules = list.data?.rules ?? [];
  return (
    <div className="nx-body">
      <div className="nx-chartcards"><RulesCard /><PassRateCard /></div>
      <SegmentedControl
        label={t("Rules")}
        value={seg}
        onChange={(v) => setSeg(v as Seg)}
        items={[
          { value: "active", label: t("Active") },
          { value: "drafts", label: t("Drafts") },
          { value: "promotion", label: t("Promotion") },
          { value: "learned", label: t("Learned") },
          { value: "packs", label: t("Packs") },
        ]}
      />
      {seg === "active" || seg === "learned" ? (
        <QueryView loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()} empty={rules.length === 0} emptyHeading={t("No rules yet")} emptyText={t("Rules appear here once an object has been scored.")} label={t("Loading rules")}>
          {seg === "active" ? (
            <RuleRows rules={rules.filter((r) => r.enabled)} label={t("Active rules")} empty={t("No rule is on.")} />
          ) : (
            <RuleRows rules={rules.filter((r) => r.source === "mined")} label={t("Learned rules")} empty={t("Aletheia has not learned a rule yet.")} />
          )}
        </QueryView>
      ) : null}
      {seg === "drafts" ? (
        <QueryView loading={drafts.isLoading} error={drafts.error} onRetry={() => void drafts.refetch()} empty={(drafts.data ?? []).length === 0} emptyHeading={t("No drafts")} emptyText={t("A rule you start but do not publish waits here.")} label={t("Loading drafts")}>
          <ul className="nx-pick" aria-label={t("Drafts")}>
            {(drafts.data ?? []).map((d) => (
              <li key={d.id} className="nx-row"><LongText text={d.rationale || d.id} className="nx-row-main" /><span className="nx-sub">{d.domain.replace("dq_rule:", "")}</span><Chip>{d.status}</Chip></li>
            ))}
          </ul>
        </QueryView>
      ) : null}
      {seg === "promotion" ? <LegacyMount><RulePromotion /></LegacyMount> : null}
      {seg === "packs" ? <LegacyMount><AdminCanvas section="policypacks" /></LegacyMount> : null}
    </div>
  );
}
