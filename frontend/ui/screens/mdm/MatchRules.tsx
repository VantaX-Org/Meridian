"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { approveProposedRule, BANDS, createMatchRule, deleteMatchRule, listMatchRules, listProposedRules, MATCH_TYPES, rejectProposedRule, simulateMatchRules, updateMatchRule, type MatchRule, type MatchSimulation, type MatchType, type ProposedRule } from "@/lib/api/v2/match-rules";
import { describeField } from "@/lib/v2/sap-fields";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Button, Card, Confirm, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, PageHeader, Select, Skeleton, StatTile, Toggle, useAletheia, useAletheiaScope } from "@/ui/kit";
import { DEFAULT_DOMAIN, DomainSelect, pct, useAct, useHref } from "./shared";

const typeLabel = (m: MatchType) =>
  m === "exact" ? t("Exact") : m === "fuzzy" ? t("Fuzzy") : m === "phonetic" ? t("Phonetic") : m === "numeric_range" ? t("Numeric range") : t("Semantic");

export function MatchRules() {
  useInterfaceLang();
  const href = useHref();
  const fx = useFixture();
  const chat = useAletheia();
  const { act, busy } = useAct();
  const [domain, setDomain] = useState(DEFAULT_DOMAIN);
  const [field, setField] = useState("");
  const [mtype, setMtype] = useState<MatchType>("exact");
  const [weight, setWeight] = useState("10");
  const [threshold, setThreshold] = useState("0.9");
  const [sim, setSim] = useState<MatchSimulation | null>(null);
  const [del, setDel] = useState<MatchRule | null>(null);
  const [rej, setRej] = useState<ProposedRule | null>(null);
  const [why, setWhy] = useState("");
  const rules = useQuery({ queryKey: ["v2", "mdm", "match-rules", fx], queryFn: listMatchRules, staleTime: 30_000, retry: false });
  const prop = useQuery({ queryKey: ["v2", "mdm", "proposed-rules", fx], queryFn: listProposedRules, staleTime: 30_000, retry: false });
  const mine = (rules.data?.rules ?? []).filter((r) => r.domain === domain);
  const w = Number(weight);
  const th = Number(threshold);
  const valid = field.trim() !== "" && Number.isFinite(w) && w > 0 && th >= 0 && th <= 1;

  useAletheiaScope({
    key: `mdm-match-rules/${domain}`,
    label: t("Asking about match rules"),
    suggestions: [t("Which field should weigh more?"), t("What do the proposed rules change?")],
    answer: () => ({
      text: t("{n} rules score pairs of this object. A pair at {a} or more merges by itself and below {l} is dismissed.", { n: mine.length, a: pct(BANDS.autoMerge), l: pct(BANDS.reviewFloor) }),
      evidence: mine.slice(0, 3).map((r) => `${r.field}: ${typeLabel(r.match_type)}, ${r.weight}`),
    }),
  });

  return (
    <>
      <PageHeader
        title={t("Match rules")}
        context={t("{n} rules", { n: mine.length })}
        actions={<>
          <Button variant="ghost" href={href("/n/mdm/match")}>{t("Match review")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      <div className="mx-col">
        <DomainSelect value={domain} onChange={setDomain} />
        <Card
          title={t("Rules")}
          sub={t("A pair at {a} or more merges by itself. Below {l} it is dismissed. Between the two a steward decides.", { a: pct(BANDS.autoMerge), l: pct(BANDS.reviewFloor) })}
        >
          {rules.isLoading ? <Skeleton lines={6} label={t("Loading match rules")} /> : rules.isError ? <ErrorState heading={t("Match rules could not be loaded")} /> : mine.length === 0 ? (
            <EmptyState heading={t("No match rules for this object")} body={t("Add a rule below to start scoring pairs.")} />
          ) : (
            <DataTable<MatchRule>
              label={t("Match rules")}
              rows={mine}
              rowKey={(r) => r.id}
              columns={[
                { key: "f", label: t("Field"), render: (r) => <FieldChip code={r.field} description={describeField(r.field) ?? undefined} /> },
                { key: "t", label: t("Comparison"), render: (r) => typeLabel(r.match_type) },
                { key: "w", label: t("Weight"), align: "end", sort: (r) => r.weight, render: (r) => r.weight },
                { key: "th", label: t("Threshold"), align: "end", render: (r) => pct(r.threshold) },
                { key: "a", label: t("Active"), render: (r) => <Toggle label={t("Active")} checked={r.active} onChange={(v) => act(() => updateMatchRule(r.id, { active: v }), t("Rule updated"))} /> },
                { key: "x", label: t("Action"), render: (r) => <Button variant="ghost" disabled={busy} onClick={() => setDel(r)}>{t("Delete")}</Button> },
              ]}
            />
          )}
        </Card>
        <Card title={t("Add a rule")}>
          <div className="mx-links">
            <Field label={t("Field")}><Input value={field} onChange={(e) => setField(e.target.value)} /></Field>
            <Field label={t("Comparison")}>
              <Select value={mtype} onChange={(e) => setMtype(e.target.value as MatchType)} options={MATCH_TYPES.map((m) => ({ value: m, label: typeLabel(m) }))} />
            </Field>
            <Field label={t("Weight")}><Input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" /></Field>
            <Field label={t("Threshold")} hint={t("A share from 0 to 1.")}><Input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" /></Field>
            <Button variant="primary" disabled={busy || !valid} onClick={() => act(async () => { await createMatchRule({ domain, field: field.trim(), match_type: mtype, weight: w, threshold: th, active: true }); setField(""); }, t("Rule added"))}>{t("Add rule")}</Button>
          </div>
        </Card>
        <Card
          title={t("Simulate")}
          sub={t("Score the latest pending pairs with the active rules. Nothing is changed.")}
          action={<Button variant="secondary" disabled={busy} onClick={() => act(async () => { const r = await simulateMatchRules(domain); setSim(r); return r; }, t("Simulation finished"))}>{t("Run simulation")}</Button>}
        >
          {sim ? (
            <dl className="mx-tiles">
              <StatTile label={t("Pairs scored")} value={String(sim.total_pairs)} />
              <StatTile label={t("Would auto-merge")} value={String(sim.auto_merge_count)} />
              <StatTile label={t("Would auto-dismiss")} value={String(sim.auto_dismiss_count)} />
              <StatTile label={t("Left for stewards")} value={String(sim.queue_count)} />
            </dl>
          ) : <p className="mx-muted">{t("Run the simulation to see how the rules would sort the pairs.")}</p>}
        </Card>
        <Card title={t("Rules proposed by Aletheia")} sub={t("Drawn from steward corrections. Approve to copy a proposal into the match rules.")}>
          {prop.isLoading ? <Skeleton lines={3} label={t("Loading proposed rules")} /> : (prop.data?.rules ?? []).length === 0 ? (
            <EmptyState heading={t("No proposals waiting")} />
          ) : (
            <DataTable<ProposedRule>
              label={t("Proposed rules")}
              rows={prop.data?.rules ?? []}
              rowKey={(p) => p.id}
              columns={[
                { key: "f", label: t("Field"), render: (p) => (p.proposed_rule.field ? <FieldChip code={p.proposed_rule.field} description={describeField(p.proposed_rule.field) ?? undefined} /> : "") },
                { key: "t", label: t("Comparison"), render: (p) => (p.proposed_rule.match_type ? typeLabel(p.proposed_rule.match_type) : "") },
                { key: "w", label: t("Weight"), align: "end", render: (p) => p.proposed_rule.weight ?? "" },
                { key: "n", label: t("Corrections"), align: "end", render: (p) => p.supporting_correction_count },
                { key: "r", label: t("Why"), render: (p) => p.rationale },
                {
                  key: "x", label: t("Decision"), render: (p) => (
                    <span className="mx-links">
                      <Button variant="primary" disabled={busy} onClick={() => act(() => approveProposedRule(p.id), t("Rule approved"))}>{t("Approve")}</Button>
                      <Button variant="ghost" disabled={busy} onClick={() => setRej(p)}>{t("Reject")}</Button>
                    </span>
                  ),
                },
              ]}
            />
          )}
        </Card>
      </div>
      <Confirm
        open={del !== null}
        title={t("Delete this rule?")}
        confirmLabel={t("Delete")}
        cancelLabel={t("Cancel")}
        danger
        onConfirm={() => { const r = del; setDel(null); if (r) void act(() => deleteMatchRule(r.id), t("Rule deleted")); }}
        onCancel={() => setDel(null)}
      />
      <Confirm
        open={rej !== null}
        title={t("Reject this proposal?")}
        confirmLabel={t("Reject")}
        cancelLabel={t("Cancel")}
        onConfirm={() => { const p = rej; const r = why; setRej(null); setWhy(""); if (p) void act(() => rejectProposedRule(p.id, r), t("Proposal rejected")); }}
        onCancel={() => { setRej(null); setWhy(""); }}
      >
        <Field label={t("Reason")}><Input value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
      </Confirm>
    </>
  );
}
